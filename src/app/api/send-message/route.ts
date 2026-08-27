import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { remuxWebmToOgg } from "../../../lib/webm-to-ogg";
import { sendVoiceNoteViaMeta } from "../../../lib/meta-voice-note";
import { sendEvolutionVoiceNote } from "../../../lib/evolution-audio";
import { buscarOCrearConversacionChatwoot } from "../../../lib/chatwoot";

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

const isWebmBuffer = (bytes: Buffer | null) =>
  Boolean(bytes && bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { conversacionId, clienteId, numeroWhatsApp, texto, fileBase64, fileMime, fileName, cuentaResponsable } = body;

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
    const isAudio = Boolean(
      pureBase64 && (
        mime.startsWith("audio/") ||
        String(fileName || "").toLowerCase().includes("nota_de_voz") ||
        String(fileName || "").toLowerCase().includes("audio")
      )
    );

    let storedFileBase64: string | null = typeof fileBase64 === "string" ? fileBase64 : null;

    let fuente = "meta_business";
    let chatwootConvId: string | number | null = null;
    let targetClienteId = clienteId || null;

    if (conversacionId) {
      const { data: convData, error: conversationError } = await supabase
        .from("conversaciones")
        .select("cliente_id, fuente, chatwoot_conversation_id")
        .eq("id", conversacionId)
        .single();

      if (conversationError) {
        return NextResponse.json({ error: "No se pudo identificar la conversación." }, { status: 404 });
      }
      fuente = convData?.fuente || "meta_business";
      chatwootConvId = convData?.chatwoot_conversation_id || null;
      if (!targetClienteId && convData?.cliente_id) {
        targetClienteId = convData.cliente_id;
      }
    }

    // Determinar la cuenta encargada según la etapa del cliente o el parámetro recibido
    let cuentaDestino: "meta_business" | "evolution" = "meta_business";
    if (cuentaResponsable === "evolution" || cuentaResponsable === "personal") {
      cuentaDestino = "evolution";
    } else if (cuentaResponsable === "meta_business" || cuentaResponsable === "templo" || cuentaResponsable === "api") {
      cuentaDestino = "meta_business";
    } else if (targetClienteId) {
      // Consultar etapa del cliente y su cuenta_responsable configurada
      try {
        const { data: cliData } = await supabase
          .from("clientes")
          .select("estado")
          .eq("id", targetClienteId)
          .single();

        if (cliData?.estado) {
          const { data: etapaData } = await supabase
            .from("pipeline_etapas")
            .select("cuenta_responsable")
            .eq("clave", cliData.estado)
            .maybeSingle();

          if (etapaData?.cuenta_responsable === "evolution") {
            cuentaDestino = "evolution";
          } else if (etapaData?.cuenta_responsable === "meta_business") {
            cuentaDestino = "meta_business";
          } else {
            // Etapas iniciales (nuevo_lead, en_consulta) van a meta_business; avanzadas a evolution
            cuentaDestino = ["nuevo_lead", "en_consulta"].includes(cliData.estado) ? "meta_business" : "evolution";
          }
        }
      } catch (e) {
        console.warn("No se pudo consultar cuenta de la etapa, usando fuente original:", e);
        cuentaDestino = fuente === "evolution" ? "evolution" : "meta_business";
      }
    } else {
      cuentaDestino = fuente === "evolution" ? "evolution" : "meta_business";
    }

    let tipoGuardado = isAudio ? "audio" : "texto";
    // Cómo terminó saliendo el audio: "meta_direct" = nota de voz nativa vía Graph API,
    // "chatwoot" = adjunto de Chatwoot (nota de voz sólo si su versión la soporta),
    // "evolution" = sendWhatsAppAudio (PTT nativo de Baileys).
    let envioAudioVia: "meta_direct" | "chatwoot" | "evolution" | null = null;
    let evolutionIsPtt = false;

    if (cuentaDestino === "meta_business") {
      if (!chatwootToken) {
        return NextResponse.json({ error: "Falta CHATWOOT_API_TOKEN para enviar por WhatsApp API." }, { status: 500 });
      }

      // Si la conversación unificada no tenía chatwoot_conversation_id, buscarlo o crearlo en Chatwoot
      if (!chatwootConvId) {
        if (targetClienteId) {
          const { data: altConv } = await supabase
            .from("conversaciones")
            .select("chatwoot_conversation_id")
            .eq("cliente_id", targetClienteId)
            .not("chatwoot_conversation_id", "is", null)
            .limit(1)
            .maybeSingle();
          if (altConv?.chatwoot_conversation_id) {
            chatwootConvId = altConv.chatwoot_conversation_id;
          }
        }

        if (!chatwootConvId) {
          chatwootConvId = await buscarOCrearConversacionChatwoot(cleanNumber, 5);
          if (chatwootConvId && conversacionId) {
            await supabase
              .from("conversaciones")
              .update({ chatwoot_conversation_id: String(chatwootConvId) })
              .eq("id", conversacionId);
          }
        }
      }

      if (!chatwootConvId) {
        return NextResponse.json({ error: "No se pudo vincular la conversación en WhatsApp API (Chatwoot)." }, { status: 502 });
      }

      const endpoint = `${chatwootUrl}/api/v1/accounts/1/conversations/${chatwootConvId}/messages`;
      let response: Response | null = null;
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

        if (isAudio && (mime.includes("webm") || isWebmBuffer(bytes))) {
          try {
            bytes = Buffer.from(remuxWebmToOgg(bytes, { prerollMs: WEBM_OGG_PREROLL_MS }));
            outgoingMime = "audio/ogg";
            outgoingName = /\.webm$/i.test(outgoingName) ? outgoingName.replace(/\.webm$/i, ".ogg") : `${outgoingName}.ogg`;
            storedFileBase64 = `data:${outgoingMime};base64,${bytes.toString("base64")}`;
          } catch (conversionError: any) {
            console.error("WebM a OGG falló:", conversionError?.message || conversionError);
            return NextResponse.json({ error: `No se pudo convertir la nota de voz a OGG/Opus para WhatsApp (${conversionError?.message || "formato inválido"}).` }, { status: 500 });
          }
        }

        if (isAudio && outgoingMime === "audio/ogg") {
          const direct = await sendVoiceNoteViaMeta({
            chatwootUrl,
            chatwootToken,
            chatwootConversationId: chatwootConvId,
            fallbackToDigits: cleanNumber,
            ogg: bytes,
          });
          if (direct.ok) {
            envioAudioVia = "meta_direct";
          } else {
            const reason = (direct as { reason?: string }).reason || "sin detalle";
            console.error("[send-message] Envío directo a Meta falló, se reintenta por Chatwoot:", reason);
          }
        }

        if (!envioAudioVia) {
          const form = new FormData();
          form.set("content", texto?.trim() || (isAudio ? "🎤 Nota de voz" : "Archivo enviado"));
          form.set("message_type", "outgoing");
          form.set("private", "false");

          if (isAudio) {
            form.set("is_voice_message", "true");
          }

          const attachmentMime = outgoingMime === "audio/ogg" ? "audio/ogg; codecs=opus" : outgoingMime;
          form.append("attachments[]", new Blob([new Uint8Array(bytes)], { type: attachmentMime }), outgoingName);

          response = await fetch(endpoint, {
            method: "POST",
            headers: { api_access_token: chatwootToken },
            body: form,
          });
        }
      } else {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", api_access_token: chatwootToken },
          body: JSON.stringify({ content: texto.trim(), message_type: "outgoing" }),
        });
      }

      if (response && !response.ok) {
        const detail = (await response.text()).slice(0, 500);
        console.error("Chatwoot rejected outgoing message:", response.status, detail);
        return NextResponse.json({ error: `WhatsApp API no aceptó el ${isAudio ? "audio" : "mensaje"} (${response.status}). ${detail}` }, { status: 502 });
      }
      if (!envioAudioVia && isAudio && pureBase64) envioAudioVia = "chatwoot";
    } else {
      // Envío por WhatsApp Personal (Evolution API)
      if (!evoKey) {
        return NextResponse.json({ error: "Falta EVOLUTION_API_KEY para enviar por WhatsApp Personal." }, { status: 500 });
      }

      if (pureBase64 && isAudio) {
        tipoGuardado = "audio";
        let audioMime = mime;
        let outgoingName = safeFileName(fileName, mime);
        let bytes: Buffer;
        try {
          bytes = Buffer.from(pureBase64, "base64");
        } catch {
          return NextResponse.json({ error: "El archivo de audio no tiene un formato válido." }, { status: 400 });
        }
        if (!bytes.length) {
          return NextResponse.json({ error: "El archivo de audio está vacío." }, { status: 400 });
        }

        if (mime.includes("webm") || isWebmBuffer(bytes)) {
          try {
            bytes = Buffer.from(remuxWebmToOgg(bytes, { prerollMs: WEBM_OGG_PREROLL_MS }));
            audioMime = "audio/ogg";
            outgoingName = /\.webm$/i.test(outgoingName) ? outgoingName.replace(/\.webm$/i, ".ogg") : `${outgoingName.replace(/\.[^.]+$/, "")}.ogg`;
            storedFileBase64 = `data:${audioMime};base64,${bytes.toString("base64")}`;
          } catch (conversionError: any) {
            console.error("WebM a OGG para Evolution falló:", conversionError?.message || conversionError);
            return NextResponse.json({ error: `No se pudo preparar la nota de voz para WhatsApp (${conversionError?.message || "formato inválido"}).` }, { status: 500 });
          }
        }

        const sent = await sendEvolutionVoiceNote({
          evoUrl,
          evoKey,
          instance: "personal",
          number: cleanNumber,
          bytes,
          mime: audioMime,
          fileName: outgoingName,
        });
        if (sent.ok === false) {
          return NextResponse.json({
            error: `WhatsApp Personal no aceptó el audio (${sent.status}). ${sent.detail}`,
          }, { status: 502 });
        }
        envioAudioVia = "evolution";
        evolutionIsPtt = sent.ptt;
        if (!sent.ptt) {
          console.warn("[send-message] Evolution aceptó el audio por sendMedia (no PTT):", sent.detail);
        }
      } else if (pureBase64) {
        let mediatype = "document";
        if (mime.startsWith("image/")) { mediatype = "image"; tipoGuardado = "imagen"; }
        else if (mime.startsWith("video/")) { mediatype = "video"; tipoGuardado = "video"; }
        const response = await fetch(`${evoUrl}/message/sendMedia/personal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: evoKey },
          body: JSON.stringify({
            number: cleanNumber,
            mediatype,
            mimetype: mime,
            fileName: safeFileName(fileName, mime),
            caption: texto || "",
            media: pureBase64,
          }),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          console.error("Evolution rejected outgoing media:", response.status, detail);
          return NextResponse.json({ error: `WhatsApp Personal no aceptó el mensaje (${response.status}). ${detail}` }, { status: 502 });
        }
      } else {
        const response = await fetch(`${evoUrl}/message/sendText/personal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: evoKey },
          body: JSON.stringify({ number: cleanNumber, text: texto || "" }),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          console.error("Evolution rejected outgoing message:", response.status, detail);
          return NextResponse.json({ error: `WhatsApp Personal no aceptó el mensaje (${response.status}). ${detail}` }, { status: 502 });
        }
      }
    }

    if (conversacionId) {
      const contenidoFinal = texto?.trim() || (pureBase64 ? `[${tipoGuardado}]` : "");
      const { error: messageError } = await supabase.from("mensajes").insert([
        {
          conversacion_id: conversacionId,
          tipo: "enviado",
          contenido: contenidoFinal,
          tipo_contenido: tipoGuardado,
          url_archivo: storedFileBase64,
          creado_en: new Date().toISOString()
        }
      ]);
      if (messageError) console.error("Could not save outgoing message:", messageError.message);

      await supabase.from("conversaciones").update({
        ultimo_mensaje: contenidoFinal === "[audio]" ? "🎤 Nota de voz" : contenidoFinal,
        ultimo_mensaje_en: new Date().toISOString()
      }).eq("id", conversacionId);
    }

    // Al responder, si el cliente estaba en seguimiento, queda marcado como revisado hoy
    if (targetClienteId) {
      try {
        await supabase
          .from("clientes")
          .update({ seguimiento_revisado_en: new Date().toISOString() })
          .eq("id", targetClienteId);
      } catch (e) {
        console.warn("No se pudo actualizar seguimiento_revisado_en:", e);
      }
    }

    // `voiceNote` = sabemos con certeza que salió como nota de voz nativa
    // (envío directo a Meta o PTT de Evolution). Con el fallback de Chatwoot no
    // podemos saberlo: depende de la versión instalada (>= 4.15.0).
    const voiceNote = envioAudioVia === "meta_direct" || (envioAudioVia === "evolution" && evolutionIsPtt);

    return NextResponse.json({ success: true, voiceNote, via: envioAudioVia, cuenta: cuentaDestino });
  } catch (error: any) {
    console.error("Error en send-message:", error);
    return NextResponse.json({ error: error.message || "No se pudo enviar el mensaje." }, { status: 500 });
  }
}
