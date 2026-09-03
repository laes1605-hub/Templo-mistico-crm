/**
 * Configuración central de Supabase.
 *
 * MUY IMPORTANTE: nunca deben existir URLs ni llaves reales incrustadas en el
 * código. Todo viene de variables de entorno:
 *
 *   NEXT_PUBLIC_SUPABASE_URL          → URL pública del proyecto (client + server)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY     → anon key (client)
 *   SUPABASE_URL                      → override del server (opcional)
 *   SUPABASE_SERVICE_ROLE_KEY         → service role (solo server / n8n)
 *   SUPABASE_SERVICE_KEY              → alias de la service role
 *
 * Este módulo no lanza en import; si falta configuración, provee clientes que
 * fallan con un mensaje claro al primer uso y las funciones REST devuelven
 * errores legibles. Así un despliegue sin env vars no arranca "roto en silencio".
 */

const url = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
)
  .trim()
  .replace(/\/+$/, "");

const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

const serviceRoleKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  ""
).trim();

export const supabaseConfig = {
  url,
  anonKey,
  serviceRoleKey,
  /** true cuando hay URL + clave para el cliente anónimo del navegador. */
  ready: Boolean(url && anonKey),
  /** true cuando hay URL + service role para operaciones de administrador. */
  adminReady: Boolean(url && serviceRoleKey),
};

export const mensajeConfigFaltante = ():
  | string
  | null => {
  if (!supabaseConfig.url) {
    return "Supabase sin configurar: falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL.";
  }
  if (!supabaseConfig.anonKey) {
    return "Supabase sin configurar: falta NEXT_PUBLIC_SUPABASE_ANON_KEY.";
  }
  return null;
};

export const mensajeAdminFaltante = (): string | null => {
  if (!supabaseConfig.url) {
    return "Supabase sin configurar: falta NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL.";
  }
  if (!supabaseConfig.serviceRoleKey) {
    return "Supabase sin configurar: falta SUPABASE_SERVICE_ROLE_KEY (no usar la anon para escrituras críticas).";
  }
  return null;
};

/**
 * URL limpia para llamadas REST directas (sync-chatwoot / media-storage).
 */
export function supabaseRestUrl(): string {
  return supabaseConfig.url;
}

/**
 * Credenciales para llamadas REST directas. La service role tiene prioridad;
 * la anon sólo si no existe la service role (para compatibilidad de lectura).
 */
export function supabaseRestCredentials(): { url: string; key: string } {
  return {
    url: supabaseConfig.url,
    key: supabaseConfig.serviceRoleKey || supabaseConfig.anonKey,
  };
}
