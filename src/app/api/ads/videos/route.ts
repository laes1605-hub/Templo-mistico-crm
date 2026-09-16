import { NextResponse } from "next/server";
import { getMetaConfig, metaGraph } from "@/lib/meta-config";

export const dynamic = "force-dynamic";

type InfoCopy = { message: string; permalink: string; postId: string };

function extraerIdsVideoDeAdjunto(att: any): string[] {
  const ids: string[] = [];
  const push = (v: any) => {
    const s = String(v || "").trim();
    if (s && !ids.includes(s)) ids.push(s);
  };
  // Formas en que Meta enlaza el adjunto con el video según el tipo de post
  push(att?.target?.id);
  push(att?.media?.video?.id);
  push(att?.media?.id);
  push(att?.object_id);
  return ids;
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
        const copyPorVideo = new Map<string, InfoCopy>();

        const registrar = (videoId: string, info: InfoCopy) => {
          const clave = String(videoId || "").trim();
          if (!clave) return;
          const previo = copyPorVideo.get(clave);
          // Gana el post más reciente con texto (los posts llegan de nuevo a viejo)
          if (!previo || (!previo.message && info.message)) copyPorVideo.set(clave, info);
        };

        // 2) Posts de la página para extraer el COPY REAL publicado.
        //    Se enlaza por object_id (el más confiable) y por los ids del adjunto.
        try {
          let nextPost: string | null = metaGraph(`/${pageId}/posts?fields=id,message,object_id,created_time,permalink_url,attachments{media_type,type,title,description,target,media}&limit=100&${pageTokenParam}`);
          let pPost = 0;
          while (nextPost && pPost < 5) {
            const pRes = await fetch(nextPost, { cache: "no-store" });
            const pData: any = await pRes.json().catch(() => ({}));
            debug.push(`page posts p${pPost + 1}: ${pRes.status} (${pData?.data?.length || 0})${pData?.error ? " " + pData.error.message : ""}`);

            for (const post of pData?.data || []) {
              const msgPost = String(post.message || "").trim();
              const info: InfoCopy = {
                message: msgPost,
                permalink: post.permalink_url || "",
                postId: post.id || "",
              };
              // object_id del post (cuando el post es un video, es el id del video)
              if (post.object_id) registrar(String(post.object_id), info);
              for (const att of post?.attachments?.data || []) {
                const tipo = String(att?.media_type || att?.type || "").toLowerCase();
                if (!tipo.includes("video")) continue;
                for (const vid of extraerIdsVideoDeAdjunto(att)) registrar(vid, info);
              }
            }
            nextPost = pData?.paging?.next || null;
            pPost++;
          }
          debug.push(`copys de posts enlazados: ${copyPorVideo.size}`);
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
            const delPost = copyPorVideo.get(String(v.id));
            const msgPost = (delPost?.message || "").trim();
            const descVideo = String(v.description || "").trim();

            // El copy es SOLO texto real publicado (post o descripción).
            // El título NUNCA es copy: usarlo inventaba "texto random".
            const copyReal = msgPost || descVideo;
            const origenCopy = msgPost
              ? "post"
              : descVideo
                ? "video_description"
                : "sin_copy";

            const primeraLinea = copyReal.split("\n").find((l: string) => l.trim()) || "";
            const titulo =
              String(v.title || "").trim() ||
              (primeraLinea ? primeraLinea.substring(0, 70).trim() + (primeraLinea.length > 70 ? "..." : "") : `Video ${v.id}`);

            videos.push({
              id: v.id,
              title: titulo,
              description: copyReal,
              copy_original: copyReal,
              copy_origen: origenCopy,
              tiene_copy: copyReal.length > 0,
              picture: v.picture || "",
              source: v.source || "",
              permalink: delPost?.permalink || (v.permalink_url ? `https://www.facebook.com${v.permalink_url}` : ""),
              postId: delPost?.postId || null,
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
          const desc = String(v.description || "").trim();
          videos.push({
            id: v.id,
            title: String(v.title || "").trim() || (desc ? desc.substring(0, 60).trim() + "..." : `Video creativo ${v.id}`),
            description: desc,
            copy_original: desc,
            copy_origen: desc ? "video_description" : "sin_copy",
            tiene_copy: desc.length > 0,
            picture: "",
            source: "",
            length: null,
            createdTime: null,
            origin: "ad_account",
          });
        }
        if (videos.length > 0 && !pageWarning) {
          pageWarning = "La Fan Page no devolvió videos con este token; se muestran los de la biblioteca de la cuenta publicitaria.";
        }
      } catch (errAd: any) {
        debug.push(`advideos error: ${errAd.message}`);
      }
    }

    // 5) Completar copys faltantes leyendo el nodo del video (máx 25 para no saturar)
    const sinCopy = videos.filter((v) => !v.tiene_copy).slice(0, 25);
    if (sinCopy.length > 0) {
      await Promise.all(
        sinCopy.map(async (v) => {
          try {
            const url = metaGraph(`/${v.id}?fields=description&${tokenParam}`);
            const r = await fetch(url, { cache: "no-store" });
            const d: any = await r.json().catch(() => ({}));
            const texto = String(d?.description || "").trim();
            if (texto) {
              v.description = texto;
              v.copy_original = texto;
              v.copy_origen = "video_node";
              v.tiene_copy = true;
            }
          } catch {}
        })
      );
    }

    const conCopy = videos.filter((v) => v.tiene_copy).length;

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
      note:
        videos.length === 0
          ? "No se encontraron videos publicados en la Fan Page. Verifica permisos pages_read_engagement / pages_show_list."
          : `${videos.length} videos de "${pageName || "la Fan Page"}" · ${conCopy} con copy original detectado.`,
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, videos: [], error: error.message }, { status: 500 });
  }
}
