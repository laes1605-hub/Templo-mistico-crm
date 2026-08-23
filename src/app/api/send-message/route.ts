import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { remuxWebmToOgg } from "../../../lib/webm-to-ogg";

const cleanBase64 = (value: unknown) => {
  if (!value) return null;
  const encoded = String(value);
  return encoded.includes(",") ? encoded.slice(encoded.indexOf(",") + 1) : encoded;
};

// Preroll mínimo: sólo el necesario para que WhatsApp no recorte la primera
// sílaba. Más que esto se escucha como silencio muerto al inicio de la nota.
const WEBM_OGG_PREROLL_MS = 300;

const safeFileName = (name: unknown, mime: string) => {
  const fallbackExtension = mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "m4a" : "webm";
  const cleaned = String(name || `audio.${fallbackExtension}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || `archivo.${fallbackExtension}`;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { conversacionId, numeroWhatsApp, texto, fileBase64, fileMime, fileName } = body;

    if (!numeroWhatsApp || (!texto?.trim() && !fileBase64)) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const evoUrl = (process.env.EVOLUTION_API_URL || "https://evo.crmesteban.duckdns.org").replace(/\/$/, "");
    const evoKey = process.env.EVOLUTION_API_KEY || "";
    const chatwootToken = process.env.CHATWOOT_API_TOKEN || "";
    const chatwootUrl = (process.env.CHATWOOT_URL || "https://crmesteban.duckdns.org").replace(/\/$/, "");
    const cleanNumber = String(numeroWhatsApp).replace(/[^\d]/g, "");
    const pureBase64 = cleanBase64(fileBase64);
    const mime = String(fileMime || "application/octet-stream").split(";")[0];
    const isAudio = Boolean(pureBase64 && (mime.startsWith("audio/") || String(fileName || "").includes("nota_de_voz")));

    let fuente = "meta_business";
    let chatwootConvId: string | number | null = null;
    if (conversacionId) {
      const { data: convData, error: conversationError } = await supabase
        .from("conversaciones")
        .select("fuente, chatwoot_conversation_id")
        .eq("id", conversacionId)
        .single();

      if (conversationError) {
        return NextResponse.json({ error: "No se pudo identificar la conversación." }, { status: 404 });
      }
      fuente = convData?.fuente || "meta_business";
      chatwootConvId = convData?.chatwoot_conversation_id || null;
    }

    let tipoGuardado = isAudio ? "audio" : "texto";

    // Meta Cloud API is connected through Chatwoot. A text-only payload drops the
    // attachment, so files must be sent as multipart/form-data using attachments[].
    if (fuente === "meta_business" && chatwootConvId) {
      if (!chatwootToken) {
        return NextResponse.json({ error: "Falta CHATWOOT_API_TOKEN para enviar por WhatsApp Business." }, { status: 500 });
      }

      const endpoint = `${chatwootUrl}/api/v1/accounts/1/conversations/${chatwootConvId}/messages`;
      let response: Response;
      if (pureBase64) {
        let bytes: Buffer;
        try {
          bytes = Buffer.from(pureBase64, "base64");
        } catch {
          return NextResponse.json({ error: "El archivo de audio no tiene un formato válido." }, { status: 400 });
        }
        if (!bytes.length) return NextResponse.json({ error: "El archivo de audio está vacío." }, { status: 400 });

        let outgoingMime = mime;
        let outgoingName = safeFileName(fileName, mime);
        // WhatsApp Cloud API (Meta) rejects WebM voice notes: it only accepts
        // OGG/Opus (`audio/ogg; codecs=opus`). Browsers record Opus inside a
        // WebM container, so rewrap the packets losslessly into OGG before
        // uploading the attachment to Chatwoot.
        if (isAudio && mime.startsWith("audio/webm")) {
          try {
            bytes = remuxWebmToOgg(bytes, { prerollMs: WEBM_OGG_PREROLL_MS });
            outgoingMime = "audio/ogg; codecs=opus";
            outgoingName = /\.webm$/i.test(outgoingName) ? outgoingName.replace(/\.webm$/i, ".ogg") : `${outgoingName}.ogg`;
          } catch (conversionError: any) {
            console.error("WebM a OGG falló:", conversionError?.message || conversionError);
            return NextResponse.json({ error: `No se pudo convertir la nota de voz a OGG/Opus para WhatsApp (${conversionError?.message || "formato inválido"}).` }, { status: 500 });
          }
        }

        const form = new FormData();
        form.set("content", texto?.trim() || (isAudio ? "🎤 Nota de voz" : "Archivo enviado"));
        form.set("message_type", "outgoing");
        // Copy into a browser-compatible typed array; Buffer's ArrayBufferLike type
        // is not accepted by the Web Blob type used by Next's fetch implementation.
        form.append("attachments[]", new Blob([new Uint8Array(bytes)], { type: outgoingMime }), outgoingName);
        response = await fetch(endpoint, {
          method: "POST",
          headers: { api_access_token: chatwootToken },
          body: form,
        });
      } else {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", api_access_token: chatwootToken },
          body: JSON.stringify({ content: texto.trim(), message_type: "outgoing" }),
        });
      }

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        console.error("Chatwoot rejected outgoing message:", response.status, detail);
        return NextResponse.json({ error: `WhatsApp Business no aceptó el ${isAudio ? "audio" : "mensaje"} (${response.status}). ${detail}` }, { status: 502 });
      }
    } else {
      if (!evoKey) {
        return NextResponse.json({ error: "Falta EVOLUTION_API_KEY para enviar por WhatsApp Personal." }, { status: 500 });
      }

      let endpoint = `${evoUrl}/message/sendText/personal`;
      let payload: Record<string, unknown> = { number: cleanNumber, text: texto || "" };
      if (pureBase64 && isAudio) {
        tipoGuardado = "audio";
        endpoint = `${evoUrl}/message/sendWhatsAppAudio/personal`;
        let audioMime = mime;
        let audioBase64 = pureBase64;

        // Igual que en WhatsApp Business: si el celular grabó WebM/Opus, lo
        // reempaquetamos a OGG/Opus y le agregamos un preroll silencioso. Esto
        // evita que Evolution/WhatsApp recorten la primera palabra del audio.
        if (mime.startsWith("audio/webm")) {
          try {
            const converted = remuxWebmToOgg(Buffer.from(pureBase64, "base64"), { prerollMs: WEBM_OGG_PREROLL_MS });
            audioMime = "audio/ogg";
            audioBase64 = converted.toString("base64");
          } catch (conversionError: any) {
            console.error("WebM a OGG para Evolution falló:", conversionError?.message || conversionError);
            return NextResponse.json({ error: `No se pudo preparar la nota de voz para WhatsApp (${conversionError?.message || "formato inválido"}).` }, { status: 500 });
          }
        }

        const audioDataUri = `data:${audioMime};base64,${audioBase64}`;
        payload = { number: cleanNumber, audio: audioDataUri, encoding: true };
      } else if (pureBase64) {
        let mediatype = "document";
        if (mime.startsWith("image/")) { mediatype = "image"; tipoGuardado = "imagen"; }
        else if (mime.startsWith("video/")) { mediatype = "video"; tipoGuardado = "video"; }
        payload = { number: cleanNumber, mediatype, mimetype: mime, fileName: safeFileName(fileName, mime), caption: texto || "", media: pureBase64 };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evoKey },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        console.error("Evolution rejected outgoing message:", response.status, detail);
        return NextResponse.json({ error: `WhatsApp Personal no aceptó el ${isAudio ? "audio" : "mensaje"} (${response.status}). ${detail}` }, { status: 502 });
      }
    }

    if (conversacionId) {
      const contenidoFinal = texto?.trim() || (pureBase64 ? `[${tipoGuardado}]` : "");
      const { error: messageError } = await supabase.from("mensajes").insert([{ conversacion_id: conversacionId, tipo: "enviado", contenido: contenidoFinal, tipo_contenido: tipoGuardado, url_archivo: fileBase64 || null, creado_en: new Date().toISOString() }]);
      if (messageError) console.error("Could not save outgoing message:", messageError.message);

      await supabase.from("conversaciones").update({ ultimo_mensaje: contenidoFinal, ultimo_mensaje_en: new Date().toISOString() }).eq("id", conversacionId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en send-message:", error);
    return NextResponse.json({ error: error.message || "No se pudo enviar el mensaje." }, { status: 500 });
  }
}
