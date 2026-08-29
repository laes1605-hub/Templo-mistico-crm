/**
 * Respuestas rápidas: textos, audios (OGG) e imágenes.
 *
 * Fuente de verdad: tabla Supabase `respuestas_rapidas` (todos los
 * dispositivos). localStorage queda como caché / respaldo si no hay red o
 * todavía no se aplicó la migración.
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
}

const STORAGE_KEY = "templo-crm:respuestas-rapidas:v1";
const MIGRATED_KEY = "templo-crm:respuestas-rapidas:migrado-supabase";
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_IMG_DIRECTA = 2 * 1024 * 1024;

function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `rr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cachearLocal(todas: RespuestaRapida[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todas));
  } catch {
    // Caché opcional: si el teléfono no tiene espacio, igual viven en la nube.
  }
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

function filaARespuesta(row: any): RespuestaRapida | null {
  if (!row || !row.id || !row.tipo || typeof row.contenido !== "string" || !row.contenido) return null;
  if (row.tipo !== "texto" && row.tipo !== "audio" && row.tipo !== "imagen") return null;
  return {
    id: String(row.id),
    tipo: row.tipo,
    titulo: String(row.titulo || ""),
    contenido: row.contenido,
    creado_en: row.creado_en || new Date().toISOString(),
  };
}

export async function sincronizarRespuestasRapidas(): Promise<RespuestaRapida[]> {
  const locales = listarRespuestasRapidas();
  try {
    const { data, error } = await supabase
      .from("respuestas_rapidas")
      .select("id, tipo, titulo, contenido, creado_en")
      .order("creado_en", { ascending: true });

    if (error) throw error;
    const remotas = (data || []).map(filaARespuesta).filter(Boolean) as RespuestaRapida[];

    // Sube al servidor las que solo estaban en este teléfono (una vez).
    if (typeof window !== "undefined" && !window.localStorage.getItem(MIGRATED_KEY) && locales.length > 0) {
      const idsRemotos = new Set(remotas.map((r) => r.id));
      const pendientes = locales.filter((l) => !idsRemotos.has(l.id));
      for (const item of pendientes) {
        const { data: inserted, error: insErr } = await supabase
          .from("respuestas_rapidas")
          .insert({
            id: item.id,
            tipo: item.tipo,
            titulo: item.titulo,
            contenido: item.contenido,
            creado_en: item.creado_en,
          })
          .select("id, tipo, titulo, contenido, creado_en")
          .maybeSingle();
        if (!insErr && inserted) {
          const fila = filaARespuesta(inserted);
          if (fila && !idsRemotos.has(fila.id)) {
            remotas.push(fila);
            idsRemotos.add(fila.id);
          }
        } else if (insErr) {
          // Si el id no es uuid válido, inserta con id nuevo.
          const { data: inserted2 } = await supabase
            .from("respuestas_rapidas")
            .insert({ tipo: item.tipo, titulo: item.titulo, contenido: item.contenido, creado_en: item.creado_en })
            .select("id, tipo, titulo, contenido, creado_en")
            .maybeSingle();
          const fila = filaARespuesta(inserted2);
          if (fila && !idsRemotos.has(fila.id)) {
            remotas.push(fila);
            idsRemotos.add(fila.id);
          }
        }
      }
      try { window.localStorage.setItem(MIGRATED_KEY, "1"); } catch {}
    }

    remotas.sort((a, b) => new Date(a.creado_en).getTime() - new Date(b.creado_en).getTime());
    cachearLocal(remotas);
    return remotas;
  } catch {
    return locales;
  }
}

/** Guarda una respuesta nueva en la nube (y en caché local). */
export async function guardarRespuestaRapida(
  nueva: { tipo: TipoRespuestaRapida; titulo: string; contenido: string }
): Promise<RespuestaRapida> {
  const item: RespuestaRapida = {
    id: uid(),
    tipo: nueva.tipo,
    titulo: nueva.titulo,
    contenido: nueva.contenido,
    creado_en: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from("respuestas_rapidas")
      .insert({
        id: item.id,
        tipo: item.tipo,
        titulo: item.titulo,
        contenido: item.contenido,
        creado_en: item.creado_en,
      })
      .select("id, tipo, titulo, contenido, creado_en")
      .maybeSingle();
    if (error) throw error;
    const fila = filaARespuesta(data) || item;
    const todas = [...listarRespuestasRapidas().filter((r) => r.id !== fila.id), fila];
    cachearLocal(todas);
    return fila;
  } catch (e: any) {
    // Si la tabla aún no existe, se queda en el teléfono.
    const todas = [...listarRespuestasRapidas(), item];
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todas));
    } catch {
      throw new Error(
        e?.message ||
          "No se pudo guardar. Aplica la migración supabase/migrations/20260913_respuestas_rapidas.sql o borra respuestas antiguas."
      );
    }
    return item;
  }
}

/** Borra por id en la nube y en caché. */
export async function eliminarRespuestaRapida(id: string): Promise<RespuestaRapida[]> {
  try {
    await supabase.from("respuestas_rapidas").delete().eq("id", id);
  } catch {}
  const todas = listarRespuestasRapidas().filter((r) => r.id !== id);
  cachearLocal(todas);
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
