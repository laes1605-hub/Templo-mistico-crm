/**
 * Escritura en `respuestas_rapidas` a prueba de esquemas a medio migrar.
 *
 * Contexto (19–21/09/2026): la migración «fix_migraciones_duplicadas» borró el
 * trigger `respuestas_rapidas_calcular_huella` y no lo volvió a crear. Como
 * `respuestas_rapidas.huella` es NOT NULL, TODA inserción fallaba con
 * «null value in column "huella" … violates not-null constraint» y el botón
 * «Sincronizar» de la biblioteca compartida quedaba inutilizable. Lo mismo
 * pasaba si el teléfono hablaba con un Supabase al que le faltaba alguna
 * columna (`hash_bytes`) o la tabla entera.
 *
 * Este módulo centraliza la escritura para que la app NO dependa de ese
 * trigger: calcula la huella en el cliente/servidor con la MISMA fórmula que
 * usa Postgres —
 *
 *   md5(tipo || chr(31) || coalesce(hash_bytes, contenido))
 *
 * — y, si el esquema no tiene alguna columna opcional, la descarta y reintenta
 * en vez de fallar. Postgres recalcula la huella de todos modos cuando el
 * trigger existe: el valor enviado se sobrescribe con exactamente el mismo.
 */
import { md5Hex } from "./md5";

export const COLUMNAS_BASICAS_RR = "id, tipo, titulo, contenido, creado_en";
export const COLUMNAS_REMOTAS_RR = `${COLUMNAS_BASICAS_RR}, hash_bytes`;

/** Separador chr(31) (unit separator) que usa la migración SQL. */
const SEPARADOR = "\u001f";

/** Columnas que se pueden sacrificar si la base todavía no tiene la migración. */
const COLUMNAS_DESCARTABLES = ["hash_bytes", "huella"];

/** Rutas .sql que se le sugieren al operador según lo que falte. */
export const SQL_MIGRACIONES_RR = {
  tabla: "supabase/migrations/20260913000001_respuestas_rapidas.sql",
  huella: "supabase/migrations/20260915000001_sincronizacion_respuestas_rapidas_unica.sql",
  hashBytes: "supabase/migrations/20260917000001_respuestas_rapidas_a_storage.sql",
  triggers: "supabase/migrations/20260922000001_restaurar_triggers_perdidos.sql",
  todo: "MIGRAR-A-NUEVO-SUPABASE.sql",
} as const;

export interface FilaRespuestaRapida {
  id?: string;
  tipo: string;
  titulo: string;
  contenido: string;
  creado_en: string;
  hash_bytes?: string | null;
  huella?: string;
}

/**
 * Cliente de Supabase en su forma mínima: sirve tanto la anon key del teléfono
 * como la service role del servidor.
 */
export interface ClienteRespuestasRapidas {
  from(tabla: string): any;
}

/**
 * md5(tipo + chr(31) + (hash de los bytes || contenido)) — exactamente la
 * huella que calcula `calcular_huella_respuesta_rapida()` en Postgres.
 *
 * Se codifica en UTF-8 antes del MD5 porque `md5()` de Postgres trabaja sobre
 * los bytes del texto, no sobre los code units de JavaScript (una tilde ocupa
 * dos bytes en la base y uno en JS: sin esto la huella no coincidiría).
 */
export function huellaDeRespuestaRapida(tipo: string, contenido: string, hash?: string | null): string {
  const base = typeof hash === "string" && hash.length > 0 ? hash : contenido;
  return md5Hex(new TextEncoder().encode(`${tipo}${SEPARADOR}${base}`));
}

/** Payload listo para PostgREST: sin columnas vacías y con la huella puesta. */
export function filaConHuella(fila: FilaRespuestaRapida): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(fila)) {
    if (valor === undefined) continue;
    if (clave === "hash_bytes" && (valor === null || valor === "")) continue;
    payload[clave] = valor;
  }
  if (!payload.huella) {
    payload.huella = huellaDeRespuestaRapida(fila.tipo, fila.contenido, fila.hash_bytes);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Clasificación de errores de PostgREST / Postgres
// ---------------------------------------------------------------------------

function mensaje(error: any): string {
  return String(error?.message || error || "").toLowerCase();
}

/** 42703 / PGRST204: el esquema no tiene esa columna (migración sin aplicar). */
export function esColumnaInexistente(error: any): boolean {
  const texto = mensaje(error);
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    (texto.includes("column") && texto.includes("does not exist")) ||
    (texto.includes("could not find") && texto.includes("column"))
  );
}

/** 42P01 / PGRST205: la tabla todavía no existe en el proyecto de Supabase. */
export function esTablaInexistente(error: any): boolean {
  const texto = mensaje(error);
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    (texto.includes("relation") && texto.includes("does not exist")) ||
    (texto.includes("could not find the table") && texto.includes("schema cache"))
  );
}

/** 42501 / RLS: falta la política pública de la tabla. */
export function esPermisoDenegado(error: any): boolean {
  const texto = mensaje(error);
  return error?.code === "42501" || texto.includes("permission denied") || texto.includes("row-level security");
}

/** 22P02: el id local no es un UUID y Postgres no lo acepta. */
export function esIdNoValido(error: any): boolean {
  const texto = mensaje(error);
  return error?.code === "22P02" || (texto.includes("uuid") && texto.includes("invalid"));
}

/** 23505: ya hay otra fila con el mismo tipo y huella (duplicado exacto). */
export function esDuplicado(error: any): boolean {
  const texto = mensaje(error);
  return error?.code === "23505" || texto.includes("duplicate key") || texto.includes("duplicate");
}

/** El servidor no consiguió hablar con Supabase (DNS, red o bloqueo). */
export function esFalloDeRed(error: any): boolean {
  const texto = mensaje(error);
  return (
    texto.includes("fetch failed") ||
    texto.includes("enotfound") ||
    texto.includes("econnrefused") ||
    texto.includes("etimedout") ||
    texto.includes("network") ||
    texto.includes("socket hang up")
  );
}

/** El bucket de Storage no existe o la subida está bloqueada por políticas. */
export function esBucketInexistente(error: any): boolean {
  const texto = mensaje(error);
  return texto.includes("bucket not found") || texto.includes("bucket") && texto.includes("not found");
}

/** Nombre de la columna que PostgREST dice que no encuentra, si lo nombra. */
export function columnaQueFalta(error: any): string | null {
  if (!esColumnaInexistente(error)) return null;
  const texto = String(error?.message || "");
  const conComillas = texto.match(/['"`]([a-z_][a-z0-9_]*)['"`]/i);
  if (conComillas) return conComillas[1];
  const suelta = texto.match(/column\s+([a-z_][a-z0-9_]*)/i);
  return suelta ? suelta[1] : null;
}

function primerDescartable(payload: Record<string, unknown>): string | null {
  return COLUMNAS_DESCARTABLES.find((columna) => columna in payload) ?? null;
}

// ---------------------------------------------------------------------------
// Lectura y escritura tolerantes
// ---------------------------------------------------------------------------

export interface ResultadoLecturaBiblioteca {
  filas: any[];
  error: any;
}

/** Biblioteca ordenada por fecha; si falta `hash_bytes`, se relee sin ella. */
export async function listarFilasBiblioteca(cliente: ClienteRespuestasRapidas): Promise<ResultadoLecturaBiblioteca> {
  const intento = await cliente
    .from("respuestas_rapidas")
    .select(COLUMNAS_REMOTAS_RR)
    .order("creado_en", { ascending: true });
  if (!intento.error) return { filas: intento.data || [], error: null };
  if (!esColumnaInexistente(intento.error)) return { filas: [], error: intento.error };

  const reintento = await cliente
    .from("respuestas_rapidas")
    .select(COLUMNAS_BASICAS_RR)
    .order("creado_en", { ascending: true });
  if (reintento.error) return { filas: [], error: reintento.error };
  return { filas: reintento.data || [], error: null };
}

export interface ResultadoEscritura {
  data: any;
  error: any;
  /** Columnas que se dejaron de enviar porque la base todavía no las tiene. */
  columnasOmitidas: string[];
}

/**
 * Inserta una respuesta rápida y, si el esquema no tiene `huella`/`hash_bytes`
 * (o el id local no es UUID), reintenta sin esa columna en vez de devolver el
 * error al operador. Así «Sincronizar» funciona con la base tal como esté hoy.
 */
export async function insertarFilaBiblioteca(
  cliente: ClienteRespuestasRapidas,
  fila: FilaRespuestaRapida,
  columnas: string = COLUMNAS_REMOTAS_RR
): Promise<ResultadoEscritura> {
  const payload = filaConHuella(fila);
  const columnasOmitidas: string[] = [];
  let seleccion = columnas;

  for (let intento = 0; intento < 5; intento++) {
    const { data, error } = await cliente
      .from("respuestas_rapidas")
      .insert(payload)
      .select(seleccion)
      .maybeSingle();

    if (!error) return { data: data ?? null, error: null, columnasOmitidas };

    const nombrada = columnaQueFalta(error);
    if (nombrada && nombrada in payload) {
      delete payload[nombrada];
      columnasOmitidas.push(nombrada);
      if (nombrada === "hash_bytes") seleccion = COLUMNAS_BASICAS_RR;
      continue;
    }
    // PostgREST viejo puede no decir el nombre: se cae la primera opcional.
    const generica = esColumnaInexistente(error) ? primerDescartable(payload) : null;
    if (generica) {
      delete payload[generica];
      columnasOmitidas.push(generica);
      if (generica === "hash_bytes") seleccion = COLUMNAS_BASICAS_RR;
      continue;
    }
    // La columna que falta puede ser sólo la del SELECT (p. ej. hash_bytes).
    if (nombrada === "hash_bytes" || (esColumnaInexistente(error) && seleccion === COLUMNAS_REMOTAS_RR)) {
      seleccion = COLUMNAS_BASICAS_RR;
      if (!columnasOmitidas.includes("hash_bytes")) columnasOmitidas.push("hash_bytes");
      continue;
    }
    if (payload.id !== undefined && esIdNoValido(error)) {
      delete payload.id;
      continue;
    }
    return { data: null, error, columnasOmitidas };
  }

  return {
    data: null,
    error: { message: "No se pudo insertar la respuesta rápida (el esquema de la base rechaza las columnas)." },
    columnasOmitidas,
  };
}

/** Actualiza una fila recalculando la huella con la misma fórmula. */
export async function actualizarFilaBiblioteca(
  cliente: ClienteRespuestasRapidas,
  id: string,
  cambios: Partial<FilaRespuestaRapida> & { tipo: string; contenido: string }
): Promise<ResultadoEscritura> {
  const payload = filaConHuella(cambios as FilaRespuestaRapida);
  const columnasOmitidas: string[] = [];

  for (let intento = 0; intento < 4; intento++) {
    const { error } = await cliente.from("respuestas_rapidas").update(payload).eq("id", id);
    if (!error) return { data: { id }, error: null, columnasOmitidas };
    const nombrada = columnaQueFalta(error);
    const columna = nombrada && nombrada in payload ? nombrada : esColumnaInexistente(error) ? primerDescartable(payload) : null;
    if (!columna) return { data: null, error, columnasOmitidas };
    delete payload[columna];
    columnasOmitidas.push(columna);
  }

  return {
    data: null,
    error: { message: "No se pudo actualizar la respuesta rápida (columnas desconocidas en la base)." },
    columnasOmitidas,
  };
}

// ---------------------------------------------------------------------------
// Traducción del error a algo que el operador pueda accionar
// ---------------------------------------------------------------------------

/**
 * Devuelve una frase corta con QUÉ hacer, para pegar al final del aviso de la
 * app. El caso típico es la huella NOT NULL sin trigger, pero también cubre la
 * tabla que falta (proyecto nuevo de Supabase) y las políticas RLS.
 */
export function pistaParaOperador(error: unknown): string {
  const texto = typeof error === "string" ? error.toLowerCase() : mensaje(error);

  if (!texto) return " Intenta sincronizar de nuevo.";
  if (esFalloDeRed(error)) {
    return " No hubo conexión con Supabase: revisa la red del teléfono o del servidor y vuelve a intentar.";
  }
  // Si el mensaje ya trae la ruta del .sql que hay que correr, no se repite.
  if (texto.includes("supabase/migrations/") || texto.includes("migrar-a-nuevo-supabase.sql")) return "";
  if (texto.includes("huella") && (texto.includes("not-null") || texto.includes("null value"))) {
    return ` Falta el trigger que calcula la huella en Supabase: corre ${SQL_MIGRACIONES_RR.triggers} y vuelve a sincronizar.`;
  }
  if (esTablaInexistente(error)) {
    return ` La tabla respuestas_rapidas no existe en este Supabase: corre ${SQL_MIGRACIONES_RR.tabla} (o ${SQL_MIGRACIONES_RR.todo}) y vuelve a sincronizar.`;
  }
  if (esPermisoDenegado(error)) {
    return ` Supabase no autorizó la escritura: revisa las políticas de la tabla (${SQL_MIGRACIONES_RR.tabla}).`;
  }
  if (esColumnaInexistente(error) && texto.includes("hash_bytes")) {
    return ` A este Supabase le falta la columna hash_bytes: corre ${SQL_MIGRACIONES_RR.hashBytes}.`;
  }
  if (esBucketInexistente(error)) {
    return " Falta el bucket media-mensajes en Supabase Storage: corre 20260916000001_media_storage.sql.";
  }
  return " Intenta sincronizar de nuevo.";
}
