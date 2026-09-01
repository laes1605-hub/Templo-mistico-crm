import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { parsearDataUri, subirMediaAStorage } from "../../../../lib/media-storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Migra los adjuntos históricos guardados como data-URI base64 dentro de
 * `mensajes.url_archivo` hacia Supabase Storage, dejando en la tabla solo la
 * URL pública. Con esto los mensajes viejos también dejan de inflar el Egress
 * (refetch del chat, realtime, sincronización).
 *
 * GET  → informa cuántos mensajes quedan pendientes de migrar.
 * POST → migra un lote (con presupuesto de tiempo). Llamar repetidamente
 *        hasta que `pendientes` llegue a 0. El botón "Migrar adjuntos" de
 *        Ajustes hace ese bucle automáticamente.
 */

async function contarPendientes(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("mensajes")
    .select("id", { count: "exact", head: true })
    .like("url_archivo", "data:%");
  if (error) {
    console.error("[migrar-media] No se pudo contar pendientes:", error.message);
    return null;
  }
  return count ?? 0;
}

export async function GET() {
  const pendientes = await contarPendientes();
  if (pendientes === null) {
    return NextResponse.json({ error: "No se pudo consultar la tabla mensajes." }, { status: 500 });
  }
  return NextResponse.json({ pendientes });
}

export async function POST() {
  const inicio = Date.now();
  const PRESUPUESTO_MS = 45_000; // margen bajo el límite del hosting
  const LOTE = 5; // pocas filas por consulta: cada una puede pesar varios MB

  let migrados = 0;
  let fallidos = 0;
  const fallidosIds = new Set<string>();

  try {
    while (Date.now() - inicio < PRESUPUESTO_MS) {
      const { data: filas, error } = await supabaseAdmin
        .from("mensajes")
        .select("id, url_archivo, tipo_contenido, creado_en")
        .like("url_archivo", "data:%")
        .order("creado_en", { ascending: false })
        .limit(LOTE + fallidosIds.size);
      if (error) throw new Error(error.message);

      const pendientesLote = (filas || []).filter((f: any) => !fallidosIds.has(String(f.id)));
      if (pendientesLote.length === 0) break;

      for (const fila of pendientesLote.slice(0, LOTE)) {
        if (Date.now() - inicio >= PRESUPUESTO_MS) break;
        const parseado = parsearDataUri(String(fila.url_archivo || ""));
        if (!parseado) {
          fallidos += 1;
          fallidosIds.add(String(fila.id));
          continue;
        }
        const nombre = fila.tipo_contenido === "audio" ? "nota_de_voz" : String(fila.tipo_contenido || "adjunto");
        const url = await subirMediaAStorage(parseado.bytes, parseado.mime, nombre);
        if (!url) {
          fallidos += 1;
          fallidosIds.add(String(fila.id));
          continue;
        }
        const { error: errorUpdate } = await supabaseAdmin
          .from("mensajes")
          .update({ url_archivo: url })
          .eq("id", fila.id);
        if (errorUpdate) {
          fallidos += 1;
          fallidosIds.add(String(fila.id));
          console.error("[migrar-media] No se pudo actualizar la fila:", errorUpdate.message);
          continue;
        }
        migrados += 1;
      }
    }
  } catch (e: any) {
    console.error("[migrar-media] Error migrando:", e?.message || e);
    const pendientes = await contarPendientes();
    return NextResponse.json(
      { error: e?.message || "Error migrando adjuntos.", migrados, fallidos, pendientes },
      { status: 500 }
    );
  }

  const pendientes = await contarPendientes();
  return NextResponse.json({
    ok: true,
    migrados,
    fallidos,
    // Los fallidos siguen contando como pendientes; el cliente debe parar
    // cuando pendientes <= fallidos acumulados o cuando no haya avance.
    pendientes,
  });
}
