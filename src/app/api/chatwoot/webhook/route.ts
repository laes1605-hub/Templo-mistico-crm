import { NextResponse } from "next/server";
import { procesarEventoWebhook } from "../../../../lib/sync-chatwoot";

export const dynamic = "force-dynamic";

/**
 * Webhook directo de Chatwoot → Vercel (opcional pero recomendado).
 *
 * Configurarlo en Chatwoot: Ajustes → Integraciones → Webhooks → nuevo:
 *   URL:     https://templo-mistico-crm.vercel.app/api/chatwoot/webhook
 *   Eventos: message_created (y conversation_created si se quiere)
 *
 * Con esto los mensajes llegan al CRM en el mismo instante, sin depender del
 * workflow de n8n (Luna) ni esperar el sondeo de 20 segundos. Puede coexistir
 * con n8n: la sincronización deduplica por ID de mensaje de Chatwoot.
 */
export async function POST(req: Request) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignorado: "body inválido" });
  }

  const evento = String(body?.event || "");

  try {
    // message_updated también se procesa: llega el pie de foto/caption de una
    // imagen al instante en vez de esperar el siguiente sondeo. La deduplicación
    // por id de mensaje hace que sea idempotente.
    if (
      evento === "message_created" ||
      evento === "conversation_created" ||
      evento === "message_updated"
    ) {
      const resultado = await procesarEventoWebhook(body, {
        // message_updated nunca debe crear filas nuevas (ev. "leído"): sólo
        // completar pie de foto / URL del adjunto en las existentes.
        soloActualizarExistentes: evento === "message_updated",
      });
      if (!resultado.ok && resultado.errores.length > 0) {
        console.error("[chatwoot-webhook]", evento, resultado.errores.join(" | "));
      }
      return NextResponse.json({ ok: true, resultado });
    }
    return NextResponse.json({ ok: true, ignorado: evento || "sin evento" });
  } catch (e: any) {
    // Siempre 200 para que Chatwoot no reintente en cascada; el sondeo repara.
    console.error("[chatwoot-webhook] error:", e?.message || e);
    return NextResponse.json({ ok: true, error: e?.message || "error" });
  }
}
