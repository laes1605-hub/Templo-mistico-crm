import { NextResponse } from "next/server";

export async function GET() {
  try {
    // 1. Sanitizar llaves desde variables de entorno
    const metaToken = (process.env.META_MARKETING_TOKEN || "")
      .replace(/[\r\n\t "']/g, "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    let adAccountId = (process.env.META_AD_ACCOUNT_ID || "")
      .replace(/[\r\n\t "']/g, "")
      .replace(/^act_/, "")
      .trim();

    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        live: false,
        campaigns: [],
        currency: "COP",
        note: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID en Vercel."
      });
    }

    // 2. Consulta directa y limpia a Meta Graph API (Mismo formato comprobado en la prueba)
    const fields = "id,name,status,effective_status,daily_budget,lifetime_budget,insights{spend,clicks,impressions,actions}";
    const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns?fields=${fields}&limit=100&access_token=${encodeURIComponent(metaToken)}`;

    const res = await fetch(url, { cache: "no-store" });
    const rawText = await res.text();

    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { error: { message: rawText } };
    }

    // Si Meta devuelve error, mostrar el mensaje exacto en pantalla
    if (!res.ok || data.error) {
      const metaErrorMsg = data?.error?.message || `HTTP ${res.status}: ${rawText.substring(0, 100)}`;
      return NextResponse.json({
        live: false,
        campaigns: [],
        currency: "COP",
        error: `Error Meta API: ${metaErrorMsg}`,
        debug: { adAccountId, status: res.status }
      });
    }

    const rawList = data.data || [];

    // 3. Procesar métricas en Pesos Colombianos (COP)
    const campaigns = rawList.map((c: any) => {
      const insight = c.insights?.data?.[0] || {};
      const spend = Math.round(Number(insight.spend || 0));
      const clicks = Number(insight.clicks || 0);
      const impressions = Number(insight.impressions || 0);

      const actions = insight.actions || [];
      const leadAction = actions.find((a: any) =>
        ["lead", "messaging_conversation_started_7d", "onsite_conversion.messaging_conversation_started_7d"].includes(a.action_type)
      );

      let leads = Number(leadAction?.value || 0);
      if (!leads) {
        const msgActions = actions.filter((a: any) => String(a.action_type || "").includes("messaging"));
        leads = msgActions.reduce((s: number, a: any) => s + Number(a.value || 0), 0);
      }

      const cpl = leads > 0 ? Math.round(spend / leads) : 0;
      const status = c.effective_status || c.status || "UNKNOWN";

      return {
        id: c.id,
        name: c.name,
        status: status, // ACTIVE, PAUSED, etc.
        dailyBudget: c.daily_budget ? Math.round(Number(c.daily_budget) / 100) : 0,
        lifetimeBudget: c.lifetime_budget ? Math.round(Number(c.lifetime_budget) / 100) : 0,
        spend,
        clicks,
        impressions,
        leads,
        cpl,
        currency: "COP"
      };
    });

    return NextResponse.json({
      live: true,
      campaigns,
      currency: "COP",
      total: campaigns.length,
      note: `Conectado en Vivo a Meta API. ${campaigns.length} campañas cargadas.`
    });

  } catch (error: any) {
    return NextResponse.json({
      live: false,
      campaigns: [],
      currency: "COP",
      error: "Error interno: " + (error.message || String(error))
    });
  }
}