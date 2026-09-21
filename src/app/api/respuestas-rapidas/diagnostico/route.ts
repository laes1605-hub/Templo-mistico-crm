import { NextResponse } from "next/server";
import { supabaseAdmin, usingServiceRole } from "../../../../lib/supabase-admin";
import {
  esColumnaInexistente,
  esFalloDeRed,
  listarFilasBiblioteca,
  SQL_MIGRACIONES_RR,
} from "../../../../lib/respuestas-rapidas-fila";

export const dynamic = "force-dynamic";

/**
 * Comprobación de la biblioteca compartida de respuestas rápidas.
 *
 * Existe porque «no me deja sincronizar» puede deberse a cuatro estados
 * distintos de la base (tabla que no existe, columnas sin migrar, políticas RLS
 * o bucket ausente) y desde el teléfono el error crudo de Postgres no dice cuál
 * es. Este endpoint es SÓLO LECTURA: informa qué falta y qué .sql correr.
 */
type Paso = { nombre: string; ok: boolean; detalle: string };

const PROBLEMAS: Record<string, string> = {
  tabla: "La tabla respuestas_rapidas no existe en este proyecto de Supabase.",
  huella: "Falta la columna huella (la biblioteca deduplica por ella).",
  hashBytes: "Falta la columna hash_bytes (huella del archivo, no de la URL).",
  bucket: "Falta el bucket media-mensajes en Supabase Storage.",
};

export async function GET() {
  const pasos: Paso[] = [];
  const problemas: string[] = [];
  const sql = new Set<string>();

  // 1) Tabla y columnas básicas.
  const biblioteca = await listarFilasBiblioteca(supabaseAdmin);
  const sinRed = esFalloDeRed(biblioteca.error);
  const tablaOk = !biblioteca.error;
  pasos.push({
    nombre: "Tabla respuestas_rapidas",
    ok: tablaOk,
    detalle: tablaOk
      ? `${biblioteca.filas.length} respuesta(s) en la biblioteca compartida`
      : sinRed
        ? "no se pudo consultar (sin conexión con Supabase)"
        : String(biblioteca.error?.message || "no se pudo leer"),
  });
  if (!tablaOk) {
    if (sinRed) {
      // No es un problema de esquema: el servidor no alcanzó Supabase. En la
      // APK y en la web desplegada esto no pasa; en un servidor sin salida a
      // internet (o con DNS bloqueado) sí.
      problemas.push("Este servidor no pudo conectarse con Supabase (red, DNS o bloqueo de salida).");
    } else {
      problemas.push(PROBLEMAS.tabla);
      sql.add(SQL_MIGRACIONES_RR.tabla);
      sql.add(SQL_MIGRACIONES_RR.todo);
    }
  }

  // 2) Columnas y bucket: sólo tienen sentido si la tabla se pudo leer.
  if (!tablaOk) {
    const motivo = sinRed ? "no comprobado (sin conexión con Supabase)" : "no comprobado (falta la tabla)";
    for (const nombre of ["Columna huella", "Columna hash_bytes", "Bucket media-mensajes"]) {
      pasos.push({ nombre, ok: false, detalle: motivo });
    }
  } else {
    const pruebaHuella = await supabaseAdmin.from("respuestas_rapidas").select("huella").limit(1);
    const huellaOk = !pruebaHuella.error;
    pasos.push({
      nombre: "Columna huella",
      ok: huellaOk,
      detalle: huellaOk ? "presente" : String(pruebaHuella.error?.message || "ausente"),
    });
    if (!huellaOk) {
      problemas.push(PROBLEMAS.huella);
      sql.add(SQL_MIGRACIONES_RR.huella);
    }

    const pruebaHash = await supabaseAdmin.from("respuestas_rapidas").select("hash_bytes").limit(1);
    const hashOk = !pruebaHash.error;
    pasos.push({
      nombre: "Columna hash_bytes",
      ok: hashOk,
      detalle: hashOk ? "presente" : String(pruebaHash.error?.message || "ausente"),
    });
    if (!hashOk) {
      problemas.push(PROBLEMAS.hashBytes);
      sql.add(SQL_MIGRACIONES_RR.hashBytes);
    }

    const pruebaBucket = await supabaseAdmin.storage.from("media-mensajes").list("respuestas-rapidas", { limit: 1 });
    const bucketOk = !(pruebaBucket as any).error;
    pasos.push({
      nombre: "Bucket media-mensajes",
      ok: bucketOk,
      detalle: bucketOk ? "accesible" : String((pruebaBucket as any).error?.message || "no accesible"),
    });
    if (!bucketOk) {
      problemas.push(PROBLEMAS.bucket);
      sql.add("supabase/migrations/20260916000001_media_storage.sql");
    }
  }

  // 5) Binarios que todavía viajan en base64 dentro de la tabla.
  let pendientesBase64: number | null = null;
  if (tablaOk) {
    const { count, error } = await supabaseAdmin
      .from("respuestas_rapidas")
      .select("id", { count: "exact", head: true })
      .in("tipo", ["audio", "imagen"])
      .like("contenido", "data:%");
    if (!error) pendientesBase64 = count ?? 0;
  }

  // 6) Con qué credencial se escribe (la service role evita sorpresas de RLS).
  pasos.push({
    nombre: "Credencial del servidor",
    ok: usingServiceRole,
    detalle: usingServiceRole
      ? "service role (sin límites de RLS)"
      : "anon key (depende de las políticas públicas de la tabla)",
  });

  // La huella la calcula la app desde el 21/09/2026, así que un trigger ausente
  // ya no impide sincronizar; aun así se recuerda que hay que reponerlo por los
  // otros cinco triggers que borraba la misma migración.
  const problemaDeEsquema = problemas.some((problema) => problema !== "Este servidor no pudo conectarse con Supabase (red, DNS o bloqueo de salida).");
  if (!problemas.length) sql.add(SQL_MIGRACIONES_RR.triggers);
  if (problemaDeEsquema) sql.add(SQL_MIGRACIONES_RR.todo);

  return NextResponse.json({
    ok: problemas.length === 0,
    total: biblioteca.filas.length,
    pendientesBase64,
    problemas,
    sql: Array.from(sql),
    pasos,
    columnaRechazada: esColumnaInexistente(biblioteca.error) ? String(biblioteca.error?.message || "") : undefined,
  });
}
