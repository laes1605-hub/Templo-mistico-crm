import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { conversacionId, numeroWhatsApp, texto, fileBase64, fileMime, fileName } = body;

    if (!numeroWhatsApp || (!texto && !fileBase64)) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const evoUrl = process.env.EVOLUTION_API_URL || "https://evo.crmesteban.duckdns.org";
    const evoKey = process.env.EVOLUTION_API_KEY || "25bbc50b8bfeb365633899951d2b9a6c4110f94e08535133d0953da151b4a1d3";
    const cleanNumber = String(numeroWhatsApp).replace(/[^\d]/g, "");

    const pureBase64 = fileBase64
      ? (String(fileBase64).includes(",") ? String(fileBase64).split(",")[1] : String(fileBase64))
      : null;

    let tipoGuardado = "texto";
    let endpoint = "";
    let payload: any = {};

    // ========== AUDIO = NOTA DE VOZ (PTT) ==========
    if (fileBase64 && (fileMime?.startsWith("audio/") || fileName?.includes("nota_de_voz") || fileName?.endsWith(".webm") || fileName?.endsWith(".ogg") || fileName?.endsWith(".mp3"))) {
      tipoGuardado = "audio";
      endpoint = `${evoUrl}/message/sendWhatsAppAudio/personal`;
      payload = {
        number: cleanNumber,
        audio: pureBase64,
        // encoding opcional según versión Evolution
        // encoding: "base64",
      };
    }
    // ========== IMAGEN / VIDEO / DOCUMENTO ==========
    else if (fileBase64) {
      endpoint = `${evoUrl}/message/sendMedia/personal`;

      let mediatype = "document";
      if (fileMime?.startsWith("image/")) {
        mediatype = "image";
        tipoGuardado = "imagen";
      } else if (fileMime?.startsWith("video/")) {
        mediatype = "video";
        tipoGuardado = "video";
      } else {
        tipoGuardado = "archivo";
      }

      payload = {
        number: cleanNumber,
        mediatype,
        mimetype: fileMime || "application/octet-stream",
        fileName: fileName || "archivo",
        caption: texto || "",
        media: pureBase64,
      };
    }
    // ========== TEXTO ==========
    else {
      endpoint = `${evoUrl}/message/sendText/personal`;
      payload = {
        number: cleanNumber,
        text: texto || "",
      };
      tipoGuardado = "texto";
    }

    const evoRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evoKey,
      },
      body: JSON.stringify(payload),
    });

    if (!evoRes.ok) {
      const errText = await evoRes.text();
      console.error("Error Evolution API:", errText);
      // fallback: si sendWhatsAppAudio falla, intentar sendMedia audio
      if (tipoGuardado === "audio" && pureBase64) {
        const fallbackRes = await fetch(`${evoUrl}/message/sendMedia/personal`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: evoKey,
          },
          body: JSON.stringify({
            number: cleanNumber,
            mediatype: "audio",
            mimetype: fileMime || "audio/ogg; codecs=opus",
            fileName: fileName || "audio.ogg",
            media: pureBase64,
          }),
        });
        if (!fallbackRes.ok) {
          const t2 = await fallbackRes.text();
          console.error("Fallback audio error:", t2);
        }
      }
    }

    // Guardar en Supabase (1 sola vez desde CRM)
    if (conversacionId) {
      const contenidoFinal = texto || (fileBase64 ? `[${tipoGuardado}]` : "");

      await supabase.from("mensajes").insert([
        {
          conversacion_id: conversacionId,
          tipo: "enviado",
          contenido: contenidoFinal,
          tipo_contenido: tipoGuardado,
          url_archivo: fileBase64 || null,
          creado_en: new Date().toISOString(),
        },
      ]);

      await supabase
        .from("conversaciones")
        .update({
          ultimo_mensaje: contenidoFinal,
          ultimo_mensaje_en: new Date().toISOString(),
        })
        .eq("id", conversacionId);
    }

    return NextResponse.json({ success: true, tipo: tipoGuardado });
  } catch (error: any) {
    console.error("Error en send-message:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}