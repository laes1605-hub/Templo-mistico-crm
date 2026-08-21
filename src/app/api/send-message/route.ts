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
    const evoKey = process.env.EVOLUTION_API_KEY || "";
    const chatwootToken = process.env.CHATWOOT_API_TOKEN || "";
    const chatwootUrl = process.env.CHATWOOT_URL || "https://crmesteban.duckdns.org";

    const cleanNumber = String(numeroWhatsApp).replace(/[^\d]/g, "");

    let fuente = "meta_business";
    let chatwootConvId = null;

    if (conversacionId) {
      const { data: convData } = await supabase
        .from("conversaciones")
        .select("fuente, chatwoot_conversation_id")
        .eq("id", conversacionId)
        .single();

      if (convData) {
        fuente = convData.fuente || "meta_business";
        chatwootConvId = convData.chatwoot_conversation_id;
      }
    }

    let tipoGuardado = "texto";

    // Enviar a Meta Cloud API vía Chatwoot
    if (fuente === "meta_business" && chatwootConvId) {
      const cwRes = await fetch(`${chatwootUrl}/api/v1/accounts/1/conversations/${chatwootConvId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          api_access_token: chatwootToken,
        },
        body: JSON.stringify({
          content: texto || (fileBase64 ? `[Archivo enviado]` : ""),
          message_type: "outgoing",
        }),
      });

      if (!cwRes.ok) {
        console.error("Error enviando mensaje a Chatwoot API:", await cwRes.text());
      }
    } else {
      // Enviar a WhatsApp Personal vía Evolution API
      const pureBase64 = fileBase64
        ? (String(fileBase64).includes(",") ? String(fileBase64).split(",")[1] : String(fileBase64))
        : null;

      let endpoint = `${evoUrl}/message/sendText/personal`;
      let payload: any = { number: cleanNumber, text: texto || "" };

      if (fileBase64 && (fileMime?.startsWith("audio/") || fileName?.includes("nota_de_voz"))) {
        tipoGuardado = "audio";
        endpoint = `${evoUrl}/message/sendWhatsAppAudio/personal`;
        payload = { number: cleanNumber, audio: pureBase64 };
      } else if (fileBase64) {
        endpoint = `${evoUrl}/message/sendMedia/personal`;
        let mediatype = "document";
        if (fileMime?.startsWith("image/")) { mediatype = "image"; tipoGuardado = "imagen"; }
        else if (fileMime?.startsWith("video/")) { mediatype = "video"; tipoGuardado = "video"; }
        payload = {
          number: cleanNumber,
          mediatype,
          mimetype: fileMime || "application/octet-stream",
          fileName: fileName || "archivo",
          caption: texto || "",
          media: pureBase64,
        };
      }

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evoKey },
        body: JSON.stringify(payload),
      });
    }

    // Guardar en Supabase
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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error en send-message:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}