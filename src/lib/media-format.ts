/**
 * Helpers de archivos adjuntos SIN dependencias de servidor: se pueden importar
 * tanto desde los route handlers como desde el código que corre en el teléfono
 * (respuestas rápidas), donde no existe `Buffer` ni la service role.
 *
 * La subida pesada de los adjuntos del chat sigue en `media-storage.ts`.
 */

/** Bucket público de solo-lectura donde viven los adjuntos (ver migración 20260916). */
export const BUCKET_MEDIA = "media-mensajes";
/** Carpeta dentro del bucket: adjuntos enviados por chat. */
export const CARPETA_MENSAJES = "mensajes";
/** Carpeta dentro del bucket: audios/imágenes de la biblioteca de respuestas rápidas. */
export const CARPETA_RESPUESTAS_RAPIDAS = "respuestas-rapidas";

const EXT_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/amr": "amr",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/x-ms-wma": "wma",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
  "video/ogg": "ogv",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/x-rar-compressed": "rar",
  "application/vnd.rar": "rar",
  "application/x-7z-compressed": "7z",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
};

/**
 * Extensión → MIME. Se deriva del mapa anterior pero SIN pisar la primera
 * coincidencia: ".ogg" tiene que resolver a `audio/ogg`, no a `audio/opus`,
 * porque el envío nativo de nota de voz sólo acepta `audio/ogg`; con otro MIME
 * la respuesta llegaría como archivo adjunto en vez de como nota de voz.
 */
const MIME_POR_EXT: Record<string, string> = {};
for (const [mime, ext] of Object.entries(EXT_POR_MIME)) {
  if (!MIME_POR_EXT[ext]) MIME_POR_EXT[ext] = mime;
}

export function extensionPorMime(mime: string): string {
  const limpio = (mime || "").split(";")[0].trim().toLowerCase();
  if (EXT_POR_MIME[limpio]) return EXT_POR_MIME[limpio];
  const sufijo = limpio.split("/")[1] || "";
  return /^[a-z0-9]{2,5}$/.test(sufijo) ? sufijo : "bin";
}

/** MIME a partir de una URL de Storage (o de cualquier URL con extensión). */
export function mimeDesdeUrl(url: string, porDefecto = "application/octet-stream"): string {
  const ext = extensionDesdeUrl(url, "");
  return (ext && MIME_POR_EXT[ext]) || porDefecto;
}

function extensionDesdeUrl(url: string, porDefecto: string): string {
  const sinQuery = String(url || "").split(/[?#]/)[0];
  const m = sinQuery.match(/\.([A-Za-z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : porDefecto;
}

/** Nombre de archivo legible para el adjunto (se usa al enviarlo por WhatsApp). */
export function nombreDesdeUrl(url: string, porDefecto: string): string {
  const limpio = String(url || "").split(/[?#]/)[0];
  const ultimo = decodeURIComponent(limpio.split("/").pop() || "");
  return /\.([A-Za-z0-9]{2,5})$/.test(ultimo) ? ultimo : porDefecto;
}

/** ¿La cadena es un data-URI base64 (archivo incrustado)? */
export function esDataUri(valor: unknown): valor is string {
  return typeof valor === "string" && valor.startsWith("data:");
}

/** ¿El contenido ya apunta a Supabase Storage en vez de traer el base64 dentro? */
export function esUrlDeStorage(valor: unknown): valor is string {
  return typeof valor === "string" && /^https?:\/\/[^/]+\/storage\/v1\/object\/public\//i.test(valor);
}

/** Ruta del objeto dentro del bucket a partir de su URL pública. */
export function rutaEnBucket(url: string, bucket: string = BUCKET_MEDIA): string | null {
  try {
    const u = new URL(url);
    const prefijo = `/storage/v1/object/public/${bucket}/`;
    if (!u.pathname.startsWith(prefijo)) return null;
    return decodeURIComponent(u.pathname.slice(prefijo.length));
  } catch {
    return null;
  }
}

function decodificarBase64(b64: string): Uint8Array | null {
  const limpio = b64.replace(/\s+/g, "");
  try {
    if (typeof atob === "function") {
      const bin = atob(limpio);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    // eslint-disable-next-line node/no-unsupported-features/node-builtins
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(limpio, "base64"));
  } catch {
    return null;
  }
  return null;
}

/** Separa un data-URI en mime + bytes. Devuelve null si no se puede parsear. */
export function parsearDataUri(dataUri: string): { mime: string; bytes: Uint8Array } | null {
  const coma = dataUri.indexOf(",");
  if (!dataUri.startsWith("data:") || coma < 0) return null;
  const cabecera = dataUri.slice(5, coma); // p. ej. "audio/ogg;base64"
  const mime = (cabecera.split(";")[0] || "application/octet-stream").trim().toLowerCase();
  if (!/base64/i.test(cabecera)) return null;
  const bytes = decodificarBase64(dataUri.slice(coma + 1));
  return bytes && bytes.length > 0 ? { mime, bytes } : null;
}

/** Convierte unos bytes en data-URI (plan B cuando no hay Storage disponible). */
export function bytesADataUri(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  if (typeof btoa === "function") return `data:${mime};base64,${btoa(bin)}`;
  // eslint-disable-next-line node/no-unsupported-features/node-builtins
  if (typeof Buffer !== "undefined") return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  return "";
}

export function limpiarNombreBase(nombre: string): string {
  const limpio = String(nombre || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return limpio.slice(0, 40) || "adjunto";
}

export interface OpcionesRuta {
  /** Carpeta dentro del bucket (por defecto la de los adjuntos del chat). */
  carpeta?: string;
  /** Nombre base legible; se ignora si hay `hash`. */
  nombreBase?: string;
  /**
   * Huella MD5 del contenido. Cuando viene, el nombre del objeto es el hash:
   * el mismo archivo subido desde dos teléfonos ocupan SIEMPRE la misma ruta,
   * así que no se crean copias duplicadas en el bucket.
   */
  hash?: string;
  /** Fecha para la carpeta AAAA-MM (por defecto, hoy). */
  fecha?: Date;
}

/** Ruta determinista y ordenada por mes dentro del bucket. */
export function rutaDeObjeto(mime: string, opciones: OpcionesRuta = {}): string {
  const ahora = opciones.fecha || new Date();
  const yyyy = ahora.getFullYear();
  const mm = String(ahora.getMonth() + 1).padStart(2, "0");
  const carpeta = opciones.carpeta || CARPETA_MENSAJES;
  const ext = extensionPorMime(mime);
  if (opciones.hash) {
    const hash = opciones.hash.replace(/[^a-f0-9]/gi, "").slice(0, 40);
    if (hash) return `${carpeta}/${yyyy}-${mm}/${hash}.${ext}`;
  }
  const unico = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${carpeta}/${yyyy}-${mm}/${unico}-${limpiarNombreBase(opciones.nombreBase || "adjunto")}.${ext}`;
}

export interface ClienteStorage {
  // El cliente de Supabase (anon del navegador o service role del servidor).
  storage: {
    from(bucket: string): {
      upload(path: string, body: Blob | Uint8Array | ArrayBuffer, options?: Record<string, unknown>): Promise<{ data: { path?: string } | null; error: any }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
      remove(paths: string[]): Promise<{ data: any; error: any }>;
    };
  };
}

/**
 * Sube bytes al bucket y devuelve la URL pública, o null si falló (quien llama
 * decide el plan B, normalmente conservar el base64 para no perder el archivo).
 */
export async function subirBytesAStorage(
  cliente: ClienteStorage,
  bytes: Uint8Array,
  mime: string,
  opciones: OpcionesRuta = {}
): Promise<string | null> {
  try {
    const ruta = rutaDeObjeto(mime, opciones);
    const contentType = mime.split(";")[0] || "application/octet-stream";
    const { error } = await cliente.storage.from(BUCKET_MEDIA).upload(ruta, bytes, {
      contentType,
      // Con hash como nombre, reintentar la misma respuesta rápida sobrescribe
      // el mismo objeto en vez de fallar por "ya existe" o dejar una copia.
      upsert: true,
    });
    if (error) {
      console.error("[media] No se pudo subir el adjunto:", error.message);
      return null;
    }
    const { data } = cliente.storage.from(BUCKET_MEDIA).getPublicUrl(ruta);
    return data?.publicUrl || null;
  } catch (e: any) {
    console.error("[media] Error subiendo adjunto:", e?.message || e);
    return null;
  }
}

/** Borra el objeto del bucket (solo si nadie más lo usa; lo decide quien llama). */
export async function borrarObjetoDelBucket(cliente: ClienteStorage, url: string): Promise<boolean> {
  const ruta = rutaEnBucket(url);
  if (!ruta) return false;
  try {
    const { error } = await cliente.storage.from(BUCKET_MEDIA).remove([ruta]);
    return !error;
  } catch {
    return false;
  }
}
