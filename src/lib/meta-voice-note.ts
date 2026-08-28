/**
 * Envío de notas de voz DIRECTO a la WhatsApp Cloud API de Meta con `voice: true`,
 * que es lo que hace que WhatsApp las muestre como burbujas de nota de voz nativa
 * (micrófono + onda) en vez de como archivos de audio reproducibles.
 *
 * ¿Por qué directo? Chatwoot sólo reenvía el flag `voice` desde la v4.15.0
 * (junio 2026). Con versiones anteriores el adjunto siempre sale como "audio
 * simple" aunque se mande `is_voice_message=true`. Para no depender de la
 * versión instalada, hablamos con Meta nosotros mismos:
 *
 *   1. GET  /api/v1/accounts/1/conversations/:id   → teléfono real (wa_id)
 *      (opcional: si falla, se usa el número que ya tiene el CRM)
 *   2. Credenciales del canal WhatsApp Cloud, en este orden:
 *        a. env META_VOICE_API_TOKEN / META_VOICE_PHONE_NUMBER_ID
 *        b. config_general (clave meta_voice_token / meta_voice_phone_number_id,
 *           editable desde Ajustes de la app)
 *        c. provider_config del inbox de Chatwoot (requiere token admin)
 *   3. POST graph.facebook.com/:version/:phone_id/media   (multipart, OGG/Opus)
 *   4. POST graph.facebook.com/:version/:phone_id/messages (audio + voice:true)
 *
 * Ante cualquier tropiezo devuelve { ok: false, reason } y el caller debe
 * reintentar por el camino tradicional (adjunto de Chatwoot). El reason se
 * muestra en la app para que el fallo no quede oculto en los logs del servidor.
 */

import { supabaseAdmin } from "./supabase-admin";

// v24.0 es la misma versión que usa Chatwoot para adjuntos y soporta `voice`.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v24.0";
const GRAPH_BASE = (process.env.META_GRAPH_BASE || "https://graph.facebook.com").replace(/\/$/, "");

export type MetaVoiceResult = { ok: true; messageId: string | null } | { ok: false; reason: string };
export type MetaVoiceCreds = { token: string; phoneNumberId: string };

const fetchWithTimeout = async (url: string, init: RequestInit = {}, ms = 12000) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(ms) });

const shortReason = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * Credenciales del canal WhatsApp Cloud para el envío directo.
 * Orden: variables de entorno → config_general (Ajustes de la app) → null
 * (el caller decide si sigue preguntando al inbox de Chatwoot).
 */
export async function obtenerCredencialesMeta(): Promise<MetaVoiceCreds | null> {
  const envToken = (process.env.META_VOICE_API_TOKEN || "").trim();
  const envPhoneId = (process.env.META_VOICE_PHONE_NUMBER_ID || "").trim();
  let cfgToken = "";
  let cfgPhoneId = "";
  if (!envToken || !envPhoneId) {
    try {
      const { data } = await supabaseAdmin
        .from("config_general")
        .select("clave, valor")
        .in("clave", ["meta_voice_token", "meta_voice_phone_number_id"]);
      (data || []).forEach((row: any) => {
        if (row.clave === "meta_voice_token") cfgToken = String(row.valor || "").trim();
        if (row.clave === "meta_voice_phone_number_id") cfgPhoneId = String(row.valor || "").trim();
      });
    } catch (e: any) {
      console.warn("[meta-voice-note] No se pudo leer config_general:", e?.message || e);
    }
  }
  const token = envToken || cfgToken;
  const phoneId = envPhoneId || cfgPhoneId;
  if (token && phoneId) return { token, phoneNumberId: phoneId };
  return null;
}

/**
 * POST con un reintento cuando Meta responde con 5xx (transitorio).
 * `buildInit` genera un RequestInit NUEVO por intento: un FormData consumido
 * no puede reenviarse. Errores de red (timeout, DNS) se dejan propagar.
 */
async function postWithRetry(
  url: string,
  buildInit: RequestInit | (() => RequestInit),
  ms = 15000,
): Promise<{ res: Response; json: any }> {
  const resolve = () => (typeof buildInit === "function" ? buildInit() : buildInit);
  let res: Response | null = null;
  let json: any = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetchWithTimeout(url, resolve(), ms);
    json = await res.json().catch(() => ({}));
    if (res.ok || res.status < 500) break;
  }
  return { res: res as Response, json };
}

export async function sendVoiceNoteViaMeta(opts: {
  chatwootUrl: string;
  chatwootToken: string;
  chatwootConversationId: string | number;
  fallbackToDigits: string;
  ogg: Buffer;
  /** Credenciales ya resueltas (env/config). Si no se pasan, se consulta el inbox de Chatwoot. */
  metaCreds?: MetaVoiceCreds | null;
}): Promise<MetaVoiceResult> {
  try {
    const headers = { api_access_token: opts.chatwootToken };

    // 1. Teléfono de destino: el de la conversación de Chatwoot si existe
    //    (es el que conoce WhatsApp); si no se pudo consultar, el del CRM.
    //    Un chatwoot_conversation_id obsoleto NO debe matar la nota de voz
    //    nativa: con credenciales directas Meta no necesita la conversación.
    let inboxId: number | null = null;
    let toDigits = String(opts.fallbackToDigits || "").replace(/\D/g, "");
    let convDetalle = "";
    try {
      const convRes = await fetchWithTimeout(
        `${opts.chatwootUrl}/api/v1/accounts/1/conversations/${opts.chatwootConversationId}`,
        { headers },
      );
      if (!convRes.ok) {
        convDetalle = `la conversación ${opts.chatwootConversationId} no está en Chatwoot (${convRes.status})`;
      } else {
        const conv = await convRes.json().catch(() => null);
        inboxId = conv?.inbox_id ?? null;
        const phone = conv?.meta?.sender?.phone_number;
        if (phone) {
          const digits = String(phone).replace(/\D/g, "");
          if (digits) toDigits = digits;
        }
      }
    } catch (error: any) {
      convDetalle = `no se pudo consultar la conversación en Chatwoot (${error?.message || error})`;
    }
    if (!toDigits) return { ok: false, reason: "no hay número de destino para Meta" };

    // 2. Credenciales del canal WhatsApp Cloud.
    let metaToken = "";
    let phoneNumberId = "";
    if (opts.metaCreds?.token && opts.metaCreds?.phoneNumberId) {
      metaToken = opts.metaCreds.token;
      phoneNumberId = opts.metaCreds.phoneNumberId;
    } else {
      // 2b. Inbox → provider_config (sólo lo expone Chatwoot a administradores).
      try {
        if (!inboxId) {
          return {
            ok: false,
            reason: convDetalle
              ? `sin credenciales Meta directas y ${convDetalle}`
              : "la conversación no tiene inbox asociado",
          };
        }
        const inboxRes = await fetchWithTimeout(`${opts.chatwootUrl}/api/v1/accounts/1/inboxes/${inboxId}`, { headers });
        if (!inboxRes.ok) {
          return {
            ok: false,
            reason: `Chatwoot no devolvió el inbox (${inboxRes.status}) — el token no es administrador; define META_VOICE_API_TOKEN + META_VOICE_PHONE_NUMBER_ID o guárdalos en Ajustes → Notas de voz`,
          };
        }
        const inbox = await inboxRes.json().catch(() => null);
        if (inbox?.channel_type !== "Channel::Whatsapp" || inbox?.provider !== "whatsapp_cloud") {
          return { ok: false, reason: `canal no elegible para envío directo (${inbox?.channel_type}/${inbox?.provider})` };
        }
        const providerConfig = inbox?.provider_config || {};
        metaToken = String(providerConfig.api_key || "");
        phoneNumberId = String(providerConfig.phone_number_id || "");
        if (!metaToken || !phoneNumberId) {
          return { ok: false, reason: "el inbox no expone provider_config (token sin rol administrador); define las credenciales en Ajustes → Notas de voz" };
        }
      } catch (error: any) {
        return { ok: false, reason: `no se pudo consultar el inbox en Chatwoot (${error?.message || error})` };
      }
    }

    // 3. Subir el OGG/Opus como media de WhatsApp (devuelve un media id).
    //    Se construye el FormData por intento: un FormData consumido no se reutiliza.
    const buildMediaForm = () => {
      const form = new FormData();
      form.set("messaging_product", "whatsapp");
      form.append("file", new Blob([new Uint8Array(opts.ogg)], { type: "audio/ogg" }), "nota_de_voz.ogg");
      return form;
    };
    let mediaId = "";
    try {
      const { res: mediaRes, json: mediaJson } = await postWithRetry(
        `${GRAPH_BASE}/${GRAPH_VERSION}/${phoneNumberId}/media`,
        () => ({
          method: "POST",
          headers: { Authorization: `Bearer ${metaToken}` },
          body: buildMediaForm(),
        }),
      );
      mediaId = mediaJson?.id || "";
      if (!mediaRes.ok || !mediaId) {
        return { ok: false, reason: `Meta rechazó la subida del audio (${mediaRes.status}): ${shortReason(String(mediaJson?.error?.message || "sin detalle"))}` };
      }
    } catch (error: any) {
      return { ok: false, reason: `fallo subiendo el audio a Meta (${error?.message || error})` };
    }

    // 4. Enviar como nota de voz nativa (voice: true).
    try {
      const body = JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toDigits,
        type: "audio",
        audio: { id: mediaId, voice: true },
      });
      const { res: sendRes, json: sendJson } = await postWithRetry(
        `${GRAPH_BASE}/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${metaToken}`, "Content-Type": "application/json" },
          body,
        },
      );
      if (!sendRes.ok || sendJson?.error) {
        return { ok: false, reason: `Meta rechazó el envío (${sendRes.status}): ${shortReason(String(sendJson?.error?.message || "sin detalle"))}` };
      }
      return { ok: true, messageId: sendJson?.messages?.[0]?.id || null };
    } catch (error: any) {
      return { ok: false, reason: `fallo enviando por Meta (${error?.message || error})` };
    }
  } catch (error: any) {
    return { ok: false, reason: error?.message || "error inesperado hablando con Meta" };
  }
}
