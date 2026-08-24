/**
 * Envío de notas de voz DIRECTO a la WhatsApp Cloud API de Meta con `voice: true`,
 * que es lo que hace que WhatsApp las muestre como burbujas de nota de voz nativa
 * (micrófono + onda) en vez de como archivos de audio reproducibles.
 *
 * ¿Por qué directo? Chatwoot sólo reenvía el flag `voice` desde la v4.15.0
 * (junio 2026). Con versiones anteriores el adjunto siempre sale como "audio
 * simple" aunque se mande `is_voice_message=true`. Para no depender de la
 * versión instalada, le pedimos a Chatwoot las credenciales del canal (la API
 * de inboxes las expone a usuarios administradores) y hablamos con Meta nosotros
 * mismos:
 *
 *   1. GET  /api/v1/accounts/1/conversations/:id   → inbox_id + teléfono real
 *   2. GET  /api/v1/accounts/1/inboxes/:inbox_id   → provider_config (token,
 *      phone_number_id del canal WhatsApp Cloud)
 *   3. POST graph.facebook.com/:version/:phone_id/media   (multipart, OGG/Opus)
 *   4. POST graph.facebook.com/:version/:phone_id/messages (audio + voice:true)
 *
 * Ante cualquier tropiezo devuelve { ok: false, reason } y el caller debe
 * reintentar por el camino tradicional (adjunto de Chatwoot).
 */

// v24.0 es la misma versión que usa Chatwoot para adjuntos y soporta `voice`.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v24.0";
const GRAPH_BASE = (process.env.META_GRAPH_BASE || "https://graph.facebook.com").replace(/\/$/, "");

export type MetaVoiceResult = { ok: true; messageId: string | null } | { ok: false; reason: string };

const fetchWithTimeout = async (url: string, init: RequestInit = {}, ms = 12000) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(ms) });

export async function sendVoiceNoteViaMeta(opts: {
  chatwootUrl: string;
  chatwootToken: string;
  chatwootConversationId: string | number;
  fallbackToDigits: string;
  ogg: Buffer;
}): Promise<MetaVoiceResult> {
  try {
    const headers = { api_access_token: opts.chatwootToken };

    // 1. Conversación → inbox y teléfono real del contacto (wa_id).
    let inboxId: number | null = null;
    let toDigits = opts.fallbackToDigits;
    try {
      const convRes = await fetchWithTimeout(
        `${opts.chatwootUrl}/api/v1/accounts/1/conversations/${opts.chatwootConversationId}`,
        { headers },
      );
      if (!convRes.ok) return { ok: false, reason: `Chatwoot no devolvió la conversación (${convRes.status})` };
      const conv = await convRes.json().catch(() => null);
      inboxId = conv?.inbox_id ?? null;
      const phone = conv?.meta?.sender?.phone_number;
      if (phone) toDigits = String(phone).replace(/\D/g, "");
    } catch (error: any) {
      return { ok: false, reason: `no se pudo consultar la conversación en Chatwoot (${error?.message || error})` };
    }
    if (!inboxId) return { ok: false, reason: "la conversación no tiene inbox asociado" };
    if (!toDigits) return { ok: false, reason: "no hay número de destino para Meta" };

    // 2. Inbox → credenciales del canal WhatsApp Cloud (sólo para administradores).
    let providerConfig: Record<string, unknown> = {};
    try {
      const inboxRes = await fetchWithTimeout(`${opts.chatwootUrl}/api/v1/accounts/1/inboxes/${inboxId}`, { headers });
      if (!inboxRes.ok) return { ok: false, reason: `Chatwoot no devolvió el inbox (${inboxRes.status})` };
      const inbox = await inboxRes.json().catch(() => null);
      if (inbox?.channel_type !== "Channel::Whatsapp" || inbox?.provider !== "whatsapp_cloud") {
        return { ok: false, reason: `canal no elegible para envío directo (${inbox?.channel_type}/${inbox?.provider})` };
      }
      providerConfig = inbox?.provider_config || {};
    } catch (error: any) {
      return { ok: false, reason: `no se pudo consultar el inbox en Chatwoot (${error?.message || error})` };
    }
    const metaToken = String(providerConfig.api_key || "");
    const phoneNumberId = String(providerConfig.phone_number_id || "");
    if (!metaToken || !phoneNumberId) {
      return { ok: false, reason: "el token de Chatwoot no es administrador o el inbox no expone provider_config" };
    }

    // 3. Subir el OGG/Opus como media de WhatsApp (devuelve un media id).
    const mediaForm = new FormData();
    mediaForm.set("messaging_product", "whatsapp");
    mediaForm.append("file", new Blob([new Uint8Array(opts.ogg)], { type: "audio/ogg" }), "nota_de_voz.ogg");
    let mediaId = "";
    try {
      const mediaRes = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/${phoneNumberId}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${metaToken}` },
        body: mediaForm,
      });
      const mediaJson = await mediaRes.json().catch(() => ({}));
      mediaId = mediaJson?.id || "";
      if (!mediaRes.ok || !mediaId) {
        return { ok: false, reason: `Meta rechazó la subida del audio (${mediaRes.status}): ${mediaJson?.error?.message || "sin detalle"}` };
      }
    } catch (error: any) {
      return { ok: false, reason: `fallo subiendo el audio a Meta (${error?.message || error})` };
    }

    // 4. Enviar como nota de voz nativa (voice: true).
    try {
      const sendRes = await fetchWithTimeout(`${GRAPH_BASE}/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${metaToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: toDigits,
          type: "audio",
          audio: { id: mediaId, voice: true },
        }),
      });
      const sendJson = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok || sendJson?.error) {
        return { ok: false, reason: `Meta rechazó el envío (${sendRes.status}): ${sendJson?.error?.message || "sin detalle"}` };
      }
      return { ok: true, messageId: sendJson?.messages?.[0]?.id || null };
    } catch (error: any) {
      return { ok: false, reason: `fallo enviando por Meta (${error?.message || error})` };
    }
  } catch (error: any) {
    return { ok: false, reason: error?.message || "error inesperado hablando con Meta" };
  }
}
