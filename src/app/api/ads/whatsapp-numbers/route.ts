import { NextResponse } from "next/server";
import { getMetaConfig } from "@/lib/meta-config";

export const dynamic = "force-dynamic";

type WaNumber = {
  id: string;
  display_phone_number: string;
  display_number: string;
  numero_e164: string;
  verified_name: string;
  quality_rating?: string;
  code_verification_status?: string;
  platform_type?: string;
  waba_id?: string;
  waba_name?: string;
};

function normalizar(pn: any, wabaId?: string, wabaName?: string): WaNumber {
  const numero = String(pn.display_phone_number || pn.number || pn.display_number || "").trim();
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
    const { metaToken, wabaIds, whatsappNumbers: defaultNumbers } = await getMetaConfig();

    const numbers: WaNumber[] = [];
    const debugSteps: string[] = [];
    const pnFields = "id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type";

    async function cargarNumerosDeWaba(wabaId: string, wabaName: string, etiqueta: string) {
      if (!metaToken) return;
      try {
        const pnUrl = `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=${pnFields}&limit=100&access_token=${encodeURIComponent(metaToken)}`;
        const pnRes = await fetch(pnUrl, { cache: "no-store" });
        const pnData = await pnRes.json();
        debugSteps.push(`${etiqueta} ${wabaId}: ${pnRes.status} (${pnData?.data?.length || 0})`);
        for (const pn of pnData?.data || []) {
          if (!numbers.find((n) => n.id === String(pn.id) || n.numero_e164 === String(pn.display_phone_number || "").replace(/[^\d]/g, ""))) {
            numbers.push(normalizar(pn, wabaId, wabaName));
          }
        }
      } catch (e: any) {
        debugSteps.push(`${etiqueta} ${wabaId}: error ${e.message}`);
      }
    }

    // 1) Si hay token, intentamos consultar en tiempo real las WABAs configuradas
    if (metaToken && wabaIds.length > 0) {
      for (const wId of wabaIds) {
        await cargarNumerosDeWaba(wId, "WhatsApp Business", "waba");
      }
    }

    // 2) Consultar en me/businesses por si hay más
    if (metaToken && numbers.length === 0) {
      try {
        const bizUrl = `https://graph.facebook.com/v19.0/me/businesses?fields=id,name&limit=50&access_token=${encodeURIComponent(metaToken)}`;
        const bizRes = await fetch(bizUrl, { cache: "no-store" });
        const bizData = await bizRes.json();
        for (const biz of bizData?.data || []) {
          for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
            try {
              const wabaUrl = `https://graph.facebook.com/v19.0/${biz.id}/${edge}?fields=id,name&limit=50&access_token=${encodeURIComponent(metaToken)}`;
              const wabaRes = await fetch(wabaUrl, { cache: "no-store" });
              const wabaData = await wabaRes.json();
              for (const waba of wabaData?.data || []) {
                await cargarNumerosDeWaba(waba.id, waba.name || biz.name, edge);
              }
            } catch {}
          }
        }
      } catch (e: any) {
        debugSteps.push(`biz error: ${e.message}`);
      }
    }

    // 3) Si la API de Meta no respondió o la red falló, incorporamos los números predeterminados vinculados
    if (defaultNumbers && defaultNumbers.length > 0) {
      for (const dn of defaultNumbers) {
        const cleanE164 = dn.numero_e164 || dn.display_phone_number.replace(/[^\d]/g, "");
        if (!numbers.find((n) => n.numero_e164 === cleanE164)) {
          numbers.push(normalizar(dn, dn.waba_id, dn.verified_name));
        }
      }
    }

    // Ordenar por número
    numbers.sort((a, b) => a.numero_e164.localeCompare(b.numero_e164));

    return NextResponse.json({
      ok: true,
      numbers,
      total: numbers.length,
      debug: debugSteps,
      note: "Solo WhatsApp - Vinculados a Fanpage / WABA",
    });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      numbers: [],
      error: error.message || "Error interno",
    });
  }
}
