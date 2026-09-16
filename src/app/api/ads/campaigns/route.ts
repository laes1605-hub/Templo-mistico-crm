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

// Genera horario estricto: Inicio 00:01 del día inicial y Fin 23:59 del día final
function calcularHorarioCampana(diasTotales: number, fechaInicioBase?: Date) {
  const ahora = fechaInicioBase ? new Date(fechaInicioBase) : new Date();

  // Inicio: hoy (o fecha base) fijado a las 00:01:00
  const fechaInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 1, 0, 0);

  // Fin: N días después fijado a las 23:59:59
  const dias = Math.max(1, diasTotales);
  const fechaFin = new Date(fechaInicio.getFullYear(), fechaInicio.getMonth(), fechaInicio.getDate() + dias - 1, 23, 59, 59, 999);

  return {
    startTimeIso: fechaInicio.toISOString(),
    stopTimeIso: fechaFin.toISOString(),
    startTimeMeta: Math.floor(fechaInicio.getTime() / 1000),
    stopTimeMeta: Math.floor(fechaFin.getTime() / 1000),
    dias
  };
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

    const fields = "id,name,status,effective_status,objective,start_time,stop_time,daily_budget,lifetime_budget,insights{spend,clicks,impressions,actions},adsets{id,name,daily_budget,lifetime_budget,start_time,end_time,ads{id,name,creative{id,name,video_id,image_url}}}";
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

      // Extraer video IDs o creativos asociados para saber qué videos funcionaron mejor
      const videosUsed: string[] = [];
      if (c.adsets?.data) {
        c.adsets.data.forEach((adset: any) => {
          if (adset.ads?.data) {
            adset.ads.data.forEach((ad: any) => {
              if (ad.creative?.video_id) videosUsed.push(ad.creative.video_id);
            });
          }
        });
      }

      return {
        id: c.id,
        name: c.name,
        status: status,
        objective: c.objective || "",
        startTime: c.start_time || null,
        stopTime: c.stop_time || null,
        dailyBudget: c.daily_budget ? Math.round(Number(c.daily_budget) / 100) : 0,
        lifetimeBudget: c.lifetime_budget ? Math.round(Number(c.lifetime_budget) / 100) : 0,
        spend,
        clicks,
        impressions,
        leads,
        cpl,
        videosUsed: Array.from(new Set(videosUsed)),
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

// POST: Crear una nueva campaña en Meta Ads con horario estricto 00:01 a 23:59 y asignación de video
export async function POST(req: Request) {
  try {
    const {
      name,
      budgetType = "lifetime",
      budgetAmount,
      days = 4,
      objective = "OUTCOME_LEADS",
      status = "PAUSED",
      selectedVideoId, // Video seleccionado de la Fan Page
      videoTitle
    } = await req.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "El nombre de la campaña es obligatorio." }, { status: 400 });
    }

    const { metaToken, adAccountId } = getMetaCredentials();

    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        error: "Faltan las credenciales META_MARKETING_TOKEN o META_AD_ACCOUNT_ID en el entorno."
      }, { status: 400 });
    }

    const totalBudget = Number(budgetAmount) || 0;
    const duracionDias = Math.max(1, Number(days) || 4);

    // Calcular estricto horario: Inicia 00:01 del día inicial y termina 23:59 del día final
    const horario = calcularHorarioCampana(duracionDias);

    const payload: Record<string, any> = {
      name: name.trim(),
      objective: objective || "OUTCOME_LEADS",
      status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
      special_ad_categories: [],
      start_time: horario.startTimeIso,
      stop_time: horario.stopTimeIso,
      access_token: metaToken
    };

    if (totalBudget > 0) {
      if (budgetType === "lifetime") {
        payload.lifetime_budget = Math.round(totalBudget * 100);
      } else {
        payload.daily_budget = Math.round(totalBudget * 100);
      }
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
      budgetType,
      budgetAmount: totalBudget,
      days: duracionDias,
      startTime: horario.startTimeIso,
      stopTime: horario.stopTimeIso,
      selectedVideoId,
      videoTitle
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al crear campaña" }, { status: 500 });
  }
}

// PATCH: Modificar presupuesto, extender duración todo lo deseado (00:01 a 23:59) y estado
export async function PATCH(req: Request) {
  try {
    const { campaignId, name, budgetType, budgetAmount, days, status, extendDays } = await req.json();

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

    // Extender duración todo lo que el usuario/agente decida: fijando siempre fin a las 23:59:59
    const diasTotales = Number(days || extendDays);
    if (!isNaN(diasTotales) && diasTotales > 0) {
      const horario = calcularHorarioCampana(diasTotales);
      body.stop_time = horario.stopTimeIso;
    }

    const amountNum = Number(budgetAmount);
    if (!isNaN(amountNum) && amountNum > 0) {
      if (budgetType === "daily") {
        body.daily_budget = Math.round(amountNum * 100);
      } else {
        body.lifetime_budget = Math.round(amountNum * 100);
      }
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
        lifetimeBudget: body.lifetime_budget ? Math.round(body.lifetime_budget / 100) : undefined,
        dailyBudget: body.daily_budget ? Math.round(body.daily_budget / 100) : undefined,
        stopTime: body.stop_time,
        status: body.status,
        daysExtended: diasTotales || undefined
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al actualizar campaña" }, { status: 500 });
  }
}
