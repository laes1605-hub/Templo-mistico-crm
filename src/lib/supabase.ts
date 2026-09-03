import { createClient } from "@supabase/supabase-js";
import { supabaseConfig, mensajeConfigFaltante } from "./supabase-config";

/**
 * Cliente Supabase del navegador / cliente.
 *
 * Requiere `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * Si faltan, se exporta un cliente "trampa" que lanza un error claro al primer
 * uso (`.from`, `.rpc`, etc.) en lugar de hacer peticiones a una URL vacía.
 */
function clienteSinConfigurar() {
  const error = () => {
    throw new Error(mensajeConfigFaltante() || "Supabase sin configurar.");
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

export const supabase = supabaseConfig.ready
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : clienteSinConfigurar();
