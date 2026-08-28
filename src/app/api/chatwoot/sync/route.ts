import { NextResponse } from "next/server";
import { sincronizarTodo } from "../../../../lib/sync-chatwoot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sincronización Chatwoot → Supabase.
 *
 *   GET /api/chatwoot/sync                        → conversaciones con novedades
 *   GET /api/chatwoot/sync?rapido=1               → modo delta (barato, para sondeo frecuente)
 *   GET /api/chatwoot/sync?completa=1             → historial de todas (reparación)
 *   GET /api/chatwoot/sync?conversacionId=123     → una sola conversación (con filtro delta)
 *
 * El dashboard lo llama al abrir la app (completa), cada pocos segundos en
 * modo `rapido` (bandeja cada 5 s, chat abierto cada 2.5 s), al abrir un chat
 * y con el botón 🔄. Con el webhook de Chatwoot configurado, el mensaje ya
 * suele estar antes de que llegue el primer sondeo.
 */
async function manejar(req: Request) {
  const url = new URL(req.url);
  const conversacionId = url.searchParams.get("conversacionId");
  const completa = url.searchParams.get("completa") === "1";
  const rapido = url.searchParams.get("rapido") === "1";

  const resultado = await sincronizarTodo({
    completa,
    rapido,
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
