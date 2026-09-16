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

        const fields = "id,title,description,picture,source,permalink_url,length,created_time,updated_time,views";
        let next: string | null = `https://graph.facebook.com/v19.0/${pageId}/videos?fields=${fields}&limit=50&access_token=${encodeURIComponent(pageToken)}`;
        let paginas = 0;

        while (next && paginas < 6) {
          const vRes: any = await fetch(next, { cache: "no-store" });
          const vData: any = await vRes.json();
          debug.push(`page videos p${paginas + 1}: ${vRes.status} (${vData?.data?.length || 0})`);

          for (const v of vData?.data || []) {
            videos.push({
              id: v.id,
              title: v.title || (v.description ? v.description.substring(0, 60).trim() + "..." : `Video ${v.id}`),
              description: v.description || "",
              picture: v.picture || "",
              source: v.source || "",
              permalink: v.permalink_url ? `https://www.facebook.com${v.permalink_url}` : "",
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
      note:
        videos.length === 0
          ? "No se encontraron videos publicados en la Fan Page. Verifica permisos pages_read_engagement / pages_show_list."
          : `${videos.length} videos publicados disponibles para usar como anuncios.`,
    });

  } catch (error: any) {
    return NextResponse.json({ ok: false, videos: [], error: error.message }, { status: 500 });
  }
}
