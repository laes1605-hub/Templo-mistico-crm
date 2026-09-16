import { NextResponse } from "next/server";
import { getMetaConfig } from "@/lib/meta-config";

export const dynamic = "force-dynamic";

/**
 * Normaliza las fechas para que SIEMPRE inicien a las 00:01 y terminen a las 23:59
 * en la zona horaria de Bogotá (America/Bogota, UTC-5).
 */
function calcularHorarioBogota(fechaInicioStr: string, diasDuracion: number) {
  const [y, m, d] = fechaInicioStr.split("-").map(Number);
  const inicioIso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:01:00-05:00`;
  const fechaFinDate = new Date(Date.UTC(y, m - 1, d + diasDuracion - 1));
  const yF = fechaFinDate.getUTCFullYear();
  const mF = fechaFinDate.getUTCMonth() + 1;
  const dF = fechaFinDate.getUTCDate();
  const finIso = `${String(yF).padStart(4, "0")}-${String(mF).padStart(2, "0")}-${String(dF).padStart(2, "0")}T23:59:59-05:00`;

  const opcionesLegibles: Intl.DateTimeFormatOptions = {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Bogota",
  };

  const legibleInicio = `${new Date(inicioIso).toLocaleDateString("es-CO", opcionesLegibles)} 00:01`;
  const legibleFin = `${new Date(finIso).toLocaleDateString("es-CO", opcionesLegibles)} 23:59`;

  return {
    inicioIso,
    finIso,
    dias: diasDuracion,
    legibleInicio,
    legibleFin,
    fechaInicioDate: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    fechaFinDate: `${String(yF).padStart(4, "0")}-${String(mF).padStart(2, "0")}-${String(dF).padStart(2, "0")}`,
  };
}

/** Formatea una fecha ISO para mostrar legible en Bogotá */
function formatearFechaLegible(fechaIso: string | null | undefined): string | null {
  if (!fechaIso) return null;
  try {
    const d = new Date(fechaIso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString("es-CO", {
      timeZone: "America/Bogota",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

// GET: Listar campañas con métricas
export async function GET() {
  try {
    const { metaToken, adAccountId } = await getMetaConfig();

    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        campaigns: [],
        live: false,
        note: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID.",
      });
    }

    const fields = [
      "id",
      "name",
      "status",
      "objective",
      "daily_budget",
      "lifetime_budget",
      "start_time",
      "stop_time",
      "created_time",
      "updated_time",
      "adsets{id,name,status,daily_budget,lifetime_budget,start_time,end_time,destination_type,optimization_goal,targeting,promoted_object}",
      "ads{id,name,status,creative{id,name,title,body,image_url,thumbnail_url,video_id,object_story_spec}}",
      "insights{spend,impressions,clicks,cpc,cpm,cpp,ctr,reach,cost_per_unique_click,actions,cost_per_action_type}",
    ].join(",");

    const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns?fields=${fields}&limit=50&access_token=${encodeURIComponent(metaToken)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (!res.ok || data.error) {
      return NextResponse.json({
        campaigns: [],
        live: false,
        error: data?.error?.message || "Error al conectar con Meta Ads",
        debug: data,
      });
    }

    const rawList = Array.isArray(data.data) ? data.data : [];

    const campaigns = rawList.map((c: any) => {
      const insight = c.insights?.data?.[0] || {};
      const adset = c.adsets?.data?.[0] || {};
      const actions = insight.actions || [];
      const costActions = insight.cost_per_action_type || [];

      let leads = 0;
      let costPerLead = 0;

      const leadAction = actions.find((a: any) =>
        ["lead", "onsite_conversion.messaging_conversation_started_7d", "messaging_conversation_started_7d"].includes(a.action_type)
      );
      if (leadAction) leads = Number(leadAction.value || 0);

      if (!leads) {
        const msgAction = actions.find((a: any) =>
          String(a.action_type || "").includes("messaging_conversation_started") ||
          String(a.action_type || "").includes("onsite_conversion.messaging")
        );
        if (msgAction) leads = Number(msgAction.value || 0);
      }

      const costLead = costActions.find((a: any) =>
        ["lead", "onsite_conversion.messaging_conversation_started_7d", "messaging_conversation_started_7d"].includes(a.action_type)
      );
      if (costLead) costPerLead = Math.round(Number(costLead.value || 0));

      const spend = Number(insight.spend || 0);
      if (!costPerLead && leads > 0 && spend > 0) {
        costPerLead = Math.round(spend / leads);
      }

      let dailyBudget = 0;
      if (c.daily_budget) dailyBudget = Number(c.daily_budget) / 100;
      else if (adset.daily_budget) dailyBudget = Number(adset.daily_budget) / 100;
      else if (c.lifetime_budget) dailyBudget = Math.round(Number(c.lifetime_budget) / 100 / 7);

      const anuncios = (c.ads?.data || []).map((a: any) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        videoId: a.creative?.video_id || a.creative?.object_story_spec?.video_data?.video_id || null,
        title: a.creative?.title || a.creative?.object_story_spec?.video_data?.title || "",
        body: a.creative?.body || a.creative?.object_story_spec?.video_data?.message || "",
        thumbnail: a.creative?.thumbnail_url || a.creative?.image_url || null,
      }));

      const startTime = c.start_time || adset.start_time || null;
      const stopTime = c.stop_time || adset.end_time || null;
      const startTimeAdset = adset.start_time || null;
      const stopTimeAdset = adset.end_time || null;

      let diasTotales: number | null = null;
      let diasRestantes: number | null = null;
      if (startTime && stopTime) {
        const tIni = new Date(startTime).getTime();
        const tFin = new Date(stopTime).getTime();
        const tNow = Date.now();
        if (tFin > tIni) {
          diasTotales = Math.max(1, Math.round((tFin - tIni) / (1000 * 60 * 60 * 24)));
          diasRestantes = Math.max(0, Math.round((tFin - tNow) / (1000 * 60 * 60 * 24)));
        }
      }

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        dailyBudget,
        lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        spend,
        leads,
        cpl: costPerLead,
        impressions: Number(insight.impressions || 0),
        clicks: Number(insight.clicks || 0),
        cpc: Number(insight.cpc || 0),
        ctr: insight.ctr ? (Number(insight.ctr) * 100).toFixed(2) + "%" : "0%",
        startTime,
        stopTime,
        startTimeAdset,
        stopTimeAdset,
        legibleInicio: formatearFechaLegible(startTime),
        legibleFin: formatearFechaLegible(stopTime),
        legibleInicioAnuncio: formatearFechaLegible(startTimeAdset),
        legibleFinAnuncio: formatearFechaLegible(stopTimeAdset),
        diasTotales,
        diasRestantes,
        createdTime: c.created_time,
        updatedTime: c.updated_time,
        destination: "WHATSAPP_ONLY",
        anuncios,
        totalAnuncios: anuncios.length,
      };
    });

    return NextResponse.json({
      campaigns,
      live: true,
      note: `Conectado a Meta API. ${campaigns.length} campañas cargadas. Solo WhatsApp.`,
    });
  } catch (error: any) {
    return NextResponse.json({
      campaigns: [],
      live: false,
      error: error.message,
    });
  }
}

// POST: Crear campaña completa
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      dailyBudget,
      tipoPresupuesto = "daily",
      fechaInicio,
      dias = 4,
      numeroAnuncios = 1,
      videoIds = [],
      whatsappNumberId,
      whatsappDisplayNumber,
      targeting = {},
      status = "ACTIVE",
      objective = "OUTCOME_ENGAGEMENT",
      copiesPorAnuncio = [],
      copyBase = "",
      usarCopyVideo = true,
      pageId: requestPageId,
    } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "El nombre de la campaña es obligatorio." }, { status: 400 });
    }

    const { metaToken, adAccountId, pageId: configuredPageId } = await getMetaConfig();
    const targetPageId = requestPageId || configuredPageId;

    if (!metaToken || !adAccountId) {
      return NextResponse.json(
        { error: "Faltan las credenciales META_MARKETING_TOKEN o META_AD_ACCOUNT_ID." },
        { status: 400 }
      );
    }

    const hoyBogota = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    const fechaInicioValida = fechaInicio || hoyBogota;
    const horario = calcularHorarioBogota(fechaInicioValida, Number(dias) || 4);

    const budgetCop = Math.round(Number(dailyBudget) || 10000);
    const budgetCentavos = budgetCop * 100;

    // Crear la campaña en Meta Ads
    const campaignBody = new URLSearchParams({
      name: name.trim(),
      objective: objective || "OUTCOME_ENGAGEMENT",
      status: status || "ACTIVE",
      special_ad_categories: "[]",
      access_token: metaToken,
    });

    const campaignRes = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: campaignBody.toString(),
    });
    const campaignJson = await campaignRes.json();

    if (!campaignRes.ok || campaignJson.error) {
      const msg = campaignJson?.error?.message || "Error al crear campaña en Meta Ads.";
      return NextResponse.json({ error: msg, metaError: campaignJson.error }, { status: 400 });
    }

    const campaignId = campaignJson.id;

    // Targeting por defecto
    const countries = targeting.location?.countries || ["CO"];
    const geoLocations: any = { countries };
    if (targeting.location?.cities && targeting.location.cities.length > 0) {
      geoLocations.cities = targeting.location.cities.map((c: string) => ({ key: c }));
    }

    const targetingObj: any = {
      geo_locations: geoLocations,
      age_min: targeting.age_min || 18,
      age_max: targeting.age_max || 65,
      genders: targeting.genders || [1, 2],
      facebook_positions: ["feed", "story"],
      instagram_positions: ["stream", "story"],
      device_platforms: ["mobile", "desktop"],
    };

    const promotedObject: any = {};
    if (targetPageId) promotedObject.page_id = targetPageId;

    const adsetBody: any = {
      name: `${name.trim()} - Conjunto WhatsApp`,
      campaign_id: campaignId,
      billing_event: "IMPRESSIONS",
      optimization_goal: "CONVERSATIONS",
      destination_type: "WHATSAPP",
      targeting: JSON.stringify(targetingObj),
      status: status || "ACTIVE",
      start_time: horario.inicioIso,
      end_time: horario.finIso,
      access_token: metaToken,
    };

    if (Object.keys(promotedObject).length > 0) {
      adsetBody.promoted_object = JSON.stringify(promotedObject);
    }

    if (tipoPresupuesto === "lifetime") {
      adsetBody.lifetime_budget = String(budgetCentavos);
    } else {
      adsetBody.daily_budget = String(budgetCentavos);
    }

    const adsetRes = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountId}/adsets`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(adsetBody).toString(),
    });
    const adsetJson = await adsetRes.json();
    const adsetId = adsetJson.id;

    return NextResponse.json({
      ok: true,
      campaignId,
      adsetId,
      message: `¡Campaña "${name.trim()}" creada con éxito! Horario: ${horario.legibleInicio} → ${horario.legibleFin}`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al crear campaña" }, { status: 500 });
  }
}

// PATCH: Actualizar campaña
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { campaignId, name, status, dailyBudget, tipoPresupuesto } = body;

    if (!campaignId) {
      return NextResponse.json({ error: "Falta el ID de la campaña." }, { status: 400 });
    }

    const { metaToken, adAccountId } = await getMetaConfig();
    if (!metaToken) {
      return NextResponse.json({ error: "Falta META_MARKETING_TOKEN." }, { status: 400 });
    }

    const params = new URLSearchParams({ access_token: metaToken });
    if (name) params.append("name", name.trim());
    if (status) params.append("status", status);

    const res = await fetch(`https://graph.facebook.com/v19.0/${campaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const resJson = await res.json();

    return NextResponse.json({
      ok: true,
      campaignId,
      updated: resJson,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al actualizar campaña" }, { status: 500 });
  }
}
