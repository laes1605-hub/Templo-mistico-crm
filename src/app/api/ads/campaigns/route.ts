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

// Genera horario estricto: Inicio en fecha seleccionada a las 00:01 y Fin a las 23:59 del último día
// fechaInicioStr: YYYY-MM-DD opcional, si no se provee usa hoy
function calcularHorarioCampana(diasTotales: number, fechaInicioStr?: string, horaInicioStr: string = "00:01", horaFinStr: string = "23:59") {
  let baseDate: Date;
  if (fechaInicioStr) {
    // Parse YYYY-MM-DD as local date to avoid UTC shift
    const parts = fechaInicioStr.split("-");
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      baseDate = new Date(y, m, d);
    } else {
      baseDate = new Date(fechaInicioStr);
    }
  } else {
    baseDate = new Date();
  }

  const [hInicio, minInicio] = horaInicioStr.split(":").map(n => parseInt(n, 10) || 0);
  const [hFin, minFin] = horaFinStr.split(":").map(n => parseInt(n, 10) || 0);

  const fechaInicio = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hInicio, minInicio, 0, 0);
  const dias = Math.max(1, diasTotales);
  const fechaFin = new Date(fechaInicio.getFullYear(), fechaInicio.getMonth(), fechaInicio.getDate() + dias - 1, hFin, minFin, 59, 999);

  // Formateo legible Colombia
  const formatoLegible = (dt: Date) => {
    return dt.toLocaleString("es-CO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Bogota",
    });
  };

  return {
    startDate: fechaInicioStr || new Date().toISOString().split("T")[0],
    startTimeIso: fechaInicio.toISOString(),
    stopTimeIso: fechaFin.toISOString(),
    startTimeMeta: Math.floor(fechaInicio.getTime() / 1000),
    stopTimeMeta: Math.floor(fechaFin.getTime() / 1000),
    startLocal: fechaInicio,
    endLocal: fechaFin,
    dias,
    legibleInicio: formatoLegible(fechaInicio),
    legibleFin: formatoLegible(fechaFin),
    horaInicio: horaInicioStr,
    horaFin: horaFinStr,
  };
}

async function getFirstPageId(metaToken: string): Promise<{ id: string; name: string } | null> {
  try {
    const url = `https://graph.facebook.com/v19.0/me/accounts?fields=id,name&limit=25&access_token=${encodeURIComponent(metaToken)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (data?.data && data.data.length > 0) {
      const templo = data.data.find((p: any) => (p.name || "").toLowerCase().includes("templo")) || data.data[0];
      return { id: templo.id, name: templo.name };
    }
  } catch {}
  return null;
}

export async function GET() {
  try {
    const { metaToken, adAccountId } = getMetaCredentials();

    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        live: false,
        campaigns: [],
        currency: "COP",
        note: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID en Vercel.",
      });
    }

    const fields =
      "id,name,status,effective_status,objective,created_time,start_time,stop_time,daily_budget,lifetime_budget,insights{spend,clicks,impressions,actions},adsets{id,name,daily_budget,lifetime_budget,start_time,end_time,destination_type,targeting,ads{id,name,status,effective_status,created_time,updated_time,creative{id,name,video_id,thumbnail_url,image_url,object_story_spec}}}";
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
      const metaErrorMsg = data?.error?.message || `HTTP ${res.status}: ${rawText.substring(0, 200)}`;
      return NextResponse.json({
        live: false,
        campaigns: [],
        currency: "COP",
        error: `Error Meta API: ${metaErrorMsg}`,
        debug: { adAccountId, status: res.status },
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

      const videosUsed: string[] = [];
      const anuncios: any[] = [];
      let destino = "whatsapp";

      // Fechas reales de los anuncios (adsets): la campaña puede tener un rango
      // y cada conjunto/anuncio el suyo. Mostramos ambos.
      let adStart: number | null = null;
      let adEnd: number | null = null;

      if (c.adsets?.data) {
        c.adsets.data.forEach((adset: any) => {
          if (adset.destination_type) destino = adset.destination_type;

          const s = adset.start_time ? new Date(adset.start_time).getTime() : null;
          const e = adset.end_time ? new Date(adset.end_time).getTime() : null;
          if (s && (adStart === null || s < adStart)) adStart = s;
          if (e && (adEnd === null || e > adEnd)) adEnd = e;

          if (adset.ads?.data) {
            adset.ads.data.forEach((ad: any) => {
              const videoId =
                ad.creative?.video_id ||
                ad.creative?.object_story_spec?.video_data?.video_id ||
                null;
              if (videoId) videosUsed.push(String(videoId));
              anuncios.push({
                id: ad.id,
                name: ad.name,
                status: ad.effective_status || ad.status || "UNKNOWN",
                videoId,
                thumbnail: ad.creative?.thumbnail_url || ad.creative?.image_url || null,
                createdTime: ad.created_time || null,
                adsetId: adset.id,
                adsetName: adset.name,
                adsetStart: adset.start_time || null,
                adsetEnd: adset.end_time || null,
              });
            });
          }
        });
      }

      const startTime = c.start_time || (adStart ? new Date(adStart).toISOString() : null);
      const stopTime = c.stop_time || (adEnd ? new Date(adEnd).toISOString() : null);

      const fmt = (iso: string | null) =>
        iso
          ? new Date(iso).toLocaleString("es-CO", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: "America/Bogota",
            })
          : null;

      // Días restantes / transcurridos para saber de un vistazo cómo va
      const ahora = Date.now();
      const finMs = stopTime ? new Date(stopTime).getTime() : null;
      const inicioMs = startTime ? new Date(startTime).getTime() : null;
      const diasRestantes = finMs ? Math.max(0, Math.ceil((finMs - ahora) / 86400000)) : null;
      const diasTotales = inicioMs && finMs ? Math.max(1, Math.ceil((finMs - inicioMs) / 86400000)) : null;

      return {
        id: c.id,
        name: c.name,
        status: status,
        objective: c.objective || "",
        createdTime: c.created_time || null,

        // FECHAS DE LA CAMPAÑA
        startTime,
        stopTime,
        startDate: startTime ? startTime.split("T")[0] : null,
        endDate: stopTime ? stopTime.split("T")[0] : null,
        legibleInicio: fmt(startTime),
        legibleFin: fmt(stopTime),

        // FECHAS DE LOS ANUNCIOS (conjuntos)
        adStartTime: adStart ? new Date(adStart).toISOString() : null,
        adEndTime: adEnd ? new Date(adEnd).toISOString() : null,
        legibleInicioAnuncio: fmt(adStart ? new Date(adStart).toISOString() : null),
        legibleFinAnuncio: fmt(adEnd ? new Date(adEnd).toISOString() : null),

        diasTotales,
        diasRestantes,
        vigente: finMs ? finMs > ahora : null,

        dailyBudget: c.daily_budget ? Math.round(Number(c.daily_budget) / 100) : 0,
        lifetimeBudget: c.lifetime_budget ? Math.round(Number(c.lifetime_budget) / 100) : 0,
        spend,
        clicks,
        impressions,
        leads,
        cpl,
        videosUsed: Array.from(new Set(videosUsed)),
        anuncios,
        numAnuncios: anuncios.length || 1,
        destination: destino,
        currency: "COP",
      };
    });

    return NextResponse.json({
      live: true,
      campaigns,
      currency: "COP",
      total: campaigns.length,
      updatedAt: new Date().toISOString(),
      note: `Conectado a Meta API. ${campaigns.length} campañas cargadas. Solo WhatsApp.`,
    });
  } catch (error: any) {
    return NextResponse.json({
      live: false,
      campaigns: [],
      currency: "COP",
      error: "Error interno: " + (error.message || String(error)),
    });
  }
}

// POST: Crear campaña completa dirigida ÚNICAMENTE a WhatsApp con fecha de inicio, número de anuncios y segmentación
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      budgetType = "lifetime",
      budgetAmount,
      days = 4,
      objective = "OUTCOME_ENGAGEMENT", // For WhatsApp, ENGAGEMENT or LEADS works best
      status = "PAUSED",
      selectedVideoId,
      videoTitle,
      // NEW FIELDS
      startDate, // YYYY-MM-DD - super importante
      startTime = "00:01",
      endTime = "23:59",
      numAds = 1, // 1-5 => 1-5 VIDEOS DIFERENTES
      selectedVideos, // array de videos distintos [{id,title,description,picture}]
      whatsappNumberId,
      whatsappDisplayNumber,
      whatsappVerifiedName,
      segmentation, // saved segmentation
      segmentationName,
      pageId, // optional
      adCopies, // optional array of ad copy variations - copy del video o del agente
      videoDescription,
      adCopyBase,
      usarCopyVideo,
    } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "El nombre de la campaña es obligatorio." }, { status: 400 });
    }

    const { metaToken, adAccountId } = getMetaCredentials();

    if (!metaToken || !adAccountId) {
      return NextResponse.json(
        {
          error: "Faltan las credenciales META_MARKETING_TOKEN o META_AD_ACCOUNT_ID en el entorno.",
        },
        { status: 400 }
      );
    }

    const totalBudget = Number(budgetAmount) || 0;
    const duracionDias = Math.max(1, Number(days) || 4);

    // La cantidad de anuncios = cantidad de VIDEOS DIFERENTES de la Fan Page.
    // Si el cliente pide 3, son 3 videos distintos publicados en la página.
    const videosElegidos: any[] = Array.isArray(selectedVideos)
      ? selectedVideos.filter((v: any) => v && v.id)
      : selectedVideoId
        ? [{ id: selectedVideoId, title: videoTitle, description: videoDescription }]
        : [];

    const numeroAnuncios = Math.min(
      5,
      Math.max(1, videosElegidos.length || Number(numAds) || 1)
    );

    // Validar fecha inicio - no puede ser pasado si es hoy? Permitir hoy o futuro
    const horario = calcularHorarioCampana(duracionDias, startDate, startTime, endTime);

    // Default segmentation for Templo Místico if not provided - Colombia focus
    const defaultSegmentation = {
      location: { countries: ["CO"], cities: [], regions: [] },
      age_min: 18,
      age_max: 65,
      genders: [1, 2], // all
      interests: ["Esoterismo", "Tarot", "Amarres de amor", "Espiritualidad", "Astrología"],
      languages: ["es"],
      placements: ["facebook", "instagram"], // but destination whatsapp only
      destination: "whatsapp_only",
      whatsapp_only: true,
      messenger_excluded: true,
      instagram_dm_excluded: true,
    };

    const finalSegmentation = segmentation || defaultSegmentation;

    // Determinar copy base - del video seleccionado o del agente
    const copyVideoOriginal = (videoDescription || "").trim();
    const copyAgenteOriginal = (adCopyBase || "").trim();
    const usarVideoFlag = usarCopyVideo !== undefined ? Boolean(usarCopyVideo) : true;

    // Preview completo que siempre se muestra - CON COPY
    const previewCompleto = {
      nombre: name.trim(),
      objetivo: objective,
      destino: "WHATSAPP_ONLY",
      destino_detalle: "Solo WhatsApp - Messenger, Instagram DM y otras plataformas excluidas",
      presupuesto: {
        tipo: budgetType,
        monto: totalBudget,
        monto_formateado: `$${totalBudget.toLocaleString("es-CO")} COP`,
        iva: Math.round(totalBudget * 0.19),
        total_con_iva: Math.round(totalBudget * 1.19),
        diario_aprox: budgetType === "lifetime" ? Math.round(totalBudget / duracionDias) : totalBudget,
      },
      duracion: {
        dias: duracionDias,
        fecha_inicio: horario.startDate,
        hora_inicio: horario.horaInicio,
        fecha_fin: horario.endLocal.toISOString().split("T")[0],
        hora_fin: horario.horaFin,
        inicio_iso: horario.startTimeIso,
        fin_iso: horario.stopTimeIso,
        legible_inicio: horario.legibleInicio,
        legible_fin: horario.legibleFin,
        resumen: `${horario.legibleInicio} → ${horario.legibleFin} (${duracionDias} días)`,
      },
      copy: {
        video_original: copyVideoOriginal,
        agente_base: copyAgenteOriginal,
        usar_video: usarVideoFlag,
        origen: usarVideoFlag ? (copyVideoOriginal ? "video + agente" : "agente") : "agente",
      },
      anuncios: {
        total: numeroAnuncios,
        // 1 anuncio = 1 VIDEO DIFERENTE de los publicados en la Fan Page
        videos_distintos: videosElegidos.length,
        detalle: Array.from({ length: numeroAnuncios }, (_, i) => {
          const vid = videosElegidos[i] || videosElegidos[0] || null;
          const descVideo = (vid?.description || "").trim() || copyVideoOriginal;
          // Nunca se inventa copy: si no hay texto real, queda vacío y se avisa.
          const copyFinal =
            adCopies?.[i] ||
            (usarVideoFlag && descVideo ? descVideo : copyAgenteOriginal) ||
            "";
          return {
            index: i + 1,
            nombre: `${name.trim()} - Anuncio ${i + 1}`,
            video_id: vid?.id || selectedVideoId || `auto_${i + 1}`,
            video_title: vid?.title || videoTitle || `Creativo ${i + 1}`,
            video_thumbnail: vid?.picture || null,
            video_description: descVideo,
            copy: copyFinal,
            copy_preview: copyFinal.substring(0, 120) + (copyFinal.length > 120 ? "..." : ""),
            copy_variacion: adCopies?.[i] || `Variación ${i + 1}`,
            copy_origen: usarVideoFlag
              ? descVideo
                ? adCopies?.[i] && adCopies[i] !== descVideo
                  ? "video + agente variación"
                  : "video"
                : "agente"
              : "agente",
            cta: "Enviar mensaje por WhatsApp",
            destino: "whatsapp",
          };
        }),
        estrategia: `Se publicarán ${numeroAnuncios} anuncios con ${videosElegidos.length || numeroAnuncios} videos DIFERENTES de la Fan Page para identificar el ganador - Copy: ${usarVideoFlag ? "del video seleccionado + agente" : "del agente"}`,
      },
      whatsapp: {
        numero_id: whatsappNumberId || "auto",
        display_number: whatsappDisplayNumber || "+57 305 402 1111",
        verified_name: whatsappVerifiedName || "Templo Místico",
        solo_whatsapp: true,
      },
      segmentacion: finalSegmentation,
      segmentacion_nombre: segmentationName || finalSegmentation?.nombre || "Segmentación por defecto",
    };

    // Intentar crear campaña real en Meta
    const campaignPayload: Record<string, any> = {
      name: name.trim(),
      objective: objective || "OUTCOME_ENGAGEMENT",
      status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
      special_ad_categories: [],
      start_time: horario.startTimeIso,
      stop_time: horario.stopTimeIso,
      access_token: metaToken,
    };

    if (totalBudget > 0) {
      if (budgetType === "lifetime") {
        campaignPayload.lifetime_budget = Math.round(totalBudget * 100);
      } else {
        campaignPayload.daily_budget = Math.round(totalBudget * 100);
      }
    }

    const campaignUrl = `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns`;
    const campaignRes = await fetch(campaignUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campaignPayload),
    });
    const campaignJson = await campaignRes.json();

    if (!campaignRes.ok || campaignJson.error) {
      // Even if Meta fails, return preview so UI can show full campaign
      const msg = campaignJson?.error?.message || "Error al crear campaña en Meta Ads.";
      return NextResponse.json(
        {
          success: false,
          error: msg,
          details: campaignJson?.error,
          preview: previewCompleto,
          note: "Vista previa generada aunque Meta falló. Verifica token y permisos.",
        },
        { status: campaignRes.status || 500 }
      );
    }

    const campaignId = campaignJson.id;

    // Crear el conjunto de anuncios (WhatsApp) y UN ANUNCIO POR CADA VIDEO DIFERENTE
    let adsetId: string | null = null;
    const adIds: string[] = [];
    const adsCreados: any[] = [];
    const adsErrores: any[] = [];
    let pageInfo = null;

    try {
      pageInfo = await getFirstPageId(metaToken);
      const effectivePageId = pageId || pageInfo?.id;

      if (effectivePageId) {
        // Targeting construido desde la SEGMENTACIÓN GUARDADA que eligió el usuario.
        // Soporta tanto el formato interno como el targeting crudo de Meta.
        const targeting: any = finalSegmentation.targeting_raw
          ? { ...finalSegmentation.targeting_raw }
          : {
              geo_locations:
                finalSegmentation.geo_locations ||
                finalSegmentation.location || { countries: ["CO"] },
              age_min: finalSegmentation.age_min || finalSegmentation.edad_min || 18,
              age_max: finalSegmentation.age_max || finalSegmentation.edad_max || 65,
              genders: finalSegmentation.genders || finalSegmentation.generos || [1, 2],
            };

        // Los placements se fuerzan para que el destino sea SOLO WhatsApp
        targeting.publisher_platforms = ["facebook", "instagram"];
        targeting.facebook_positions = ["feed", "story", "reels"];
        targeting.instagram_positions = ["stream", "story", "reels"];

        const adsetPayload: any = {
          name: `${name.trim()} - AdSet WhatsApp`,
          campaign_id: campaignId,
          daily_budget:
            budgetType === "daily"
              ? Math.round(totalBudget * 100)
              : Math.round((totalBudget / duracionDias) * 100),
          lifetime_budget: budgetType === "lifetime" ? Math.round(totalBudget * 100) : undefined,
          billing_event: "IMPRESSIONS",
          optimization_goal: "CONVERSATIONS",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          start_time: horario.startTimeIso,
          end_time: horario.stopTimeIso,
          targeting,
          promoted_object: { page_id: effectivePageId },
          destination_type: "WHATSAPP",
          status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
          access_token: metaToken,
        };

        if (budgetType === "lifetime") {
          delete adsetPayload.daily_budget;
        } else {
          delete adsetPayload.lifetime_budget;
        }

        const adsetUrl = `https://graph.facebook.com/v19.0/act_${adAccountId}/adsets`;
        const adsetRes = await fetch(adsetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(adsetPayload),
        });
        const adsetJson = await adsetRes.json();

        if (adsetRes.ok && !adsetJson.error) {
          adsetId = adsetJson.id;

          // Un anuncio por cada VIDEO DIFERENTE seleccionado de la Fan Page
          const numeroWhatsapp = String(whatsappDisplayNumber || "").replace(/[^\d]/g, "");

          for (let i = 0; i < numeroAnuncios; i++) {
            const vid = videosElegidos[i] || videosElegidos[0] || null;
            const mensaje =
              adCopies?.[i] ||
              (usarVideoFlag && (vid?.description || copyVideoOriginal)) ||
              copyAgenteOriginal ||
              `${name.trim()} - Anuncio ${i + 1}`;

            if (!vid?.id) {
              adsErrores.push({ index: i + 1, error: "Sin video asignado para este anuncio" });
              continue;
            }

            try {
              // 1) Creative con el video de la página y CTA a WhatsApp
              const creativePayload: any = {
                name: `${name.trim()} - Creativo ${i + 1}`,
                object_story_spec: {
                  page_id: effectivePageId,
                  video_data: {
                    video_id: String(vid.id),
                    message: mensaje,
                    image_url: vid.picture || undefined,
                    call_to_action: {
                      type: "WHATSAPP_MESSAGE",
                      value: {
                        app_destination: "WHATSAPP",
                        link: numeroWhatsapp
                          ? `https://api.whatsapp.com/send?phone=${numeroWhatsapp}`
                          : `https://api.whatsapp.com/send`,
                      },
                    },
                  },
                },
                access_token: metaToken,
              };

              const creativeRes = await fetch(
                `https://graph.facebook.com/v19.0/act_${adAccountId}/adcreatives`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(creativePayload),
                }
              );
              const creativeJson = await creativeRes.json();

              if (!creativeRes.ok || creativeJson.error) {
                adsErrores.push({
                  index: i + 1,
                  video_id: vid.id,
                  video_title: vid.title,
                  error: creativeJson?.error?.message || `HTTP ${creativeRes.status}`,
                });
                continue;
              }

              // 2) Anuncio que usa ese creative
              const adRes = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountId}/ads`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: `${name.trim()} - Anuncio ${i + 1} (${vid.title || vid.id})`,
                  adset_id: adsetId,
                  creative: { creative_id: creativeJson.id },
                  status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
                  access_token: metaToken,
                }),
              });
              const adJson = await adRes.json();

              if (adRes.ok && !adJson.error) {
                adIds.push(adJson.id);
                adsCreados.push({
                  index: i + 1,
                  ad_id: adJson.id,
                  creative_id: creativeJson.id,
                  video_id: vid.id,
                  video_title: vid.title || null,
                });
              } else {
                adsErrores.push({
                  index: i + 1,
                  video_id: vid.id,
                  video_title: vid.title,
                  error: adJson?.error?.message || `HTTP ${adRes.status}`,
                });
              }
            } catch (adErr: any) {
              adsErrores.push({ index: i + 1, video_id: vid?.id, error: adErr.message });
            }
          }
        } else {
          adsErrores.push({ error: adsetJson?.error?.message || "No se pudo crear el conjunto de anuncios" });
        }
      }
    } catch (adsetErr: any) {
      console.warn("AdSet creation failed (non-blocking):", adsetErr);
      adsErrores.push({ error: adsetErr.message });
    }

    return NextResponse.json({
      success: true,
      id: campaignId,
      adset_id: adsetId,
      ad_ids: adIds,
      name: name.trim(),
      status: campaignPayload.status,
      budgetType,
      budgetAmount: totalBudget,
      days: duracionDias,
      startTime: horario.startTimeIso,
      stopTime: horario.stopTimeIso,
      startDate: horario.startDate,
      endDate: horario.endLocal.toISOString().split("T")[0],
      legibleInicio: horario.legibleInicio,
      legibleFin: horario.legibleFin,
      numAds: numeroAnuncios,
      whatsapp: {
        id: whatsappNumberId,
        display: whatsappDisplayNumber,
        name: whatsappVerifiedName,
      },
      segmentation: finalSegmentation,
      segmentationName: segmentationName || finalSegmentation?.nombre || null,
      preview: previewCompleto,
      selectedVideoId,
      videoTitle,
      videos: videosElegidos.map((v: any) => ({ id: v.id, title: v.title })),
      ads_created: adsCreados,
      ads_errors: adsErrores,
      message: `¡Campaña "${name.trim()}" creada! ${adsCreados.length || numeroAnuncios} anuncios con videos diferentes • WhatsApp ${whatsappDisplayNumber || "—"} • ${horario.legibleInicio} → ${horario.legibleFin}`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al crear campaña", preview: null }, { status: 500 });
  }
}

// PATCH: Modificar presupuesto, extender duración, estado, fecha inicio y número de anuncios
export async function PATCH(req: Request) {
  try {
    const { campaignId, name, budgetType, budgetAmount, days, status, extendDays, startDate, startTime, endTime, numAds, whatsappNumberId } =
      await req.json();

    if (!campaignId) {
      return NextResponse.json({ error: "Falta el ID de la campaña." }, { status: 400 });
    }

    const { metaToken } = getMetaCredentials();

    if (!metaToken) {
      return NextResponse.json({ error: "Falta META_MARKETING_TOKEN en el entorno." }, { status: 400 });
    }

    const body: Record<string, any> = {
      access_token: metaToken,
    };

    if (name && name.trim()) {
      body.name = name.trim();
    }

    const diasTotales = Number(days || extendDays);
    let horario = null;
    if ((!isNaN(diasTotales) && diasTotales > 0) || startDate) {
      const d = diasTotales > 0 ? diasTotales : 4;
      horario = calcularHorarioCampana(d, startDate, startTime || "00:01", endTime || "23:59");
      body.stop_time = horario.stopTimeIso;
      if (startDate) {
        body.start_time = horario.startTimeIso;
      }
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
      body: JSON.stringify(body),
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
        startTime: body.start_time,
        status: body.status,
        daysExtended: diasTotales || undefined,
        startDate: horario?.startDate,
        legibleInicio: horario?.legibleInicio,
        legibleFin: horario?.legibleFin,
        numAds: numAds,
        whatsappNumberId,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error interno al actualizar campaña" }, { status: 500 });
  }
}
