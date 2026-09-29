#!/usr/bin/env node
/**
 * MEDIR LA CARGA DE ADJUNTOS DEL CHAT (audios, fotos) — antes y después.
 * =====================================================================
 * Corré esto EN TU MÁQUINA (con internet), no en el servidor:
 *
 *   node scripts/medir-adjuntos.mjs
 *   node scripts/medir-adjuntos.mjs --limite 10        # más archivos
 *   node scripts/medir-adjuntos.mjs --chat <uuid>      # solo un chat
 *
 * Qué mide, para los últimos adjuntos de `mensajes`:
 *
 *   1. ORIGEN   → bajar el archivo directo de Chatwoot (lo que hace el servidor
 *                 en cada visita al proxy `/api/media/download`).
 *   2. PROXY    → bajar por `/api/media/download` (el camino del teléfono antes
 *                 de copiar el archivo a Storage). Muestra si pegó en el CDN
 *                 (`x-vercel-cache: HIT`) o si volvió a bajar del origen (MISS).
 *   3. STORAGE  → bajar la URL pública de Supabase (el camino nuevo: directo al
 *                 CDN, con caché y rangos).
 *
 * Al final compara y dice cuántos adjuntos quedan por copiar
 * (`/api/media/persistir` hace ese trabajo en segundo plano).
 *
 * Llaves: usa las del repo por defecto (como scripts/diagnostico-sistema.mjs) y
 * se pueden pisar por variables de entorno:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHATWOOT_URL, CHATWOOT_API_TOKEN,
 *   CRM_URL (por defecto https://templo-mistico-crm.vercel.app)
 */

const args = process.argv.slice(2);
const argDe = (nombre, porDefecto = null) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://zcljlddtcoyfyvshlyfk.supabase.co"
).replace(/\/$/, "");

const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjbGpsZGR0Y295Znl2c2hseWZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQ0NTQ4NCwiZXhwIjoyMTA0MDIxNDg0fQ._iG5UHv6fUc4QvhA56WbJ_P7WhIg1vyz1R3B5EWUU90";

const CHATWOOT_URL = (process.env.CHATWOOT_URL || "https://crmesteban.duckdns.org").replace(/\/$/, "");
const CHATWOOT_TOKEN = (process.env.CHATWOOT_API_TOKEN || "KKaF2gF4bJZvnSkqKnR42zD8").trim();
const CRM_URL = (process.env.CRM_URL || "https://templo-mistico-crm.vercel.app").replace(/\/$/, "");

const LIMITE = Number(argDe("limite", "6"));
const CHAT = argDe("chat");
const TIMEOUT_MS = 45_000;

const sbHeaders = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

const ms = (n) => `${Math.round(n)} ms`;
const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;
const kb = (n) => (n >= 1024 * 1024 ? mb(n) : `${Math.round(n / 1024)} KB`);
const humano = (n) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`);

function estadoDe(url) {
  const u = String(url || "");
  if (!u) return "sin archivo";
  if (/\/storage\/v1\/object\/public\//i.test(u)) return "Storage ✅";
  if (u.startsWith("data:")) return "base64 ⚠️";
  return "externo (Chatwoot)";
}

async function medir(url, { headers = {}, etiqueta = "" } = {}) {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  const inicio = performance.now();
  try {
    const res = await fetch(url, { headers, signal: controlador.signal, redirect: "follow" });
    const buf = await res.arrayBuffer();
    const tardanza = performance.now() - inicio;
    return {
      ok: res.ok,
      status: res.status,
      ms: tardanza,
      bytes: buf.byteLength,
      cache: res.headers.get("x-vercel-cache") || res.headers.get("cf-cache-status") || "",
      tipo: res.headers.get("content-type") || "",
      etiqueta,
    };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - inicio, bytes: 0, error: e?.message || "error", etiqueta };
  } finally {
    clearTimeout(reloj);
  }
}

async function traerMensajes() {
  let url = `${SUPABASE_URL}/rest/v1/mensajes?select=id,tipo_contenido,url_archivo,creado_en,contenido&url_archivo=not.is.null&order=creado_en.desc&limit=${Math.max(LIMITE * 3, 12)}`;
  if (CHAT) url += `&conversacion_id=eq.${encodeURIComponent(CHAT)}`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) {
    throw new Error(`Supabase respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function pendientes() {
  try {
    const res = await fetch(`${CRM_URL}/api/media/persistir?dias=30`);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.pendientes !== "number") return null;
    return { pendientes: data.pendientes, quedanMas: data.quedanMas === true };
  } catch {
    return null;
  }
}

async function main() {
  console.log("📥 Midiendo la carga de adjuntos del CRM\n");
  console.log(`   Supabase:  ${SUPABASE_URL}`);
  console.log(`   Chatwoot:  ${CHATWOOT_URL}`);
  console.log(`   CRM:       ${CRM_URL}`);
  console.log(`   Límite:    ${LIMITE} adjunto(s)${CHAT ? ` · chat ${CHAT}` : ""}\n`);

  const filas = (await traerMensajes()).filter((f) => f.url_archivo);
  const conAdjunto = filas.filter((f) => String(f.url_archivo).length > 0);
  const resumen = { Storage: 0, base64: 0, externo: 0 };
  for (const f of conAdjunto) {
    const e = estadoDe(f.url_archivo);
    if (e.startsWith("Storage")) resumen.Storage++;
    else if (e.startsWith("base64")) resumen.base64++;
    else if (e.startsWith("externo")) resumen.externo++;
  }

  console.log("Estado de los últimos adjuntos:");
  console.log(`   ✅ en Storage (rápidos):        ${resumen.Storage}`);
  console.log(`   🐢 en Chatwoot (van por proxy): ${resumen.externo}`);
  console.log(`   🐌 en base64 dentro de la fila: ${resumen.base64}\n`);

  const aMedir = conAdjunto.filter((f) => !String(f.url_archivo).startsWith("data:")).slice(0, LIMITE);
  if (aMedir.length === 0) {
    console.log("No hay adjuntos con URL para medir (¿todo en base64?).");
  }

  const filasTabla = [];
  for (const f of aMedir) {
    const url = String(f.url_archivo);
    const tipo = String(f.tipo_contenido || "?").padEnd(7);
    const esStorage = /\/storage\/v1\/object\/public\//i.test(url);

    // 1) Origen (lo que hace el servidor dentro del proxy)
    const origen = esStorage
      ? null
      : await medir(url, {
          headers: /\/rails\/active_storage\//i.test(url)
            ? { api_access_token: CHATWOOT_TOKEN, "api-access-token": CHATWOOT_TOKEN }
            : {},
        });

    // 2) Proxy del CRM (el camino del teléfono)
    const proxy = await medir(`${CRM_URL}/api/media/download?url=${encodeURIComponent(url)}`);

    // 3) Storage directo (solo si ya está copiado)
    const storage = esStorage ? await medir(url) : null;

    filasTabla.push({ tipo, origen, proxy, storage, bytes: origen?.bytes || proxy.bytes || storage?.bytes || 0 });
    console.log(`· ${f.id} ${tipo} ${estadoDe(url)} · ${kb(origen?.bytes || proxy.bytes || 0)}`);
    if (origen) console.log(`    origen  (Chatwoot) : ${origen.ok ? ms(origen.ms) : `✗ ${origen.status || origen.error}`}`);
    console.log(
      `    proxy   (CRM)      : ${proxy.ok ? ms(proxy.ms) : `✗ ${proxy.status || proxy.error}`}${
        proxy.cache ? ` · CDN ${proxy.cache}` : ""
      }`
    );
    if (storage) console.log(`    storage (CDN SB)   : ${storage.ok ? ms(storage.ms) : `✗ ${storage.status || storage.error}`}`);
  }

  const promedio = (lista) => {
    const ok = lista.filter(Boolean).filter((r) => r.ok);
    if (ok.length === 0) return null;
    return { ms: ok.reduce((s, r) => s + r.ms, 0) / ok.length, n: ok.length };
  };

  const pOrigen = promedio(filasTabla.map((f) => f.origen));
  const pProxy = promedio(filasTabla.map((f) => f.proxy));
  const pStorage = promedio(filasTabla.map((f) => f.storage));

  console.log("\n================ RESUMEN ================");
  if (pOrigen) console.log(`Origen Chatwoot (servidor → Chatwoot): ${ms(pOrigen.ms)} promedio (${pOrigen.n})`);
  if (pProxy) console.log(`Proxy del CRM (teléfono → CRM):        ${ms(pProxy.ms)} promedio (${pProxy.n})`);
  if (pStorage) console.log(`Storage (teléfono → CDN Supabase):     ${ms(pStorage.ms)} promedio (${pStorage.n})`);
  if (pProxy && pStorage) {
    const mejora = pProxy.ms / Math.max(pStorage.ms, 1);
    console.log(`\n➡️  El mismo archivo por Storage tarda ${mejora.toFixed(1)}× menos que por el proxy.`);
  }
  if (pOrigen && pProxy) {
    console.log(
      `➡️  El proxy añade ${ms(Math.max(0, pProxy.ms - pOrigen.ms))} sobre bajar del origen (un salto de red de más).`
    );
  }

  const porCopiar = await pendientes();
  if (porCopiar !== null) {
    console.log(
      `\nAdjuntos que todavía viven fuera del CDN (últimos 30 días): ${porCopiar.pendientes}.\n` +
        (porCopiar.pendientes > 0
          ? "Se van copiando solos en segundo plano; también podés forzarlos desde Ajustes → Migrar adjuntos."
          : "Todo listo: los adjuntos ya salen del CDN de Supabase.")
    );
    if (porCopiar.pendientes === 0 && porCopiar.quedanMas) {
      console.log("(El contador solo mira las últimas filas: puede haber más atrás.)");
    }
    console.log(`Contador en vivo: ${CRM_URL}/api/media/persistir`);
  }
}

main().catch((e) => {
  const motivo = e?.message || String(e);
  console.error(`\n✗ No se pudo medir: ${motivo}`);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(motivo)) {
    console.error(
      "   No hubo conexión con Supabase. Revisá internet/red, y que SUPABASE_URL y\n" +
        "   SUPABASE_SERVICE_ROLE_KEY sean las llaves del proyecto actual."
    );
  }
  process.exitCode = 1;
});
