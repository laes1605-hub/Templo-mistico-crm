import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig, mensajeAdminFaltante } from "./supabase-config";

/**
 * Cliente de Supabase para uso EXCLUSIVO en el servidor (route handlers) y en
 * procesos de Node.
 *
 * Utiliza SUPABASE_SERVICE_ROLE_KEY (ignora RLS), que es lo recomendado para
 * que el Cerebro pueda escribir reglas aunque la tabla esté protegida. Si
 * falta la service role usa la anon key; si no hay ninguna, exporta una
 * trampa que falla con un mensaje claro.
 */
export const usingServiceRole = Boolean(supabaseConfig.serviceRoleKey);

function clienteSinConfigurar(): SupabaseClient {
  const error = () => {
    throw new Error(
      mensajeAdminFaltante() || "Supabase sin configurar en el servidor."
    );
  };
  const trampa: any = {
    from: () => {
      error();
    },
    rpc: () => {
      error();
    },
    channel: () => {
      error();
    },
    auth: new Proxy({}, { get: () => error }),
    storage: new Proxy({}, { get: () => error }),
  };
  return new Proxy(trampa, {
    get(_objetivo, propiedad) {
      if (propiedad in trampa) return trampa[propiedad];
      return error();
    },
  });
}

export const supabaseAdmin: SupabaseClient = supabaseConfig.adminReady
  ? createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : supabaseConfig.url && supabaseConfig.anonKey
    ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : clienteSinConfigurar();
