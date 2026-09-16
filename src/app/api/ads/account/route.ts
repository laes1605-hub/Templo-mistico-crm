import { NextResponse } from "next/server";
import { getMetaConfig, metaGraph } from "@/lib/meta-config";

export const dynamic = "force-dynamic";

function money(n: number | null | undefined, currency: string) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString("es-CO")} ${currency}`;
}

/**
 * GET /api/ads/account
 *
 * Devuelve lo importante para pautar: LOS FONDOS DISPONIBLES de la cuenta
 * publicitaria (saldo prepago), el gasto de hoy / 7 / 30 días y para cuántos
 * días alcanzan los fondos al ritmo actual.
 *
 * Cómo se calculan los fondos (Meta no tiene un campo "fondos disponibles"
 * como tal, así que se deduce del saldo que Meta sí reporta):
 *   1. Cuenta PREPAGO (is_prepay_account = true): los fondos son el crédito a
 *      favor de la cuenta. Meta reporta el saldo como importe por cobrar, así
 *      que un saldo A FAVOR viene NEGATIVO (ej: -50000 = $500 de fondos).
 *      Si el saldo viene positivo, no hay fondos y ese valor es lo que se debe.
 *      Si Meta no reporta el crédito a favor, se estima con
 *      spend_cap − amount_spent (fondos cargados menos lo gastado).
 *   2. Cuenta POSPAGO con límite de gasto (spend_cap > 0):
 *      fondos = spend_cap − amount_spent (lo que queda disponible antes de que
 *      Meta detenga la entrega por alcanzar el límite).
 *   3. Si no hay ninguna de las dos cosas, los fondos quedan en null y se
 *      explica en el panel (facturación por umbral: no hay tope fijo).
 *
 * IMPORTANTE: el "crédito a favor" y el "spend_cap − amount_spent" NO son lo
 * mismo y jamás se comparan con un "min()": el crédito a favor es el dinero
 * precargado (lo que Meta Business llama "Fondos disponibles"), mientras que
 * spend_cap − amount_spent ya descuenta todo el gasto y suele ser mucho menor.
 *
 * Cada dato opcional se pide aparte: si Meta rechaza un campo, la consulta
 * principal sigue funcionando.
 */
export async function GET() {
  try {
    const { metaToken, adAccountId } = await getMetaConfig();
    if (!metaToken || !adAccountId) {
      return NextResponse.json({
        ok: false,
        error: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID",
        account: null,
      });
    }

    const debug: string[] = [];
    const tokenParam = `access_token=${encodeURIComponent(metaToken)}`;

    // Campos base. NO pedir next_bill_date ni funding_source aquí: tumban la
    // consulta en cuentas que no los soportan.
    const coreFields = [
      "account_id",
      "name",
      "account_status",
      "balance",
      "amount_spent",
      "currency",
      "spend_cap",
      "timezone_name",
    ].join(",");

    async function pedir(fields: string, etiqueta: string) {
      try {
        const url = metaGraph(`/act_${adAccountId}?fields=${fields}&${tokenParam}`);
        const res = await fetch(url, { cache: "no-store" });
        const json: any = await res.json().catch(() => ({}));
        debug.push(`${etiqueta}: ${res.status}${json?.error ? " " + json.error.message : ""}`);
        if (!res.ok || json?.error) return null;
        return json;
      } catch (e: any) {
        debug.push(`${etiqueta} error: ${e.message}`);
        return null;
      }
    }

    // 1) Cuenta (datos base + extras por separado para que un campo raro no tumbe todo)
    const data: any = await pedir(coreFields, "cuenta");
    if (!data) {
      return NextResponse.json({
        ok: false,
        error: `No se pudo leer la cuenta act_${adAccountId}.`,
        hint: "Verifica que el token tenga permiso ads_read y acceso a esta cuenta en Business Manager.",
        account: null,
        debug,
      });
    }

    const extras = await pedir("is_prepay_account,funding_source_details", "extras");
    const prepagoExtra = await pedir("is_prepay_account", "is_prepay_account");
    const financiacion = await pedir("funding_source_details", "funding_source_details");

    // 2) Gasto: hoy, últimos 7 días y últimos 30 días (cada uno best-effort)
    async function insights(preset: string, etiqueta: string) {
      try {
        const url = metaGraph(`/act_${adAccountId}/insights?fields=spend,impressions,clicks,actions&date_preset=${preset}&${tokenParam}`);
        const res = await fetch(url, { cache: "no-store" });
        const json: any = await res.json().catch(() => null);
        debug.push(`${etiqueta}: ${res.status}${json?.error ? " " + json.error.message : ""}`);
        if (!res.ok || json?.error) return null;
        return json?.data?.[0] || null;
      } catch (e: any) {
        debug.push(`${etiqueta} error: ${e.message}`);
        return null;
      }
    }

    const [filaHoy, fila7d, fila30d] = await Promise.all([
      insights("today", "insights hoy"),
      insights("last_7d", "insights 7d"),
      insights("last_30d", "insights 30d"),
    ]);

    let spendToday = 0;
    let leadsToday = 0;
    let clicksToday = 0;
    let impressionsToday = 0;
    if (filaHoy) {
      spendToday = Number(filaHoy.spend || 0);
      clicksToday = Number(filaHoy.clicks || 0);
      impressionsToday = Number(filaHoy.impressions || 0);
      const actions = filaHoy.actions || [];
      const leadAction = actions.find((a: any) =>
        ["lead", "onsite_conversion.messaging_conversation_started_7d", "messaging_conversation_started_7d"].includes(a.action_type)
      );
      leadsToday = Number(leadAction?.value || 0);
      if (!leadsToday) {
        leadsToday = actions
          .filter((a: any) => String(a.action_type || "").includes("messaging"))
          .reduce((s: number, a: any) => s + Number(a.value || 0), 0);
      }
    }

    const spendLast7 = Number(fila7d?.spend || 0);
    const spendLast30 = Number(fila30d?.spend || 0);

    const currency = data.currency || "COP";
    const balanceRaw = data.balance !== undefined && data.balance !== null ? Number(data.balance) : null;
    const balanceNum = balanceRaw !== null ? balanceRaw / 100 : null; // signo tal cual lo reporta Meta
    const spentNum = data.amount_spent ? Number(data.amount_spent) / 100 : 0;
    const capNum = data.spend_cap && Number(data.spend_cap) > 0 ? Number(data.spend_cap) / 100 : null;

    const prepagoFuente = prepagoExtra?.is_prepay_account ?? extras?.is_prepay_account;
    const esPrepago = prepagoFuente === true || prepagoFuente === 1 || prepagoFuente === "1";

    // Saldo A FAVOR: Meta reporta el importe por cobrar, así que el crédito
    // disponible llega en negativo.
    const creditoAFavor = balanceNum !== null && balanceNum < 0 ? Math.abs(balanceNum) : 0;
    const pendientePorPagar = balanceNum !== null && balanceNum > 0 ? balanceNum : 0;
    const saldoEnCero = balanceNum === null || balanceNum === 0;

    const disponibleBajoLimite = capNum !== null ? Math.max(0, capNum - spentNum) : null;

    // 3) FONDOS DISPONIBLES + de dónde salen.
    //    El error clásico era mezclar dos señales que NO son lo mismo:
    //      a) crédito a favor (balance negativo) = dinero precargado que se va
    //         descontando del gasto. Es lo que Meta Business llama
    //         "Fondos disponibles" y NO depende de cuánto se haya gastado.
    //      b) spend_cap − amount_spent = lo que queda del tope/límite de gasto
    //         configurado, que ya lleva descontado TODO lo gastado y puede ser
    //         un número chico aunque queden $16.000 de fondos cargados.
    //    Antes se tomaba la MENOR de las dos y por eso la app podía mostrar
    //    $136 teniendo $16.000 de fondos. Ahora el "crédito a favor" (lo que
    //    de verdad está precargado) manda cuando existe, y el margen del límite
    //    se muestra aparte solo como dato informativo.
    let fondos: number | null = null;
    let fondosOrigen = "";
    let fondosDetalle = "";

    if (esPrepago) {
      if (creditoAFavor > 0) {
        // Dinero precargado a favor de la cuenta: el verdadero "Fondos disponibles".
        fondos = creditoAFavor;
        fondosOrigen = "saldo prepago de la cuenta (crédito a favor que reporta Meta)";
        fondosDetalle = "Cuenta prepago: estos fondos se descuentan solos con el gasto de las campañas y al agotarse la entrega se detiene.";
        if (disponibleBajoLimite !== null && disponibleBajoLimite >= 0 && Math.abs(creditoAFavor - disponibleBajoLimite) > 1000) {
          fondosDetalle += ` El margen del límite de gasto (spend_cap − gastado) es aparte: ${money(disponibleBajoLimite, currency)}.`;
        }
      } else if (disponibleBajoLimite !== null && disponibleBajoLimite > 0) {
        // Meta no expone el crédito a favor; se cae al margen del límite cargado.
        fondos = disponibleBajoLimite;
        fondosOrigen = "fondos cargados menos lo gastado (según el límite de la cuenta)";
        fondosDetalle = "Cuenta prepago: Meta no reportó crédito a favor, así que se estiman los fondos con el límite cargado menos lo gastado.";
      } else {
        fondos = 0;
        fondosOrigen = "saldo prepago de la cuenta (lo que reporta Meta)";
        fondosDetalle = "La cuenta es prepago y no tiene fondos cargados (o el saldo está en cero): las campañas no entregarán hasta recargar.";
      }
    } else if (disponibleBajoLimite !== null) {
      fondos = disponibleBajoLimite;
      fondosOrigen = "límite de gasto de la cuenta − lo gastado";
      fondosDetalle = "La cuenta se factura por umbral; se muestra lo que queda antes de tocar el límite de gasto configurado.";
      if (creditoAFavor > 0 && creditoAFavor > disponibleBajoLimite) {
        fondos = creditoAFavor;
        fondosOrigen = "crédito a favor de la cuenta";
        fondosDetalle = "La cuenta tiene un crédito a favor (saldo negativo) que cubre la facturación; los fondos disponibles equivalen a ese crédito.";
      }
    } else {
      fondos = null;
      fondosOrigen = "no disponible";
      fondosDetalle = saldoEnCero
        ? "Meta no reporta saldo ni límite de gasto en esta cuenta (facturación por umbral, sin tope fijo). Revisa el saldo real en Meta Business."
        : "Meta no reporta fondos ni límite de gasto; el valor del saldo se muestra aparte tal como lo entrega la API.";
    }

    // 4) ¿Para cuántos días alcanzan? (ritmo de los últimos 7 días)
    const promedioDiario7d = spendLast7 > 0 ? spendLast7 / 7 : 0;
    const diasDeFondos = fondos !== null && fondos > 0 && promedioDiario7d > 0
      ? Math.floor(fondos / promedioDiario7d)
      : null;

    let alertaFondos: "ok" | "bajo" | "critico" | "agotado" | "desconocido" = "desconocido";
    if (fondos !== null) {
      if (fondos <= 0) alertaFondos = "agotado";
      else if (diasDeFondos !== null && diasDeFondos < 3) alertaFondos = "critico";
      else if (diasDeFondos !== null && diasDeFondos < 7) alertaFondos = "bajo";
      else alertaFondos = "ok";
    }

    const saldoDisponible = fondos; // compatibilidad con el panel anterior
    const paymentMethod =
      financiacion?.funding_source_details?.display_string ||
      extras?.funding_source_details?.display_string ||
      null;

    const billingUrl = `https://business.facebook.com/ads/manager/billing_history/?act=${adAccountId}`;
    const paymentUrl = `https://business.facebook.com/billing_hub/payment_settings?act=${adAccountId}`;

    return NextResponse.json({
      ok: true,
      debug,
      account: {
        id: data.account_id || adAccountId,
        act_id: `act_${adAccountId}`,
        name: data.name || `Cuenta ${adAccountId}`,
        status: data.account_status,
        currency,
        timezone: data.timezone_name,

        is_prepay: esPrepago,
        metodo_pago: esPrepago ? "Prepago (fondos disponibles)" : "Pospago (facturación por umbral)",

        // ===== FONDOS DISPONIBLES (lo principal del panel) =====
        fondos_disponibles: fondos,
        fondos_disponibles_formatted: fondos !== null ? money(fondos, currency) : "—",
        fondos_origen: fondosOrigen,
        fondos_detalle: fondosDetalle,
        fondos_alerta: alertaFondos,
        // Desglose transparente de las dos señales con las que Meta reporta fondos
        fondos_por_credito: creditoAFavor,
        fondos_por_credito_formatted: money(creditoAFavor, currency),
        fondos_por_limite: disponibleBajoLimite,
        fondos_por_limite_formatted: disponibleBajoLimite !== null ? money(disponibleBajoLimite, currency) : "—",
        promedio_diario_7d: Math.round(promedioDiario7d),
        promedio_diario_7d_formatted: money(promedioDiario7d, currency),
        dias_de_fondos: diasDeFondos,

        // ===== Saldo tal cual lo reporta Meta (para verificar) =====
        balance: balanceNum,
        balance_formatted: money(balanceNum, currency),
        balance_label: balanceNum !== null && balanceNum < 0
          ? "Saldo a favor de la cuenta"
          : "Importe por cobrar",
        credito_a_favor: creditoAFavor,
        credito_a_favor_formatted: money(creditoAFavor, currency),
        pendiente_por_pagar: pendientePorPagar,
        pendiente_por_pagar_formatted: money(pendientePorPagar, currency),

        // compatibilidad con el panel anterior
        saldo_disponible: saldoDisponible,
        saldo_disponible_formatted: saldoDisponible !== null ? money(saldoDisponible, currency) : "—",

        amount_spent: spentNum,
        amount_spent_formatted: money(spentNum, currency),
        spend_cap: capNum,
        spend_cap_formatted: capNum !== null ? money(capNum, currency) : "Sin límite configurado",
        remaining: disponibleBajoLimite,
        remaining_formatted: disponibleBajoLimite !== null ? money(disponibleBajoLimite, currency) : "—",

        spend_today: spendToday,
        spend_today_formatted: money(spendToday, currency),
        leads_today: leadsToday,
        clicks_today: clicksToday,
        impressions_today: impressionsToday,
        cpl_today: leadsToday > 0 ? Math.round(spendToday / leadsToday) : 0,

        spend_last_7d: spendLast7,
        spend_last_7d_formatted: money(spendLast7, currency),
        spend_last_30d: spendLast30,
        spend_last_30d_formatted: money(spendLast30, currency),

        payment_method: paymentMethod,
        updated_at: new Date().toISOString(),
      },
      note: "Los fondos disponibles son el saldo prepago de la cuenta. La API de Meta no permite agregar fondos: la recarga se hace en Meta Business → Facturación → Fondos disponibles.",
      billing_url: billingUrl,
      payment_url: paymentUrl,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, account: null }, { status: 500 });
  }
}
