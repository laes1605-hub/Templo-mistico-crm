import { NextResponse } from "next/server";
import { getMetaConfig } from "@/lib/meta-config";

export const dynamic = "force-dynamic";

function money(n: number | null, currency: string) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString("es-CO")} ${currency}`;
}

/**
 * GET /api/ads/account
 * Devuelve el SALDO TOTAL de la cuenta publicitaria y el GASTO DE HOY.
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

    const fields = [
      "account_id",
      "name",
      "account_status",
      "balance",
      "amount_spent",
      "currency",
      "spend_cap",
      "timezone_name",
      "is_prepay_account",
      "funding_source",
      "funding_source_details",
      "next_bill_date",
    ].join(",");

    const accountUrl = `https://graph.facebook.com/v19.0/act_${adAccountId}?fields=${fields}&access_token=${encodeURIComponent(metaToken)}`;
    const todayUrl = `https://graph.facebook.com/v19.0/act_${adAccountId}/insights?fields=spend,impressions,clicks,actions&date_preset=today&access_token=${encodeURIComponent(metaToken)}`;
    const monthUrl = `https://graph.facebook.com/v19.0/act_${adAccountId}/insights?fields=spend&date_preset=last_30d&access_token=${encodeURIComponent(metaToken)}`;

    const [accRes, todayRes, monthRes] = await Promise.all([
      fetch(accountUrl, { cache: "no-store" }).catch((e) => ({ ok: false, json: async () => ({ error: { message: e.message } }) } as any)),
      fetch(todayUrl, { cache: "no-store" }).catch(() => null as any),
      fetch(monthUrl, { cache: "no-store" }).catch(() => null as any),
    ]);

    const data = await accRes.json();

    if (!accRes.ok || data.error) {
      return NextResponse.json({
        ok: false,
        error: data?.error?.message || `HTTP ${accRes.status || "Error"}`,
        account: null,
        debug: data,
      });
    }

    const currency = data.currency || "COP";
    const balanceNum = data.balance !== undefined && data.balance !== null ? Number(data.balance) / 100 : null;
    const spentNum = data.amount_spent ? Number(data.amount_spent) / 100 : 0;
    const capNum = data.spend_cap && Number(data.spend_cap) > 0 ? Number(data.spend_cap) / 100 : null;
    const esPrepago = Boolean(data.is_prepay_account);

    let spendToday = 0;
    let leadsToday = 0;
    let clicksToday = 0;
    let impressionsToday = 0;
    try {
      const todayJson = todayRes ? await todayRes.json() : null;
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
    } catch {}

    let spendLast30 = 0;
    try {
      const monthJson = monthRes ? await monthRes.json() : null;
      spendLast30 = Number(monthJson?.data?.[0]?.spend || 0);
    } catch {}

    const saldoDisponible = esPrepago
      ? balanceNum
      : capNum !== null
        ? capNum - spentNum
        : null;

    const fundingDetails = data.funding_source_details || null;

    return NextResponse.json({
      ok: true,
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

        next_bill_date: data.next_bill_date || null,
        funding_source: data.funding_source || null,
        funding_source_details: fundingDetails,
        payment_method: fundingDetails?.display_string || null,

        updated_at: new Date().toISOString(),
      },
      note: "El saldo solo se puede recargar desde Meta Business → Facturación. La API de Meta no permite agregar fondos.",
      billing_url: `https://business.facebook.com/ads/manager/billing_history/?act=${adAccountId}`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, account: null }, { status: 500 });
  }
}
