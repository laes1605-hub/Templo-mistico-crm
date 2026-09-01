/**
 * Respuestas rápidas: textos, audios (OGG) e imágenes.
 *
 * La tabla `respuestas_rapidas` es la biblioteca compartida. Cada dispositivo
 * conserva una copia local para poder preparar respuestas sin red, pero sólo
 * las respuestas marcadas como pendientes se publican cuando el operador pulsa
 * «Sincronizar con todos».
 *
 * Los binarios NO viajan dentro de la tabla: al publicarlos se suben al bucket
 * `media-mensajes` (carpeta `respuestas-rapidas/`) y en `contenido` queda la URL
 * pública. La biblioteca se descarga completa en cada sincronización y en cada
 * evento de realtime, así que incrustar base64 multiplicaba el Egress de la
 * misma forma que ya multiplicaba el de los chats (ver 20260916_media_storage).
 *
 * Como la URL no identifica el archivo, la huella de deduplicación se calcula
 * sobre los bytes (MD5 en `hash_bytes`, columna + trigger de la migración
 * 20260917). Así dos teléfonos que suben el mismo audio siguen siendo la misma
 * respuesta rápida aunque cada uno tenga una URL distinta, y un teléfono que
 * todavía tiene el base64 en caché reconoce la copia ya publicada en vez de
 * volver a insertarla.
 */
import { remuxWebmToOgg } from "./webm-to-ogg";
import { isWebmBytes } from "./audio-download";
import { supabase } from "./supabase";
import {
  CARPETA_RESPUESTAS_RAPIDAS,
  bytesADataUri,
  borrarObjetoDelBucket,
  esDataUri,
  esUrlDeStorage,
  extensionPorMime,
  mimeDesdeUrl,
  nombreDesdeUrl,
  parsearDataUri,
  subirBytesAStorage,
} from "./media-format";
import { md5Hex } from "./md5";

export type TipoRespuestaRapida = "texto" | "audio" | "imagen";

export interface RespuestaRapida {
  id: string;
  tipo: TipoRespuestaRapida;
  /** Título corto para identificarla en el menú. */
  titulo: string;
  /** Texto plano (tipo texto) o URL de Storage / data URI (tipo audio/imagen). */
  contenido: string;
  creado_en: string;
  /** false sólo mientras existe en este dispositivo y falta publicarla. */
  sincronizada?: boolean;
  /** MD5 de los bytes del audio/imagen. Es la clave real de deduplicación. */
  hash?: string;
}

export interface ResultadoSincronizacionRR {
  respuestas: RespuestaRapida[];
  subidas: number;
  pendientes: number;
  error?: string;
}

export interface AdjuntoParaEnviar {
  /** data-URI con el archivo (cuando todavía vive en este teléfono). */
  fileBase64: string | null;
  /** URL de Storage (el servidor la descarga; el teléfono no mueve megas). */
  fileUrl: string | null;
  fileMime: string;
  fileName: string;
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

const esBinaria = (respuesta: Pick<RespuestaRapida, "tipo">): boolean =>
  respuesta.tipo === "audio" || respuesta.tipo === "imagen";

function fechaRespuesta(valor: string): number {
  const fecha = new Date(valor).getTime();
  return Number.isFinite(fecha) ? fecha : 0;
}

/** Dos filas con el mismo tipo y el mismo archivo/texto son la misma respuesta,
 * aunque sus ids provengan de teléfonos distintos. Para los binarios se compara
 * la huella de los bytes (estable aunque uno tenga el base64 y otro la URL de
 * Storage); para el texto, el contenido completo. La base de datos protege
 * además con un índice único sobre (tipo, huella) para sincronizaciones
 * simultáneas. */
function claveContenido(respuesta: RespuestaRapida): string {
  const identificador = esBinaria(respuesta) && respuesta.hash ? respuesta.hash : respuesta.contenido;
  return `${respuesta.tipo}\u001f${identificador}`;
}

/**
 * Llaves que identifican una respuesta. Un archivo publicado en Storage se
 * reconoce por su huella, y además por su texto literal: así una fila antigua
 * que todavía trae el base64 dentro (sin `hash_bytes`) no vuelve a insertarse
 * ni se queda marcada como «pendiente» para siempre.
 */
function clavesDe(respuesta: RespuestaRapida): string[] {
  const claves = [`${respuesta.tipo}\u001f${respuesta.contenido}`];
  if (esBinaria(respuesta) && respuesta.hash) claves.push(`${respuesta.tipo}\u001f${respuesta.hash}`);
  return claves;
}

/** Añade la huella de los bytes a una respuesta binaria que aún no la trae
 * (cachés de versiones anteriores, o el data-URI recién preparado). */
function conHuella(respuesta: RespuestaRapida): RespuestaRapida {
  if (respuesta.hash || !esBinaria(respuesta) || !esDataUri(respuesta.contenido)) return respuesta;
  const parseado = parsearDataUri(respuesta.contenido);
  return parseado ? { ...respuesta, hash: md5Hex(parseado.bytes) } : respuesta;
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
    hash: typeof row.hash === "string" && row.hash ? row.hash : undefined,
  };
}

function filaARemota(row: any): RespuestaRapida | null {
  const respuesta = filaACache(row);
  if (!respuesta) return null;
  const hashDeFila = typeof row.hash_bytes === "string" && row.hash_bytes ? row.hash_bytes : undefined;
  return { ...respuesta, sincronizada: true, hash: hashDeFila ?? respuesta.hash };
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

/** Columnas de la biblioteca: `hash_bytes` sólo existe tras 20260917. */
const COLUMNAS_BASICAS = "id, tipo, titulo, contenido, creado_en";
const COLUMNAS_REMOTAS = `${COLUMNAS_BASICAS}, hash_bytes`;

/** Lee la biblioteca compartida. Si la migración 20260917 aún no está aplicada
 * la tabla no tiene `hash_bytes`: se vuelve a consultar sin esa columna para
 * no dejar la sincronización tirada. */
async function obtenerRemotas(): Promise<RespuestaRapida[]> {
  const { data, error } = await supabase.from("respuestas_rapidas").select(COLUMNAS_REMOTAS).order("creado_en", { ascending: true });
  if (!error) return deduplicarRespuestas((data || []).map(filaARemota).filter(Boolean) as RespuestaRapida[]);
  if (!esColumnaInexistente(error)) throw error;

  const { data: sinHash, error: error2 } = await supabase
    .from("respuestas_rapidas")
    .select(COLUMNAS_BASICAS)
    .order("creado_en", { ascending: true });
  if (error2) throw error2;
  return deduplicarRespuestas((sinHash || []).map(filaARemota).filter(Boolean) as RespuestaRapida[]);
}

/** Une la copia remota con las respuestas locales aún no publicadas. Una copia
 * remota siempre gana sobre una pendiente con el mismo archivo/texto. */
function combinarRemotasYPendientes(remotas: RespuestaRapida[], locales: RespuestaRapida[]): RespuestaRapida[] {
  const clavesRemotas = new Set(remotas.flatMap(clavesDe));
  const pendientes = locales
    .filter((respuesta) => respuesta.sincronizada !== true && !clavesDe(respuesta).some((clave) => clavesRemotas.has(clave)))
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

function esColumnaInexistente(error: any): boolean {
  const mensaje = String(error?.message || "").toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || (mensaje.includes("column") && mensaje.includes("does not exist"));
}

/**
 * Publica el binario en Storage y devuelve lo que hay que guardar en la tabla.
 *
 * El nombre del objeto es la huella del archivo, así que dos teléfonos que
 * suben el mismo audio escriben en la misma ruta: no se acumulan copias y la
 * URL que se guarda es idéntica en ambos. Si la subida falla se conserva el
 * data-URI (plan B): la respuesta no se pierde y la migración de Ajustes la
 * llevará a Storage más adelante.
 */
async function contenidoPublicado(item: RespuestaRapida): Promise<{ contenido: string; hash: string | null }> {
  if (!esBinaria(item) || !esDataUri(item.contenido)) {
    return { contenido: item.contenido, hash: item.hash ?? null };
  }
  const parseado = parsearDataUri(item.contenido);
  if (!parseado) return { contenido: item.contenido, hash: item.hash ?? null };

  const hash = item.hash || md5Hex(parseado.bytes);
  const url = await subirBytesAStorage(supabase, parseado.bytes, parseado.mime, {
    carpeta: CARPETA_RESPUESTAS_RAPIDAS,
    hash,
    nombreBase: item.titulo || "respuesta-rapida",
  });
  return { contenido: url || item.contenido, hash };
}

/**
 * Inserta una fila devolviendo el error sin lanzarlo. Si la tabla todavía no
 * tiene `hash_bytes` (no se aplicó 20260917) reintenta sin esa columna: la
 * respuesta se publica igual y la huella la calcula la base de datos sobre el
 * contenido, como hacía la versión anterior de la app.
 */
async function insertarFila(payload: Record<string, unknown>): Promise<{ data: any; error: any }> {
  const intento = await supabase
    .from("respuestas_rapidas")
    .insert(payload)
    .select(COLUMNAS_REMOTAS)
    .maybeSingle();
  if (!intento.error || !esColumnaInexistente(intento.error)) return { data: intento.data, error: intento.error };

  const { hash_bytes: _sinColumna, ...resto } = payload;
  const reintento = await supabase
    .from("respuestas_rapidas")
    .insert(resto)
    .select(COLUMNAS_BASICAS)
    .maybeSingle();
  return { data: reintento.data, error: reintento.error };
}

/**
 * Inserta una respuesta pendiente. Sólo se reintenta sin id si el id heredado
 * no era UUID; el código anterior reintentaba ante cualquier error y podía
 * insertar una segunda copia del mismo audio.
 */
async function insertarPendiente(item: RespuestaRapida): Promise<RespuestaRapida | null> {
  const { contenido, hash } = await contenidoPublicado(item);
  const base: Record<string, unknown> = {
    tipo: item.tipo,
    titulo: item.titulo,
    contenido,
    creado_en: item.creado_en,
  };
  if (hash) base.hash_bytes = hash;

  let { data, error } = await insertarFila({ ...base, id: item.id });

  if (error && esIdNoValido(error)) {
    // El id heredado del caché antiguo no era UUID: se deja que la base de
    // datos genere uno. La huella sigue siendo la misma, así que no se duplica.
    ({ data, error } = await insertarFila(base));
  }

  if (error) {
    // Otro teléfono publicó el mismo archivo mientras tanto.
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

  const clavesRemotas = new Set(remotas.flatMap(clavesDe));
  let subidas = 0;
  let errores = 0;

  for (const pendiente of locales.filter((respuesta) => respuesta.sincronizada !== true)) {
    if (clavesDe(pendiente).some((clave) => clavesRemotas.has(clave))) continue;

    try {
      const insertada = await insertarPendiente(pendiente);
      if (insertada) {
        remotas.push(insertada);
        for (const clave of clavesDe(insertada)) clavesRemotas.add(clave);
        for (const clave of clavesDe(pendiente)) clavesRemotas.add(clave);
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
  nueva: { tipo: TipoRespuestaRapida; titulo: string; contenido: string; hash?: string }
): Promise<RespuestaRapida> {
  const item = conHuella({
    id: uid(),
    tipo: nueva.tipo,
    titulo: nueva.titulo,
    contenido: nueva.contenido,
    creado_en: new Date().toISOString(),
    sincronizada: false,
    hash: nueva.hash,
  });

  const todas = cachearLocal([...listarRespuestasRapidas(), item]);
  return todas.find((respuesta) => claveContenido(respuesta) === claveContenido(item)) || item;
}

/** Suelta el objeto de Storage cuando ninguna otra respuesta rápida ni ningún
 * mensaje del chat lo están usando, para que borrar no deje basura. */
async function liberarAdjuntoSiHuerfano(url: string, idConservado: string): Promise<void> {
  try {
    const [{ count: otrasRespuestas, error: e1 }, { count: mensajesConUrl, error: e2 }] = await Promise.all([
      supabase
        .from("respuestas_rapidas")
        .select("id", { count: "exact", head: true })
        .eq("contenido", url)
        .neq("id", idConservado),
      supabase.from("mensajes").select("id", { count: "exact", head: true }).eq("url_archivo", url),
    ]);
    // Si no se pudo comprobar (RLS, red), se conserva el archivo: una respuesta
    // rápida sin audio es menos grave que un chat con el adjunto roto.
    if (e1 || e2) return;
    if ((otrasRespuestas ?? 0) > 0 || (mensajesConUrl ?? 0) > 0) return;
    await borrarObjetoDelBucket(supabase, url);
  } catch {
    // Borramos la respuesta igual; lo peor es un objeto huérfano en el bucket.
  }
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
    if (esUrlDeStorage(objetivo.contenido)) await liberarAdjuntoSiHuerfano(objetivo.contenido, id);
  }

  return cachearLocal(locales.filter((respuesta) => respuesta.id !== id));
}

// ---------------------------------------------------------------------------
// Consumo de la respuesta: cómo se envía a la conversación
// ---------------------------------------------------------------------------

/**
 * Prepara el archivo de una respuesta rápida para mandarla por WhatsApp.
 *
 * - Si el binario está en Storage se manda SOLO la URL: `/api/send-message` la
 *   baja dentro de la misma región de Supabase. El teléfono no descarga ni
 *   resube megabytes cada vez que usa la respuesta.
 * - Si todavía es un data-URI (respuesta pendiente en este teléfono) viaja
 *   incrustado, como siempre.
 */
export function adjuntoParaEnviar(rr: RespuestaRapida): AdjuntoParaEnviar | null {
  if (rr.tipo === "texto") return null;

  if (esDataUri(rr.contenido)) {
    const coma = rr.contenido.indexOf(",");
    const mime = (rr.contenido.slice(5, coma > 0 ? coma : undefined) || "").split(";")[0] || "application/octet-stream";
    if (rr.tipo === "audio") {
      // WhatsApp sólo acepta OGG/Opus como nota de voz: el audio ya se remuxó
      // al guardarlo, así que se conserva el contenedor que viene en el data-URI.
      const audioMime = mime.startsWith("audio/") ? mime : "audio/ogg";
      return {
        fileBase64: rr.contenido,
        fileUrl: null,
        fileMime: audioMime,
        fileName: nombreArchivoRR(rr, audioMime, "nota_de_voz"),
      };
    }
    const imgMime = mime.startsWith("image/") ? mime : "image/jpeg";
    return { fileBase64: rr.contenido, fileUrl: null, fileMime: imgMime, fileName: nombreArchivoRR(rr, imgMime, "respuesta-rapida") };
  }

  const mime = mimeDesdeUrl(rr.contenido, rr.tipo === "audio" ? "audio/ogg" : "image/jpeg");
  return {
    fileBase64: null,
    fileUrl: rr.contenido,
    fileMime: mime,
    fileName: nombreDesdeUrl(rr.contenido, nombreArchivoRR(rr, mime, "respuesta-rapida")),
  };
}

function nombreArchivoRR(rr: RespuestaRapida, mime: string, prefijo: string): string {
  const ext = extensionPorMime(mime);
  const sinExtension = (rr.titulo || prefijo).replace(/[^\w\sáéíóúñüÁÉÍÓÚÑ.-]/g, "").trim().replace(/\.[^.]+$/, "");
  return `${sinExtension || prefijo}.${ext}`;
}

// ---------------------------------------------------------------------------
// Preparación de los archivos para guardarlos en la respuesta rápida
// ---------------------------------------------------------------------------

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

  return { dataUri: bytesADataUri(out, mime), titulo, mime };
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
