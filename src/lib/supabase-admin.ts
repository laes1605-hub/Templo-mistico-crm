import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase para uso EXCLUSIVO en el servidor (route handlers).
 *
 * Si existe SUPABASE_SERVICE_ROLE_KEY usa la service role (ignora RLS), que es
 * lo recomendado para que el Cerebro pueda escribir reglas aunque la tabla esté
 * protegida. Si no existe, cae a la anon key para no romper el despliegue.
 */
const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://qrrkokfmbdtodrqbfehs.supabase.co";

const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const anonKey = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmtva2ZtYmR0b2RycWJmZWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxOTU1NDUsImV4cCI6MjEwMjc3MTU0NX0.pPbrwPjodbOg8xstoDekDHedQyZNQgmqLX4LShX0t2M"
).trim();

export const usingServiceRole = Boolean(serviceRoleKey);

export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  serviceRoleKey || anonKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);
