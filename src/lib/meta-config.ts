import { supabaseAdmin } from "./supabase-admin";

/**
 * Versión vigente de la API de Meta (Graph + Marketing).
 * v19.0 venció en 2026: TODAS las llamadas deben usar esta constante.
 * v25.0 es la versión actual recomendada por Meta (feb 2026).
 */
export const META_API_VERSION = "v25.0";

export function metaGraph(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://graph.facebook.com/${META_API_VERSION}${p}`;
}

export interface MetaWhatsappNumber {
  id: string;
  display_phone_number: string;
  display_number: string;
  numero_e164: string;
  verified_name?: string;
  waba_id?: string;
}

export interface MetaConfig {
  metaToken: string;
  adAccountId: string;
  pageId: string;
  wabaIds: string[];
  whatsappNumbers: MetaWhatsappNumber[];
}

const DEFAULTS: {
  metaToken: string;
  adAccountId: string;
  pageId: string;
  wabaIds: string[];
  whatsappNumbers: MetaWhatsappNumber[];
} = {
  metaToken: "EAAUNXpkS4e8BSbdXgT01jv505BfBzmFJCduWrUkxyafFfEIRDxq2fpckH0bivA9lWbClnzEBBsQBzZBIMrjEcArLlcGt2K0qQADwnLDBGlxz6GKCnqZAvZAEZAVKTfkfbQWSa4fqc5QzV8wft3adcFOhPXWvSy8pu6JXkMl4Vts4E1guH8rfKojjrZBkFTRZCsJgZDZD",
  adAccountId: "1393659139005209",
  pageId: "100205769623195",
  wabaIds: ["1267624563101579", "949112481608736"],
  whatsappNumbers: [
    {
      id: "1267624563101579",
      display_phone_number: "+57 316 1213199",
      display_number: "+57 316 1213199",
      numero_e164: "573161213199",
      verified_name: "Templo Místico (+57 316 1213199)",
      waba_id: "1267624563101579",
    },
    {
      id: "949112481608736",
      display_phone_number: "+57 310 3230843",
      display_number: "+57 310 3230843",
      numero_e164: "573103230843",
      verified_name: "Templo Místico (+57 310 3230843)",
      waba_id: "949112481608736",
    },
  ],
};

function cleanStr(v: any) {
  return String(v || "")
    .replace(/[\r\n\t "']/g, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

/**
 * Obtiene credenciales y configuración de Meta combinando:
 * 1. Variables de entorno (process.env)
 * 2. Tabla config_general en Supabase (si el usuario las editó en Ajustes)
 * 3. Valores por defecto del Templo Místico (token, ad account, page, wabas)
 */
export async function getMetaConfig(): Promise<MetaConfig> {
  let envToken = cleanStr(process.env.META_MARKETING_TOKEN);
  let envAdAccount = cleanStr(process.env.META_AD_ACCOUNT_ID).replace(/^act_/, "");
  let envPageId = cleanStr(process.env.META_PAGE_ID);
  let envWabaId = cleanStr(process.env.META_WABA_ID);
  let envNumbers = (process.env.META_WHATSAPP_NUMBERS || "").trim();

  let dbToken = "";
  let dbAdAccount = "";
  let dbPageId = "";
  let dbWabaId = "";
  let dbNumbers = "";

  try {
    const { data } = await supabaseAdmin
      .from("config_general")
      .select("clave, valor")
      .in("clave", [
        "meta_marketing_token",
        "meta_ad_account_id",
        "meta_page_id",
        "meta_waba_id",
        "meta_whatsapp_numbers",
      ]);

    (data || []).forEach((row: any) => {
      if (row.clave === "meta_marketing_token") dbToken = cleanStr(row.valor);
      if (row.clave === "meta_ad_account_id") dbAdAccount = cleanStr(row.valor).replace(/^act_/, "");
      if (row.clave === "meta_page_id") dbPageId = cleanStr(row.valor);
      if (row.clave === "meta_waba_id") dbWabaId = cleanStr(row.valor);
      if (row.clave === "meta_whatsapp_numbers") dbNumbers = String(row.valor || "").trim();
    });
  } catch (e: any) {
    // Si falla supabaseAdmin, continuamos con env o defaults
  }

  const metaToken = envToken || dbToken || DEFAULTS.metaToken;
  const adAccountId = envAdAccount || dbAdAccount || DEFAULTS.adAccountId;
  const pageId = envPageId || dbPageId || DEFAULTS.pageId;

  const wabaRaw = envWabaId || dbWabaId;
  const wabaIds = wabaRaw
    ? wabaRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULTS.wabaIds;

  let whatsappNumbers: MetaWhatsappNumber[] = [...DEFAULTS.whatsappNumbers];
  const numbersRaw = envNumbers || dbNumbers;
  if (numbersRaw) {
    try {
      const parsed = JSON.parse(numbersRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        whatsappNumbers = parsed.map((n: any, idx: number) => ({
          id: String(n.id || `custom_${idx}`),
          display_phone_number: String(n.display_phone_number || n.number || n.display_number || ""),
          display_number: String(n.display_number || n.display_phone_number || n.number || ""),
          numero_e164: String(n.numero_e164 || n.display_phone_number || n.number || "").replace(/[^\d]/g, ""),
          verified_name: n.verified_name || "WhatsApp Business",
          waba_id: n.waba_id,
        }));
      }
    } catch {
      // Formato CSV simple: "+57 316 1213199, +57 310 3230843"
      const parts = numbersRaw.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        whatsappNumbers = parts.map((num, idx) => ({
          id: `custom_${idx}`,
          display_phone_number: num,
          display_number: num,
          numero_e164: num.replace(/[^\d]/g, ""),
          verified_name: `WhatsApp (${num})`,
          waba_id: undefined,
        }));
      }
    }
  }

  return {
    metaToken,
    adAccountId,
    pageId,
    wabaIds,
    whatsappNumbers,
  };
}
