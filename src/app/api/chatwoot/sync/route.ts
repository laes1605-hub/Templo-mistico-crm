import { NextResponse } from "next/server";
import { diagnosticoCadena, sincronizarTodo } from "../../../../lib/sync-chatwoot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sincronización Chatwoot → Supabase.
 *
 *   GET /api/chatwoot/sync                        → conversaciones con novedades
 *   GET /api/chatwoot/sync?rapido=1               → modo delta (barato, para sondeo frecuente)
 *   GET /api/chatwoot/sync?completa=1             → historial de todas (reparación)
 *   GET /api/chatwoot/sync?conversacionId=12,34   → una o varias conversaciones (coma)
 *   GET /api/chatwoot/sync?diagnostico=1          → estado de la cadena
 *                                                     WhatsApp Personal → Evolution →
 *                                                     Chatwoot → Supabase, con veredicto
 *
 * El dashboard lo llama al abrir la app, cada pocos segundos en modo `rapido`
 * (bandeja cada 12 s, chat abierto cada 6 s — vigilando TODAS las
 * conversaciones de Chatwoot del chat unificado), al abrir un chat y con el
 * botón 🔄 (que además de sincronizar muestra el veredicto del diagnóstico).
 */
async function manejar(req: Request) {
  const url = new URL(req.url);

  if (url.searchParams.get("diagnostico") === "1") {
    const diagnostico = await diagnosticoCadena();
    return NextResponse.json(diagnostico, { status: 200 });
  }

  const conversacionId = url.searchParams.get("conversacionId");
  const completa = url.searchParams.get("completa") === "1";
  const rapido = url.searchParams.get("rapido") === "1";
  // Tope de conversaciones para la pasada (el botón 🔄 usa un tope acotado
  // para que la reparación manual no se eternice en Vercel).
  const maxBruto = Number(url.searchParams.get("max") || "");
  const maxConversaciones =
    Number.isFinite(maxBruto) && maxBruto >= 10 && maxBruto <= 100 ? Math.floor(maxBruto) : undefined;

  const resultado = await sincronizarTodo({
    completa,
    rapido,
    chatwootConversationId: conversacionId || undefined,
    maxConversaciones,
  });

  return NextResponse.json(resultado, { status: resultado.ok || resultado.mensajes_nuevos > 0 ? 200 : 500 });
}

export async function GET(req: Request) {
  return manejar(req);
}

export async function POST(req: Request) {
  return manejar(req);
}
