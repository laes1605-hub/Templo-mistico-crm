import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import {
  CEREBRO_TABLA,
  CEREBRO_TABLA_EJECUCIONES,
  ESTADOS_GANADOS,
  sanitizarRegla,
} from "../../../../lib/cerebro";
import { verificarSecreto } from "../../../../lib/cerebro-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================================
// 🧠 /api/cerebro/extraer — EL EXTRACTOR
// ----------------------------------------------------------------------------
// Analiza las conversaciones REALES donde el cliente pagó o agendó, se las pasa
// a OpenAI y guarda las lecciones como reglas en estado "pendiente" para que el
// admin las apruebe con 1 clic desde la pestaña Cerebro.
//
//   POST /api/cerebro/extraer
//   Body (todo opcional):
//   {
//     "dias": 7,                // ventana de análisis (default 7)
//     "maxConversaciones": 12,  // cuántas conversaciones ganadas analizar
//     "maxMensajes": 60,        // mensajes por conversación
//     "maxReglas": 6,           // lecciones a pedirle a la IA
//     "modelo": "gpt-4o-mini",
//     "dryRun": false           // true = analiza y devuelve, pero NO guarda
//   }
//
// Este mismo endpoint es el que dispara el workflow SEMANAL de n8n (Schedule
// Trigger → HTTP Request POST). n8n no necesita saber nada de OpenAI.
// ============================================================================

const PROMPT_SISTEMA = `Eres un analista senior de ventas conversacionales especializado en servicios esotéricos y consultas espirituales en Colombia y Latinoamérica (tarot, amarres, limpias, rituales, lecturas).

Tu trabajo es hacer ingeniería inversa de conversaciones de WhatsApp REALES que terminaron en VENTA CERRADA (el cliente pagó) o en AGENDAMIENTO, y extraer las técnicas de persuasión concretas que provocaron ese cierre.

REGLAS DE ANÁLISIS:
1. Solo extraé patrones que puedas EVIDENCIAR en los mensajes. Nada de teoría genérica de ventas.
2. Cada lección debe ser una INSTRUCCIÓN ACCIONABLE, escrita en segunda persona, para que otra vendedora (la asesora "Luna") la aplique en su próximo chat.
3. Priorizá: manejo de objeciones de precio, generación de urgencia creíble, espejo emocional, prueba social, transición del dolor al cierre y cómo se pidió el pago o la cita.
4. Incluí SIEMPRE un "ejemplo" con una frase textual (o casi textual) tomada de las conversaciones que funcionó.
5. No inventes datos, nombres ni cifras que no estén en las conversaciones.
6. Escribí todo en español neutro colombiano, sin emojis en el campo "regla".

Devolvés ÚNICAMENTE un JSON válido con esta forma exacta:
{
  "reglas": [
    {
      "titulo": "string corto y memorable (máx 70 caracteres)",
      "regla": "instrucción accionable de 1 a 3 frases",
      "categoria": "cierre | objecion | precio | urgencia | empatia | agendamiento | seguimiento | confianza | descubrimiento",
      "ejemplo": "frase textual de la conversación que funcionó",
      "justificacion": "por qué funcionó, citando la evidencia observada",
      "impacto_estimado": "alto | medio | bajo",
      "confianza": 0.0
    }
  ]
}`;

function limpiarMensaje(m: any): string {
  const quien = m.tipo === "enviado" ? "ASESORA" : "CLIENTE";
  let texto = String(m.contenido || "").trim();
  if (!texto || /^\[(audio|imagen|nota_de_voz|documento|video|sticker)\]$/i.test(texto)) {
    texto = `(envió ${String(m.tipo_contenido || "archivo")})`;
  }
  return `${quien}: ${texto.slice(0, 400)}`;
}

export async function POST(req: Request) {
  const noAutorizado = verificarSecreto(req);
  if (noAutorizado) return noAutorizado;

  const inicio = Date.now();
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dias = Math.min(Math.max(Number(body.dias) || 7, 1), 180);
  const maxConversaciones = Math.min(Math.max(Number(body.maxConversaciones) || 12, 1), 40);
  const maxMensajes = Math.min(Math.max(Number(body.maxMensajes) || 60, 10), 200);
  const maxReglas = Math.min(Math.max(Number(body.maxReglas) || 6, 1), 12);
  const modelo = String(body.modelo || "gpt-4o-mini").slice(0, 60);
  const dryRun = Boolean(body.dryRun);
  const origen = String(body.origen || "n8n_extractor").slice(0, 60);

  const registrarError = async (mensaje: string) => {
    await supabaseAdmin
      .from(CEREBRO_TABLA_EJECUCIONES)
      .insert([{ origen, estado: "error", modelo, error: mensaje.slice(0, 1000) }])
      .then(() => null, () => null);
  };

  try {
    const openaiKey = (process.env.OPENAI_API_KEY || "").replace(/[\r\n\t "']/g, "").replace(/^Bearer\s+/i, "").trim();
    if (!openaiKey) {
      await registrarError("Falta OPENAI_API_KEY");
      return NextResponse.json({ error: "Falta OPENAI_API_KEY en las variables de entorno." }, { status: 400 });
    }

    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

    // ---------------------------------------------------------------------
    // 1. Clientes GANADOS: pagaron (tabla pagos) o llegaron a un estado ganador
    // ---------------------------------------------------------------------
    const idsGanados = new Set<string>();
    const contexto: Record<string, any> = {};

    const { data: pagos } = await supabaseAdmin
      .from("pagos")
      .select("cliente_id, monto, fecha_pago, estado")
      .eq("estado", "pagado")
      .gte("fecha_pago", desde.slice(0, 10));

    (pagos || []).forEach((p: any) => {
      if (!p.cliente_id) return;
      idsGanados.add(p.cliente_id);
      const prev = contexto[p.cliente_id] || { montoPagado: 0, pagos: 0 };
      contexto[p.cliente_id] = { montoPagado: prev.montoPagado + Number(p.monto || 0), pagos: prev.pagos + 1 };
    });

    const { data: clientesGanados } = await supabaseAdmin
      .from("clientes")
      .select("id, nombre, estado, actualizado_en")
      .in("estado", ESTADOS_GANADOS)
      .gte("actualizado_en", desde);

    (clientesGanados || []).forEach((c: any) => {
      idsGanados.add(c.id);
      contexto[c.id] = { ...(contexto[c.id] || {}), estado: c.estado };
    });

    if (idsGanados.size === 0) {
      const msg = `No se encontraron ventas cerradas ni agendamientos en los últimos ${dias} días. Ampliá la ventana con "dias".`;
      await supabaseAdmin
        .from(CEREBRO_TABLA_EJECUCIONES)
        .insert([{ origen, estado: "ok", modelo, conversaciones_analizadas: 0, detalle: { nota: msg, dias } }])
        .then(() => null, () => null);
      return NextResponse.json({ ok: true, nuevas: 0, analizadas: 0, nota: msg, reglas: [] });
    }

    // ---------------------------------------------------------------------
    // 2. Conversaciones de esos clientes
    // ---------------------------------------------------------------------
    const { data: convs } = await supabaseAdmin
      .from("conversaciones")
      .select("id, cliente_id, fuente, ultimo_mensaje_en, clientes(nombre, estado)")
      .in("cliente_id", Array.from(idsGanados))
      .order("ultimo_mensaje_en", { ascending: false })
      .limit(maxConversaciones);

    if (!convs || convs.length === 0) {
      const msg = "Hay clientes ganados pero sin conversaciones asociadas para analizar.";
      return NextResponse.json({ ok: true, nuevas: 0, analizadas: 0, nota: msg, reglas: [] });
    }

    // ---------------------------------------------------------------------
    // 3. Transcripciones
    // ---------------------------------------------------------------------
    const transcripciones: string[] = [];
    let mensajesTotales = 0;

    for (const conv of convs as any[]) {
      const { data: msgs } = await supabaseAdmin
        .from("mensajes")
        .select("tipo, contenido, tipo_contenido, creado_en")
        .eq("conversacion_id", conv.id)
        .order("creado_en", { ascending: true })
        .limit(maxMensajes);

      if (!msgs || msgs.length < 4) continue;
      mensajesTotales += msgs.length;

      const ctx = contexto[conv.cliente_id] || {};
      const cabecera = [
        `--- CONVERSACIÓN GANADA (canal: ${conv.fuente || "desconocido"})`,
        ctx.montoPagado ? `Monto pagado: $${Math.round(ctx.montoPagado).toLocaleString("es-CO")} COP` : null,
        ctx.estado ? `Estado final: ${ctx.estado}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      transcripciones.push([cabecera, ...msgs.map(limpiarMensaje), "--- FIN DE LA CONVERSACIÓN"].join("\n"));
    }

    if (transcripciones.length === 0) {
      const msg = "Las conversaciones ganadas son demasiado cortas para extraer patrones.";
      return NextResponse.json({ ok: true, nuevas: 0, analizadas: 0, nota: msg, reglas: [] });
    }

    // ---------------------------------------------------------------------
    // 4. Reglas ya conocidas (para que la IA no repita lo mismo)
    // ---------------------------------------------------------------------
    const { data: yaConocidas } = await supabaseAdmin
      .from(CEREBRO_TABLA)
      .select("titulo")
      .in("estado", ["aprobada", "pendiente"])
      .limit(60);

    const listaConocidas = (yaConocidas || []).map((r: any) => `- ${r.titulo}`).join("\n");

    // ---------------------------------------------------------------------
    // 5. OpenAI
    // ---------------------------------------------------------------------
    let corpus = transcripciones.join("\n\n");
    const LIMITE_CARACTERES = 55000;
    if (corpus.length > LIMITE_CARACTERES) corpus = corpus.slice(-LIMITE_CARACTERES);

    const promptUsuario = [
      `Analizá estas ${transcripciones.length} conversaciones reales del Templo Místico que terminaron en venta o agendamiento (últimos ${dias} días):`,
      "",
      corpus,
      "",
      listaConocidas
        ? `LECCIONES QUE LUNA YA TIENE (NO las repitas, buscá patrones NUEVOS o refinamientos claramente distintos):\n${listaConocidas}`
        : "",
      "",
      `Devolvé máximo ${maxReglas} lecciones nuevas, ordenadas de mayor a menor impacto. Sólo JSON.`,
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: "system", content: PROMPT_SISTEMA },
          { role: "user", content: promptUsuario },
        ],
        temperature: 0.5,
        max_tokens: 2200,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errTxt = (await res.text()).slice(0, 400);
      await registrarError(`OpenAI ${res.status}: ${errTxt}`);
      return NextResponse.json({ error: `Error OpenAI ${res.status}: ${errTxt}` }, { status: 502 });
    }

    const dataAi = await res.json();
    const raw = dataAi.choices?.[0]?.message?.content || "{}";

    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const brutas: any[] = Array.isArray(parsed?.reglas) ? parsed.reglas : Array.isArray(parsed) ? parsed : [];
    const sanitizadas = brutas
      .slice(0, maxReglas)
      .map((r) =>
        sanitizarRegla(
          {
            ...r,
            estado: "pendiente",
            origen,
            evidencia: {
              conversaciones_analizadas: transcripciones.length,
              mensajes_analizados: mensajesTotales,
              ventana_dias: dias,
              modelo,
              generado_en: new Date().toISOString(),
            },
          },
          origen
        )
      )
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        analizadas: transcripciones.length,
        mensajes: mensajesTotales,
        sugeridas: sanitizadas.length,
        reglas: sanitizadas,
      });
    }

    // ---------------------------------------------------------------------
    // 6. Guardar (sin pisar duplicados)
    // ---------------------------------------------------------------------
    const vistos = new Set<string>();
    const lote = sanitizadas.filter((r) => (vistos.has(r.hash_regla) ? false : (vistos.add(r.hash_regla), true)));

    const { data: existentes } = await supabaseAdmin
      .from(CEREBRO_TABLA)
      .select("hash_regla")
      .in("hash_regla", lote.map((r) => r.hash_regla));

    const yaExistian = new Set((existentes || []).map((r: any) => r.hash_regla));
    const nuevas = lote.filter((r) => !yaExistian.has(r.hash_regla));

    let insertadas: any[] = [];
    if (nuevas.length) {
      const { data, error } = await supabaseAdmin.from(CEREBRO_TABLA).insert(nuevas).select();
      if (error) {
        await registrarError(error.message);
        const faltaTabla = /does not exist|could not find the table/i.test(error.message || "");
        return NextResponse.json(
          {
            error: faltaTabla
              ? "La tabla 'cerebro_reglas' no existe. Ejecutá supabase/migrations/20260824_fase3_cerebro_ia.sql."
              : error.message,
            needsMigration: faltaTabla,
          },
          { status: faltaTabla ? 424 : 500 }
        );
      }
      insertadas = data || [];
    }

    await supabaseAdmin
      .from(CEREBRO_TABLA_EJECUCIONES)
      .insert([
        {
          origen,
          estado: "ok",
          conversaciones_analizadas: transcripciones.length,
          mensajes_analizados: mensajesTotales,
          reglas_sugeridas: lote.length,
          reglas_nuevas: insertadas.length,
          reglas_duplicadas: lote.length - insertadas.length,
          modelo,
          detalle: { dias, duracion_ms: Date.now() - inicio },
        },
      ])
      .then(() => null, () => null);

    return NextResponse.json({
      ok: true,
      analizadas: transcripciones.length,
      mensajes: mensajesTotales,
      sugeridas: lote.length,
      nuevas: insertadas.length,
      duplicadas: lote.length - insertadas.length,
      duracionMs: Date.now() - inicio,
      reglas: insertadas,
    });
  } catch (e: any) {
    await registrarError(e.message || "Error desconocido");
    return NextResponse.json({ error: e.message || "Error interno del extractor" }, { status: 500 });
  }
}

// Permitir disparo por GET desde n8n/cron simples (?dias=7)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params: Record<string, any> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));
  return POST(
    new Request(url.toString(), {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(params),
    })
  );
}
