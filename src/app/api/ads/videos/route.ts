import { NextResponse } from "next/server";
import { getMetaConfig, metaGraph } from "@/lib/meta-config";
import {
  PRIORIDAD_FUENTE_COPY,
  esNombreDeArchivo,
  etiquetaFuenteCopy,
  limpiarCopy,
  primerLineaCopy,
  revisarCopy,
  type FuenteCopy,
} from "@/lib/copy-post";

export const dynamic = "force-dynamic";

/**
 * Candidato de copy de un video.
 *
 * El copy se busca en el TEXTO DE LOS POSTS (publicaciones), en este orden de
 * confianza y prefiriendo siempre el más reciente:
 *   1. post       → texto de la publicación en la Fan Page
 *   2. post_anuncio → texto del post del anuncio (publicación oculta)
 *   3. ad_creative → texto del creativo del anuncio (Advantage+ / DCO)
 *   4. video_description → descripción del video en Meta
 *   5. video_node → descripción leída del nodo del video
 * El nombre del archivo del video ("Auto_Cropped_AR_4_X_5_DCO_...") NUNCA es
 * copy: se descarta y se avisa en `copy_descartado`.
 */
type InfoCopy = {
  texto: string;
  fuente: FuenteCopy;
  permalink: string;
  postId: string;
  fecha: number; // milisegundos del post/anuncio, para elegir el más reciente
};

/** Guarda un candidato de copy para un video (sin duplicar el mismo texto). */
function agregarCandidato(store: Map<string, InfoCopy[]>, videoId: string, info: InfoCopy) {
  const clave = String(videoId || "").trim();
  if (!clave || !info.texto) return;
  const lista = store.get(clave) || [];
  if (lista.some((c) => c.texto === info.texto && c.fuente === info.fuente)) return;
  lista.push({ ...info, texto: info.texto });
  store.set(clave, lista);
}

/** Mejor candidato: primero el más reciente, y a igual fecha la fuente más confiable. */
function mejorCandidato(lista: InfoCopy[] | undefined): InfoCopy | null {
  if (!lista || lista.length === 0) return null;
  return [...lista].sort((a, b) => {
    if ((b.fecha || 0) !== (a.fecha || 0)) return (b.fecha || 0) - (a.fecha || 0);
    return PRIORIDAD_FUENTE_COPY[b.fuente] - PRIORIDAD_FUENTE_COPY[a.fuente];
  })[0];
}

function aMilisegundos(fecha: unknown): number {
  const t = Date.parse(String(fecha || ""));
  return isNaN(t) ? 0 : t;
}

/**
 * Saca los ids de video que Meta enlaza en un adjunto de post, sin filtrar por
 * tipo: si el post trae el video de cualquier forma (target, media, object_id,
 * subadjuntos) hay que enlazarlo para poder leer su texto.
 */
function extraerIdsVideoDeAdjunto(att: any): string[] {
  const ids: string[] = [];
  const vistos = new Set<any>();
  const push = (v: any) => {
    const s = String(v || "").trim();
    if (s && !ids.includes(s)) ids.push(s);
  };
  const recorrer = (a: any) => {
    if (!a || typeof a !== "object" || vistos.has(a)) return;
    vistos.add(a);
    push(a?.target?.id);
    push(a?.media?.video?.id);
    push(a?.media?.id);
    push(a?.object_id);
    for (const sub of a?.subattachments?.data || []) recorrer(sub);
  };
  recorrer(att);
  return ids;
}

/**
 * Lee el copy REAL de los anuncios de la cuenta publicitaria.
 * En anuncios de video (incluidos los DCO / auto-cropped) el texto que se
 * publica vive en el creativo y/o en el post del anuncio, no en el nombre del
 * archivo del video.
 */
async function cargarCopysDeAnuncios(opts: {
  adAccountId: string;
  metaToken: string;
  pageToken: string;
  store: Map<string, InfoCopy[]>;
  debug: string[];
}): Promise<{ videos: number; copys: number }> {
  const { adAccountId, metaToken, pageToken, store, debug } = opts;
  if (!adAccountId) return { videos: 0, copys: 0 };

  const tokenParam = `access_token=${encodeURIComponent(metaToken)}`;
  // Si un campo no existe, Meta tumba TODA la consulta: se prueba de más a menos.
  const intentosCampos = [
    "id,name,effective_object_story_id,created_time,creative{id,name,body,title,object_story_spec,asset_feed_spec}",
    "id,name,effective_object_story_id,created_time,creative{id,name,object_story_spec,asset_feed_spec}",
    "id,name,effective_object_story_id,created_time,creative{id,name,object_story_spec}",
  ];

  let primeraUrl: string | null = null;
  for (const campos of intentosCampos) {
    const url = metaGraph(`/act_${adAccountId}/ads?fields=${encodeURIComponent(campos)}&limit=100&${tokenParam}`);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json: any = await res.json().catch(() => ({}));
      if (res.ok && !json?.error) {
        primeraUrl = url;
        break;
      }
      debug.push(`ads creatividades: ${res.status}${json?.error?.message ? " " + json.error.message : ""}`);
    } catch (e: any) {
      debug.push(`ads creatividades error: ${e.message}`);
    }
  }
  if (!primeraUrl) {
    debug.push("No se pudieron leer las creatividades de los anuncios (se sigue con los posts de la página).");
    return { videos: 0, copys: 0 };
  }

  const postDeAnuncio = new Map<string, string>(); // videoId -> id del post del anuncio
  let videosConTexto = 0;
  let anunciosLeidos = 0;
  let next: string | null = primeraUrl;
  let pagina = 0;

  while (next && pagina < 2) {
    const res = await fetch(next, { cache: "no-store" });
    const json: any = await res.json().catch(() => ({}));
    debug.push(`ads p${pagina + 1}: ${res.status} (${json?.data?.length || 0})${json?.error ? " " + json.error.message : ""}`);

    for (const ad of json?.data || []) {
      anunciosLeidos++;
      const creativo = ad?.creative || {};
      const spec = creativo?.object_story_spec || {};
      const feed = creativo?.asset_feed_spec || {};
      const fecha = aMilisegundos(ad?.created_time);

      // Textos publicados por este anuncio (el "texto dentro del post")
      const textos: string[] = [];
      const candidatosTexto = [
        creativo?.body,
        spec?.video_data?.message,
        spec?.link_data?.message,
        ...(Array.isArray(feed?.bodies) ? feed.bodies.map((b: any) => b?.text) : []),
      ];
      for (const t of candidatosTexto) {
        const limpio = limpiarCopy(t);
        if (limpio && !textos.includes(limpio)) textos.push(limpio);
      }

      // Videos que usa el anuncio
      const videoIds: string[] = [];
      const pushVideo = (v: any) => {
        const id = String(v || "").trim();
        if (id && !videoIds.includes(id)) videoIds.push(id);
      };
      pushVideo(spec?.video_data?.video_id);
      if (Array.isArray(feed?.videos)) for (const v of feed.videos) pushVideo(v?.video_id);
      if (Array.isArray(spec?.link_data?.child_attachments)) {
        for (const c of spec.link_data.child_attachments) pushVideo(c?.video_id);
      }
      // Videos con creatividades DCO: los objetos traen video_id dentro de "video"
      if (Array.isArray(feed?.videos)) {
        for (const v of feed.videos) pushVideo(v?.video?.id);
      }

      if (videoIds.length === 0) continue;
      if (textos.length > 0) videosConTexto++;
      if (ad?.effective_object_story_id) {
        for (const vid of videoIds) postDeAnuncio.set(vid, String(ad.effective_object_story_id));
      }
      if (textos.length === 0) continue;

      for (const vid of videoIds) {
        agregarCandidato(store, vid, {
          texto: textos[0],
          fuente: "ad_creative",
          permalink: ad?.effective_object_story_id ? `https://www.facebook.com/${ad.effective_object_story_id}` : "",
          postId: String(ad?.effective_object_story_id || ""),
          fecha,
        });
      }
    }

    next = json?.paging?.next || null;
    pagina++;
  }

  // El post del anuncio (publicación oculta) es el texto tal cual se publica
  const tokenLectura = pageToken || metaToken;
  const tokenLecturaParam = `access_token=${encodeURIComponent(tokenLectura)}`;
  const idsPost = Array.from(new Set(postDeAnuncio.values())).slice(0, 15);
  let copysDePostAnuncio = 0;

  for (const postId of idsPost) {
    try {
      const res = await fetch(metaGraph(`/${postId}?fields=message,created_time&${tokenLecturaParam}`), { cache: "no-store" });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        debug.push(`post del anuncio ${postId}: ${res.status}${json?.error?.message ? " " + json.error.message : ""}`);
        continue;
      }
      const info = revisarCopy(json?.message);
      if (!info.texto) continue;
      const fecha = aMilisegundos(json?.created_time);
      for (const [vid, pid] of postDeAnuncio) {
        if (pid !== postId) continue;
        agregarCandidato(store, vid, {
          texto: info.texto,
          fuente: "post_anuncio",
          permalink: `https://www.facebook.com/${postId}`,
          postId,
          fecha,
        });
        copysDePostAnuncio++;
      }
    } catch (e: any) {
      debug.push(`post del anuncio ${postId} error: ${e.message}`);
    }
  }

  debug.push(`ads leídos: ${anunciosLeidos} · con texto: ${videosConTexto} · posts de anuncio con copy: ${copysDePostAnuncio}`);
  return { videos: videosConTexto, copys: copysDePostAnuncio };
}

// GET: Obtener TODOS los videos publicados en la Fan Page con su COPY REAL
export async function GET() {
  try {
    const { metaToken, adAccountId, pageId: configuredPageId } = await getMetaConfig();

    if (!metaToken) {
      return NextResponse.json({
        ok: false,
        videos: [],
        error: "Falta META_MARKETING_TOKEN."
      });
    }

    const tokenParam = `access_token=${encodeURIComponent(metaToken)}`;
    let videos: any[] = [];
    let pageName = "";
    let pageId = configuredPageId || "";
    let pageToken = metaToken;
    let pageWarning = "";
    const debug: string[] = [];

    // Candidatos de copy por video: posts de la página + anuncios
    const copysPorVideo = new Map<string, InfoCopy[]>();
    // Descripción cruda del video (última opción del copy)
    const descripcionCruda = new Map<string, string>();

    // 1) Resolver la página SIN cambiarla en silencio a otra.
    //    Si la página configurada no aparece en me/accounts, se sigue usando
    //    igual (con aviso) en vez de tomar videos de otra página.
    try {
      const accountsUrl = metaGraph(`/me/accounts?fields=id,name,access_token&limit=50&${tokenParam}`);
      const accountsRes = await fetch(accountsUrl, { cache: "no-store" });
      const accountsData = await accountsRes.json().catch(() => ({}));
      debug.push(`me/accounts: ${accountsRes.status} (${accountsData?.data?.length || 0})`);

      const lista = Array.isArray(accountsData?.data) ? accountsData.data : [];
      if (lista.length > 0) {
        const configurada = configuredPageId ? lista.find((p: any) => String(p.id) === String(configuredPageId)) : null;
        if (configurada) {
          pageName = configurada.name;
          pageId = configurada.id;
          pageToken = configurada.access_token || metaToken;
        } else if (configuredPageId) {
          // NO saltar a otra página: mantener la configurada con el token de usuario
          pageWarning = `La página ${configuredPageId} no aparece en las páginas del token; se intenta igual con el token de usuario. Si no cargan videos, revisa los permisos pages_show_list y pages_read_engagement.`;
          debug.push(`aviso: página configurada ${configuredPageId} no está en me/accounts`);
        } else {
          const templo = lista.find((p: any) =>
            (p.name || "").toLowerCase().includes("templo") || (p.name || "").toLowerCase().includes("mistico")
          ) || lista[0];
          if (templo) {
            pageName = templo.name;
            pageId = templo.id;
            pageToken = templo.access_token || metaToken;
            pageWarning = `No hay página configurada; se está usando "${templo.name}". Configura META_PAGE_ID para fijar la correcta.`;
          }
        }
      } else if (configuredPageId) {
        pageWarning = "El token no devolvió páginas (me/accounts vacío). Se intenta con la página configurada; revisa los permisos pages_show_list y pages_read_engagement.";
      }
    } catch (eAcc: any) {
      debug.push(`me/accounts error: ${eAcc.message}`);
    }

    // Nombre de la página si aún no lo tenemos
    if (!pageName && pageId) {
      try {
        const pInfoRes = await fetch(metaGraph(`/${pageId}?fields=id,name&${tokenParam}`), { cache: "no-store" });
        const pInfo = await pInfoRes.json().catch(() => ({}));
        if (pInfo?.name) pageName = pInfo.name;
      } catch {}
    }

    if (pageId) {
      try {
        const pageTokenParam = `access_token=${encodeURIComponent(pageToken)}`;

        // 2) POSTS de la página: el texto del post ES el copy del video.
        //    Se enlaza por object_id y por TODOS los ids del adjunto (sin
        //    filtrar por tipo, porque Meta cambia el tipo según el post).
        try {
          let nextPost: string | null = metaGraph(`/${pageId}/posts?fields=id,message,object_id,created_time,permalink_url,attachments{media_type,type,title,description,target,media,subattachments}&limit=100&${pageTokenParam}`);
          let pPost = 0;
          while (nextPost && pPost < 5) {
            const pRes = await fetch(nextPost, { cache: "no-store" });
            const pData: any = await pRes.json().catch(() => ({}));
            debug.push(`page posts p${pPost + 1}: ${pRes.status} (${pData?.data?.length || 0})${pData?.error ? " " + pData.error.message : ""}`);

            for (const post of pData?.data || []) {
              const info = revisarCopy(post?.message);
              const fecha = aMilisegundos(post?.created_time);
              const permalink = post?.permalink_url || "";
              const postId = String(post?.id || "");
              if (!info.texto) continue;

              const candidato: InfoCopy = { texto: info.texto, fuente: "post", permalink, postId, fecha };
              if (post?.object_id) agregarCandidato(copysPorVideo, String(post.object_id), candidato);

              for (const att of post?.attachments?.data || []) {
                for (const vid of extraerIdsVideoDeAdjunto(att)) agregarCandidato(copysPorVideo, vid, candidato);

                // La descripción del adjunto también puede traer el copy del post
                const descAdj = revisarCopy(att?.description);
                if (descAdj.texto) {
                  for (const vid of extraerIdsVideoDeAdjunto(att)) {
                    agregarCandidato(copysPorVideo, vid, { ...candidato, texto: descAdj.texto, fuente: "video_description" });
                  }
                }
              }
            }
            nextPost = pData?.paging?.next || null;
            pPost++;
          }
          debug.push(`videos enlazados a posts: ${copysPorVideo.size}`);
        } catch (ePosts: any) {
          debug.push(`page posts error: ${ePosts.message}`);
        }

        // 3) Videos de la página. (Sin "views": ese campo tumba la consulta en versiones nuevas.)
        const fields = "id,title,description,picture,source,permalink_url,length,created_time,updated_time";
        let next: string | null = metaGraph(`/${pageId}/videos?fields=${fields}&limit=50&${pageTokenParam}`);
        let paginas = 0;

        while (next && paginas < 6) {
          const vRes = await fetch(next, { cache: "no-store" });
          const vData: any = await vRes.json().catch(() => ({}));
          debug.push(`page videos p${paginas + 1}: ${vRes.status} (${vData?.data?.length || 0})${vData?.error ? " " + vData.error.message : ""}`);

          for (const v of vData?.data || []) {
            descripcionCruda.set(String(v.id), String(v.description || "").trim());
            videos.push({
              id: v.id,
              title: String(v.title || "").trim(),
              picture: v.picture || "",
              source: v.source || "",
              permalink: v.permalink_url ? `https://www.facebook.com${v.permalink_url}` : "",
              postId: null,
              length: v.length ? Math.round(v.length) : null,
              createdTime: v.created_time,
              views: 0,
              origin: "page",
              pageName: pageName || "Fan Page Templo Místico",
              pageId,
            });
          }

          next = vData?.paging?.next || null;
          paginas++;
        }
      } catch (errPage: any) {
        debug.push(`page videos error: ${errPage.message}`);
      }
    }

    // 4) Respaldo: videos de la biblioteca de la cuenta publicitaria (solo si la página dio 0)
    if (videos.length === 0 && adAccountId) {
      try {
        const adVideosUrl = metaGraph(`/act_${adAccountId}/advideos?fields=id,title,description&limit=100&${tokenParam}`);
        const adVRes = await fetch(adVideosUrl, { cache: "no-store" });
        const adVData: any = await adVRes.json().catch(() => ({}));
        debug.push(`advideos: ${adVRes.status} (${adVData?.data?.length || 0})${adVData?.error ? " " + adVData.error.message : ""}`);

        for (const v of adVData?.data || []) {
          descripcionCruda.set(String(v.id), String(v.description || "").trim());
          videos.push({
            id: v.id,
            title: String(v.title || "").trim(),
            picture: "",
            source: "",
            permalink: "",
            postId: null,
            length: null,
            createdTime: null,
            views: 0,
            origin: "ad_account",
            pageName: pageName || "Fan Page Templo Místico",
            pageId,
          });
        }
        if (videos.length > 0 && !pageWarning) {
          pageWarning = "La Fan Page no devolvió videos con este token; se muestran los de la biblioteca de la cuenta publicitaria.";
        }
      } catch (errAd: any) {
        debug.push(`advideos error: ${errAd.message}`);
      }
    }

    // 5) COPY de los anuncios: en los videos de campañas (DCO / auto-cropped) el
    //    texto publicado está en el creativo o en el post del anuncio.
    const infoAnuncios = await cargarCopysDeAnuncios({
      adAccountId,
      metaToken,
      pageToken,
      store: copysPorVideo,
      debug,
    });

    // 5b) Videos sin copy: última opción, leer la descripción del nodo del video
    const sinCopyAun = videos.filter((v) => !mejorCandidato(copysPorVideo.get(String(v.id))) && !limpiarCopy(descripcionCruda.get(String(v.id))));
    if (sinCopyAun.length > 0) {
      await Promise.all(
        sinCopyAun.slice(0, 25).map(async (v) => {
          try {
            const url = metaGraph(`/${v.id}?fields=description&${tokenParam}`);
            const r = await fetch(url, { cache: "no-store" });
            const d: any = await r.json().catch(() => ({}));
            const texto = limpiarCopy(d?.description);
            if (texto) descripcionCruda.set(String(v.id), texto);
          } catch {}
        })
      );
    }

    // 6) Resolver el copy final de cada video: SIEMPRE el texto del post.
    //    El nombre del archivo del video nunca se usa como copy.
    videos = videos.map((v) => {
      const id = String(v.id);
      const candidatos = copysPorVideo.get(id);
      const mejor = mejorCandidato(candidatos);
      const descripcionOriginal = descripcionCruda.get(id) || "";
      const descVideo = revisarCopy(descripcionOriginal);

      const descartados: string[] = [];
      const nombreArchivo = revisarCopy(v.title);
      if (nombreArchivo.descartado) descartados.push(nombreArchivo.descartado);
      if (descVideo.descartado) descartados.push(descVideo.descartado);

      let texto = "";
      let fuente: FuenteCopy = "sin_copy";
      if (mejor) {
        texto = mejor.texto;
        fuente = mejor.fuente;
      } else if (descVideo.texto) {
        texto = descVideo.texto;
        fuente = descVideo.texto === descripcionOriginal ? "video_description" : "video_node";
      }

      // Titular del video: si Meta solo devolvió el nombre del archivo, se usa
      // la primera línea del copy o "Video <id>" (nunca el nombre del archivo).
      const tituloMeta = String(v.title || "").trim();
      const tituloEsArchivo = esNombreDeArchivo(tituloMeta);
      const primeraLinea = primerLineaCopy(texto);
      const titulo = tituloMeta && !tituloEsArchivo
        ? tituloMeta
        : primeraLinea
          ? primeraLinea.substring(0, 70).trim() + (primeraLinea.length > 70 ? "..." : "")
          : `Video ${v.id}`;

      return {
        ...v,
        title: titulo,
        // El nombre del archivo se conserva aparte para que el agente identifique el video
        nombre_archivo: tituloEsArchivo ? tituloMeta : "",
        titulo_es_nombre_archivo: tituloEsArchivo,
        description: texto,
        copy_original: texto,
        copy_origen: fuente,
        copy_fuente: etiquetaFuenteCopy(fuente),
        tiene_copy: texto.length > 0,
        copy_descartado: descartados.join(" | ").substring(0, 160),
        permalink: mejor?.permalink || v.permalink || "",
        postId: mejor?.postId || v.postId || null,
        origen_copy_fecha: mejor?.fecha ? new Date(mejor.fecha).toISOString() : null,
      };
    });

    const conCopy = videos.filter((v) => v.tiene_copy).length;
    const conCopyDePost = videos.filter((v) => v.copy_origen === "post" || v.copy_origen === "post_anuncio").length;
    const sinCopy = videos.length - conCopy;

    // Quitar duplicados y ordenar: primero los más recientes
    const unicos = new Map<string, any>();
    for (const v of videos) if (!unicos.has(v.id)) unicos.set(v.id, v);
    videos = Array.from(unicos.values()).sort(
      (a, b) => new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime()
    );

    return NextResponse.json({
      ok: true,
      total: videos.length,
      pageName: pageName || "Templo Místico",
      pageId,
      pageWarning: pageWarning || null,
      videos,
      debug,
      conCopy,
      conCopyDePost,
      sinCopy,
      reglaCopy: "El copy es el texto que va dentro del post (publicación). El nombre del archivo del video nunca se usa como copy.",
      note:
        videos.length === 0
          ? "No se encontraron videos publicados en la Fan Page. Verifica permisos pages_read_engagement / pages_show_list."
          : `${videos.length} videos de "${pageName || "la Fan Page"}" · ${conCopyDePost} con copy del texto del post · ${conCopy} con copy detectado · ${sinCopy} sin copy publicado.` +
            (infoAnuncios.videos > 0 ? ` (${infoAnuncios.videos} anuncios con texto leído.)` : ""),
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, videos: [], error: error.message }, { status: 500 });
  }
}

