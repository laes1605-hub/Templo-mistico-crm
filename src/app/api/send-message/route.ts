import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function POST(req: Request) {
  try {
    const { conversacionId, clienteId, numeroWhatsApp, texto } = await req.json();

    if (!numeroWhatsApp || !texto) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const evoUrl = process.env.EVOLUTION_API_URL || "https://evo.crmesteban.duckdns.org";
    const evoKey = process.env.EVOLUTION_API_KEY || "25bbc50b8bfeb365633899951d2b9a6c4110f94e08535133d0953da151b4a1d3";

    // 1. Enviar mensaje por Evolution API
    const cleanNumber = numeroWhatsApp.replace(/[^\d]/g, "");
    const evoRes = await fetch(`${evoUrl}/message/sendText/personal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evoKey,
      },
      body: JSON.stringify({
        number: cleanNumber,
        text: texto,
      }),
    });

    if (!evoRes.ok) {
      const errText = await evoRes.text();
      console.error("Error Evolution API:", errText);
    }

    // 2. Guardar el mensaje saliente en Supabase
    if (conversacionId) {
      await supabase.from("mensajes").insert([
        {
          conversacion_id: conversacionId,
          tipo: "enviado",
          contenido: texto,
          tipo_contenido: "texto",
          creado_en: new Date().toISOString(),
        },
      ]);

      await supabase
        .from("conversaciones")
        .update({
          ultimo_mensaje: texto,
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