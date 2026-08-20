import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { conversacionId, clienteId, numeroWhatsApp, texto, fileBase64, fileMime, fileName } = body;

    if (!numeroWhatsApp || (!texto && !fileBase64)) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const evoUrl = process.env.EVOLUTION_API_URL || "https://evo.crmesteban.duckdns.org";
    const evoKey = process.env.EVOLUTION_API_KEY || "25bbc50b8bfeb365633899951d2b9a6c4110f94e08535133d0953da151b4a1d3";
    const cleanNumber = numeroWhatsApp.replace(/[^\d]/g, "");

    let endpoint = `${evoUrl}/message/sendText/personal`;
    let payload: any = {
      number: cleanNumber,
      text: texto || "",
    };

    let tipoGuardado = "texto";

    if (fileBase64) {
      endpoint = `${evoUrl}/message/sendMedia/personal`;
      
      let mediatype = "document";
      if (fileMime?.startsWith("image/")) { mediatype = "image"; tipoGuardado = "imagen"; }
      else if (fileMime?.startsWith("video/")) { mediatype = "video"; tipoGuardado = "video"; }
      else if (fileMime?.startsWith("audio/")) { mediatype = "audio"; tipoGuardado = "audio"; }
      else { tipoGuardado = "archivo"; }

      const pureBase64 = fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64;

      payload = {
        number: cleanNumber,
        mediatype: mediatype,
        mimetype: fileMime || "application/octet-stream",
        fileName: fileName || "archivo",
        caption: texto || "",
        media: pureBase64,
      };
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
    }

    if (conversacionId) {
      await supabase.from("mensajes").insert([
        {
          conversacion_id: conversacionId,
          tipo: "enviado",
          contenido: texto || (fileBase64 ? `[Adjunto: ${fileName || tipoGuardado}]` : ""),
          tipo_contenido: tipoGuardado,
          url_archivo: fileBase64 ? fileBase64 : null,
          creado_en: new Date().toISOString(),
        },
      ]);

      await supabase
        .from("conversaciones")
        .update({
          ultimo_mensaje: texto || (fileBase64 ? `[${tipoGuardado} enviado]` : ""),
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