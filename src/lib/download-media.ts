import { Capacitor } from "@capacitor/core";

const MAX_BYTES = 25 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/amr": "amr",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/zip": "zip",
  "application/x-rar-compressed": "rar",
  "text/plain": "txt",
  "text/csv": "csv",
};

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function mimeToExt(mime: string): string {
  const clean = (mime || "").split(";")[0].trim().toLowerCase();
  return MIME_EXT[clean] || (clean.startsWith("image/") ? clean.slice(6) : clean.startsWith("audio/") ? clean.slice(6) : clean.startsWith("video/") ? clean.slice(6) : "bin");
}

export function guessImageFilename(url: string, fallback = "imagen-cliente"): string {
  const base = fallback.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "imagen-cliente";
  if (url.startsWith("data:")) {
    const mime = url.slice(5, url.indexOf(";")) || "image/jpeg";
    return `${base}.${mimeToExt(mime)}`;
  }
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split("/").pop() || "");
    if (/\.([A-Za-z0-9]{2,5})$/i.test(last)) return last;
  } catch {}
  return `${base}.jpg`;
}

export function guessFilename(url: string, fallback = "archivo-adjunto", mimeType?: string): string {
  const base = fallback.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "archivo-adjunto";
  if (url.startsWith("data:")) {
    const mime = mimeType || url.slice(5, url.indexOf(";")) || "application/octet-stream";
    return `${base}.${mimeToExt(mime)}`;
  }
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split("/").pop() || "");
    if (/\.([A-Za-z0-9]{2,5})$/i.test(last)) return last;
  } catch {}
  if (mimeType) {
    return `${base}.${mimeToExt(mimeType)}`;
  }
  return base;
}

/** ¿Es un mensaje de audio / nota de voz? */
export function isAudioMessage(msg: any): boolean {
  if (!msg?.url_archivo) return false;
  const url = String(msg.url_archivo).toLowerCase();
  const tipo = String(msg.tipo_contenido || "").toLowerCase();
  const contenido = String(msg.contenido || "").toLowerCase();
  if (tipo === "audio" || tipo === "voice" || tipo === "ptt") return true;
  if (url.startsWith("data:audio/")) return true;
  if (/\.(ogg|opus|webm|mp3|wav|m4a|aac|amr|flac|oga)($|\?|#)/i.test(url)) return true;
  if (contenido === "[audio]" || contenido === "[nota_de_voz]" || contenido.includes("nota_de_voz") || contenido.includes("nota de voz") || contenido.includes("🎤")) return true;
  if (url.includes("nota_de_voz") || url.includes("voice_note") || url.includes("/audio-")) return true;
  return false;
}

/** ¿Es un mensaje de imagen? */
export function isImageMessage(msg: any): boolean {
  if (!msg?.url_archivo) return false;
  const url = String(msg.url_archivo).toLowerCase();
  const tipo = String(msg.tipo_contenido || "").toLowerCase();
  const contenido = String(msg.contenido || "").toLowerCase();
  if (isAudioMessage(msg)) return false;
  if (tipo === "imagen" || tipo === "sticker" || tipo === "image" || tipo === "photo") return true;
  if (url.startsWith("data:image/")) return true;
  if (/\.(jpe?g|png|gif|webp|bmp|heic|heif|svg)($|\?|#)/i.test(url)) return true;
  if (contenido === "[imagen]" || contenido === "[image]" || contenido === "[sticker]" || contenido.startsWith("📷")) return true;
  if (url.includes("/imagen") || url.includes("-imagen.") || url.includes("-foto.")) return true;
  return false;
}

/** ¿Es un mensaje de video? */
export function isVideoMessage(msg: any): boolean {
  if (!msg?.url_archivo) return false;
  const url = String(msg.url_archivo).toLowerCase();
  const tipo = String(msg.tipo_contenido || "").toLowerCase();
  const contenido = String(msg.contenido || "").toLowerCase();
  if (isAudioMessage(msg) || isImageMessage(msg)) return false;
  if (tipo === "video") return true;
  if (url.startsWith("data:video/")) return true;
  if (/\.(mp4|webm|mov|avi|mkv|3gp|m4v|ogv)($|\?|#)/i.test(url)) return true;
  if (contenido === "[video]" || contenido.startsWith("🎥") || contenido.startsWith("🎬")) return true;
  if (url.includes("/video-") || url.includes("-video.")) return true;
  return false;
}

/** ¿Es un mensaje de documento / archivo adjunto (PDF, Word, Excel, ZIP, etc.)? */
export function isFileMessage(msg: any): boolean {
  if (!msg?.url_archivo) return false;
  if (isAudioMessage(msg) || isImageMessage(msg) || isVideoMessage(msg)) return false;
  return true;
}

async function blobFromDataUri(url: string): Promise<Blob> {
  const res = await fetch(url);
  const blob = await res.blob();
  if (!blob.size) throw new Error("El archivo está vacío.");
  return blob;
}

async function blobFromProxy(url: string): Promise<Blob> {
  const res = await fetch(`/api/media/download?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error || `No se pudo descargar el archivo (${res.status}).`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("El archivo está vacío.");
  if (blob.size > MAX_BYTES) throw new Error("El archivo es demasiado grande para descargarlo.");
  return blob;
}

/**
 * Resuelve un archivo multimedia del chat (data URI o URL remota) a Blob.
 * Exportado también para audios, videos y documentos.
 */
export async function resolveMediaBlob(url: string): Promise<Blob> {
  if (!url) throw new Error("No hay archivo para descargar.");
  if (url.startsWith("data:")) return blobFromDataUri(url);

  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0 && !(blob.type || "").includes("text/html")) return blob;
    }
  } catch {
    // CORS o red: se reintenta por el proxy del CRM.
  }
  return blobFromProxy(url);
}

function triggerAnchorDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}

function base64DeBytes(u8: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...Array.from(u8.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

async function archivoABase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return base64DeBytes(bytes);
}

const sanearNombre = (n: string): string => n.replace(/[^\w.\-]+/g, "_").slice(0, 60) || "archivo";

async function guardarNativoCapacitor(files: File[], titulo: string): Promise<boolean> {
  try {
    const { Filesystem, FilesystemDirectory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const sello = Date.now();
    const uris: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const { uri } = await Filesystem.writeFile({
        path: `descargas/${sello}-${i + 1}-${sanearNombre(files[i].name)}`,
        data: await archivoABase64(files[i]),
        directory: FilesystemDirectory.Documents,
      });
      uris.push(uri);
    }
    try {
      await Share.share({ files: uris, title: titulo });
    } catch (e: any) {
      console.warn("Hoja de compartir cerrada:", e);
    }
    alert(
      `${files.length === 1 ? "El archivo quedó guardado" : "Los archivos quedaron guardados"} en este teléfono (Documentos › Descargas).\n\nSi se abrió la hoja de compartir, elige Galería, Archivos u otra app para moverlos.`
    );
    return true;
  } catch (e) {
    console.error("Error guardando con Capacitor:", e);
    return false;
  }
}

async function distribuirArchivos(files: File[], titulo: string): Promise<void> {
  if (files.length === 0) return;

  if (isNative()) {
    if (await guardarNativoCapacitor(files, titulo)) return;
  }

  if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
    try {
      if (navigator.canShare({ files })) {
        await navigator.share({ files, title: titulo });
        return;
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
    }
  }

  for (const file of files) {
    triggerAnchorDownload(file, file.name);
    await new Promise((r) => setTimeout(r, 350));
  }
}

export async function downloadMedia(url: string, filename: string): Promise<void> {
  const blob = await resolveMediaBlob(url);
  const type = blob.type || "application/octet-stream";
  const file = new File([blob], filename, { type });
  await distribuirArchivos([file], filename);
}

export async function downloadMany(items: Array<{ url: string; filename: string }>): Promise<{ ok: number; fail: number }> {
  let fail = 0;
  const files: File[] = [];
  for (const item of items) {
    try {
      const blob = await resolveMediaBlob(item.url);
      const type = blob.type || "image/jpeg";
      files.push(new File([blob], item.filename, { type }));
    } catch {
      fail += 1;
    }
  }

  if (files.length === 0) return { ok: 0, fail };
  await distribuirArchivos(files, files.length === 1 ? files[0].name : "Archivos del cliente");
  return { ok: files.length, fail };
}

export async function saveAudioFiles(files: File[], title = "Notas de voz"): Promise<number> {
  if (files.length === 0) return 0;
  await distribuirArchivos(files, title);
  return files.length;
}
