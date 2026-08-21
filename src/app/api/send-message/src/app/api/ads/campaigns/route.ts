import { NextResponse } from "next/server";

export async function GET() {
  try {
    const metaToken = (process.env.META_MARKETING_TOKEN || "").trim();
    let adAccountId = (process.env.META_AD_ACCOUNT_ID || "").trim();

    // Normalizar ID: quitar act_ si viene duplicado
    adAccountId = adAccountId.replace(/^act_/, "");

    // Si hay credenciales, consultar Meta Graph API
    if (metaToken && adAccountId) {
      // Traer campañas en TODOS los estados relevantes + insights históricos
      const fields = [
        "id",
        "name",
        "status",
        "effective_status",
        "daily_budget",
        "lifetime_budget",
        "created_time",
        "updated_time",
        "stop_time",
        "start_time",
        "objective",
        // Insights de los últimos 90 días (incluye campañas ya cerradas)
        "insights.date_preset(last_90d){spend,clicks,impressions,actions,cpc,ctr}",
      ].join(",");

      // Filtrar por estados: activas, pausadas, archivadas, con problemas, etc.
      const filtering = encodeURIComponent(
        JSON.stringify([
          {
            field: "effective_status",
            operator: "IN",
            value: [
              "ACTIVE",
              "PAUSED",
              "ARCHIVED",
              "CAMPAIGN_PAUSED",
              "WITH_ISSUES",
              "IN_PROCESS",
              "PENDING_REVIEW",
              "PREAPPROVED",
            ],
          },
        ])
      );

      const url =
        `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns` +
        `?fields=${fields}` +
        `&filtering=${filtering}` +
        `&limit=100` +
        `&access_token=${encodeURIComponent(metaToken)}`;

      const res = await fetch(url, { cache: "no-store" });
      const rawText = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { error: { message: rawText } };
      }

      if (!res.ok) {
        return NextResponse.json(
          {
            live: false,
            campaigns: [],
            currency: "COP",
            error:
              data?.error?.message ||
              `Meta API error ${res.status}`,
            debug: {
              adAccountId,
              status: res.status,
            },
          },
          { status: 200 } // devolvemos 200 para que el frontend muestre el error amable
        );
      }

      const campaigns = (data.data || []).map((c: any) => {
        const insight = c.insights?.data?.[0] || {};
        const spend = Math.round(Number(insight.spend || 0));
        const clicks = Number(insight.clicks || 0);
        const impressions = Number(insight.impressions || 0);

        const actions = insight.actions || [];
        // Varios tipos de conversión posibles en WhatsApp/leads
        const leadAction = actions.find((a: any) =>
          [
            "lead",
            "onsite_conversion.messaging_conversation_started_7d",
            "onsite_conversion.total_messaging_connection",
            "messaging_conversation_started_7d",
            "complete_registration",
            "purchase",
          ].includes(a.action_type)
        );

        // Si no hay action tipada, sumar messaging si existe
        let leads = Number(leadAction?.value || 0);
        if (!leads) {
          const msgActions = actions.filter((a: any) =>
            String(a.action_type || "").includes("messaging")
          );
          leads = msgActions.reduce((s: number, a: any) => s + Number(a.value || 0), 0);
        }

        const cpl = leads > 0 ? Math.round(spend / leads) : 0;

        // Estado visible: preferir effective_status
        const status = c.effective_status || c.status || "UNKNOWN";

        return {
          id: c.id,
          name: c.name,
          status, // ACTIVE, PAUSED, ARCHIVED, etc.
          dailyBudget: c.daily_budget ? Math.round(Number(c.daily_budget) / 100) : 0,
          lifetimeBudget: c.lifetime_budget ? Math.round(Number(c.lifetime_budget) / 100) : 0,
          spend,
          clicks,
          impressions,
          leads,
          cpl,
          objective: c.objective || "",
          createdTime: c.created_time || null,
          updatedTime: c.updated_time || null,
          stopTime: c.stop_time || null,
          currency: "COP",
        };
      });

      // Ordenar: activas primero, luego por gasto desc
      campaigns.sort((a: any, b: any) => {
        if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
        if (b.status === "ACTIVE" && a.status !== "ACTIVE") return 1;
        return (b.spend || 0) - (a.spend || 0);
      });

      return NextResponse.json({
        live: true,
        campaigns,
        currency: "COP",
        total: campaigns.length,
        note:
          campaigns.length === 0
            ? "Token OK, pero no se encontraron campañas en esta cuenta (revisa el Ad Account ID o el rango de fechas)."
            : `Se cargaron ${campaigns.length} campañas (incluye pausadas/archivadas). Métricas: últimos 90 días.`,
      });
    }

    // Fallback demo si no hay variables
    const demoCampaigns = [
      {
        id: "camp_001",
        name: "🔮 Amarres de Amor - Colombia / Peru",
        status: "PAUSED",
        dailyBudget: 60000,
        spend: 570000,
        clicks: 840,
        impressions: 12400,
        leads: 62,
        cpl: 9193,
        currency: "COP",
      },
      {
        id: "camp_002",
        name: "✨ Limpiezas & Amuletos Prosperidad",
        status: "ARCHIVED",
        dailyBudget: 40000,
        spend: 340000,
        clicks: 610,
        impressions: 9800,
        leads: 48,
        cpl: 7083,
        currency: "COP",
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
        cpl: 27096,
        currency: "COP",
      },
    ];

    return NextResponse.json({
      live: false,
      campaigns: demoCampaigns,
      currency: "COP",
      note: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID en Vercel. Mostrando demo.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        live: false,
        campaigns: [],
        currency: "COP",
        error: error.message || "Error consultando campañas",
      },
      { status: 200 }
    );
  }
}