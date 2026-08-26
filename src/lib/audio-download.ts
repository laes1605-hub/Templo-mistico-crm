/**
 * Guardado de las notas de voz del chat (botón "Guardar audios").
 *
 * Convierte el audio de un mensaje (data URI o URL remota) en un `File` listo
 * para guardar. Cuando se pide OGG:
 *  - Las notas en OGG/Opus (las que mandan desde WhatsApp) se guardan tal cual.
 *  - Las notas grabadas como WebM/Opus se REMUEVAN sin recodificar a OGG/Opus
 *    (remuxWebmToOgg, isomórtico) — el resultado suena idéntico.
 *  - Las notas en otro formato (mp4/AAC de iOS, mp3…) se conservan en su
 *    formato original, porque convertirlas exigiría recodificar y perder calidad.
 */
import { remuxWebmToOgg } from "./webm-to-ogg";
import { resolveMediaBlob } from "./download-media";

/** Mágico EBML (WebM/Matroska). */
export function isWebmBytes(u8: Uint8Array): boolean {
  return u8.length >= 4 && u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3;
}

/** Mágico OGG ("OggS"). */
export function isOggBytes(u8: Uint8Array): boolean {
  return u8.length >= 4 && u8[0] === 0x4f && u8[1] === 0x67 && u8[2] === 0x67 && u8[3] === 0x53;
}

function extensionDesdeUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split("/").pop() || "");
    const m = last.match(/\.(\w{2,4})$/i);
    if (m) return m[1].toLowerCase();
  } catch {}
  const m = url.match(/\.(\w{2,4})(?=$|\?|#)/i);
  return m ? m[1].toLowerCase() : fallback;
}

export interface AudioGuardado {
  file: File;
  mime: string;
  /** true si el audio se remuxó de WebM a OGG. */
  convertidoAogg: boolean;
}

/**
 * Resuelve el audio del mensaje y lo devuelve como `File` con nombre limpio.
 * `preferirOgg` = true guarda todo en OGG (lossless donde es posible).
 */
export async function audioMensajeToArchivo(msg: any, baseName: string, preferirOgg: boolean): Promise<AudioGuardado> {
  const url = String(msg?.url_archivo || "");
  if (!url) throw new Error("La nota no tiene archivo de audio.");
  const blob = await resolveMediaBlob(url);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.length) throw new Error("La nota está vacía.");

  let out: Uint8Array = bytes;
  let mime = ((blob.type || "").split(";")[0] || "audio/ogg").toLowerCase();
  let convertidoAogg = false;

  if (preferirOgg && !isOggBytes(bytes)) {
    if (isWebmBytes(bytes)) {
      try {
        // prerollMs: 0 → sin silencio artificial (es para guardar, no para WhatsApp)
        out = remuxWebmToOgg(bytes, { prerollMs: 0 });
        mime = "audio/ogg";
        convertidoAogg = true;
      } catch {
        // Si no se pudo parsear el WebM, se guarda el archivo original.
      }
    }
  }

  const ext =
    mime.includes("ogg") || mime.includes("opus") ? "ogg"
    : mime.includes("webm") ? "webm"
    : mime.includes("mp3") ? "mp3"
    : mime.includes("wav") ? "wav"
    : mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a") ? "m4a"
    : extensionDesdeUrl(url, "ogg");

  // .slice(): copia sobre un ArrayBuffer fresco (File exige ArrayBufferView<ArrayBuffer>)
  return { file: new File([out.slice()], `${baseName}.${ext}`, { type: mime }), mime, convertidoAogg };
}
