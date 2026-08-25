import { NextResponse } from "next/server";
import { sincronizarTodo } from "../../../../lib/sync-chatwoot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sincronización Chatwoot → Supabase.
 *
 *   GET /api/chatwoot/sync                        → conversaciones con novedades
 *   GET /api/chatwoot/sync?completa=1             → historial de todas (reparación)
 *   GET /api/chatwoot/sync?conversacionId=123     → una sola conversación
 *
 * El dashboard lo llama al abrir la app, cada 20 segundos con la app visible,
 * al abrir un chat (conversacionId) y con el botón 🔄.
 */
async function manejar(req: Request) {
  const url = new URL(req.url);
  const conversacionId = url.searchParams.get("conversacionId");
  const completa = url.searchParams.get("completa") === "1";

  const resultado = await sincronizarTodo({
    completa,
    chatwootConversationId: conversacionId || undefined,
  });

  return NextResponse.json(resultado, { status: resultado.ok || resultado.mensajes_nuevos > 0 ? 200 : 500 });
}

export async function GET(req: Request) {
  return manejar(req);
}

export async function POST(req: Request) {
  return manejar(req);
}
