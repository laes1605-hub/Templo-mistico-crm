import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const {
      campaigns = [],
      action = "audit", // "audit" | "generate_strategy" | "adjust_budget"
      topCampaigns = [],
      failedCampaigns = [],
      pageVideos = [], // Videos subidos a la Fan Page de Facebook
      targetCampaign,
      newBudget,
      newDays
    } = await req.json();

    const openaiKey = (process.env.OPENAI_API_KEY || "").replace(/[\r\n\t "']/g, "").trim();

    if (!openaiKey) {
      return NextResponse.json({ error: "Falta OPENAI_API_KEY en Vercel" }, { status: 400 });
    }

    // 1. MODO: RECOMENDACIÓN DE EXTENSIÓN Y REAJUSTE DE PRESUPUESTO
    if (action === "adjust_budget") {
      const promptAjuste = `Eres el Agente Estratega Senior de Meta Ads de Templo Místico (esoterismo, amarres y consultas en Colombia).
El usuario quiere reajustar y extender una campaña ganadora.
Campaña evaluada:
${JSON.stringify(targetCampaign || {}, null, 2)}

Nuevo presupuesto total propuesto: $${Number(newBudget || 80000).toLocaleString("es-CO")} COP + IVA (19%)
Días de duración extendida: ${newDays || 8} días.
REGLA HORARIA OBLIGATORIA: Todas las campañas inician exactamente a las 00:01 del día inicial y finalizan a las 23:59 del día final.

Analiza y responde de forma ejecutiva:
1. 🗓️ Cronograma y Ritmo: Inicio a las 00:01 y Cierre a las 23:59 en ${newDays || 8} días. Inversión neta diaria estimada en COP.
2. 📈 Recomendación de extensión: ¿Conviene extenderla más días (ej. 10, 14, 21 días) según el CPL actual?
3. 🎯 Creativo en juego: Recomendación de mantener el video/creativo que ya está convirtiendo sin alterarlo para no reiniciar el aprendizaje de Meta.
4. 💰 Proyección de conversaciones/leads adicionales a WhatsApp.`;

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
          max_tokens: 600,
        }),
      });

      const data = await res.json();
      return NextResponse.json({
        ok: true,
        recommendation: data.choices?.[0]?.message?.content || "Presupuesto ajustado correctamente."
      });
    }

    // 2. MODO: GENERAR ESTRATEGIA REUTILIZANDO VIDEOS DE LA PÁGINA DE FACEBOOK
    if (action === "generate_strategy") {
      const promptGenerar = `Eres el Agente Estratega Autónomo de Meta Ads para Templo Místico. Tu objetivo es crear una NUEVA CAMPAÑA DE ALTO IMPACTO reutilizando y apalancándote de los VIDEOS EXISTENTES ya subidos a la Fan Page de Facebook que mejor rendimiento han tenido.

📹 VIDEOS DISPONIBLES EN LA FAN PAGE DE FACEBOOK:
${JSON.stringify(pageVideos.length > 0 ? pageVideos : [
  { id: "vid_fb_01", title: "Amarre de Amor con Velación y Fotografía (Testimonio)", views: 1420 },
  { id: "vid_fb_02", title: "Consulta Espiritual en Vivo - Lectura de Tarot y Tabaco Certero", views: 2850 },
  { id: "vid_fb_03", title: "Ritual de Despojo y Destrancadera", views: 3100 }
], null, 2)}

🏆 TOP MEJORES CAMPAÑAS HISTÓRICAS (CPL bajo, alto volumen de mensajes):
${JSON.stringify(topCampaigns.length > 0 ? topCampaigns : campaigns.slice(0, 3), null, 2)}

🚫 LO QUE YA SE PROBÓ Y NO FUNCIONÓ (Anti-patrones a descartar):
${JSON.stringify(failedCampaigns.length > 0 ? failedCampaigns : "Ninguna con fallas críticas.", null, 2)}

REGLAS DE ORO DE TEMPLO MÍSTICO:
- La campaña debe programarse de 00:01 del día inicial a 23:59 del día final.
- El presupuesto puede extenderse todo lo que se desee según el ritmo de conversión.
- Selecciona el mejor video de la Fan Page para apalancarte de su autoridad o engagement previo.
- El COPY es el TEXTO QUE VA DENTRO DEL POST (la publicación) que acompaña al video. NUNCA uses el nombre del archivo del video (ej: "Auto_Cropped_AR_4_X_5_DCO_1.mp4") como copy: ese es un nombre técnico de edición. Si un video no trae texto en el post, propone un copy nuevo del agente.

Genera una propuesta estructurada con:
1. 🎬 VIDEO SELECCIONADO DE LA FAN PAGE: Cuál video de la lista reutilizar y por qué su ángulo conecta mejor con las campañas ganadoras.
2. 🗓️ PROGRAMACIÓN Y PRESUPUESTO: Horario estricto (00:01 a 23:59), duración sugerida (días) y presupuesto total en COP + IVA, con recomendación de hasta cuántos días extenderla si el CPL se mantiene bajo.
3. ✍️ 2 PROPUESTAS DE COPY DE ALTO IMPACTO para acompañar el video (gancho emocional fuerte para amarres/consultas y CTA claro a WhatsApp).
4. 🔬 VARIACIÓN DE PRUEBA: Qué elemento testear (ej: gancho de los primeros 3 segundos vs texto principal) para superar el récord del Top 3.`;

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
          max_tokens: 1000,
        }),
      });

      const data = await res.json();
      return NextResponse.json({
        ok: true,
        recommendation: data.choices?.[0]?.message?.content || "Estrategia con videos generada con éxito."
      });
    }

    // 3. MODO DEFAULT: AUDITORÍA GENERAL
    const promptAudit = `Eres el Agente Estratega de Meta Ads de Templo Místico. Analiza las campañas actuales:
${JSON.stringify(campaigns, null, 2)}

Reglas: Cifras en COP. Horarios de inicio 00:01 y fin 23:59.
Identifica cuáles videos/campañas están rindiendo mejor, cuáles conviene apagar y cómo extender las ganadoras todo lo que se quiera sin romper el CPL.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: promptAudit }],
        temperature: 0.4,
        max_tokens: 700,
      }),
    });

    const data = await res.json();
    return NextResponse.json({ ok: true, recommendation: data.choices?.[0]?.message?.content || "" });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
