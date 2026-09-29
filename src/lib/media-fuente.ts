/**
 * Acceso del SERVIDOR a los adjuntos que viven fuera del CRM.
 *
 * Los audios, fotos y videos que mandan los clientes NO viven en Supabase: los
 * guarda Chatwoot (Active Storage) en el servidor propio, y en la tabla
 * `mensajes` solo queda la URL de Chatwoot. Todo lo que necesite leer esos
 * bytes desde el servidor (el proxy `/api/media/download` y la copia a Storage
 * de `/api/media/persistir`) tiene que:
 *
 *   1. mandar el token de Chatwoot (Caddy descarta los guiones bajos, así que
 *      se mandan las dos formas de la cabecera),
 *   2. negarse a pedir hosts privados (nada de `localhost`, `10.x`, `192.168.x`…),
 *   3. negarse a usar la API de Chatwoot con ese token: solo sus archivos.
 *
 * Antes esta lógica estaba duplicada dentro de la ruta del proxy; ahora vive
 * aquí para que el proxy y la copia a Storage se comporten igual.
 */

/** URL base del Chatwoot propio (misma por defecto que el resto del repo). */
export function urlChatwoot(): string {
  return (process.env.CHATWOOT_URL || "https://crmesteban.duckdns.org").replace(/\/$/, "");
}

/** URL base de Evolution (WhatsApp Personal). */
export function urlEvolution(): string {
  return (process.env.EVOLUTION_API_URL || "https://evo-crmesteban.duckdns.org").replace(/\/$/, "");
}

function mismoOrigen(destino: URL, base: string): boolean {
  try {
    return destino.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

export function esOrigenDeChatwoot(target: URL): boolean {
  return mismoOrigen(target, urlChatwoot());
}

export function esOrigenDeEvolution(target: URL): boolean {
  return mismoOrigen(target, urlEvolution());
}

/** Hosts que el servidor NUNCA debe visitar (SSRF). */
export function esHostPrivado(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0") return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Del servidor de Chatwoot solo se sirven sus archivos, nunca su API: el proxy
 * viaja con el token de administrador y sin este candado cualquiera podría leer
 * las conversaciones desde fuera (se comprobó que respondía con el token).
 */
export function esRutaDeApiBloqueada(target: URL): boolean {
  return esOrigenDeChatwoot(target) && !target.pathname.startsWith("/rails/active_storage/");
}

/**
 * ¿Esta URL se puede bajar con `fetch` desde el servidor sin riesgos?
 * (El proyecto compila sin strictNullChecks: por eso es un objeto plano y no
 * una unión discriminada, que aquí TypeScript no estrecharía.)
 */
export interface RevisionUrl {
  ok: boolean;
  destino?: URL;
  motivo?: string;
}

export function esUrlDescargable(raw: string): RevisionUrl {
  let destino: URL;
  try {
    destino = new URL(String(raw || ""));
  } catch {
    return { ok: false, motivo: "URL de archivo inválida." };
  }
  if (destino.protocol !== "http:" && destino.protocol !== "https:") {
    return { ok: false, motivo: "Solo se pueden descargar archivos http(s)." };
  }
  if (esHostPrivado(destino.hostname)) return { ok: false, motivo: "URL no permitida." };
  if (esRutaDeApiBloqueada(destino)) return { ok: false, motivo: "URL no permitida." };
  return { ok: true, destino };
}

/** Cabeceras necesarias para que el host de origen devuelva el archivo. */
export function cabecerasParaFuente(target: URL): Record<string, string> {
  const headers: Record<string, string> = { Accept: "*/*" };
  if (esOrigenDeChatwoot(target)) {
    const token = (process.env.CHATWOOT_API_TOKEN || "").trim();
    if (token) {
      headers.api_access_token = token;
      // Caddy descarta api_access_token (guion bajo). La forma con guiones sí llega.
      headers["api-access-token"] = token;
    }
  }
  if (esOrigenDeEvolution(target)) {
    const key = (process.env.EVOLUTION_API_KEY || "").trim();
    if (key) headers.apikey = key;
  }
  return headers;
}
