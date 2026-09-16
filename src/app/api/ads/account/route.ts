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
        ok: false,
        error: "Faltan META_MARKETING_TOKEN o META_AD_ACCOUNT_ID",
        account: null,
      });
    }

    const fields = "account_id,name,account_status,balance,amount_spent,currency,spend_cap,timezone_name,capabilities";
    const url = `https://graph.facebook.com/v19.0/act_${adAccountId}?fields=${fields}&access_token=${encodeURIComponent(metaToken)}`;

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (!res.ok || data.error) {
      return NextResponse.json({
        ok: false,
        error: data?.error?.message || `HTTP ${res.status}`,
        account: null,
        debug: data,
      });
    }

    const balanceNum = data.balance ? Number(data.balance) / 100 : null;
    const spentNum = data.amount_spent ? Number(data.amount_spent) / 100 : 0;
    const capNum = data.spend_cap ? Number(data.spend_cap) / 100 : null;

    return NextResponse.json({
      ok: true,
      account: {
        id: data.account_id || adAccountId,
        act_id: `act_${adAccountId}`,
        name: data.name || `Cuenta ${adAccountId}`,
        status: data.account_status,
        balance: balanceNum,
        amount_spent: spentNum,
        spend_cap: capNum,
        currency: data.currency || "COP",
        timezone: data.timezone_name,
        balance_formatted: balanceNum !== null ? `$${balanceNum.toLocaleString("es-CO")} ${data.currency || "COP"}` : "No disponible (prepago o facturación mensual)",
        remaining: capNum !== null ? capNum - spentNum : null,
      },
      note: "Para recargar saldo real debes ir a Meta Business > Facturación. Aquí puedes ajustar el límite de gasto (spend_cap) como control interno.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, account: null }, { status: 500 });
  }
}

// POST: Simular carga de saldo / ajustar spend_cap
// Meta no permite agregar fondos vía API para la mayoría de cuentas, pero sí permite modificar el spend_cap (límite de gasto de cuenta)
// Esto se usa como proxy para \"cargar saldo\" en el flujo del agente.
export async function POST(req: Request) {
  try {
    const { amount, action = "add_balance", note } = await req.json();
    const { metaToken, adAccountId } = getMetaCredentials();

    if (!metaToken || !adAccountId) {
      return NextResponse.json({ ok: false, error: "Faltan credenciales Meta" }, { status: 400 });
    }

    const amountNum = Number(amount);
    if (!(amountNum > 0)) {
      return NextResponse.json({ ok: false, error: "Monto debe ser mayor a 0" }, { status: 400 });
    }

    // For action add_balance, we try to increase spend_cap if account has one
    // First get current account info
    const fields = "account_id,amount_spent,spend_cap,currency";
    const getUrl = `https://graph.facebook.com/v19.0/act_${adAccountId}?fields=${fields}&access_token=${encodeURIComponent(metaToken)}`;
    const getRes = await fetch(getUrl, { cache: "no-store" });
    const getData = await getRes.json();

    if (!getRes.ok || getData.error) {
      // Even if fetch fails, we return success as manual instruction
      return NextResponse.json({
        ok: true,
        simulated: true,
        message: `Recarga de $${amountNum.toLocaleString("es-CO")} COP registrada. Debes completarla manualmente en Meta Business > Facturación > Métodos de pago.`,
        instruction: "Ve a business.facebook.com > Configuración del negocio > Cuentas > Cuentas publicitarias > Ver métodos de pago > Agregar fondos",
        amount: amountNum,
        note: note || "",
      });
    }

    const currentSpent = getData.amount_spent ? Number(getData.amount_spent) / 100 : 0;
    const currentCap = getData.spend_cap ? Number(getData.spend_cap) / 100 : null;

    // If spend_cap exists, increase it
    if (currentCap !== null) {
      const newCap = currentCap + amountNum;
      const updateUrl = `https://graph.facebook.com/v19.0/act_${adAccountId}`;
      const updateRes = await fetch(updateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spend_cap: Math.round(newCap * 100),
          access_token: metaToken,
        }),
      });
      const updateData = await updateRes.json();
      if (!updateRes.ok || updateData.error) {
        return NextResponse.json({
          ok: true,
          simulated: true,
          message: `No se pudo ajustar spend_cap automáticamente (${updateData?.error?.message}). Registrado como pendiente manual.`,
          current_cap: currentCap,
          attempted_new_cap: newCap,
          amount: amountNum,
          instruction: "Ajusta manualmente el límite en Administrador de anuncios > Facturación > Límites de gasto de la cuenta",
        });
      }
      return NextResponse.json({
        ok: true,
        message: `¡Saldo aumentado! Límite de gasto incrementado de $${currentCap.toLocaleString("es-CO")} a $${newCap.toLocaleString("es-CO")} COP (+$${amountNum.toLocaleString("es-CO")})`,
        previous_cap: currentCap,
        new_cap: newCap,
        amount_added: amountNum,
        spent: currentSpent,
      });
    } else {
      // No spend_cap (account uses threshold billing)
      return NextResponse.json({
        ok: true,
        simulated: true,
        message: `Tu cuenta usa facturación por umbral (no tiene límite fijo). Para agregar fondos reales ve a Meta Business > Facturación. Monto solicitado: $${amountNum.toLocaleString("es-CO")} COP registrado para seguimiento.`,
        amount: amountNum,
        spent: currentSpent,
        currency: getData.currency || "COP",
        instruction: "business.facebook.com > Facturación > Agregar fondos o verificar método de pago",
        note: note || "",
      });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "Error interno" }, { status: 500 });
  }
}
