import { NextResponse } from "next/server";
import { getMetaConfig, metaGraph } from "@/lib/meta-config";
import { primerLineaCopy, revisarCopy } from "@/lib/copy-post";

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

function finBogotaDesdeIso(inicioIso: string, dias: number): string {
  const t = new Date(inicioIso).getTime();
  const base = isNaN(t) ? Date.now() : t;
  // Días en hora Bogotá (UTC-5)
  const finMs = base + (Math.max(1, dias) - 1) * 24 * 60 * 60 * 1000;
  const bog = new Date(finMs - 0); // el desfase se fija con el sufijo -05:00
  const ref = new Date(bog.toLocaleString("en-US", { timeZone: "America/Bogota" }));
  const y = ref.getFullYear();
  const m = String(ref.getMonth() + 1).padStart(2, "0");
  const d = String(ref.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T23:59:59-05:00`;
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

async function postForm(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
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

    // Solo campos que existen y se usan. Un campo inválido tumba TODA la consulta.
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
      "adsets{id,name,status,daily_budget,lifetime_budget,start_time,end_time,destination_type,optimization_goal}",
      "ads{id,name,status,creative{id,name,title,body,image_url,thumbnail_url,object_story_spec}}",
      "insights{spend,impressions,clicks,cpc,cpm,ctr,actions,cost_per_action_type}",
    ].join(",");

    const url = metaGraph(`/act_${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=50&access_token=${encodeURIComponent(metaToken)}`);
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      return NextResponse.json({
        campaigns: [],
        live: false,
        error: data?.error?.message ? `Meta dice: ${data.error.message}` : "Error al conectar con Meta Ads",
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
        videoId: a.creative?.object_story_spec?.video_data?.video_id || null,
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

/** Resuelve nombres de intereses a IDs de Meta (Targeting Search). Lo que no resuelva se omite. */
async function resolverIntereses(nombres: string[], metaToken: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  const unicos = Array.from(new Set((nombres || []).map((n) => String(n || "").trim()).filter(Boolean))).slice(0, 8);
  for (const nombre of unicos) {
    try {
      const url = metaGraph(`/search?type=adinterest&q=${encodeURIComponent(nombre)}&limit=1&access_token=${encodeURIComponent(metaToken)}`);
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const primero = data?.data?.[0];
      if (primero?.id) out.push({ id: String(primero.id), name: primero.name || nombre });
    } catch {}
  }
  return out;
}

/**
 * Construye el targeting del conjunto de anuncios.
 * - Si la segmentación trae targeting_raw (público guardado o conjunto existente),
 *   se reutiliza TAL CUAL (es el targeting exacto que el usuario eligió).
 * - Si no, se construye desde países/edades/géneros + intereses resueltos a IDs.
 */
async function construirTargeting(seg: any, metaToken: string): Promise<{ targeting: any; nota: string | null }> {
  if (seg?.targeting_raw && typeof seg.targeting_raw === "object") {
    const raw = { ...seg.targeting_raw };
    // Campos de solo lectura que Meta rechaza al crear
    delete raw.id;
    if (!raw.geo_locations) raw.geo_locations = { countries: ["CO"] };
    return { targeting: raw, nota: null };
  }

  const countries = Array.isArray(seg?.location?.countries) && seg.location.countries.length > 0
    ? seg.location.countries.map((c: string) => String(c).toUpperCase())
    : ["CO"];
  const geoLocations: any = { countries };

  // Ciudades: Meta solo acepta el KEY numérico. Los nombres se omiten (no tumban la creación).
  const ciudades = Array.isArray(seg?.location?.cities) ? seg.location.cities : [];
  const keysNumericas = ciudades.map((c: string) => String(c).trim()).filter((c: string) => /^\d+$/.test(c));
  if (keysNumericas.length > 0) geoLocations.cities = keysNumericas.map((key: string) => ({ key }));
  const ciudadesOmitidas = ciudades.length - keysNumericas.length;

  const targeting: any = {
    geo_locations: geoLocations,
    age_min: Number(seg?.age_min) || 18,
    age_max: Number(seg?.age_max) || 65,
    genders: Array.isArray(seg?.genders) && seg.genders.length > 0 ? seg.genders : [1, 2],
    facebook_positions: ["feed", "story"],
    instagram_positions: ["stream", "story"],
    device_platforms: ["mobile", "desktop"],
  };

  const nombresIntereses = Array.isArray(seg?.interests) ? seg.interests : [];
  let nota: string | null = null;
  if (nombresIntereses.length > 0) {
    const resueltos = await resolverIntereses(nombresIntereses, metaToken);
    if (resueltos.length > 0) {
      targeting.flexible_spec = [{ interests: resueltos }];
      if (resueltos.length < nombresIntereses.length) {
        nota = `Intereses aplicados: ${resueltos.map((r) => r.name).join(", ")}. Los demás no existen con ese nombre en Meta.`;
      }
    } else {
      nota = "Los intereses por nombre no se encontraron en Meta y se omitieron. Para targeting exacto, elige un público guardado.";
    }
  }
  if (ciudadesOmitidas > 0) {
    nota = (nota ? nota + " " : "") + "Las ciudades por nombre se omitieron (Meta exige su código numérico).";
  }
  return { targeting, nota };
}

// POST: Crear campaña completa (campaña + conjunto + 1 anuncio por video con su copy)
export async function POST(req: Request) {
  try {
    const b = await req.json();

    // El panel envía estos nombres; se aceptan alias antiguos por compatibilidad.
    const name = String(b.name || "").trim();
    const budgetAmount = Math.round(Number(b.budgetAmount ?? b.dailyBudget ?? 0) || 0);
    const budgetTypeRaw = String(b.budgetType ?? b.tipoPresupuesto ?? "lifetime").toLowerCase();
    const budgetType = budgetTypeRaw === "daily" ? "daily" : "lifetime";
    const days = Math.max(1, Number(b.days ?? b.dias ?? 4) || 4);
    const startDate = String(b.startDate || b.fechaInicio || "").trim();
    const numAds = Math.max(1, Math.min(5, Number(b.numAds ?? b.numeroAnuncios ?? 1) || 1));
    const selectedVideos: any[] = Array.isArray(b.selectedVideos)
      ? b.selectedVideos
      : Array.isArray(b.videoIds)
        ? b.videoIds.map((id: any) => ({ id: String(id) }))
        : [];
    const adCopies: string[] = Array.isArray(b.adCopies)
      ? b.adCopies
      : Array.isArray(b.copiesPorAnuncio)
        ? b.copiesPorAnuncio
        : [];
    const segmentation = b.segmentation ?? b.targeting ?? {};
    const status = b.status === "PAUSED" ? "PAUSED" : "ACTIVE";
    const objective = String(b.objective || "OUTCOME_ENGAGEMENT");
    const whatsappDisplay = String(b.whatsappDisplayNumber || b.whatsappDisplay || "");
    const requestPageId = String(b.pageId || "").trim();

    if (!name) {
      return NextResponse.json({ error: "El nombre de la campaña es obligatorio." }, { status: 400 });
    }
    if (!(budgetAmount > 0)) {
      return NextResponse.json({ error: "El presupuesto debe ser mayor a 0." }, { status: 400 });
    }
    if (selectedVideos.length < numAds) {
      return NextResponse.json({
        error: `Pediste ${numAds} anuncio(s) pero solo llegaron ${selectedVideos.length} video(s). Elige ${numAds} videos diferentes.`,
      }, { status: 400 });
    }

    const { metaToken, adAccountId, pageId: configuredPageId } = await getMetaConfig();
    const targetPageId = requestPageId || configuredPageId;

    if (!metaToken || !adAccountId) {
      return NextResponse.json(
        { error: "Faltan las credenciales META_MARKETING_TOKEN o META_AD_ACCOUNT_ID." },
        { status: 400 }
      );
    }
    if (!targetPageId) {
      return NextResponse.json(
        { error: "Falta el ID de la Fan Page (META_PAGE_ID). Sin página no se pueden crear anuncios de video." },
        { status: 400 }
      );
    }

    const hoyBogota = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    const horario = calcularHorarioBogota(startDate || hoyBogota, days);
    const budgetCentavos = budgetAmount * 100;

    // Copys finales: uno por anuncio (el panel ya combina video + agente).
    // El copy es el TEXTO QUE VA DENTRO DEL POST: si lo que llega es el nombre
    // del archivo del video (Auto_Cropped_AR_4_X_5_DCO_1.mp4) se rechaza, no se
    // publica un nombre de archivo como copy.
    const copiesRevisados = Array.from({ length: numAds }, (_, i) => revisarCopy(adCopies[i]));
    const copiesFinales = copiesRevisados.map((c) => c.texto);
    const descartados = copiesRevisados.map((c) => c.descartado || "");
    const sinCopy = copiesFinales.map((c, i) => (c ? null : i + 1)).filter(Boolean) as number[];
    if (sinCopy.length > 0) {
      const porNombreArchivo = descartados
        .map((d, i) => (d && !copiesFinales[i] ? `#${i + 1} («${d}»)` : null))
        .filter(Boolean) as string[];
      return NextResponse.json({
        error:
          `Los anuncios ${sinCopy.join(", ")} quedaron sin copy. ` +
          (porNombreArchivo.length > 0
            ? `El texto que llegó (${porNombreArchivo.join(", ")}) es el nombre del archivo del video, no el copy. `
            : "Esos videos no traen texto publicado en el post. ") +
          "El copy debe ser el TEXTO QUE VA DENTRO DEL POST: escríbelo en el panel antes de crear.",
      }, { status: 400 });
    }

    // 1) Campaña
    const { res: campaignRes, json: campaignJson } = await postForm(
      metaGraph(`/act_${adAccountId}/campaigns`),
      {
        name,
        objective,
        status,
        special_ad_categories: "[]",
        access_token: metaToken,
      }
    );
    if (!campaignRes.ok || campaignJson.error) {
      const msg = campaignJson?.error?.message || "Error al crear campaña en Meta Ads.";
      return NextResponse.json({ error: `Meta dice: ${msg}`, metaError: campaignJson.error }, { status: 400 });
    }
    const campaignId = campaignJson.id;

    // 2) Conjunto (adset) con el targeting elegido + destino WhatsApp
    const { targeting, nota: targetingNota } = await construirTargeting(segmentation, metaToken);

    const adsetParams: Record<string, string> = {
      name: `${name} - Conjunto WhatsApp`,
      campaign_id: campaignId,
      billing_event: "IMPRESSIONS",
      optimization_goal: "CONVERSATIONS",
      destination_type: "WHATSAPP",
      targeting: JSON.stringify(targeting),
      promoted_object: JSON.stringify({ page_id: targetPageId }),
      status,
      start_time: horario.inicioIso,
      end_time: horario.finIso,
      access_token: metaToken,
    };
    if (budgetType === "lifetime") adsetParams.lifetime_budget = String(budgetCentavos);
    else adsetParams.daily_budget = String(budgetCentavos);

    const { res: adsetRes, json: adsetJson } = await postForm(metaGraph(`/act_${adAccountId}/adsets`), adsetParams);
    if (!adsetRes.ok || adsetJson.error) {
      // Rollback best-effort: no dejar la campaña huérfana
      try { await postForm(metaGraph(`/${campaignId}`), { status: "ARCHIVED", access_token: metaToken }); } catch {}
      const msg = adsetJson?.error?.message || "Error al crear el conjunto de anuncios.";
      return NextResponse.json({ error: `Meta dice: ${msg}`, metaError: adsetJson.error }, { status: 400 });
    }
    const adsetId = adsetJson.id;

    // 3) Un anuncio por video, cada uno con SU copy
    const adIds: string[] = [];
    const ads_errors: { index: number; video: string; error: string }[] = [];
    for (let i = 0; i < numAds; i++) {
      const video = selectedVideos[i];
      const copy = copiesFinales[i];
      const videoId = String(video?.id || "").trim();
      if (!videoId) {
        ads_errors.push({ index: i + 1, video: video?.title || `#${i + 1}`, error: "Sin ID de video." });
        continue;
      }
      try {
        const primeraLinea = primerLineaCopy(copy) || name;
        const titulo = primeraLinea.length > 60 ? primeraLinea.substring(0, 57).trim() + "..." : primeraLinea;

        const { res: creRes, json: creJson } = await postForm(metaGraph(`/act_${adAccountId}/adcreatives`), {
          name: `${name} - Creatividad ${i + 1}`,
          object_story_spec: JSON.stringify({
            page_id: targetPageId,
            video_data: {
              video_id: videoId,
              message: copy,
              title: titulo,
              call_to_action: {
                type: "WHATSAPP_MESSAGE",
                value: { app_destination: "WHATSAPP" },
              },
            },
          }),
          access_token: metaToken,
        });
        if (!creRes.ok || creJson.error || !creJson.id) {
          ads_errors.push({ index: i + 1, video: video?.title || videoId, error: creJson?.error?.message || "No se pudo crear la creatividad." });
          continue;
        }

        const { res: adRes, json: adJson } = await postForm(metaGraph(`/act_${adAccountId}/ads`), {
          name: `${name} - Anuncio ${i + 1}`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creJson.id }),
          status,
          access_token: metaToken,
        });
        if (!adRes.ok || adJson.error || !adJson.id) {
          ads_errors.push({ index: i + 1, video: video?.title || videoId, error: adJson?.error?.message || "No se pudo crear el anuncio." });
          continue;
        }
        adIds.push(adJson.id);
      } catch (e: any) {
        ads_errors.push({ index: i + 1, video: video?.title || video?.id || `#${i + 1}`, error: e.message });
      }
    }

    return NextResponse.json({
      ok: true,
      id: campaignId,
      campaignId,
      adsetId,
      adIds,
      legibleInicio: horario.legibleInicio,
      legibleFin: horario.legibleFin,
      fechaInicio: horario.fechaInicioDate,
      fechaFin: horario.fechaFinDate,
      targeting_nota: targetingNota,
      whatsapp: whatsappDisplay || null,
      ads_errors,
      message: `¡Campaña "${name}" creada con éxito! ${adIds.length}/${numAds} anuncios. Horario: ${horario.legibleInicio} → ${horario.legibleFin}`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al crear campaña" }, { status: 500 });
  }
}

// PATCH: Actualizar campaña (nombre, estado y presupuesto de sus conjuntos)
export async function PATCH(req: Request) {
  try {
    const b = await req.json();
    const campaignId = String(b.campaignId || "").trim();
    const name = String(b.name || "").trim();
    const status = b.status === "ACTIVE" || b.status === "PAUSED" ? b.status : null;
    const budgetTypeRaw = String(b.budgetType ?? b.tipoPresupuesto ?? "").toLowerCase();
    const budgetType = budgetTypeRaw === "daily" ? "daily" : budgetTypeRaw === "lifetime" ? "lifetime" : null;
    const budgetAmount = b.budgetAmount !== undefined || b.dailyBudget !== undefined
      ? Math.round(Number(b.budgetAmount ?? b.dailyBudget ?? 0) || 0)
      : null;
    const days = Math.max(1, Number(b.days ?? 8) || 8);

    if (!campaignId) {
      return NextResponse.json({ error: "Falta el ID de la campaña." }, { status: 400 });
    }

    const { metaToken } = await getMetaConfig();
    if (!metaToken) {
      return NextResponse.json({ error: "Falta META_MARKETING_TOKEN." }, { status: 400 });
    }

    // 1) Nombre y estado de la campaña
    const campParams: Record<string, string> = { access_token: metaToken };
    if (name) campParams.name = name;
    if (status) campParams.status = status;
    const { res, json: resJson } = await postForm(metaGraph(`/${campaignId}`), campParams);
    if (!res.ok || resJson?.error) {
      return NextResponse.json({ error: `Meta dice: ${resJson?.error?.message || "No se pudo actualizar la campaña."}` }, { status: 400 });
    }

    // 2) Presupuesto de los conjuntos (el presupuesto vive en el adset, no en la campaña)
    let adsetsActualizados = 0;
    const adset_errors: { id: string; error: string }[] = [];
    if (budgetType && budgetAmount !== null && budgetAmount > 0) {
      try {
        const listUrl = metaGraph(`/${campaignId}/adsets?fields=id,name,start_time&limit=50&access_token=${encodeURIComponent(metaToken)}`);
        const listRes = await fetch(listUrl, { cache: "no-store" });
        const listJson = await listRes.json().catch(() => ({}));
        const adsets = Array.isArray(listJson?.data) ? listJson.data : [];
        for (const ad of adsets) {
          try {
            const p: Record<string, string> = { access_token: metaToken };
            if (budgetType === "daily") {
              p.daily_budget = String(budgetAmount * 100);
            } else {
              p.lifetime_budget = String(budgetAmount * 100);
              p.end_time = finBogotaDesdeIso(ad.start_time || new Date().toISOString(), days);
            }
            const { res: uRes, json: uJson } = await postForm(metaGraph(`/${ad.id}`), p);
            if (!uRes.ok || uJson?.error) adset_errors.push({ id: String(ad.id), error: uJson?.error?.message || "Error" });
            else adsetsActualizados++;
          } catch (e: any) {
            adset_errors.push({ id: String(ad.id), error: e.message });
          }
        }
      } catch (e: any) {
        adset_errors.push({ id: "lista", error: e.message });
      }
    }

    return NextResponse.json({
      ok: true,
      campaignId,
      updated: resJson,
      adsets_actualizados: adsetsActualizados,
      adset_errors,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al actualizar campaña" }, { status: 500 });
  }
}
