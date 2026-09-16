/**
 * Reglas del COPY de un anuncio.
 *
 * El copy es SIEMPRE el TEXTO QUE VA DENTRO DEL POST (la publicación): lo que
 * la persona lee junto al video. NUNCA es el nombre del archivo del video
 * (ej: "Auto_Cropped_AR_4_X_5_DCO_1.mp4"): eso es un nombre técnico de edición
 * y no un texto publicable.
 *
 * Estas reglas se usan en el servidor (al leer los posts y las creatividades de
 * Meta) y también en el panel (antes de mandar el copy a la campaña), para que
 * un nombre de archivo no termine publicado como copy del anuncio.
 */

export type FuenteCopy =
  | "post" // texto de la publicación en la Fan Page
  | "post_anuncio" // texto del post del anuncio (publicación oculta / dark post)
  | "ad_creative" // texto del creativo del anuncio (Advantage+ / DCO)
  | "video_description" // descripción del video en Meta
  | "video_node" // descripción leída del nodo del video
  | "sin_copy";

/** Cómo se muestra en el panel de dónde salió el copy. */
export const ETIQUETA_FUENTE_COPY: Record<FuenteCopy, string> = {
  post: "texto del post en la Fan Page",
  post_anuncio: "texto del post del anuncio",
  ad_creative: "texto del creativo del anuncio",
  video_description: "descripción del video",
  video_node: "texto del video",
  sin_copy: "sin copy publicado",
};

/** Etiqueta corta para las pastillas del panel. */
export const ETIQUETA_CORTA_COPY: Record<FuenteCopy, string> = {
  post: "texto del post",
  post_anuncio: "post del anuncio",
  ad_creative: "creativo del anuncio",
  video_description: "descripción del video",
  video_node: "texto del video",
  sin_copy: "sin copy",
};

/** Explicación de dónde salió el copy (para mostrar en el panel). */
export const DETALLE_FUENTE_COPY: Record<FuenteCopy, string> = {
  post: "Se tomó el texto de la publicación (post) de la Fan Page que contiene el video.",
  post_anuncio: "Se tomó el texto del post que usa el anuncio (la publicación del anuncio).",
  ad_creative: "Se tomó el texto del creativo del anuncio (no hay post visible con ese video).",
  video_description: "Se tomó la descripción del video en Meta porque no había texto de post.",
  video_node: "Se leyó la descripción del video en Meta porque no había texto de post.",
  sin_copy: "Este video no tiene texto publicado en ningún post: escribe el copy a mano.",
};

/** Prioridad cuando dos fuentes traen texto (mayor = más confiable). */
export const PRIORIDAD_FUENTE_COPY: Record<FuenteCopy, number> = {
  post: 4,
  post_anuncio: 3,
  ad_creative: 2,
  video_description: 1,
  video_node: 0,
  sin_copy: 0,
};

// Extensiones de archivo de video/imagen
const RX_EXTENSION = /\.(mp4|mov|m4v|avi|mkv|webm|wmv|flv|3gp|mpeg|mpg|mts|jpg|jpeg|png|gif|webp|heic)\s*$/i;
// URLs y rutas (un copy nunca es una ruta)
const RX_RUTA = /^(https?:\/\/|file:|content:|blob:|\/|[a-z]:\\)/i;

// Marca técnica FUERTE de edición de Meta: auto-crop y "advideo" son nombres
// internos de la herramienta de edición/publicación, no del copy.
const RX_MARCA_FUERTE = /(auto[_\s-]?crop(?:ped)?|advideo)/i;

// Patrón de archivo con versión/recorte: "final_2", "v2", "DCO_1",
// "AR_4_X_5". "final", "versión" o "creativo" como palabra SUELTA en un copy
// NO se tratan como archivo: son palabras normales del español.
const RX_PATRON_ARCHIVO = /(?:^|[_\s.-])(?:final|version|versi[oó]n|v|dco|ar|vertical|horizontal|square|story|feed|reels)[_\s-]?\d{1,2}(?:[_\s-]?(?:x|por)[_\s-]?\d{1,2})?(?:[_\s.-]|$)/i;

// Recorte de proporción tipo "4x5", "9:16".
const RX_RECORTE = /\b\d{1,2}\s?(?:[xX]|:)\s?\d{1,2}\b/;

/**
 * ¿Este texto es el nombre de un archivo/asset y NO un copy publicable?
 * Ejemplos que devuelven true: "Auto_Cropped_AR_4_X_5_DCO_1.mp4",
 * "Auto_Cropped_AR_4_X_5_DCO_", "video_final_vertical_4x5.mp4".
 *
 * Ejemplos de COPY REAL que devuelven false (se conservan):
 * "Ritual creativo para amarre de amor efectivo", "Trabajo final 1 de la serie",
 * "AMARRE_DE_AMOR 100% GARANTIZADO".
 */
export function esNombreDeArchivo(valor: unknown): boolean {
  const texto = String(valor ?? "").trim();
  if (!texto) return false;
  if (RX_EXTENSION.test(texto)) return true;
  if (!/\s/.test(texto) && RX_RUTA.test(texto)) return true;

  const palabras = texto.split(/\s+/).filter(Boolean);

  // Una sola "palabra": se detecta por guiones/underscores o por patrón técnico
  if (palabras.length === 1) {
    const palabra = palabras[0];
    if (!/^[\w.\-()+]+$/.test(palabra)) return false;
    const separadores = (palabra.match(/[_-]/g) || []).length;
    // Auto_Cropped_AR_4_X_5_DCO_1 (varios separadores + números/marca técnica).
    // Se pide algo más que los guiones para no tumbar un copy tipo "AMARRE_DE_AMOR".
    const numeroEntreGuiones = /_?\d+_/.test(palabra) || RX_RECORTE.test(palabra);
    if (separadores >= 2 && (numeroEntreGuiones || RX_MARCA_FUERTE.test(palabra) || RX_PATRON_ARCHIVO.test(palabra))) return true;
    if (/\d/.test(palabra) && /[a-z][A-Z]/.test(palabra)) return true; // VideoFinal4K
    // "final_2", "v2", "DCO_1": patrón de archivo + número de edición.
    if (RX_PATRON_ARCHIVO.test(palabra) && /\d/.test(palabra)) return true;
    return RX_MARCA_FUERTE.test(palabra);
  }

  // Varias palabras: solo se descarta si TODO el texto es un nombre técnico real
  // (marca de edición fuerte y/o patrón de recorte). Palabras sueltas como
  // "creativo", "final" o "versión" en medio de un copy NO lo convierten en archivo.
  if (palabras.length <= 8 && !/[.?!¿¡,]/.test(texto)) {
    const marcaFuerte = RX_MARCA_FUERTE.test(texto);
    const recorte = RX_RECORTE.test(texto);
    const patron = RX_PATRON_ARCHIVO.test(texto);
    // "Auto Cropped AR 4 X 5 DCO 1" → marca fuerte + recorte/patrón.
    if (marcaFuerte && (recorte || patron || /\d/.test(texto))) return true;
    if (recorte && patron) return true;
    // "Video Final 1", "Foto 4x5" → empieza por tipo de asset + patrón técnico.
    const empiezaPorAsset = /^(?:video|imagen|foto|audio|archivo|adjunto|clip)\b/i.test(texto);
    if (empiezaPorAsset && (patron || recorte)) return true;
    return false;
  }
  return false;
}

/** Texto listo para usar como copy ("" si no hay nada publicable). */
export function limpiarCopy(valor: unknown): string {
  return revisarCopy(valor).texto;
}

/**
 * Igual que limpiarCopy pero conserva el texto que se descartó, para poder
 * avisar en el panel: "ignoré este texto porque es el nombre del archivo".
 */
export function revisarCopy(valor: unknown): { texto: string; descartado: string } {
  const bruto = String(valor ?? "").replace(/\r\n/g, "\n").trim();
  if (!bruto) return { texto: "", descartado: "" };
  if (esNombreDeArchivo(bruto)) return { texto: "", descartado: bruto };
  return { texto: bruto, descartado: "" };
}

export function etiquetaFuenteCopy(fuente: unknown): string {
  return ETIQUETA_FUENTE_COPY[fuente as FuenteCopy] || ETIQUETA_FUENTE_COPY.sin_copy;
}

export function etiquetaCortaFuenteCopy(fuente: unknown): string {
  return ETIQUETA_CORTA_COPY[fuente as FuenteCopy] || ETIQUETA_CORTA_COPY.sin_copy;
}

export function detalleFuenteCopy(fuente: unknown): string {
  return DETALLE_FUENTE_COPY[fuente as FuenteCopy] || DETALLE_FUENTE_COPY.sin_copy;
}

/** Primer renglón con texto (se usa como titular del anuncio). */
export function primerLineaCopy(valor: unknown): string {
  return String(valor ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l) || "";
}
