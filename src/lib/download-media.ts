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

async function resolveMediaBlob(url: string): Promise<Blob> {
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

/**
 * Descarga una imagen del chat (data URI o URL remota).
 * En el APK abre la hoja nativa para guardarla en Galería/Descargas.
 */
export async function downloadMedia(url: string, filename: string): Promise<void> {
  const blob = await resolveMediaBlob(url);
  const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  const file = new File([blob], filename, { type });

  if (isNative() && typeof navigator !== "undefined" && navigator.canShare) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
    }
  }

  triggerAnchorDownload(blob, filename);
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

  if (typeof navigator !== "undefined" && navigator.canShare) {
    try {
      if (navigator.canShare({ files })) {
        await navigator.share({ files, title: files.length === 1 ? files[0].name : "Fotos del cliente" });
        return { ok: files.length, fail };
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return { ok: files.length, fail };
    }
  }

  for (const file of files) {
    triggerAnchorDownload(file, file.name);
    await new Promise((r) => setTimeout(r, 350));
  }
  return { ok: files.length, fail };
}
