import { NextResponse } from "next/server";
import { getMetaConfig, metaGraph } from "@/lib/meta-config";

export const dynamic = "force-dynamic";

function money(n: number | null, currency: string) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString("es-CO")} ${currency}`;
}

/**
 * GET /api/ads/account
 * Devuelve el SALDO TOTAL de la cuenta publicitaria y el GASTO DE HOY.
 *
 * Robusto: si Meta rechaza algún campo opcional, reintenta con campos mínimos
 * en vez de devolver error. Los detalles de pago se piden aparte (best-effort)
 * para que nunca tumben la consulta principal.
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

    // Campos principales. NOTA: NO pedir next_bill_date ni funding_source aquí:
    // no existen / tumban toda la consulta en cuentas que no los soportan.
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
    const extraFields = "is_prepay_account";

    async function leerCuenta(fields: string) {
      const url = metaGraph(`/act_${adAccountId}?fields=${fields}&${tokenParam}`);
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      return { res, json };
    }

    // 1) Cuenta: intento con is_prepay_account, reintento sin él si Meta se queja
    let { res: accRes, json: data } = await leerCuenta(`${coreFields},${extraFields}`);
    if ((!accRes.ok || data?.error) && /100|field|param/i.test(String(data?.error?.code || "") + (data?.error?.message || ""))) {
      debug.push(`cuenta con extras falló (${data?.error?.message || accRes.status}), reintentando mínimo`);
      ({ res: accRes, json: data } = await leerCuenta(coreFields));
    }
    debug.push(`cuenta: ${accRes.status}${data?.error ? " " + data.error.message : ""}`);

    if (!accRes.ok || data?.error) {
      return NextResponse.json({
        ok: false,
        error: data?.error?.message
          ? `Meta dice: ${data.error.message}`
          : `No se pudo leer la cuenta act_${adAccountId} (HTTP ${accRes.status})`,
        hint: "Verifica que el token tenga permiso ads_read y acceso a esta cuenta en Business Manager.",
        account: null,
        debug,
      });
    }

    // 2) Gasto de hoy + últimos 30 días (llamadas separadas: si fallan, igual se muestra el saldo)
    let spendToday = 0;
    let leadsToday = 0;
    let clicksToday = 0;
    let impressionsToday = 0;
    try {
      const todayUrl = metaGraph(`/act_${adAccountId}/insights?fields=spend,impressions,clicks,actions&date_preset=today&${tokenParam}`);
      const todayRes = await fetch(todayUrl, { cache: "no-store" });
      const todayJson = await todayRes.json().catch(() => null);
      debug.push(`insights hoy: ${todayRes.status}`);
      const row = todayJson?.data?.[0];
      if (row) {
        spendToday = Number(row.spend || 0);
        clicksToday = Number(row.clicks || 0);
        impressionsToday = Number(row.impressions || 0);
        const actions = row.actions || [];
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
    } catch (e: any) {
      debug.push(`insights hoy error: ${e.message}`);
    }

    let spendLast30 = 0;
    try {
      const monthUrl = metaGraph(`/act_${adAccountId}/insights?fields=spend&date_preset=last_30d&${tokenParam}`);
      const monthRes = await fetch(monthUrl, { cache: "no-store" });
      const monthJson = await monthRes.json().catch(() => null);
      debug.push(`insights 30d: ${monthRes.status}`);
      spendLast30 = Number(monthJson?.data?.[0]?.spend || 0);
    } catch (e: any) {
      debug.push(`insights 30d error: ${e.message}`);
    }

    // 3) Método de pago (best-effort, nunca bloquea)
    let paymentMethod: string | null = null;
    try {
      const payUrl = metaGraph(`/act_${adAccountId}?fields=funding_source_details&${tokenParam}`);
      const payRes = await fetch(payUrl, { cache: "no-store" });
      const payJson = await payRes.json().catch(() => null);
      paymentMethod = payJson?.funding_source_details?.display_string || null;
      debug.push(`pago: ${payRes.status}`);
    } catch (e: any) {
      debug.push(`pago error: ${e.message}`);
    }

    const currency = data.currency || "COP";
    const balanceNum = data.balance !== undefined && data.balance !== null ? Number(data.balance) / 100 : null;
    const spentNum = data.amount_spent ? Number(data.amount_spent) / 100 : 0;
    const capNum = data.spend_cap && Number(data.spend_cap) > 0 ? Number(data.spend_cap) / 100 : null;
    const esPrepago = data.is_prepay_account === true || data.is_prepay_account === 1;

    const saldoDisponible = esPrepago
      ? balanceNum
      : capNum !== null
        ? capNum - spentNum
        : null;

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
        balance: balanceNum,
        balance_label: esPrepago ? "Saldo disponible" : "Saldo pendiente por facturar",
        balance_formatted: money(balanceNum, currency),

        saldo_disponible: saldoDisponible,
        saldo_disponible_formatted:
          saldoDisponible !== null
            ? money(saldoDisponible, currency)
            : esPrepago
              ? "Sin fondos prepago reportados"
              : "Facturación por umbral (sin límite fijo)",

        amount_spent: spentNum,
        amount_spent_formatted: money(spentNum, currency),
        spend_cap: capNum,
        spend_cap_formatted: capNum !== null ? money(capNum, currency) : "Sin límite configurado",
        remaining: capNum !== null ? capNum - spentNum : null,

        spend_today: spendToday,
        spend_today_formatted: money(spendToday, currency),
        leads_today: leadsToday,
        clicks_today: clicksToday,
        impressions_today: impressionsToday,
        cpl_today: leadsToday > 0 ? Math.round(spendToday / leadsToday) : 0,

        spend_last_30d: spendLast30,
        spend_last_30d_formatted: money(spendLast30, currency),

        payment_method: paymentMethod,
        updated_at: new Date().toISOString(),
      },
      note: "El saldo solo se puede recargar desde Meta Business → Facturación. La API de Meta no permite agregar fondos.",
      billing_url: `https://business.facebook.com/ads/manager/billing_history/?act=${adAccountId}`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, account: null }, { status: 500 });
  }
}
