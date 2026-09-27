#!/usr/bin/env node
/**
 * DIAGNÓSTICO DEL CRM — ¿Supabase se está actualizando y apunta donde debe?
 * ============================================================================
 * Créalo pensando para correrlo EN TU MÁQUINA (tu PC/servidor con internet),
 * NO en el sandbox. Revisa, en orden:
 *
 *   1) ¿La URL de Supabase es la correcta? (la del destino de tu migración)
 *   2) ¿Las llaves sirven contra ese proyecto? (anon y service_role)
 *   3) ¿La tabla `mensajes` se está actualizando? (último creado_en vs. ahora)
 *   4) ¿La tabla `conversaciones` avanza? (último ultimo_mensaje_en)
 *   5) ¿Chatwoot responde y tiene conversaciones? (para comparar)
 *
 * CÓMO USARLO (con las llaves NUEVAS de tu proyecto):
 *   SUPABASE_SERVICE_ROLE_KEY=<llave_nueva> \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_nueva> \
 *   CHATWOOT_API_TOKEN=<token_chatwoot> \
 *   node scripts/diagnostico-sistema.mjs
 *
 * Si NO pasás llaves, usa las que están escritas en el código (hoy en día
 * rechazadas por el proyecto nuevo) → verás "Invalid API key", que es justo
 * la señal de que hay que actualizarlas.
 */

const AHORA = Date.now();

const URL_SB =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://zcljlddtcoyfyvshlyfk.supabase.co";

const SRK = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsImJlZiI6InpjbGpsZGR0Y295Znl2c2hseWZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQ0NTQ4NCwiZXhwIjoyMTA0MDIxNDg0fQ._iG5UHv6fUc4QvhA56WbJ_P7WhIg1vyz1R3B5EWUU90"
).trim();

const ANON = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsImJlZiI6InpjbGpsZGR0Y295Znl2c2hseWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NDU0ODQsImV4cCI6MjEwNDAyMTQ4NH0.tBeu7TJpnEwSIcBMTC86G8-1EF4p1xaqPy_nxtaqv2Q"
).trim();

const CW_URL = (process.env.CHATWOOT_URL || "https://crmesteban.duckdns.org").replace(/\/$/, "");
const CW_TOKEN = (process.env.CHATWOOT_API_TOKEN || "KKaF2gF4bJZvnSkqKnR42zD8").trim();
const CW_ACCOUNT = (process.env.CHATWOOT_ACCOUNT_ID || "1").trim();

function haceCuanto(iso) {
  if (!iso) return "—";
  const ms = AHORA - Date.parse(iso);
  if (Number.isNaN(ms)) return `(${iso})`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} días`;
}

async function sb(ruta, key, etiqueta) {
  const r = await fetch(`${URL_SB}/rest/v1${ruta}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* no json */
  }
  return { status: r.status, ok: r.ok, json, texto, etiqueta };
}

async function cw(ruta) {
  const r = await fetch(`${CW_URL}/api/v1/accounts/${CW_ACCOUNT}${ruta}`, {
    headers: { api_access_token: CW_TOKEN, "api-access-token": CW_TOKEN, "Content-Type": "application/json" },
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* no json */
  }
  return { status: r.status, ok: r.ok, json, texto };
}

(async () => {
  console.log("══════════════════════════════════════════════════════════");
  console.log("  DIAGNÓSTICO CRM — Templo Místico (Supabase + Chatwoot)");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`Supabase URL : ${URL_SB}`);
  console.log(`Service role : ${SRK.slice(0, 18)}… (${SRK.length} chars)`);
  console.log(`Chatwoot     : ${CW_URL}  cuenta ${CW_ACCOUNT}`);
  console.log("");

  // 1) ¿Sirven las llaves contra este proyecto?
  console.log("── 1) Llaves de Supabase ────────────────────────────────");
  const testSR = await sb("/mensajes?select=id&limit=1", SRK, "service_role");
  const testAnon = await sb("/mensajes?select=id&limit=1", ANON, "anon");
  for (const t of [testSR, testAnon]) {
    if (t.ok) console.log(`   ✅ ${t.etiqueta}: VÁLIDA`);
    else if (/invalid api key/i.test(t.texto)) console.log(`   ❌ ${t.etiqueta}: Invalid API key (rechazada por el proyecto)`);
    else console.log(`   ⚠️  ${t.etiqueta}: HTTP ${t.status} — ${t.texto.slice(0, 120)}`);
  }
  if (!testSR.ok) {
    console.log("");
    console.log("   → CONCLUSIÓN: las llaves NO funcionan contra este proyecto.");
    console.log("     Pasá las NUEVAS por variable de entorno y volvé a correr:");
    console.log("       SUPABASE_SERVICE_ROLE_KEY=<nueva> NEXT_PUBLIC_SUPABASE_ANON_KEY=<nueva> node scripts/diagnostico-sistema.mjs");
    process.exit(0);
  }
  const KEY = SRK; // a partir de acá usamos la service_role (bypasea RLS)

  // 2) ¿Se actualiza `mensajes`?
  console.log("");
  console.log("── 2) Tabla mensajes (¿se actualiza?) ────────────────────");
  const ult = await sb("/mensajes?select=creado_en,tipo,contenido&order=creado_en.desc&limit=3", KEY);
  const cnt = await sb("/mensajes?select=id", KEY, { headers: { Prefer: "count=exact" } }).catch(() => null);
  if (ult.ok && Array.isArray(ult.json)) {
    if (ult.json.length === 0) console.log("   ⚠️  La tabla mensajes está VACÍA.");
    for (const m of ult.json) {
      const prev = String(m.contenido || "").replace(/\s+/g, " ").slice(0, 40);
      console.log(`   · ${m.creado_en}  (${haceCuanto(m.creado_en)})  [${m.tipo}] "${prev}"`);
    }
    const ultimoIso = ult.json[0]?.creado_en;
    const minutos = ultimoIso ? Math.round((AHORA - Date.parse(ultimoIso)) / 60000) : null;
    if (minutos !== null && minutos <= 10) console.log(`   ✅ El último mensaje tiene ${minutos} min → Supabase SÍ está recibiendo.`);
    else if (minutos !== null) console.log(`   ❌ El último mensaje tiene ${minutos} min → Supabase NO está recibiendo mensajes nuevos.`);
  } else {
    console.log(`   ⚠️  No se pudo leer mensajes: HTTP ${ult.status} ${ult.texto.slice(0, 120)}`);
  }

  // 3) ¿Avanza `conversaciones`?
  console.log("");
  console.log("── 3) Tabla conversaciones ──────────────────────────────");
  const conv = await sb("/conversaciones?select=ultimo_mensaje_en,ultimo_mensaje&order=ultimo_mensaje_en.desc.nullslast&limit=3", KEY);
  if (conv.ok && Array.isArray(conv.json) && conv.json.length > 0) {
    for (const c of conv.json) {
      const prev = String(c.ultimo_mensaje || "").replace(/\s+/g, " ").slice(0, 40);
      console.log(`   · ${c.ultimo_mensaje_en || "—"} (${haceCuanto(c.ultimo_mensaje_en)}) "${prev}"`);
    }
  } else if (conv.ok) {
    console.log("   ⚠️  conversaciones vacía.");
  } else {
    console.log(`   ⚠️  No se pudo leer conversaciones: HTTP ${conv.status} ${conv.texto.slice(0, 120)}`);
  }

  // 4) Chatwoot (¿recibe los mensajes?)
  console.log("");
  console.log("── 4) Chatwoot (fuente de la verdad) ────────────────────");
  const lista = await cw("/conversations?status=open&per_page=5");
  if (lista.ok) {
    const arr = lista.json?.data?.payload || lista.json?.payload || [];
    console.log(`   ✅ Chatwoot responde. Conversaciones abiertas (página 1): ${arr.length}`);
    const act = arr
      .map((c) => (c.last_non_activity_message_at || c.last_activity_at || 0) * 1000)
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    if (act) console.log(`   · Actividad más reciente en Chatwoot: ${new Date(act).toISOString()} (${haceCuanto(new Date(act).toISOString())})`);
  } else if (lista.status === 0) {
    console.log("   ❌ No se pudo conectar a Chatwoot (revisá la URL/red).");
  } else {
    console.log(`   ⚠️  Chatwoot HTTP ${lista.status}: ${lista.texto.slice(0, 120)}`);
    console.log("      (si es 401 'iniciar sesión', es el tema del proxy Caddy y la cabecera del token)");
  }

  console.log("");
  console.log("── Veredicto ────────────────────────────────────────────");
  console.log("· Si mensajes SÍ avanza y Chatwoot SÍ tiene actividad → el CRM debería mostrar todo (revisá el deploy/Vercel).");
  console.log("· Si mensajes NO avanza pero Chatwoot SÍ → el sync (Chatwoot→Supabase) está fallando o no corre.");
  console.log("· Si Chatwoot NO tiene actividad → el problema es WhatsApp→Chatwoot (Evolution/Meta).");
  console.log("══════════════════════════════════════════════════════════");
})().catch((e) => {
  console.error("Error inesperado:", e?.message || e);
  process.exit(1);
});
