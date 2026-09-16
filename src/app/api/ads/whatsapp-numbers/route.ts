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

type WaNumber = {
  id: string;
  /** Número tal cual lo entrega Meta, ej: "+57 305 402 1111" */
  display_phone_number: string;
  /** Alias usado por la UI (mismo valor que display_phone_number) */
  display_number: string;
  /** Solo dígitos, ej: "573054021111" */
  numero_e164: string;
  verified_name: string;
  quality_rating?: string;
  code_verification_status?: string;
  platform_type?: string;
  waba_id?: string;
  waba_name?: string;
  is_mock?: boolean;
};

/** Normaliza para que la UI siempre tenga EL NÚMERO disponible. */
function normalizar(pn: any, wabaId?: string, wabaName?: string): WaNumber {
  const numero = String(pn.display_phone_number || pn.number || "").trim();
  return {
    id: String(pn.id),
    display_phone_number: numero,
    display_number: numero,
    numero_e164: numero.replace(/[^\d]/g, ""),
    verified_name: String(pn.verified_name || wabaName || "WhatsApp Business"),
    quality_rating: pn.quality_rating,
    code_verification_status: pn.code_verification_status,
    platform_type: pn.platform_type,
    waba_id: wabaId,
    waba_name: wabaName,
  };
}

export async function GET() {
  try {
    const { metaToken } = getMetaCredentials();
    if (!metaToken) {
      return NextResponse.json({
        ok: false,
        numbers: [],
        error: "Falta META_MARKETING_TOKEN",
      });
    }

    const numbers: WaNumber[] = [];
    const debugSteps: string[] = [];
    const pnFields = "id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type";

    async function cargarNumerosDeWaba(wabaId: string, wabaName: string, etiqueta: string) {
      try {
        const pnUrl = `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=${pnFields}&limit=100&access_token=${encodeURIComponent(metaToken)}`;
        const pnRes = await fetch(pnUrl, { cache: "no-store" });
        const pnData = await pnRes.json();
        debugSteps.push(`${etiqueta} ${wabaId}: ${pnRes.status} (${pnData?.data?.length || 0})`);
        for (const pn of pnData?.data || []) {
          if (!numbers.find((n) => n.id === String(pn.id))) {
            numbers.push(normalizar(pn, wabaId, wabaName));
          }
        }
      } catch (e: any) {
        debugSteps.push(`${etiqueta} ${wabaId}: error ${e.message}`);
      }
    }

    // 1) Todos los negocios → todas las WABA (propias y de cliente) → todos los números
    try {
      const bizUrl = `https://graph.facebook.com/v19.0/me/businesses?fields=id,name&limit=50&access_token=${encodeURIComponent(metaToken)}`;
      const bizRes = await fetch(bizUrl, { cache: "no-store" });
      const bizData = await bizRes.json();
      debugSteps.push(`businesses: ${bizRes.status} (${bizData?.data?.length || 0})`);

      for (const biz of bizData?.data || []) {
        for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
          try {
            const wabaUrl = `https://graph.facebook.com/v19.0/${biz.id}/${edge}?fields=id,name&limit=50&access_token=${encodeURIComponent(metaToken)}`;
            const wabaRes = await fetch(wabaUrl, { cache: "no-store" });
            const wabaData = await wabaRes.json();
            debugSteps.push(`${edge} ${biz.id}: ${wabaRes.status} (${wabaData?.data?.length || 0})`);
            for (const waba of wabaData?.data || []) {
              await cargarNumerosDeWaba(waba.id, waba.name || biz.name, edge);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      debugSteps.push(`biz error: ${e.message}`);
    }

    // 2) WABA directa desde env (soporta varias separadas por coma)
    const envWabaIds = (process.env.META_WABA_ID || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const wabaId of envWabaIds) {
      await cargarNumerosDeWaba(wabaId, "WhatsApp Business", "env_waba");
    }

    // 3) Lista manual desde env (JSON o separada por comas)
    if (numbers.length === 0) {
      const envList = process.env.META_WHATSAPP_NUMBERS || "";
      if (envList) {
        try {
          const parsed = JSON.parse(envList);
          if (Array.isArray(parsed)) {
            parsed.forEach((n: any, idx: number) => {
              numbers.push(normalizar({ id: n.id || `env_${idx}`, ...n }));
            });
            debugSteps.push("using META_WHATSAPP_NUMBERS env (json)");
          }
        } catch {
          envList
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((p, idx) => {
              numbers.push(normalizar({ id: `env_${idx}`, display_phone_number: p }));
            });
          debugSteps.push("using META_WHATSAPP_NUMBERS env (csv)");
        }
      }
    }

    // 4) Sin números reales: no inventamos nombres "principal/secundario",
    //    devolvemos vacío para que la UI avise que hay que vincular WhatsApp.
    if (numbers.length === 0) {
      debugSteps.push("sin numeros vinculados");
      return NextResponse.json({
        ok: true,
        numbers: [],
        total: 0,
        debug: debugSteps,
        error:
          "No se encontraron números de WhatsApp vinculados al token. Verifica permisos whatsapp_business_management o configura META_WABA_ID / META_WHATSAPP_NUMBERS.",
      });
    }

    // Ordena por número para que la lista sea estable
    numbers.sort((a, b) => a.numero_e164.localeCompare(b.numero_e164));

    return NextResponse.json({
      ok: true,
      numbers,
      total: numbers.length,
      debug: debugSteps,
      note: "Solo WhatsApp - Messenger y otras plataformas excluidas",
    });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      numbers: [],
      error: error.message || "Error interno",
    });
  }
}
