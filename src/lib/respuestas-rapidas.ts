/**
 * Respuestas rápidas: textos, audios (OGG) e imágenes guardados en el
 * dispositivo (localStorage) que pueden enviarse a CUALQUIER conversación
 * desde el botón "Respuestas rápidas" de la barra de escribir.
 *
 * Los audios se convierten a OGG/Opus cuando son WebM (remux sin recodificar,
 * mismo resultado que las notas de voz del chat). Las imágenes grandes se
 * reducen a ~1024px JPEG para no agotar el almacenamiento local.
 */
import { remuxWebmToOgg } from "./webm-to-ogg";
import { isWebmBytes } from "./audio-download";

export type TipoRespuestaRapida = "texto" | "audio" | "imagen";

export interface RespuestaRapida {
  id: string;
  tipo: TipoRespuestaRapida;
  /** Título corto para identificarla en el menú. */
  titulo: string;
  /** Texto plano (tipo texto) o data URI (tipo audio/imagen). */
  contenido: string;
  creado_en: string;
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

export function listarRespuestasRapidas(): RespuestaRapida[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && r.id && r.tipo && typeof r.contenido === "string" && r.contenido.length > 0);
  } catch {
    return [];
  }
}

/** Guarda una respuesta nueva. Lanza Error si no hay espacio suficiente. */
export function guardarRespuestaRapida(
  nueva: { tipo: TipoRespuestaRapida; titulo: string; contenido: string }
): RespuestaRapida {
  const item: RespuestaRapida = {
    id: uid(),
    tipo: nueva.tipo,
    titulo: nueva.titulo,
    contenido: nueva.contenido,
    creado_en: new Date().toISOString(),
  };
  const todas = [...listarRespuestasRapidas(), item];
  if (typeof window === "undefined") return item;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todas));
    return item;
  } catch {
    throw new Error(
      "Sin espacio en el almacenamiento del teléfono. Borra respuestas antiguas o guarda archivos más ligeros."
    );
  }
}

/** Borra por id y devuelve la lista actualizada. */
export function eliminarRespuestaRapida(id: string): RespuestaRapida[] {
  const todas = listarRespuestasRapidas().filter((r) => r.id !== id);
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todas));
  } catch {
    // Sin espacio no pasa nada: la lista en memoria queda filtrada.
  }
  return todas;
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
  // Anotación explícita: TS 5.9 tipa Uint8Array con el buffer base (ArrayBufferLike).
  let out: Uint8Array = bytes;
  let mime = file.type && file.type.startsWith("audio/") ? file.type : "audio/ogg";

  if (isWebmBytes(bytes)) {
    try {
      // prerollMs: 0 → sin silencio artificial (es para guardar, no para WhatsApp)
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
 * ~1024px JPEG para no agotar el almacenamiento del teléfono.
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
