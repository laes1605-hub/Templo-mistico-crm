import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getMetaCredentials() {
  const metaToken = (process.env.META_MARKETING_TOKEN || "")
    .replace(/[\r\n\t "']/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  let adAccountId = (process.env.META_AD_ACCOUNT_ID || "")
    .replace(/[\r\n\t "']/g, "")
    .replace(/^act_/, "")
    .trim();

  return { metaToken, adAccountId };
}

// GET: Obtener TODOS los videos publicados en la Fan Page (y como respaldo los de la cuenta publicitaria)
export async function GET() {
  try {
    const { metaToken, adAccountId } = getMetaCredentials();

    if (!metaToken) {
      return NextResponse.json({
        ok: false,
        videos: [],
        error: "Falta META_MARKETING_TOKEN en variables de entorno."
      });
    }

    let videos: any[] = [];
    let pageName = "";
    let pageId = "";
    const debug: string[] = [];

    // 1. Videos publicados en la Fan Page (paginando para traerlos todos)
    try {
      const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&limit=50&access_token=${encodeURIComponent(metaToken)}`;
      const accountsRes = await fetch(accountsUrl, { cache: "no-store" });
      const accountsData = await accountsRes.json();
      debug.push(`me/accounts: ${accountsRes.status} (${accountsData?.data?.length || 0})`);

      if (accountsData?.data && accountsData.data.length > 0) {
        const targetPage =
          accountsData.data.find((p: any) =>
            (p.name || "").toLowerCase().includes("templo") || (p.name || "").toLowerCase().includes("mistico")
          ) || accountsData.data[0];

        pageName = targetPage.name;
        pageId = targetPage.id;
        const pageToken = targetPage.access_token || metaToken;

        // El COPY REAL del video suele estar en el post del feed (campo "message"),
        // no en "description" del video. Aquí se arma un mapa video_id -> texto del post.
        const copyPorVideo = new Map<string, { message: string; permalink: string; postId: string }>();
        try {
          let nextPost: string | null = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time,permalink_url,attachments{media_type,type,title,description,target}&limit=50&access_token=${encodeURIComponent(pageToken)}`;
          let pPost = 0;
          while (nextPost && pPost < 6) {
            const pRes: any = await fetch(nextPost, { cache: "no-store" });
            const pData: any = await pRes.json();
            debug.push(`page posts p${pPost + 1}: ${pRes.status} (${pData?.data?.length || 0})${pData?.error ? " " + pData.error.message : ""}`);

            for (const post of pData?.data || []) {
              for (const att of post?.attachments?.data || []) {
                const tipo = String(att.media_type || att.type || "").toLowerCase();
                const targetId = att?.target?.id;
                if (!targetId) continue;
                if (!tipo.includes("video")) continue;
                // El texto que el usuario escribió al publicar manda sobre todo lo demás
                const texto = String(post.message || att.description || att.title || "").trim();
                if (!copyPorVideo.has(String(targetId))) {
                  copyPorVideo.set(String(targetId), {
                    message: texto,
                    permalink: post.permalink_url || "",
                    postId: post.id || "",
                  });
                }
              }
            }
            nextPost = pData?.paging?.next || null;
            pPost++;
          }
        } catch (ePosts: any) {
          debug.push(`page posts error: ${ePosts.message}`);
        }

        const fields = "id,title,description,picture,source,permalink_url,length,created_time,updated_time,views";
        let next: string | null = `https://graph.facebook.com/v19.0/${pageId}/videos?fields=${fields}&limit=50&access_token=${encodeURIComponent(pageToken)}`;
        let paginas = 0;

        while (next && paginas < 6) {
          const vRes: any = await fetch(next, { cache: "no-store" });
          const vData: any = await vRes.json();
          debug.push(`page videos p${paginas + 1}: ${vRes.status} (${vData?.data?.length || 0})`);

          for (const v of vData?.data || []) {
            const delPost = copyPorVideo.get(String(v.id));

            // Prioridad del COPY ORIGINAL:
            // 1) texto del post publicado en la fan page (lo que se ve en Facebook)
            // 2) description del video
            // 3) title del video
            const copyReal =
              (delPost?.message || "").trim() ||
              String(v.description || "").trim() ||
              String(v.title || "").trim();

            const origenCopy = (delPost?.message || "").trim()
              ? "post"
              : String(v.description || "").trim()
                ? "video_description"
                : String(v.title || "").trim()
                  ? "video_title"
                  : "sin_copy";

            // Título legible para la lista
            const primeraLinea = copyReal.split("\n").find((l: string) => l.trim()) || "";
            const titulo =
              String(v.title || "").trim() ||
              (primeraLinea ? primeraLinea.substring(0, 70).trim() + (primeraLinea.length > 70 ? "..." : "") : `Video ${v.id}`);

            videos.push({
              id: v.id,
              title: titulo,
              // description = COPY ORIGINAL real del video en la fan page
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
              views: v.views || 0,
              origin: "page",
              pageName,
              pageId,
            });
          }

          next = vData?.paging?.next || null;
          paginas++;
        }
      }
    } catch (errPage: any) {
      debug.push(`page videos error: ${errPage.message}`);
    }

    // 2. Respaldo: videos subidos directamente a la cuenta de anuncios
    if (videos.length === 0 && adAccountId) {
      try {
        const adVideosUrl = `https://graph.facebook.com/v19.0/act_${adAccountId}/advideos?fields=id,title,description,picture,source,length,created_time&limit=100&access_token=${encodeURIComponent(metaToken)}`;
        const adVRes = await fetch(adVideosUrl, { cache: "no-store" });
        const adVData = await adVRes.json();
        debug.push(`advideos: ${adVRes.status} (${adVData?.data?.length || 0})`);

        for (const v of adVData?.data || []) {
          videos.push({
            id: v.id,
            title: v.title || (v.description ? v.description.substring(0, 60).trim() + "..." : `Video creativo ${v.id}`),
            description: v.description || "",
            copy_original: String(v.description || "").trim(),
            copy_origen: String(v.description || "").trim() ? "video_description" : "sin_copy",
            tiene_copy: Boolean(String(v.description || "").trim()),
            picture: v.picture || "",
            source: v.source || "",
            length: v.length ? Math.round(v.length) : null,
            createdTime: v.created_time,
            origin: "ad_account",
          });
        }
      } catch (errAd: any) {
        debug.push(`advideos error: ${errAd.message}`);
      }
    }

    // Último recurso: los videos que aún no tienen copy se consultan uno por uno.
    // Algunos videos exponen el texto en su propio nodo aunque el feed no lo traiga.
    const sinCopy = videos.filter((v) => !v.tiene_copy).slice(0, 25);
    if (sinCopy.length > 0) {
      debug.push(`rellenando copy de ${sinCopy.length} videos`);
      await Promise.all(
        sinCopy.map(async (v) => {
          try {
            const url = `https://graph.facebook.com/v19.0/${v.id}?fields=description,title,from&access_token=${encodeURIComponent(metaToken)}`;
            const r = await fetch(url, { cache: "no-store" });
            const d = await r.json();
            const texto = String(d?.description || d?.title || "").trim();
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
      pageName,
      pageId,
      videos,
      debug,
      conCopy,
      note:
        videos.length === 0
          ? "No se encontraron videos publicados en la Fan Page. Verifica permisos pages_read_engagement / pages_show_list."
          : `${videos.length} videos publicados · ${conCopy} con copy original detectado.`,
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, videos: [], error: error.message }, { status: 500 });
  }
}
