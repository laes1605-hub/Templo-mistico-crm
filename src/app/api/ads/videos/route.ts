import { NextResponse } from "next/server";
import { getMetaConfig } from "@/lib/meta-config";

export const dynamic = "force-dynamic";

// GET: Obtener TODOS los videos publicados en la Fan Page
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

    let videos: any[] = [];
    let pageName = "";
    let pageId = configuredPageId || "";
    const debug: string[] = [];

    // 1. Videos publicados en la Fan Page
    try {
      let pageToken = metaToken;

      // Obtener page access token o validar la página
      try {
        const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&limit=50&access_token=${encodeURIComponent(metaToken)}`;
        const accountsRes = await fetch(accountsUrl, { cache: "no-store" });
        const accountsData = await accountsRes.json();
        debug.push(`me/accounts: ${accountsRes.status} (${accountsData?.data?.length || 0})`);

        if (accountsData?.data && accountsData.data.length > 0) {
          const targetPage =
            (configuredPageId && accountsData.data.find((p: any) => String(p.id) === String(configuredPageId))) ||
            accountsData.data.find((p: any) =>
              (p.name || "").toLowerCase().includes("templo") || (p.name || "").toLowerCase().includes("mistico")
            ) || accountsData.data[0];

          if (targetPage) {
            pageName = targetPage.name;
            pageId = targetPage.id;
            pageToken = targetPage.access_token || metaToken;
          }
        }
      } catch (eAcc: any) {
        debug.push(`me/accounts error: ${eAcc.message}`);
      }

      // Si no obtuvimos targetPage de me/accounts pero tenemos pageId configurado:
      if (!pageName && pageId) {
        try {
          const pInfoRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=id,name,access_token&access_token=${encodeURIComponent(metaToken)}`, { cache: "no-store" });
          const pInfo = await pInfoRes.json();
          if (pInfo?.name) {
            pageName = pInfo.name;
            if (pInfo.access_token) pageToken = pInfo.access_token;
          }
        } catch {}
      }

      if (pageId) {
        const copyPorVideo = new Map<string, { message: string; permalink: string; postId: string }>();

        // Intentar traer posts para extraer el COPY REAL publicado
        try {
          let nextPost: string | null = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time,permalink_url,attachments{media_type,type,title,description,target}&limit=50&access_token=${encodeURIComponent(pageToken)}`;
          let pPost = 0;
          while (nextPost && pPost < 6) {
            const pRes: any = await fetch(nextPost, { cache: "no-store" });
            const pData: any = await pRes.json();
            debug.push(`page posts p${pPost + 1}: ${pRes.status} (${pData?.data?.length || 0})`);

            for (const post of pData?.data || []) {
              const msgPost = String(post.message || "").trim();
              for (const att of post?.attachments?.data || []) {
                const tipo = String(att.media_type || att.type || "").toLowerCase();
                const targetId = att?.target?.id;
                if (!targetId) continue;
                if (!tipo.includes("video")) continue;
                const texto = msgPost || String(att.description || att.title || "").trim();
                if (!copyPorVideo.has(String(targetId)) || (!copyPorVideo.get(String(targetId))?.message && texto)) {
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

        // Consultar videos directamente de la página
        const fields = "id,title,description,picture,source,permalink_url,length,created_time,updated_time,views";
        let next: string | null = `https://graph.facebook.com/v19.0/${pageId}/videos?fields=${fields}&limit=50&access_token=${encodeURIComponent(pageToken)}`;
        let paginas = 0;

        while (next && paginas < 6) {
          const vRes: any = await fetch(next, { cache: "no-store" });
          const vData: any = await vRes.json();
          debug.push(`page videos p${paginas + 1}: ${vRes.status} (${vData?.data?.length || 0})`);

          for (const v of vData?.data || []) {
            const delPost = copyPorVideo.get(String(v.id));

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
              views: v.views || 0,
              origin: "page",
              pageName: pageName || "Fan Page Templo Místico",
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

    // 2. Respaldo: videos de la cuenta publicitaria si no hubo de la página
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

    // Completar copys que falten buscando directamente el nodo de video
    const sinCopy = videos.filter((v) => !v.tiene_copy).slice(0, 25);
    if (sinCopy.length > 0) {
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
      pageName: pageName || "Templo Místico",
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
