import { NextResponse } from "next/server";

export async function GET() {
  try {
    const metaToken = process.env.META_MARKETING_TOKEN || "";
    const adAccountId = process.env.META_AD_ACCOUNT_ID || "";

    // Si existen credenciales de Meta, consultamos la Graph API de Meta
    if (metaToken && adAccountId) {
      const cleanAccId = adAccountId.replace(/^act_/, "");
      const url = `https://graph.facebook.com/v19.0/act_${cleanAccId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,insights{spend,clicks,impressions,actions}&access_token=${metaToken}`;

      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const campaigns = (data.data || []).map((c: any) => {
          const insight = c.insights?.data?.[0] || {};
          const spend = Math.round(Number(insight.spend || 0));
          const clicks = Number(insight.clicks || 0);
          const impressions = Number(insight.impressions || 0);
          
          const actions = insight.actions || [];
          const leadAction = actions.find((a: any) => a.action_type === "lead" || a.action_type === "messaging_conversation_started_7d");
          const leads = Number(leadAction?.value || 0);
          const cpl = leads > 0 ? Math.round(spend / leads) : 0;

          return {
            id: c.id,
            name: c.name,
            status: c.status,
            dailyBudget: c.daily_budget ? Math.round(Number(c.daily_budget) / 100) : 0,
            spend,
            clicks,
            impressions,
            leads,
            cpl,
            currency: "COP"
          };
        });

        return NextResponse.json({ live: true, campaigns, currency: "COP" });
      }
    }

    // Datos de demostración en PESOS COLOMBIANOS (COP)
    const demoCampaigns = [
      {
        id: "camp_001",
        name: "🔮 Amarres de Amor - Colombia / Peru",
        status: "ACTIVE",
        dailyBudget: 60000,
        spend: 570000,
        clicks: 840,
        impressions: 12400,
        leads: 62,
        cpl: 9193, // CPL $9.193 COP
        currency: "COP"
      },
      {
        id: "camp_002",
        name: "✨ Limpiezas & Amuletos Prosperidad",
        status: "ACTIVE",
        dailyBudget: 40000,
        spend: 340000,
        clicks: 610,
        impressions: 9800,
        leads: 48,
        cpl: 7083, // CPL $7.083 COP
        currency: "COP"
      },
      {
        id: "camp_003",
        name: "🕯️ Retornos de Pareja Urgentes",
        status: "PAUSED",
        dailyBudget: 80000,
        spend: 840000,
        clicks: 420,
        impressions: 15200,
        leads: 31,
        cpl: 27096, // CPL alto $27.096 COP (para alerta IA)
        currency: "COP"
      },
      {
        id: "camp_004",
        name: "💀 Protecciones & Desamarres",
        status: "ACTIVE",
        dailyBudget: 30000,
        spend: 168000,
        clicks: 310,
        impressions: 5400,
        leads: 29,
        cpl: 5793, // CPL excelente $5.793 COP
        currency: "COP"
      },
    ];

    return NextResponse.json({ live: false, campaigns: demoCampaigns, currency: "COP" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error consultando campañas" }, { status: 500 });
  }
}