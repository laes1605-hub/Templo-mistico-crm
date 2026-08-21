import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { campaigns } = await req.json();

    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return NextResponse.json({ error: "No hay campañas para analizar" }, { status: 400 });
    }

    const openaiKey = (process.env.OPENAI_API_KEY || "").replace(/[\r\n\t "']/g, "").trim();

    if (!openaiKey) {
      return NextResponse.json({ error: "Falta OPENAI_API_KEY en Vercel" }, { status: 400 });
    }

    const prompt = `Eres un experto estratega de Meta Ads (Facebook e Instagram Ads) especializado en servicios esotéricos y consultas espirituales en Colombia y Latinoamérica.

Analiza los siguientes datos de rendimiento de campañas actuales:

${JSON.stringify(campaigns, null, 2)}

NOTA IMPORTANTE SOBRE MONEDA: Todos los valores monetarios de inversión, presupuesto y CPL están expresados en PESOS COLOMBIANOS (COP). Expresa todas tus cifras y presupuestos siempre en COP (ejemplo: $10.000 COP, $50.000 COP).

Entrega una auditoría ejecutiva breve y contundente en español para el director del negocio, organizada estrictamente en estas 3 secciones:

🏆 1. CAMPAÑA ESTRELLA (Mina de oro):
Identifica cuál es la mejor campaña basada en el CPL (Costo Por Lead en COP) más bajo y alto número de conversiones. Explica por qué es eficiente y sugiere cuánto aumentar su presupuesto diario en COP.

⚠️ 2. CAMPAÑA DEFICIENTE (Botadero de dinero):
Identifica si hay alguna campaña activa o pausada con CPL demasiado alto en COP. Recomienda explícitamente si se debe PAUSAR o descartar de inmediato.

💡 3. CONSEJOS PRÁCTICOS DE MEJORA:
Entrega 2 a 3 recomendaciones tácticas sobre copys, creativos o segmentación para mejorar los anuncios del Templo Místico.

Usa un tono profesional, directo, con emojis y sin rodeos.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 650,
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text();
      return NextResponse.json({ error: `Error OpenAI ${res.status}: ${errTxt}` }, { status: 500 });
    }

    const data = await res.json();
    const recommendation = data.choices?.[0]?.message?.content || "No se pudo generar la recomendación.";

    return NextResponse.json({ ok: true, recommendation });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}