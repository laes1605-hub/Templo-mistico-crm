/**
 * Respuestas rápidas: textos, audios (OGG) e imágenes.
 *
 * La tabla `respuestas_rapidas` es la biblioteca compartida. Cada dispositivo
 * conserva una copia local para poder preparar respuestas sin red, pero sólo
 * las respuestas marcadas como pendientes se publican cuando el operador pulsa
 * «Sincronizar con todos».
 */
import { remuxWebmToOgg } from "./webm-to-ogg";
import { isWebmBytes } from "./audio-download";
import { supabase } from "./supabase";

export type TipoRespuestaRapida = "texto" | "audio" | "imagen";

export interface RespuestaRapida {
  id: string;
  tipo: TipoRespuestaRapida;
  /** Título corto para identificarla en el menú. */
  titulo: string;
  /** Texto plano (tipo texto) o data URI (tipo audio/imagen). */
  contenido: string;
  creado_en: string;
  /** false sólo mientras existe en este dispositivo y falta publicarla. */
  sincronizada?: boolean;
}

export interface ResultadoSincronizacionRR {
  respuestas: RespuestaRapida[];
  subidas: number;
  pendientes: number;
  error?: string;
}

const STORAGE_KEY = "templo-crm:respuestas-rapidas:v1";
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_IMG_DIRECTA = 2 * 1024 * 1024;

function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `rr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function esTipoRespuesta(valor: unknown): valor is TipoRespuestaRapida {
  return valor === "texto" || valor === "audio" || valor === "imagen";
}

function fechaRespuesta(valor: string): number {
  const fecha = new Date(valor).getTime();
  return Number.isFinite(fecha) ? fecha : 0;
}

/** Dos filas con el mismo tipo y contenido son la misma respuesta, aunque sus
 * ids provengan de teléfonos distintos. El contenido no se hashea aquí para
 * evitar colisiones: se compara completo; la migración crea además una huella
 * MD5 y un índice único en la base de datos para proteger sincronizaciones
 * simultáneas. */
function claveContenido(respuesta: Pick<RespuestaRapida, "tipo" | "contenido">): string {
  return `${respuesta.tipo}\u001f${respuesta.contenido}`;
}

function ordenarRespuestas(todas: RespuestaRapida[]): RespuestaRapida[] {
  return [...todas].sort((a, b) => {
    const diferencia = fechaRespuesta(a.creado_en) - fechaRespuesta(b.creado_en);
    return diferencia || a.id.localeCompare(b.id);
  });
}

/** Conserva una sola copia de contenido idéntico. Se prefiere la copia que ya
 * está en la nube y, entre las equivalentes, la más antigua. */
function deduplicarRespuestas(todas: RespuestaRapida[]): RespuestaRapida[] {
  const porContenido = new Map<string, RespuestaRapida>();
  for (const respuesta of todas) {
    const clave = claveContenido(respuesta);
    const actual = porContenido.get(clave);
    if (!actual) {
      porContenido.set(clave, respuesta);
      continue;
    }

    const preferirNueva =
      (respuesta.sincronizada === true && actual.sincronizada !== true) ||
      (respuesta.sincronizada === actual.sincronizada &&
        (fechaRespuesta(respuesta.creado_en) < fechaRespuesta(actual.creado_en) ||
          (fechaRespuesta(respuesta.creado_en) === fechaRespuesta(actual.creado_en) && respuesta.id < actual.id)));
    if (preferirNueva) porContenido.set(clave, respuesta);
  }
  return ordenarRespuestas(Array.from(porContenido.values()));
}

function cachearLocal(todas: RespuestaRapida[]): RespuestaRapida[] {
  const unicas = deduplicarRespuestas(todas);
  if (typeof window === "undefined") return unicas;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(unicas));
  } catch {
    // Caché opcional: si el teléfono no tiene espacio, igual viven en la nube.
  }
  return unicas;
}

function filaACache(row: any): RespuestaRapida | null {
  if (!row || !row.id || !esTipoRespuesta(row.tipo) || typeof row.contenido !== "string" || !row.contenido) return null;
  return {
    id: String(row.id),
    tipo: row.tipo,
    titulo: String(row.titulo || ""),
    contenido: row.contenido,
    creado_en: typeof row.creado_en === "string" ? row.creado_en : new Date().toISOString(),
    // Los cachés anteriores no tienen este campo: se consideran pendientes
    // hasta que se comparen con la biblioteca remota.
    sincronizada: row.sincronizada === true,
  };
}

function filaARemota(row: any): RespuestaRapida | null {
  const respuesta = filaACache(row);
  return respuesta ? { ...respuesta, sincronizada: true } : null;
}

export function listarRespuestasRapidas(): RespuestaRapida[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return deduplicarRespuestas(arr.map(filaACache).filter(Boolean) as RespuestaRapida[]);
  } catch {
    return [];
  }
}

async function obtenerRemotas(): Promise<RespuestaRapida[]> {
  const { data, error } = await supabase
    .from("respuestas_rapidas")
    .select("id, tipo, titulo, contenido, creado_en")
    .order("creado_en", { ascending: true });
  if (error) throw error;
  return deduplicarRespuestas((data || []).map(filaARemota).filter(Boolean) as RespuestaRapida[]);
}

/** Une la copia remota con las respuestas locales aún no publicadas. Una copia
 * remota siempre gana sobre una pendiente con el mismo archivo/texto. */
function combinarRemotasYPendientes(remotas: RespuestaRapida[], locales: RespuestaRapida[]): RespuestaRapida[] {
  const clavesRemotas = new Set(remotas.map(claveContenido));
  const pendientes = locales
    .filter((respuesta) => respuesta.sincronizada !== true && !clavesRemotas.has(claveContenido(respuesta)))
    .map((respuesta) => ({ ...respuesta, sincronizada: false }));
  return deduplicarRespuestas([...remotas.map((respuesta) => ({ ...respuesta, sincronizada: true })), ...pendientes]);
}

/** Descarga la biblioteca compartida sin publicar automáticamente respuestas
 * antiguas del teléfono. Así abrir la app no vuelve a crear duplicados. */
export async function actualizarRespuestasRapidas(): Promise<RespuestaRapida[]> {
  const locales = listarRespuestasRapidas();
  try {
    const remotas = await obtenerRemotas();
    return cachearLocal(combinarRemotasYPendientes(remotas, locales));
  } catch {
    return cachearLocal(locales);
  }
}

function esIdNoValido(error: any): boolean {
  const mensaje = String(error?.message || "").toLowerCase();
  return error?.code === "22P02" || (mensaje.includes("uuid") && mensaje.includes("invalid"));
}

function esDuplicado(error: any): boolean {
  const mensaje = String(error?.message || "").toLowerCase();
  return error?.code === "23505" || mensaje.includes("duplicate key") || mensaje.includes("duplicate");
}

/** Inserta una respuesta pendiente. Sólo se reintenta sin id si el id heredado
 * no era UUID; el código anterior reintentaba ante cualquier error y podía
 * insertar una segunda copia del mismo audio. */
async function insertarPendiente(item: RespuestaRapida): Promise<RespuestaRapida | null> {
  const payload = {
    id: item.id,
    tipo: item.tipo,
    titulo: item.titulo,
    contenido: item.contenido,
    creado_en: item.creado_en,
  };
  let { data, error } = await supabase
    .from("respuestas_rapidas")
    .insert(payload)
    .select("id, tipo, titulo, contenido, creado_en")
    .maybeSingle();

  if (error && esIdNoValido(error)) {
    ({ data, error } = await supabase
      .from("respuestas_rapidas")
      .insert({
        tipo: item.tipo,
        titulo: item.titulo,
        contenido: item.contenido,
        creado_en: item.creado_en,
      })
      .select("id, tipo, titulo, contenido, creado_en")
      .maybeSingle());
  }

  if (error) {
    if (esDuplicado(error)) return null;
    throw error;
  }
  return filaARemota(data);
}

/**
 * Publica las respuestas pendientes de este teléfono y descarga después la
 * biblioteca única de Supabase. Es la acción que debe ejecutar el botón
 * «Sincronizar con todos».
 */
export async function sincronizarRespuestasRapidas(): Promise<ResultadoSincronizacionRR> {
  const locales = listarRespuestasRapidas();
  let remotas: RespuestaRapida[];
  try {
    remotas = await obtenerRemotas();
  } catch (error: any) {
    const respuestas = cachearLocal(locales);
    return {
      respuestas,
      subidas: 0,
      pendientes: respuestas.filter((respuesta) => respuesta.sincronizada !== true).length,
      error: error?.message || "No se pudo conectar con la biblioteca compartida.",
    };
  }

  const clavesRemotas = new Set(remotas.map(claveContenido));
  let subidas = 0;
  let errores = 0;

  for (const pendiente of locales.filter((respuesta) => respuesta.sincronizada !== true)) {
    const clave = claveContenido(pendiente);
    if (clavesRemotas.has(clave)) continue;

    try {
      const insertada = await insertarPendiente(pendiente);
      if (insertada) {
        remotas.push(insertada);
        clavesRemotas.add(clave);
        subidas += 1;
      }
      // Si otro teléfono la insertó al mismo tiempo, la recarga final la toma.
    } catch {
      errores += 1;
    }
  }

  // Vuelve a consultar para absorber inserciones simultáneas y que el índice
  // único de la base de datos elija la copia canónica si hubo una carrera.
  try {
    remotas = await obtenerRemotas();
  } catch {
    // Conservamos las inserciones que sí confirmó este dispositivo; las demás
    // siguen pendientes y se podrán reintentar con el siguiente botón.
  }

  const respuestas = cachearLocal(combinarRemotasYPendientes(remotas, locales));
  const pendientes = respuestas.filter((respuesta) => respuesta.sincronizada !== true).length;
  return {
    respuestas,
    subidas,
    pendientes,
    error: errores > 0 ? "Algunas respuestas no se pudieron subir. Intenta sincronizar de nuevo." : undefined,
  };
}

/** Guarda una respuesta nueva sólo en este dispositivo hasta que se pulse
 * Sincronizar con todos. Esto hace explícito qué se comparte y evita subidas
 * repetidas al abrir la app. */
export async function guardarRespuestaRapida(
  nueva: { tipo: TipoRespuestaRapida; titulo: string; contenido: string }
): Promise<RespuestaRapida> {
  const item: RespuestaRapida = {
    id: uid(),
    tipo: nueva.tipo,
    titulo: nueva.titulo,
    contenido: nueva.contenido,
    creado_en: new Date().toISOString(),
    sincronizada: false,
  };

  const todas = cachearLocal([...listarRespuestasRapidas(), item]);
  return todas.find((respuesta) => claveContenido(respuesta) === claveContenido(item)) || item;
}

/** Borra localmente una respuesta pendiente o de la biblioteca compartida si
 * ya estaba publicada. No oculta un borrado remoto que haya fallado. */
export async function eliminarRespuestaRapida(id: string): Promise<RespuestaRapida[]> {
  const locales = listarRespuestasRapidas();
  const objetivo = locales.find((respuesta) => respuesta.id === id);
  if (!objetivo) return locales;

  if (objetivo.sincronizada === true) {
    const { error } = await supabase.from("respuestas_rapidas").delete().eq("id", id);
    if (error) throw new Error(error.message || "No se pudo borrar la respuesta compartida.");
  }

  return cachearLocal(locales.filter((respuesta) => respuesta.id !== id));
}

// ---------------------------------------------------------------------------
// Preparación de los archivos para guardarlos en la respuesta rápida
// ---------------------------------------------------------------------------

function bytesABase64(u8: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...Array.from(u8.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

const nombreBase = (file: File, fallback: string): string =>
  file.name.replace(/\.[^.]+$/, "").replace(/[^\w\sáéíóúñüÁÉÍÓÚÑ-]/g, "").trim().slice(0, 50) || fallback;

const leerComoDataUri = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });

/**
 * Audio → data URI listo para guardar. Los WebM se remuevan a OGG/Opus
 * (sin recodificar, sin pérdida); el resto se conserva en su formato.
 */
export async function prepararAudioRR(file: File): Promise<{ dataUri: string; titulo: string; mime: string }> {
  const esAudio =
    (file.type || "").startsWith("audio/") || /\.(ogg|opus|webm|mp3|wav|m4a|aac)$/i.test(file.name);
  if (!esAudio) throw new Error("Selecciona un archivo de audio.");
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("El audio supera 6 MB: recórtalo a una nota más corta y vuelve a intentarlo.");
  }

  const titulo = nombreBase(file, "nota-de-voz");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let out: Uint8Array = bytes;
  let mime = file.type && file.type.startsWith("audio/") ? file.type : "audio/ogg";

  if (isWebmBytes(bytes)) {
    try {
      out = remuxWebmToOgg(bytes, { prerollMs: 0 });
      mime = "audio/ogg";
    } catch {
      // Si no se pudo parsear el WebM, se guarda el archivo original.
    }
  }

  return { dataUri: `data:${mime};base64,${bytesABase64(out)}`, titulo, mime };
}

/**
 * Imagen → data URI lista para guardar. Las grandes (o GIF) se reducen a
 * ~1024px JPEG para no agotar el almacenamiento.
 */
export async function prepararImagenRR(file: File): Promise<{ dataUri: string; titulo: string }> {
  if (!(file.type || "").startsWith("image/")) throw new Error("Selecciona un archivo de imagen.");
  const titulo = nombreBase(file, "respuesta-rapida");

  if (file.size <= MAX_IMG_DIRECTA && file.type !== "image/gif") {
    return { dataUri: await leerComoDataUri(file), titulo };
  }

  const dataUri = await leerComoDataUri(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("No se pudo procesar la imagen."));
    el.src = dataUri;
  });
  const escala = Math.min(1, 1024 / Math.max(img.width || 1, img.height || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((img.width || 1) * escala));
  canvas.height = Math.max(1, Math.round((img.height || 1) * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo reducir la imagen (canvas no disponible).");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUri: canvas.toDataURL("image/jpeg", 0.82), titulo };
}
