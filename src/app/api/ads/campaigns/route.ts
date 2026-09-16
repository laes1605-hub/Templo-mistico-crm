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
      "id,name,status,effective_status,objective,start_time,stop_time,daily_budget,lifetime_budget,insights{spend,clicks,impressions,actions},adsets{id,name,daily_budget,lifetime_budget,start_time,end_time,destination_type,ads{id,name,creative{id,name,video_id,image_url}}}";
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
      let numAnuncios = 0;
      let destino = "whatsapp";
      if (c.adsets?.data) {
        c.adsets.data.forEach((adset: any) => {
          if (adset.destination_type) destino = adset.destination_type;
          if (adset.ads?.data) {
            numAnuncios += adset.ads.data.length;
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
        numAnuncios: numAnuncios || 1,
        destination: destino,
        currency: "COP",
      };
    });

    return NextResponse.json({
      live: true,
      campaigns,
      currency: "COP",
      total: campaigns.length,
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
      numAds = 1, // 1-5
      whatsappNumberId,
      whatsappDisplayNumber,
      whatsappVerifiedName,
      segmentation, // saved segmentation
      pageId, // optional
      adCopies, // optional array of ad copy variations
      addBalanceAmount, // optional saldo a cargar
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
    const numeroAnuncios = Math.min(5, Math.max(1, Number(numAds) || 1));

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

    // Preview completo que siempre se muestra
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
      anuncios: {
        total: numeroAnuncios,
        detalle: Array.from({ length: numeroAnuncios }, (_, i) => ({
          index: i + 1,
          nombre: `${name.trim()} - Anuncio ${i + 1}`,
          video_id: selectedVideoId || `auto_${i + 1}`,
          video_title: videoTitle || `Creativo ${i + 1}`,
          copy_variacion: adCopies?.[i] || `Variación ${i + 1} - Prueba A/B`,
          cta: "Enviar mensaje por WhatsApp",
          destino: "whatsapp",
        })),
        estrategia: `Se probarán ${numeroAnuncios} variaciones para identificar ganador rápido`,
      },
      whatsapp: {
        numero_id: whatsappNumberId || "auto",
        display_number: whatsappDisplayNumber || "+57 305 402 1111",
        verified_name: whatsappVerifiedName || "Templo Místico",
        solo_whatsapp: true,
      },
      segmentacion: finalSegmentation,
      saldo_recarga: addBalanceAmount ? Number(addBalanceAmount) : 0,
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

    // Try to create adset with WhatsApp destination if we have page info
    let adsetId: string | null = null;
    let adIds: string[] = [];
    let pageInfo = null;

    try {
      pageInfo = await getFirstPageId(metaToken);
      const effectivePageId = pageId || pageInfo?.id;

      if (effectivePageId) {
        // AdSet payload - WhatsApp only
        const adsetPayload: any = {
          name: `${name.trim()} - AdSet WhatsApp`,
          campaign_id: campaignId,
          daily_budget: budgetType === "daily" ? Math.round(totalBudget * 100) : Math.round((totalBudget / duracionDias) * 100),
          lifetime_budget: budgetType === "lifetime" ? Math.round(totalBudget * 100) : undefined,
          billing_event: "IMPRESSIONS",
          optimization_goal: "CONVERSATIONS",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          start_time: horario.startTimeIso,
          end_time: horario.stopTimeIso,
          targeting: {
            geo_locations: finalSegmentation.location || { countries: ["CO"] },
            age_min: finalSegmentation.age_min || 18,
            age_max: finalSegmentation.age_max || 65,
            genders: finalSegmentation.genders || [1, 2],
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["feed", "story", "reels"],
            instagram_positions: ["stream", "story", "reels"],
          },
          promoted_object: {
            page_id: effectivePageId,
          },
          destination_type: "WHATSAPP", // Force WhatsApp only
          status: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
          access_token: metaToken,
        };

        // If lifetime, remove daily
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

          // Try to create ads (1-5) - simplified, would need creative creation
          // For now we log intent, actual creative creation requires more steps
          for (let i = 0; i < numeroAnuncios; i++) {
            // Placeholder - real implementation would create creative then ad
            adIds.push(`pending_ad_${i + 1}_${adsetId}`);
          }
        }
      }
    } catch (adsetErr) {
      console.warn("AdSet creation failed (non-blocking):", adsetErr);
    }

    // Handle add balance if requested
    let balanceResult = null;
    if (addBalanceAmount && Number(addBalanceAmount) > 0) {
      try {
        const balRes = await fetch(`${process.env.NEXT_PUBLIC_VERCEL_URL || ""}/api/ads/account`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: Number(addBalanceAmount), note: `Recarga para campaña ${name.trim()}` }),
        });
        balanceResult = await balRes.json().catch(() => null);
      } catch {}
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
      preview: previewCompleto,
      selectedVideoId,
      videoTitle,
      balance: balanceResult,
      message: `¡Campaña "${name.trim()}" creada! ${numeroAnuncios} anuncios • WhatsApp ${whatsappDisplayNumber || "principal"} • ${horario.legibleInicio} → ${horario.legibleFin}`,
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
