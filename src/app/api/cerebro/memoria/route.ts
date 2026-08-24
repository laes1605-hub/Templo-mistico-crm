import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { CEREBRO_TABLA, construirPromptMemoria } from "../../../../lib/cerebro";
import { verificarSecreto } from "../../../../lib/cerebro-auth";

export const dynamic = "force-dynamic";

// ============================================================================
// 🧠 /api/cerebro/memoria — LA INYECCIÓN
// ----------------------------------------------------------------------------
// Este es el endpoint que llama n8n JUSTO ANTES de que Luna responda.
// Devuelve el bloque de texto con TODAS las reglas APROBADAS, listo para
// concatenar al System Prompt.
//
//   GET  /api/cerebro/memoria                 → { prompt, reglas, total }
//   GET  /api/cerebro/memoria?format=text     → text/plain (el bloque pelado)
//   GET  /api/cerebro/memoria?limit=25        → tope de reglas (default 40)
//   GET  /api/cerebro/memoria?categoria=cierre
//   GET  /api/cerebro/memoria?track=1         → además incrementa veces_usada
//
// Auth: header `x-cerebro-secret` si CEREBRO_API_SECRET/ADMIN_SECRET existen.
// ============================================================================

export async function GET(req: Request) {
  const noAutorizado = verificarSecreto(req);
  if (noAutorizado) return noAutorizado;

  try {
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") || "json").toLowerCase();
    const limit = Math.min(Number(url.searchParams.get("limit") || 40) || 40, 200);
    const categoria = url.searchParams.get("categoria");
    const track = ["1", "true", "si", "yes"].includes((url.searchParams.get("track") || "").toLowerCase());
    const minConfianza = Number(url.searchParams.get("min_confianza") || 0) || 0;

    let query = supabaseAdmin
      .from(CEREBRO_TABLA)
      .select("id, titulo, regla, categoria, ejemplo, confianza, prioridad, veces_usada")
      .eq("estado", "aprobada")
      .gte("confianza", minConfianza)
      .order("prioridad", { ascending: false })
      .order("confianza", { ascending: false })
      .limit(limit);

    if (categoria && categoria !== "todas") query = query.eq("categoria", categoria);

    const { data, error } = await query;

    if (error) {
      const faltaTabla = /does not exist|could not find the table/i.test(error.message || "");
      // Nunca romper a Luna: si el Cerebro falla, devolvemos memoria vacía.
      if (format === "text") return new NextResponse("", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return NextResponse.json({
        ok: false,
        prompt: "",
        reglas: [],
        total: 0,
        error: faltaTabla ? "Falta ejecutar la migración del Cerebro en Supabase." : error.message,
      });
    }

    const reglas = data || [];
    const prompt = construirPromptMemoria(reglas);

    if (track && reglas.length) {
      // Best-effort: registra el uso sin bloquear la respuesta de Luna.
      supabaseAdmin
        .rpc("cerebro_registrar_uso", { p_ids: reglas.map((r: any) => r.id) })
        .then(() => null, () => null);
    }

    if (format === "text" || format === "txt" || format === "plain") {
      return new NextResponse(prompt, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json({
      ok: true,
      total: reglas.length,
      prompt,
      caracteres: prompt.length,
      reglas,
      generadoEn: new Date().toISOString(),
    });
  } catch (e: any) {
    // Fallback silencioso: Luna sigue funcionando con su prompt base.
    return NextResponse.json({ ok: false, prompt: "", reglas: [], total: 0, error: e.message });
  }
}
