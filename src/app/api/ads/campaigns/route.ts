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

export async function GET() {
  try {
    const { metaToken, adAccountId } = getMetaCredentials();

    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        live: false,
        campaigns: [],
        currency: "COP",
        note: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID en Vercel."
      });
    }

    const fields = "id,name,status,effective_status,objective,daily_budget,lifetime_budget,insights{spend,clicks,impressions,actions}";
    const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns?fields=${fields}&limit=100&access_token=${encodeURIComponent(metaToken)}`;

    const res = await fetch(url, { cache: "no-store" });
    const rawText = await res.text();

    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { error: { message: rawText } };
    }

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
        status: status,
        objective: c.objective || "",
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
      note: `Conectado a Meta API. ${campaigns.length} campañas cargadas.`
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

// POST: Crear una nueva campaña directamente en Meta Ads
export async function POST(req: Request) {
  try {
    const { name, dailyBudget, objective = "OUTCOME_LEADS", status = "PAUSED" } = await req.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "El nombre de la campaña es obligatorio." }, { status: 400 });
    }

    const { metaToken, adAccountId } = getMetaCredentials();

    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        error: "Faltan las credenciales META_MARKETING_TOKEN o META_AD_ACCOUNT_ID en el entorno."
      }, { status: 400 });
    }

    // Meta API espera daily_budget en centavos (ej: $10,000 COP -> 1000000)
    const budgetCents = Number(dailyBudget) > 0 ? Math.round(Number(dailyBudget) * 100) : null;

    const payload: Record<string, any> = {
      name: name.trim(),
      objective: objective || "OUTCOME_LEADS",
      status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
      special_ad_categories: [], // Lista vacía requerida por Meta
      access_token: metaToken
    };

    if (budgetCents) {
      payload.daily_budget = budgetCents;
    }

    const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const resJson = await res.json();

    if (!res.ok || resJson.error) {
      const msg = resJson?.error?.message || "Error al crear la campaña en Meta Ads.";
      return NextResponse.json({ error: msg, details: resJson?.error }, { status: res.status || 500 });
    }

    return NextResponse.json({
      success: true,
      id: resJson.id,
      name: name.trim(),
      status: payload.status,
      dailyBudget: Number(dailyBudget) || 0
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al crear campaña" }, { status: 500 });
  }
}

// PATCH: Modificar nombre, presupuesto y/o estado de una campaña existente
export async function PATCH(req: Request) {
  try {
    const { campaignId, name, dailyBudget, status } = await req.json();

    if (!campaignId) {
      return NextResponse.json({ error: "Falta el ID de la campaña." }, { status: 400 });
    }

    const { metaToken } = getMetaCredentials();

    if (!metaToken) {
      return NextResponse.json({ error: "Falta META_MARKETING_TOKEN en el entorno." }, { status: 400 });
    }

    const body: Record<string, any> = {
      access_token: metaToken
    };

    if (name && name.trim()) {
      body.name = name.trim();
    }

    if (dailyBudget !== undefined && dailyBudget !== null && !isNaN(Number(dailyBudget))) {
      body.daily_budget = Math.round(Number(dailyBudget) * 100);
    }

    if (status && ["ACTIVE", "PAUSED", "ARCHIVED"].includes(status)) {
      body.status = status;
    }

    const url = `https://graph.facebook.com/v19.0/${campaignId}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const resJson = await res.json();

    if (!res.ok || resJson.error) {
      const msg = resJson?.error?.message || "Error al actualizar la campaña en Meta Ads.";
      return NextResponse.json({ error: msg, details: resJson?.error }, { status: res.status || 500 });
    }

    return NextResponse.json({
      success: true,
      campaignId,
      updated: {
        name: body.name,
        dailyBudget: body.daily_budget ? Math.round(body.daily_budget / 100) : undefined,
        status: body.status
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al actualizar campaña" }, { status: 500 });
  }
}
