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
  return MIME_EXT[clean] || (clean.startsWith("image/") ? clean.slice(6) : "jpg");
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
    if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(last)) return last;
  } catch {}
  return `${base}.jpg`;
}

export function isImageMessage(msg: any): boolean {
  if (!msg?.url_archivo) return false;
  const url = String(msg.url_archivo);
  const tipo = String(msg.tipo_contenido || "").toLowerCase();
  if (tipo === "imagen" || tipo === "sticker" || tipo === "image") return true;
  if (url.startsWith("data:image/")) return true;
  if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)($|\?)/i.test(url)) return true;
  return false;
}

async function blobFromDataUri(url: string): Promise<Blob> {
  const res = await fetch(url);
  const blob = await res.blob();
  if (!blob.size) throw new Error("La imagen está vacía.");
  return blob;
}

async function blobFromProxy(url: string): Promise<Blob> {
  const res = await fetch(`/api/media/download?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.error || `No se pudo descargar la imagen (${res.status}).`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("La imagen está vacía.");
  if (blob.size > MAX_BYTES) throw new Error("La imagen es demasiado grande para descargarla.");
  return blob;
}

/**
 * Resuelve un archivo multimedia del chat (data URI o URL remota) a Blob.
 * Exportado también para los audios: las notas de voz se guardan/downloadean
 * con el mismo camino (fetch directo → proxy /api/media/download).
 */
export async function resolveMediaBlob(url: string): Promise<Blob> {
  if (!url) throw new Error("No hay imagen para descargar.");
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

// ---------------------------------------------------------------------------
// Guardado real en el teléfono (APK / Capacitor)
// ---------------------------------------------------------------------------
// El WebView de Android NO descarga con <a download> ni soporta Web Share con
// archivos; por eso antes "no pasaba nada" al tocar Descargar. Ahora se
// escribe en Documents › Descargas con @capacitor/filesystem y se abre la
// hoja de compartir nativa (@capacitor/share) para mover el archivo a
// Galería, Archivos, WhatsApp, etc.

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
      // El usuario cerró la hoja de compartir: los archivos siguen guardados.
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

/**
 * Reparte los archivos hacia el medio correcto según la plataforma:
 *  1. APK (Android): Capacitor Filesystem + Share (guardado real en el teléfono).
 *  2. Si Web Share con archivos está disponible: hoja de compartir.
 *  3. Navegador normal: descarga por ancla (archivo por archivo).
 */
async function distribuirArchivos(files: File[], titulo: string): Promise<void> {
  if (files.length === 0) return;

  if (isNative()) {
    if (await guardarNativoCapacitor(files, titulo)) return;
    // Si Capacitor falló, se cae a Web Share / ancla de todos modos.
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

/**
 * Descarga una imagen del chat (data URI o URL remota).
 * En el APK guarda en el teléfono vía hoja nativa (Ver Descargar imágenes).
 */
export async function downloadMedia(url: string, filename: string): Promise<void> {
  const blob = await resolveMediaBlob(url);
  const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  const file = new File([blob], filename, { type });
  await distribuirArchivos([file], filename);
}

export async function downloadMany(items: Array<{ url: string; filename: string }>): Promise<{ ok: number; fail: number }> {
  let fail = 0;
  const files: File[] = [];
  for (const item of items) {
    try {
      const blob = await resolveMediaBlob(item.url);
      const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
      files.push(new File([blob], item.filename, { type }));
    } catch {
      fail += 1;
    }
  }

  if (files.length === 0) return { ok: 0, fail };
  await distribuirArchivos(files, files.length === 1 ? files[0].name : "Fotos del cliente");
  return { ok: files.length, fail };
}

/**
 * Guarda audios (notas de voz, en OGG). En la APK guarda en el teléfono vía
 * Filesystem + hoja de compartir nativa y en el navegador descarga archivo
 * por archivo. Devuelve cuántos se guardaron.
 */
export async function saveAudioFiles(files: File[], title = "Notas de voz"): Promise<number> {
  if (files.length === 0) return 0;
  await distribuirArchivos(files, title);
  return files.length;
}
