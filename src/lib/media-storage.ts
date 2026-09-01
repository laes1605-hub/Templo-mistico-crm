import { supabaseAdmin } from "./supabase-admin";

/**
 * Subida de adjuntos del chat (notas de voz, imágenes, videos, documentos) a
 * Supabase Storage.
 *
 * Antes estos archivos se guardaban como data-URI base64 dentro de
 * `mensajes.url_archivo`, lo que multiplicaba el Egress: cada refetch del chat
 * y cada evento realtime volvía a transmitir los megabytes del adjunto. Con
 * Storage, en la tabla queda solo una URL corta y el archivo se descarga
 * únicamente cuando se reproduce/abre (y el navegador lo cachea).
 */

export const BUCKET_MEDIA = "media-mensajes";

const EXT_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

export function extensionPorMime(mime: string): string {
  const limpio = (mime || "").split(";")[0].trim().toLowerCase();
  if (EXT_POR_MIME[limpio]) return EXT_POR_MIME[limpio];
  const sufijo = limpio.split("/")[1] || "";
  return /^[a-z0-9]{2,5}$/.test(sufijo) ? sufijo : "bin";
}

/** ¿La cadena es un data-URI base64 (adjunto incrustado)? */
export function esDataUri(valor: unknown): valor is string {
  return typeof valor === "string" && valor.startsWith("data:");
}

/** Separa un data-URI en mime + bytes. Devuelve null si no se puede parsear. */
export function parsearDataUri(dataUri: string): { mime: string; bytes: Buffer } | null {
  const coma = dataUri.indexOf(",");
  if (!dataUri.startsWith("data:") || coma < 0) return null;
  const cabecera = dataUri.slice(5, coma); // p. ej. "audio/ogg;base64"
  const mime = (cabecera.split(";")[0] || "application/octet-stream").trim().toLowerCase();
  try {
    const bytes = Buffer.from(dataUri.slice(coma + 1), "base64");
    return bytes.length > 0 ? { mime, bytes } : null;
  } catch {
    return null;
  }
}

/**
 * Sube bytes al bucket y devuelve la URL pública, o null si falló (el llamador
 * decide el plan B, normalmente conservar el base64 para no perder el adjunto).
 */
export async function subirMediaAStorage(
  bytes: Buffer | Uint8Array,
  mime: string,
  nombreBase = "adjunto"
): Promise<string | null> {
  try {
    const ahora = new Date();
    const yyyy = ahora.getFullYear();
    const mm = String(ahora.getMonth() + 1).padStart(2, "0");
    const limpio = nombreBase.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "adjunto";
    const unico = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ruta = `mensajes/${yyyy}-${mm}/${unico}-${limpio}.${extensionPorMime(mime)}`;

    const { error } = await supabaseAdmin.storage
      .from(BUCKET_MEDIA)
      .upload(ruta, bytes, { contentType: mime.split(";")[0] || "application/octet-stream", upsert: false });
    if (error) {
      console.error("[media-storage] No se pudo subir el adjunto:", error.message);
      return null;
    }
    const { data } = supabaseAdmin.storage.from(BUCKET_MEDIA).getPublicUrl(ruta);
    return data?.publicUrl || null;
  } catch (e: any) {
    console.error("[media-storage] Error subiendo adjunto:", e?.message || e);
    return null;
  }
}

/**
 * Convierte un data-URI en URL de Storage. Si algo falla devuelve el data-URI
 * original para que el mensaje nunca pierda su adjunto.
 */
export async function dataUriAStorage(dataUri: string, nombreBase = "adjunto"): Promise<string> {
  const parseado = parsearDataUri(dataUri);
  if (!parseado) return dataUri;
  const url = await subirMediaAStorage(parseado.bytes, parseado.mime, nombreBase);
  return url || dataUri;
}
