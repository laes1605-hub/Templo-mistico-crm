import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const {
      campaigns,
      action = "audit", // "audit" | "generate_strategy" | "adjust_budget"
      topCampaigns = [],
      failedCampaigns = [],
      targetCampaign,
      newBudget,
      newDays
    } = await req.json();

    const openaiKey = (process.env.OPENAI_API_KEY || "").replace(/[\r\n\t "']/g, "").trim();

    if (!openaiKey) {
      return NextResponse.json({ error: "Falta OPENAI_API_KEY en Vercel" }, { status: 400 });
    }

    // 1. MODO: AJUSTE / ESCALADO DE PRESUPUESTO BAJO INSTRUCCIÓN
    if (action === "adjust_budget") {
      const promptAjuste = `Eres el Agente Estratega de Meta Ads para Templo Místico (esoterismo, consultas espirituales y amarres en Colombia).
El usuario quiere reajustar una campaña existente que viene rindiendo bien.
Detalles de la campaña actual:
${JSON.stringify(targetCampaign || {}, null, 2)}

Nuevo presupuesto total propuesto: $${Number(newBudget || 80000).toLocaleString("es-CO")} COP + IVA
Nueva duración total: ${newDays || 8} días.

Entrega una respuesta directa y ejecutiva con:
1. Confirmación del ajuste (cálculo del presupuesto diario resultante en COP).
2. Estimación de leads adicionales que se esperan recibir manteniendo o mejorando el CPL.
3. Reglas de oro para este ajuste: advertencia sobre no cambiar los creativos/copys que ya están ganando para no reiniciar el algoritmo, y cómo monitorear las primeras 24 horas.`;

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: promptAjuste }],
          temperature: 0.4,
          max_tokens: 500,
        }),
      });

      const data = await res.json();
      return NextResponse.json({
        ok: true,
        recommendation: data.choices?.[0]?.message?.content || "Presupuesto ajustado correctamente."
      });
    }

    // 2. MODO: GENERAR NUEVA CAMPAÑA APRENDIENDO DE LAS MEJORES Y DESCARTANDO LO QUE NO FUNCIONA
    if (action === "generate_strategy") {
      const promptGenerar = `Eres el Agente Estratega Avanzado de Meta Ads para Templo Místico. Tu objetivo es diseñar una NUEVA CAMPAÑA DE ALTO RENDIMIENTO aprendiendo de las mejores campañas pasadas y evitando errores de las que fracasaron.

🎯 DATOS DE APRENDIZAJE:
🏆 TOP 3 MEJORES CAMPAÑAS (CPL más económico y mayor volumen de mensajes):
${JSON.stringify(topCampaigns.length > 0 ? topCampaigns : campaigns.slice(0, 3), null, 2)}

🚫 LO QUE YA SE PROBÓ Y NO FUNCIONÓ (Campañas con CPL alto o cero conversiones):
${JSON.stringify(failedCampaigns.length > 0 ? failedCampaigns : "Ninguna registrada con pérdidas graves.", null, 2)}

Diseña una propuesta de campaña COMPLETA lista para lanzar con:
1. 🏷️ NOMBRE DE CAMPAÑA Y OBJETIVO RECOMENDADO (Leads / Mensajes a WhatsApp).
2. 💰 ESTRUCTURA DE PRESUPUESTO (Presupuesto total sugerido para 4 a 8 días en COP).
3. 📝 2 PROPUESTAS DE COPY GANADORAS (con ganchos emocionales de alta conversión para consultas y amarres, llamados a la acción claros al WhatsApp).
4. 🎨 GUÍA DE CREATIVOS (Qué tipo de imagen o video grabar: ángulos, iluminación, elementos esotéricos o testimonios, indicando qué cambiar respecto a las campañas anteriores para testear mejora).
5. 🧪 PRUEBA A/B DE MEJORA: Una variable clara para testear (ej: copy de urgencia vs copy de empatía, o imagen estática vs video corto).

Usa un tono directo, estructurado y listo para ejecutar.`;

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: promptGenerar }],
          temperature: 0.5,
          max_tokens: 900,
        }),
      });

      const data = await res.json();
      return NextResponse.json({
        ok: true,
        recommendation: data.choices?.[0]?.message?.content || "Estrategia generada con éxito."
      });
    }

    // 3. MODO DEFAULT: AUDITORÍA GENERAL DE CAMPAÑAS ACTIVAS
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return NextResponse.json({ error: "No hay campañas para analizar" }, { status: 400 });
    }

    const prompt = `Eres un experto estratega de Meta Ads (Facebook e Instagram Ads) especializado en servicios esotéricos y consultas espirituales en Colombia y Latinoamérica.

Analiza los siguientes datos de rendimiento de campañas actuales:
${JSON.stringify(campaigns, null, 2)}

NOTA IMPORTANTE SOBRE MONEDA: Todos los valores monetarios de inversión, presupuesto y CPL están expresados en PESOS COLOMBIANOS (COP). Expresa todas tus cifras y presupuestos siempre en COP (ejemplo: $10.000 COP, $50.000 COP).

Entrega una auditoría ejecutiva breve y contundente en español para el director del negocio:
🏆 1. TOP MEJORES CAMPAÑAS (CPL bajo, alto volumen de mensajes):
Explica qué patrón exitoso tienen y si conviene aumentar su presupuesto.

⚠️ 2. CAMPAÑAS DEFICIENTES (CPL alto o sin resultados):
Recomienda explícitamente pausar o corregir.

💡 3. CONSEJOS PRÁCTICOS DE MEJORA:
2 a 3 recomendaciones tácticas de creativos, videos, copys y cómo escalar presupuestos a 4 y 8 días con presupuesto total.

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
        max_tokens: 700,
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
