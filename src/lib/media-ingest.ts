/**
 * Copia de adjuntos externos a Supabase Storage ("ingesta").
 *
 * PROBLEMA QUE RESUELVE
 * ---------------------
 * Los audios y las fotos que entran por WhatsApp viven en Chatwoot, no en el
 * CRM: en `mensajes.url_archivo` queda una URL de Chatwoot
 * (`/rails/active_storage/...`) o, en los mensajes viejos, un data-URI base64
 * de varios MB. Cada vez que el teléfono quiere reproducir esa nota tiene que
 * pasar por el proxy del CRM, que a su vez baja el archivo del servidor propio:
 * dos saltos de red y sin caché de CDN. Con 5-10 notas en un chat, esa cola es
 * la que hacía esperar 15-20 s (y el audio que te interesa casi siempre es el
 * último de la fila).
 *
 * Con esta lib, el servidor baja el archivo UNA vez y lo deja en el bucket
 * público `media-mensajes`; desde ese momento el teléfono lo pide directo al
 * CDN de Supabase (con Range y caché), sin pasar por la función del servidor.
 * Es el mismo camino que ya usan los adjuntos que se ENVÍAN desde el CRM.
 *
 * Es a prueba de fallos: si algo no se puede copiar (host caído, archivo
 * gigante, sin Storage configurado), devuelve el motivo y el mensaje se queda
 * como estaba. Nunca se pierde el adjunto.
 */

import { esDataUri, esUrlDeStorage, mimeDesdeUrl, parsearDataUri } from "./media-format";
import { subirMediaAStorage } from "./media-storage";
import { cabecerasParaFuente, esUrlDescargable } from "./media-fuente";

/** Tamaño máximo que se copia a Storage (lo más grande se sigue viendo por el proxy). */
export const MAX_BYTES_INGESTA = 12 * 1024 * 1024;
/** Tiempo máximo de descarga por archivo. */
const TIMEOUT_MS = 20_000;

export type EstadoAdjunto = "storage" | "incrustado" | "externo" | "sin_archivo";

/** ¿Dónde vive hoy el adjunto de este mensaje? */
export function estadoDeAdjunto(url: unknown): EstadoAdjunto {
  const valor = String(url || "").trim();
  if (!valor) return "sin_archivo";
  if (esUrlDeStorage(valor)) return "storage";
  if (esDataUri(valor)) return "incrustado";
  return "externo";
}

/** Los adjuntos ya copiados (Storage) o vacíos no necesitan trabajo. */
export function necesitaIngesta(url: unknown): boolean {
  const estado = estadoDeAdjunto(url);
  return estado === "incrustado" || estado === "externo";
}

/** Nombre base legible según el tipo de mensaje (mismo criterio que Ajustes). */
export function nombreBaseDeTipo(tipo: string | null | undefined): string {
  const t = String(tipo || "").toLowerCase();
  if (t === "audio") return "nota_de_voz";
  if (t === "imagen") return "imagen";
  if (t === "video") return "video";
  return "adjunto";
}

/** Tipo de contenido del CRM ("audio"/"imagen"/"video"/"archivo") a partir de un MIME. */
export function tipoDesdeMime(mime: string, porDefecto = "archivo"): string {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "imagen";
  if (m.startsWith("video/")) return "video";
  return porDefecto;
}

export interface ResultadoIngesta {
  ok: boolean;
  /** URL pública en Storage cuando la copia salió bien. */
  url?: string;
  /** MIME detectado (sirve para corregir `tipo_contenido`). */
  mime?: string;
  /** Motivo legible cuando no se pudo copiar. */
  motivo?: string;
  /** true si el adjunto se quedó como estaba (no había nada que hacer). */
  sinCambios?: boolean;
}

/** Baja un adjunto http(s) con las cabeceras del host correcto. */
interface DescargaAdjunto {
  ok: boolean;
  bytes?: Uint8Array;
  mime?: string;
  motivo?: string;
}

async function descargarAdjunto(url: string): Promise<DescargaAdjunto> {
  const revision = esUrlDescargable(url);
  if (!revision.ok || !revision.destino) {
    return { ok: false, motivo: revision.motivo || "URL no permitida." };
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const respuesta = await fetch(revision.destino.toString(), {
      headers: cabecerasParaFuente(revision.destino),
      cache: "no-store",
      redirect: "follow",
      signal: controlador.signal,
    });
    if (!respuesta.ok) {
      return { ok: false, motivo: `El origen respondió ${respuesta.status}.` };
    }
    const contentLength = Number(respuesta.headers.get("content-length") || 0);
    if (contentLength > MAX_BYTES_INGESTA) {
      return { ok: false, motivo: "El archivo es demasiado grande para copiarlo." };
    }
    const mime = (respuesta.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (mime.includes("text/html")) {
      return { ok: false, motivo: "El origen devolvió una página en vez del archivo." };
    }
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    if (!bytes.length) return { ok: false, motivo: "El archivo llegó vacío." };
    if (bytes.length > MAX_BYTES_INGESTA) {
      return { ok: false, motivo: "El archivo es demasiado grande para copiarlo." };
    }
    return { ok: true, bytes, mime: mime || "application/octet-stream" };
  } catch (e: any) {
    const motivo = e?.name === "AbortError" ? "Se agotó el tiempo bajando el archivo." : e?.message || "Error de red.";
    return { ok: false, motivo };
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * MIME definitivo del objeto que se guarda en Storage.
 *
 * Chatwoot a veces manda `application/octet-stream` (o nada), y con ese MIME el
 * archivo se guardaría como ".bin": al reproducirlo desde el CDN el navegador
 * podría negarse. Se intenta sacar el MIME real de la extensión de la URL y, si
 * no, del tipo del mensaje (audio/imagen/video).
 */
function mimeFinal(detectado: string | undefined, url: string, tipo?: string | null): string {
  const limpio = String(detectado || "").toLowerCase();
  if (limpio && limpio !== "application/octet-stream" && !limpio.includes("text/html")) return limpio;
  const porUrl = url ? mimeDesdeUrl(url, "") : "";
  if (porUrl) return porUrl;
  const t = String(tipo || "").toLowerCase();
  if (t === "audio") return "audio/ogg";
  if (t === "imagen") return "image/jpeg";
  if (t === "video") return "video/mp4";
  return limpio || "application/octet-stream";
}

/**
 * Deja el adjunto en Storage y devuelve su URL pública.
 *
 * Acepta las dos formas que hay en la base:
 *   · `data:` (base64 incrustado en la fila) → se sube tal cual,
 *   · `http(s):` (Chatwoot/Evolution) → se baja con token y se sube.
 *
 * Si ya está en Storage o no tiene archivo, `sinCambios: true` (no se toca).
 */
export async function ingerirAdjunto(
  url: string,
  opciones: { nombreBase?: string; tipo?: string | null } = {}
): Promise<ResultadoIngesta> {
  const estado = estadoDeAdjunto(url);
  if (estado === "storage" || estado === "sin_archivo") return { ok: true, url, sinCambios: true };

  const nombreBase = opciones.nombreBase || nombreBaseDeTipo(opciones.tipo);

  if (estado === "incrustado") {
    const parseado = parsearDataUri(url);
    if (!parseado) return { ok: false, motivo: "El archivo incrustado no se pudo leer." };
    const mime = mimeFinal(parseado.mime, "", opciones.tipo);
    const nueva = await subirMediaAStorage(parseado.bytes, mime, nombreBase);
    if (!nueva) return { ok: false, motivo: "No se pudo subir el archivo a Storage." };
    return { ok: true, url: nueva, mime };
  }

  const bajado = await descargarAdjunto(url);
  if (!bajado.ok || !bajado.bytes) {
    return { ok: false, motivo: bajado.motivo || "No se pudo bajar el archivo." };
  }
  const mime = mimeFinal(bajado.mime, url, opciones.tipo);
  const nueva = await subirMediaAStorage(bajado.bytes, mime, nombreBase);
  if (!nueva) return { ok: false, motivo: "No se pudo subir el archivo a Storage." };
  return { ok: true, url: nueva, mime };
}
