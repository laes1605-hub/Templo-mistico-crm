import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { CARPETA_RESPUESTAS_RAPIDAS, esDataUri, extensionPorMime, parsearDataUri } from "../../../../lib/media-format";
import { md5Hex } from "../../../../lib/md5";
import {
  esDuplicado,
  FilaRespuestaRapida,
  insertarFilaBiblioteca,
  listarFilasBiblioteca,
  pistaParaOperador,
} from "../../../../lib/respuestas-rapidas-fila";

export const dynamic = "force-dynamic";

/**
 * Publica en la biblioteca compartida las respuestas rápidas pendientes del
 * teléfono y devuelve la biblioteca completa.
 *
 * Dos cosas importantes desde el 21/09/2026:
 *  · `insertarFilaBiblioteca` calcula y envía `huella`, así que la inserción no
 *    depende de que el trigger `respuestas_rapidas_calcular_huella` siga vivo
 *    (una migración lo borraba y «Sincronizar» era imposible), y reintenta sin
 *    las columnas que falten si el Supabase no tiene la migración aplicada.
 *  · Los fallos por respuesta viajan en `errores` en vez de perderse: la app
 *    puede decir QUÉ respuesta no subió y POR QUÉ.
 */

const TIPOS_VALIDOS = ["texto", "audio", "imagen"];

function normalizarPendiente(valor: any): FilaRespuestaRapida | null {
  if (!valor || typeof valor !== "object") return null;
  const tipo = String(valor.tipo || "");
  if (!TIPOS_VALIDOS.includes(tipo)) return null;
  const contenido = typeof valor.contenido === "string" ? valor.contenido : "";
  if (!contenido) return null;
  const titulo = typeof valor.titulo === "string" ? valor.titulo : "";
  if (!titulo) return null;
  const fila: FilaRespuestaRapida = {
    tipo,
    titulo,
    contenido,
    creado_en: typeof valor.creado_en === "string" && valor.creado_en ? valor.creado_en : new Date().toISOString(),
    hash_bytes: typeof valor.hash === "string" && valor.hash ? valor.hash : undefined,
  };
  if (typeof valor.id === "string" && valor.id) fila.id = valor.id;
  return fila;
}

/**
 * Si el contenido es un data-URI, lo sube al bucket y deja la URL pública. El
 * hash de los bytes viaja en la fila para que la huella siga siendo la misma
 * aunque la URL cambie. Si la subida falla, se publica el base64 como plan B
 * (la migración de Ajustes lo pasa a Storage después).
 */
async function publicarContenido(fila: FilaRespuestaRapida): Promise<FilaRespuestaRapida> {
  if (!esDataUri(fila.contenido)) return fila;
  const parseado = parsearDataUri(fila.contenido);
  if (!parseado) return fila;

  const hash = fila.hash_bytes || md5Hex(parseado.bytes);
  const ext = extensionPorMime(parseado.mime);
  const path = `${CARPETA_RESPUESTAS_RAPIDAS}/${hash}.${ext}`;
  const { error } = await supabaseAdmin.storage.from("media-mensajes").upload(path, parseado.bytes, {
    contentType: parseado.mime,
    upsert: true,
  });
  if (error) return { ...fila, hash_bytes: hash };

  const { data: pub } = supabaseAdmin.storage.from("media-mensajes").getPublicUrl(path);
  return { ...fila, contenido: pub?.publicUrl || fila.contenido, hash_bytes: hash };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const crudas = Array.isArray(body?.pendientes) ? body.pendientes : [];
    const pendientes = crudas.map(normalizarPendiente).filter(Boolean) as FilaRespuestaRapida[];

    let subidas = 0;
    const errores: string[] = [];

    for (const pendiente of pendientes) {
      try {
        const fila = await publicarContenido(pendiente);
        const { error } = await insertarFilaBiblioteca(supabaseAdmin, fila);
        if (error) {
          // Un duplicado exacto es el resultado esperado cuando dos teléfonos
          // suben el mismo audio: la huella ya está en la biblioteca.
          if (esDuplicado(error)) continue;
          errores.push(`"${fila.titulo || fila.tipo}": ${error.message}`);
          continue;
        }
        subidas += 1;
      } catch (e: any) {
        errores.push(`"${pendiente.titulo || pendiente.tipo}": ${e?.message || "error desconocido"}`);
      }
    }

    const { filas, error } = await listarFilasBiblioteca(supabaseAdmin);
    if (error) {
      return NextResponse.json(
        { error: `${error.message}${pistaParaOperador(error)}`, respuestas: [], subidas, errores },
        { status: 500 }
      );
    }

    return NextResponse.json({ respuestas: filas, subidas, errores });
  } catch (e: any) {
    return NextResponse.json(
      { error: `${e?.message || "Error sincronizando"}${pistaParaOperador(e)}`, respuestas: [], subidas: 0, errores: [] },
      { status: 500 }
    );
  }
}
