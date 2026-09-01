import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import {
  CARPETA_RESPUESTAS_RAPIDAS,
  parsearDataUri,
  subirMediaAStorage,
} from "../../../../lib/media-storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Migra los audios e imágenes de la biblioteca de RESPUESTAS RÁPIDAS que todavía
 * están incrustados como data-URI base64 dentro de `respuestas_rapidas.contenido`.
 *
 * Hace falta porque la biblioteca se descarga COMPLETA en cada sincronización y
 * en cada evento de realtime de la tabla: un solo audio de 3 MB pesando ~4 MB en
 * base64 se re-transmitía por cada teléfono cada vez que alguien tocaba
 * «Sincronizar con todos». Después de la migración en la tabla queda la URL
 * pública del bucket `media-mensajes` (carpeta `respuestas-rapidas/`) y el
 * archivo sólo se lee al enviarlo de verdad.
 *
 * Cada fila guarda además `hash_bytes` (MD5 de los bytes), que es lo que permite
 * seguir deduplicando entre dispositivos ahora que el contenido es una URL.
 * El objeto se nombra con ese hash, así que dos teléfonos que suben el mismo
 * archivo escriben en la misma ruta y no generan copias.
 *
 * GET  → informa cuántas respuestas quedan pendientes de migrar.
 * POST → migra un lote (con presupuesto de tiempo). Llamar repetidamente hasta
 *        que `pendientes` llegue a 0. El botón de Ajustes hace ese bucle solo.
 *
 * Requiere las migraciones 20260916_media_storage.sql (bucket) y
 * 20260917_respuestas_rapidas_a_storage.sql (columna hash_bytes + huella).
 */

const TIPOS_BINARIOS = ["audio", "imagen"];

async function contarPendientes(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("respuestas_rapidas")
    .select("id", { count: "exact", head: true })
    .in("tipo", TIPOS_BINARIOS)
    .like("contenido", "data:%");
  if (error) {
    console.error("[migrar-rr] No se pudo contar pendientes:", error.message);
    return null;
  }
  return count ?? 0;
}

function esDuplicadoDeIndice(error: any): boolean {
  return error?.code === "23505" || String(error?.message || "").toLowerCase().includes("duplicate key");
}

function esColumnaInexistente(error: any): boolean {
  const mensaje = String(error?.message || "").toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || (mensaje.includes("column") && mensaje.includes("does not exist"));
}

export async function GET() {
  const pendientes = await contarPendientes();
  if (pendientes === null) {
    return NextResponse.json({ error: "No se pudo consultar la tabla respuestas_rapidas." }, { status: 500 });
  }
  return NextResponse.json({ pendientes });
}

export async function POST() {
  const inicio = Date.now();
  const PRESUPUESTO_MS = 45_000; // margen bajo el límite del hosting
  const LOTE = 5; // pocas filas por consulta: cada una puede pesar varios MB

  let migrados = 0;
  let duplicados = 0;
  let fallidos = 0;
  const procesadas = new Set<string>();

  try {
    while (Date.now() - inicio < PRESUPUESTO_MS) {
      const { data: filas, error } = await supabaseAdmin
        .from("respuestas_rapidas")
        .select("id, tipo, titulo, contenido, creado_en, hash_bytes")
        .in("tipo", TIPOS_BINARIOS)
        .like("contenido", "data:%")
        .order("creado_en", { ascending: true })
        .limit(LOTE + procesadas.size);
      if (error) {
        if (esColumnaInexistente(error)) {
          // Falta 20260917_respuestas_rapidas_a_storage.sql: se puede migrar el
          // archivo, pero sin la columna no hay forma de guardar la huella.
          return NextResponse.json(
            { error: "Falta aplicar la migración 20260917_respuestas_rapidas_a_storage.sql (columna hash_bytes).", migrados, duplicados, fallidos, pendientes: await contarPendientes() },
            { status: 500 }
          );
        }
        throw new Error(error.message);
      }

      const pendientesLote = (filas || []).filter((f: any) => !procesadas.has(String(f.id)));
      if (pendientesLote.length === 0) break;

      for (const fila of pendientesLote.slice(0, LOTE)) {
        if (Date.now() - inicio >= PRESUPUESTO_MS) break;
        procesadas.add(String(fila.id));

        const parseado = parsearDataUri(String(fila.contenido || ""));
        if (!parseado) {
          fallidos += 1;
          continue;
        }

        // La misma huella que calcula el teléfono: MD5 de los bytes del archivo.
        const hash =
          (typeof fila.hash_bytes === "string" && fila.hash_bytes) ||
          createHash("md5").update(parseado.bytes).digest("hex");

        const url = await subirMediaAStorage(parseado.bytes, parseado.mime, fila.titulo || "respuesta-rapida", {
          carpeta: CARPETA_RESPUESTAS_RAPIDAS,
          hash,
        });

        if (!url) {
          // Sin Storage no se puede migrar, pero la huella ya calculada deja la
          // fila lista para deduplicarse igual cuando la subida se reintente.
          fallidos += 1;
          continue;
        }

        // Se escribe contenido (aunque no cambie) para que el trigger recalcule
        // la huella con la nueva fórmula.
        const { error: errorUpdate } = await supabaseAdmin
          .from("respuestas_rapidas")
          .update({ contenido: url, hash_bytes: hash })
          .eq("id", fila.id);

        if (errorUpdate && esDuplicadoDeIndice(errorUpdate)) {
          // Otra fila ya tiene ese mismo archivo publicado: se elimina ésta para
          // que la biblioteca siga teniendo una sola copia por contenido.
          const { error: errorBorrar } = await supabaseAdmin
            .from("respuestas_rapidas")
            .delete()
            .eq("id", fila.id);
          if (errorBorrar) {
            console.error("[migrar-rr] No se pudo eliminar el duplicado:", errorBorrar.message);
            fallidos += 1;
          } else {
            duplicados += 1;
          }
          continue;
        }
        if (errorUpdate) {
          fallidos += 1;
          console.error("[migrar-rr] No se pudo actualizar la fila:", errorUpdate.message);
          continue;
        }
        migrados += 1;
      }
    }
  } catch (e: any) {
    console.error("[migrar-rr] Error migrando:", e?.message || e);
    const pendientes = await contarPendientes();
    return NextResponse.json(
      { error: e?.message || "Error migrando las respuestas rápidas.", migrados, duplicados, fallidos, pendientes },
      { status: 500 }
    );
  }

  const pendientes = await contarPendientes();
  return NextResponse.json({
    ok: true,
    migrados,
    duplicados,
    fallidos,
    // Los fallidos siguen contando como pendientes; el cliente debe parar
    // cuando pendientes <= fallidos acumulados o cuando no haya avance.
    pendientes,
  });
}
