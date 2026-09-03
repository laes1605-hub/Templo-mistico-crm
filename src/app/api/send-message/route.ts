import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { remuxWebmToOgg } from "../../../lib/webm-to-ogg";
import { sendVoiceNoteViaMeta, obtenerCredencialesMeta } from "../../../lib/meta-voice-note";
import { sendEvolutionVoiceNote } from "../../../lib/evolution-audio";
import { buscarOCrearConversacionChatwoot } from "../../../lib/chatwoot";
import { esDataUri, dataUriAStorage, descargarAdjuntoDeStorage } from "../../../lib/media-storage";

const cleanBase64 = (value: unknown) => {
  if (!value) return null;
  const encoded = String(value);
  return encoded.includes(",") ? encoded.slice(encoded.indexOf(",") + 1) : encoded;
};

// Preroll mínimo: sólo el necesario para que WhatsApp no recorte la primera
// sílaba. Más que esto se escucha como silencio muerto al inicio de la nota.
const WEBM_OGG_PREROLL_MS = 300;

const safeFileName = (name: unknown, mime: string) => {
  const fallbackExtension =
    mime.includes("ogg") ? "ogg"
    : mime.includes("mpeg") || mime.includes("mp3") ? "mp3"
    : mime.includes("mp4") ? "mp4"
    : mime.includes("jpeg") || mime.includes("jpg") ? "jpg"
    : mime.includes("png") ? "png"
    : mime.includes("webp") ? "webp"
    : mime.includes("pdf") ? "pdf"
    : mime.includes("webm") ? "webm"
    : "bin";
  const cleaned = String(name || `adjunto.${fallbackExtension}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || `archivo.${fallbackExtension}`;
};

const isWebmBuffer = (bytes: Buffer | null) =>
  Boolean(bytes && bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { conversacionId, clienteId, numeroWhatsApp, texto, fileBase64, fileMime, fileName, fileUrl, cuentaResponsable } = body;

    if (!numeroWhatsApp || (!texto?.trim() && !fileBase64 && !fileUrl)) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const evoUrl = (process.env.EVOLUTION_API_URL || "https://TU-EVOLUTION.duckdns.org").replace(/\/$/, "");
    const evoKey = process.env.EVOLUTION_API_KEY || "";
    const chatwootToken = process.env.CHATWOOT_API_TOKEN || "";
    const chatwootUrl = (process.env.CHATWOOT_URL || "https://TU-CHATWOOT.duckdns.org").replace(/\/$/, "");
    const cleanNumber = String(numeroWhatsApp).replace(/[^\d]/g, "");

    // ADJUNTO DESDE STORAGE: las respuestas rápidas (y cualquier archivo que ya
    // esté en el bucket) viajan como URL. El servidor la lee dentro de la misma
    // región de Supabase y la convierte a base64 para enviarla, así el teléfono
    // no descarga el archivo para volver a subirlo en cada envío.
    let base64Recibido: string | null = typeof fileBase64 === "string" ? fileBase64 : null;
    let mimeRecibido = String(fileMime || "").trim();
    let urlAdjunto: string | null = null;
    if (!base64Recibido && typeof fileUrl === "string" && /^https?:\/\//i.test(fileUrl)) {
      const descargado = await descargarAdjuntoDeStorage(fileUrl);
      if (!descargado) {
        return NextResponse.json({ error: "No se pudo descargar el archivo desde Storage. Intenta sincronizar la respuesta rápida." }, { status: 502 });
      }
      if (!mimeRecibido) mimeRecibido = descargado.mime;
      base64Recibido = `data:${mimeRecibido || "application/octet-stream"};base64,${Buffer.from(descargado.bytes).toString("base64")}`;
      // El mensaje enviado apunta al MISMO objeto: no se duplica el archivo.
      urlAdjunto = fileUrl;
    }

    const pureBase64 = cleanBase64(base64Recibido);
    const mime = String(mimeRecibido || "application/octet-stream").split(";")[0].toLowerCase();
    const isAudio = Boolean(
      pureBase64 && (
        mime.startsWith("audio/") ||
        String(fileName || "").toLowerCase().includes("nota_de_voz") ||
        String(fileName || "").toLowerCase().includes("audio")
      )
    );

    let tipoGuardado = "texto";
    if (isAudio) {
      tipoGuardado = "audio";
    } else if (pureBase64 && (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(String(fileName || "")))) {
      tipoGuardado = "imagen";
    } else if (pureBase64 && (mime.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/i.test(String(fileName || "")))) {
      tipoGuardado = "video";
    } else if (pureBase64) {
      tipoGuardado = "archivo";
    }

    let storedFileBase64: string | null = urlAdjunto ?? base64Recibido;

    let fuente = "meta_business";
    let chatwootConvId: string | number | null = null;
    let chatwootIds: string[] = [];
    let targetClienteId = clienteId || null;

    if (conversacionId) {
      let convData: any = null;
      let conversationError: any = null;
      {
        const r = await supabase
          .from("conversaciones")
          .select("cliente_id, fuente, chatwoot_conversation_id, chatwoot_conversation_ids")
          .eq("id", conversacionId)
          .single();
        convData = r.data;
        conversationError = r.error;
      }
      if (conversationError) {
        const r2 = await supabase
          .from("conversaciones")
          .select("cliente_id, fuente, chatwoot_conversation_id")
          .eq("id", conversacionId)
          .single();
        convData = r2.data;
        conversationError = r2.error;
      }

      if (conversationError || !convData) {
        return NextResponse.json({ error: "No se pudo identificar la conversación." }, { status: 404 });
      }
      fuente = convData?.fuente || "meta_business";
      chatwootConvId = convData?.chatwoot_conversation_id || null;
      const extraIds = Array.isArray(convData?.chatwoot_conversation_ids)
        ? convData.chatwoot_conversation_ids.map((x: any) => String(x)).filter(Boolean)
        : [];
      chatwootIds = Array.from(
        new Set([...(chatwootConvId ? [String(chatwootConvId)] : []), ...extraIds])
      );
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
            const estNorm = String(cliData.estado || "").toLowerCase();
            const esNuevoLead = estNorm.includes("nuevo") && estNorm.includes("lead") || ["nuevo_lead", "lead_nuevo", "nuevo"].includes(estNorm);
            const esDatos = estNorm.includes("datos");
            cuentaDestino = (esNuevoLead || esDatos || ["nuevo_lead", "datos", "en_consulta"].includes(cliData.estado)) ? "meta_business" : "evolution";
          }
        }
      } catch (e) {
        console.warn("No se pudo consultar cuenta de la etapa, usando fuente original:", e);
        cuentaDestino = fuente === "evolution" ? "evolution" : "meta_business";
      }
    } else {
      cuentaDestino = fuente === "evolution" ? "evolution" : "meta_business";
    }

    let envioAudioVia: "meta_direct" | "chatwoot" | "evolution" | null = null;
    let evolutionIsPtt = false;
    let audioReason: string | null = null;

    if (cuentaDestino === "meta_business") {
      if (!chatwootToken) {
        return NextResponse.json({ error: "Falta CHATWOOT_API_TOKEN para enviar por WhatsApp API." }, { status: 500 });
      }

      // Preferir inbox Cloud API. Si no hay match, se conserva el id que ya tenía el chat.
      const inboxApi = 5;
      let idApi: string | number | null = null;
      if (chatwootIds.length > 1 && chatwootToken) {
        for (const id of chatwootIds) {
          try {
            const det = await fetch(`${chatwootUrl}/api/v1/accounts/1/conversations/${id}`, {
              headers: { api_access_token: chatwootToken },
            });
            if (!det.ok) continue;
            const json = await det.json();
            const inbox = json?.inbox_id ?? json?.inbox?.id;
            const nombre = String(json?.inbox?.name || "").toLowerCase();
            if (Number(inbox) === inboxApi || nombre.includes("api") || nombre.includes("cloud")) {
              idApi = id;
              break;
            }
          } catch {
            /* siguiente */
          }
        }
      }
      if (idApi) {
        chatwootConvId = idApi;
      } else if (!chatwootConvId) {
        chatwootConvId = await buscarOCrearConversacionChatwoot(cleanNumber, inboxApi);
        if (chatwootConvId && conversacionId) {
          await supabase
            .from("conversaciones")
            .update({ chatwoot_conversation_id: String(chatwootConvId) })
            .eq("id", conversacionId);
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
          return NextResponse.json({ error: "El archivo no tiene un formato válido." }, { status: 400 });
        }
        if (!bytes.length) return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });

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
            metaCreds: await obtenerCredencialesMeta(),
          });
          if (direct.ok) {
            envioAudioVia = "meta_direct";
          } else {
            const reason = (direct as { reason?: string }).reason || "sin detalle";
            audioReason = reason;
            console.error("[send-message] Envío directo a Meta falló, se reintenta por Chatwoot:", reason);
          }
        } else if (isAudio) {
          audioReason = `el archivo está en ${outgoingMime}, que WhatsApp API no acepta como nota de voz (sólo OGG/Opus)`;
        }

        if (!envioAudioVia) {
          const form = new FormData();
          const placeholderContenido =
            isAudio ? "🎤 Nota de voz"
            : tipoGuardado === "imagen" ? "📷 Imagen"
            : tipoGuardado === "video" ? "🎥 Video"
            : "Archivo adjunto";
          form.set("content", texto?.trim() || placeholderContenido);
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
          audioReason = "WhatsApp Personal aceptó el audio como archivo (sendMedia) y no como nota de voz nativa (PTT)";
          console.warn("[send-message] Evolution aceptó el audio por sendMedia (no PTT):", sent.detail);
        }
      } else if (pureBase64) {
        let mediatype = "document";
        if (tipoGuardado === "imagen") { mediatype = "image"; }
        else if (tipoGuardado === "video") { mediatype = "video"; }
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
      // AHORRO DE EGRESS: el adjunto se sube a Supabase Storage y en la tabla
      // queda solo la URL pública. Si la subida falla, se conserva el base64
      // para no perder el archivo (plan B).
      let urlArchivoFinal: string | null = storedFileBase64;
      if (esDataUri(storedFileBase64)) {
        const nombreBaseAdjunto =
          tipoGuardado === "audio" ? "nota_de_voz"
          : tipoGuardado === "imagen" ? "imagen"
          : tipoGuardado === "video" ? "video"
          : safeFileName(fileName, mime);
        urlArchivoFinal = await dataUriAStorage(storedFileBase64, nombreBaseAdjunto);
      }
      const { error: messageError } = await supabase.from("mensajes").insert([
        {
          conversacion_id: conversacionId,
          tipo: "enviado",
          contenido: contenidoFinal,
          tipo_contenido: tipoGuardado,
          url_archivo: urlArchivoFinal,
          creado_en: new Date().toISOString()
        }
      ]);
      if (messageError) console.error("Could not save outgoing message:", messageError.message);

      const resumenUltimo =
        tipoGuardado === "audio" ? "🎤 Nota de voz"
        : tipoGuardado === "imagen" ? (texto?.trim() ? `📷 ${texto.trim()}` : "📷 Imagen")
        : tipoGuardado === "video" ? (texto?.trim() ? `🎥 ${texto.trim()}` : "🎥 Video")
        : tipoGuardado === "archivo" ? (texto?.trim() || "📎 Archivo adjunto")
        : contenidoFinal;

      await supabase.from("conversaciones").update({
        ultimo_mensaje: resumenUltimo,
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

    const voiceNote = envioAudioVia === "meta_direct" || (envioAudioVia === "evolution" && evolutionIsPtt);

    return NextResponse.json({ success: true, voiceNote, via: envioAudioVia, cuenta: cuentaDestino, audioReason: voiceNote ? null : audioReason });
  } catch (error: any) {
    console.error("Error en send-message:", error);
    return NextResponse.json({ error: error.message || "No se pudo enviar el mensaje." }, { status: 500 });
  }
}
