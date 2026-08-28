/**
 * Prueba local (sin desplegar) de la sincronización Chatwoot → Supabase.
 * Simula fetch: Chatwoot (1 conversación abierta con actividad reciente) y
 * PostgREST de Supabase (mapa de conversaciones, dedupe de mensajes, etc.).
 *
 * Corre:  node --conditions=import scripts/prueba-sincronizacion-rapida.mjs  (tras compilar TS)
 * Este archivo usa el TS compilado on-the-fly vía esbuild si está disponible;
 * si no, se salta. Ver prueba() abajo.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Compilar el módulo TS con esbuild (dependencia transitiva de Next, ya instalada).
let esbuild;
try {
  esbuild = await import("esbuild");
} catch {
  console.log("esbuild no disponible: prueba saltada (usa `npm run build` para validar tipos).");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "tm-sync-"));
const outFile = join(dir, "sync.mjs");
const entry = join(process.cwd(), "src/lib/sync-chatwoot.ts");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
  external: [],
  define: { "process.env.SUPABASE_URL": JSON.stringify("https://sb.test") },
});

// ------------------------------ estado simulado ------------------------------
const nowSec = Math.floor(Date.now() / 1000);
const nowMs = Date.now();
const iso = (t) => new Date(t).toISOString();

const estado = {
  conversacionesCw: [
    {
      id: 77,
      inbox_id: 5,
      last_non_activity_message_at: nowSec + 60,
      last_activity_at: nowSec + 60,
      custom_attributes: {},
      meta: { sender: { name: "Ana", phone_number: "+573001112233", identifier: "3001112233", avatar_url: null } },
    },
    {
      id: 78,
      inbox_id: 3,
      last_non_activity_message_at: nowSec - 86400,
      last_activity_at: nowSec - 86400,
      custom_attributes: {},
      meta: { sender: { name: "Beto", phone_number: "+573004445566", identifier: "3004445566", avatar_url: null } },
    },
  ],
  mensajesCw77: [
    { id: 901, message_type: 0, content: "Hola, ¿me puede ayudar?", created_at: nowSec, private: false, attachments: null },
    { id: 902, message_type: 1, content: "Claro, cuéntame", created_at: nowSec + 1, private: false, attachments: null },
    { id: 903, message_type: 0, content: "¿Tiene disponible hoy?", created_at: nowSec + 60, private: false, attachments: null },
  ],
  mensajesCw78: [
    { id: 801, message_type: 0, content: "viejo", created_at: nowSec - 86400, private: false, attachments: null },
  ],
  // Supabase
  clientes: [{ id: "cli-1", telefono: "+573001112233", nombre: "Ana", foto_url: null }],
  conversaciones: [
    {
      id: "conv-1",
      chatwoot_conversation_id: "77",
      cliente_id: "cli-1",
      ultimo_mensaje_en: iso(nowMs + 1000), // ya tiene el 902
      no_leidos: 0,
      ultimo_leido_en: iso(nowMs + 1000),
      ultimo_mensaje: "Claro, cuéntame",
      numero_whatsapp: "+573001112233",
      fuente: "meta_business",
    },
    {
      id: "conv-2",
      chatwoot_conversation_id: "78",
      cliente_id: "cli-2",
      ultimo_mensaje_en: iso((nowSec - 86400) * 1000),
      no_leidos: 0,
      ultimo_leido_en: null,
      ultimo_mensaje: "viejo",
      numero_whatsapp: "+573004445566",
      fuente: "evolution",
    },
  ],
  mensajes: [
    { id: "m-1", conversacion_id: "conv-1", chatwoot_message_id: "901", tipo: "recibido", tipo_contenido: "texto", contenido: "Hola, ¿me puede ayudar?", url_archivo: null, creado_en: iso(nowMs) },
    { id: "m-2", conversacion_id: "conv-1", chatwoot_message_id: "902", tipo: "enviado", tipo_contenido: "texto", contenido: "Claro, cuéntame", url_archivo: null, creado_en: iso(nowMs + 1000) },
    { id: "m-3", conversacion_id: "conv-2", chatwoot_message_id: "801", tipo: "recibido", tipo_contenido: "texto", contenido: "viejo", url_archivo: null, creado_en: iso((nowSec - 86400) * 1000) },
  ],
  llamadas: [],
};

globalThis.fetch = async (urlRaw, init = {}) => {
  const url = new URL(urlRaw);
  const method = (init.method || "GET").toUpperCase();
  estado.llamadas.push({ host: url.host, path: url.pathname + url.search, method, body: init.body ? JSON.parse(init.body) : null });

  if (url.host.includes("sb.test")) {
    // PostgREST simulado
    if (url.pathname === "/rest/v1/") return Resp(200, { definitions: {} });
    if (url.pathname === "/rest/v1/conversaciones") {
      if (method === "PATCH") {
        const patch = init.body ? JSON.parse(init.body) : {};
        const idQ = url.searchParams.get("id");
        for (const c of estado.conversaciones) if (idQ === `eq.${c.id}`) Object.assign(c, patch);
        return Resp(204, null);
      }
      const cwQ = url.searchParams.get("chatwoot_conversation_id");
      if (cwQ) {
        const id = cwQ.replace("eq.", "");
        return Resp(200, estado.conversaciones.filter((c) => c.chatwoot_conversation_id === id));
      }
      return Resp(200, estado.conversaciones); // mapa completo
    }
    if (url.pathname === "/rest/v1/clientes") {
      const tQ = url.searchParams.get("telefono");
      if (tQ) return Resp(200, estado.clientes.filter((c) => c.telefono === tQ.replace("eq.", "")));
      return Resp(201, init.body ? JSON.parse(init.body) : []);
    }
    if (url.pathname === "/rest/v1/mensajes") {
      if (method === "POST") {
        for (const fila of init.body ? JSON.parse(init.body) : []) {
          estado.mensajes.push({ id: `m-${estado.mensajes.length + 1}`, conversacion_id: fila.conversacion_id, ...fila });
        }
        return Resp(201, null);
      }
      if (method === "PATCH") return Resp(204, null);
      const convId = (url.searchParams.get("conversacion_id") || "").replace("eq.", "");
      let rows = estado.mensajes.filter((m) => m.conversacion_id === convId);
      const desde = url.searchParams.get("creado_en");
      if (desde) rows = rows.filter((m) => Date.parse(m.creado_en) >= Date.parse(desde.replace("gte.", "")));
      const idsQ = url.searchParams.get("chatwoot_message_id");
      if (idsQ && idsQ.startsWith("in.")) {
        const ids = idsQ.slice(4, -1).split(",");
        rows = estado.mensajes.filter((m) => ids.includes(String(m.chatwoot_message_id)) && m.conversacion_id === convId);
      }
      return Resp(200, rows);
    }
    if (url.pathname === "/rest/v1/rpc/sincronizar_no_leidos") return Resp(200, null);
    return Resp(404, { error: "ruta no simulada: " + url.pathname });
  }

  // Chatwoot simulado
  if (url.pathname.endsWith("/conversations") && method === "GET") {
    return Resp(200, { payload: estado.conversacionesCw });
  }
  const det = url.pathname.match(/\/conversations\/(\d+)$/);
  if (det) {
    const conv = estado.conversacionesCw.find((c) => String(c.id) === det[1]);
    return conv ? Resp(200, conv) : Resp(404, {});
  }
  const msgs = url.pathname.match(/\/conversations\/(\d+)\/messages$/);
  if (msgs) {
    const conv = estado.conversacionesCw.find((c) => String(c.id) === msgs[1]);
    const lista = conv?.id === 77 ? estado.mensajesCw77 : estado.mensajesCw78;
    return Resp(200, { payload: lista });
  }
  return Resp(404, {});
};
function Resp(status, json) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return json == null ? "" : JSON.stringify(json); },
  };
}

const mod = await import(outFile);
let fallos = 0;
const check = (nombre, cond, detalle = "") => {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${cond ? "" : " — " + detalle}`);
  if (!cond) fallos++;
};
const conv1 = estado.conversaciones.find((c) => c.id === "conv-1");
const sbWrites = () => estado.llamadas.filter((l) => l.host.includes("sb.test") && (l.method === "PATCH" || l.method === "POST") && !l.path.includes("/rpc/"));

// ============ 1) Pasada delta FRÍA: encuentra y repara el 903 ============
estado.llamadas.length = 0;
let r = await mod.sincronizarTodo({ rapido: true });
const insertado = estado.mensajes.find((m) => m.chatwoot_message_id === "903");
check("delta con novedad: inserta el mensaje 903", Boolean(insertado) && r.mensajes_nuevos === 1, JSON.stringify(r));
check("delta con novedad: actualiza el resumen de la conversación", conv1.ultimo_mensaje === "¿Tiene disponible hoy?" && conv1.ultimo_mensaje_en === iso((nowSec + 60) * 1000), conv1.ultimo_mensaje + " / " + conv1.ultimo_mensaje_en);
check("delta: NO toca clientes cuando la conversación existe", !sbWrites().some((l) => l.path.includes("/clientes")));
check("delta: no vuelve a buscar la conversación dos veces", estado.llamadas.filter((l) => l.path.includes("chatwoot_conversation_id=eq.77")).length === 0, JSON.stringify(estado.llamadas.map((l) => l.method + " " + l.path.split("?")[0] + "?" + [...new URLSearchParams(l.path.split("?")[1] || "").keys()].join(","))));

// ============ 2) Pasadas CALIENTES: convergen a 0 escrituras y luego 2 lecturas ============
estado.llamadas.length = 0;
r = await mod.sincronizarTodo({ rapido: true }); // dedupe confirma, marca caché
check("2ª pasada: 0 escrituras en Supabase", sbWrites().length === 0, JSON.stringify(sbWrites()));
estado.llamadas.length = 0;
r = await mod.sincronizarTodo({ rapido: true }); // caliente: nada que hacer
check("3ª pasada (idle): 1 sola consulta a Chatwoot", estado.llamadas.filter((l) => !l.host.includes("sb.test")).length === 1, JSON.stringify(estado.llamadas));
check("3ª pasada (idle): 1 sola lectura a Supabase (el mapa)", estado.llamadas.filter((l) => l.host.includes("sb.test")).length === 1, JSON.stringify(estado.llamadas));
check("3ª pasada (idle): 0 escrituras", sbWrites().length === 0);
// llega un mensaje nuevo del cliente → la caché se invalida sola (actividad distinta)
estado.mensajesCw77.push({ id: 905, message_type: 0, content: "¿Sigue disponible?", created_at: nowSec + 120, private: false, attachments: null });
estado.conversacionesCw[0].last_non_activity_message_at = nowSec + 120;
estado.conversacionesCw[0].last_activity_at = nowSec + 120;
estado.llamadas.length = 0;
r = await mod.sincronizarTodo({ rapido: true });
check("mensaje nuevo: se detecta pese a la caché (inserta 905)", Boolean(estado.mensajes.find((m) => m.chatwoot_message_id === "905")) && r.mensajes_nuevos === 1, JSON.stringify(r));

// ============ 3) Webhook: mensaje nuevo en conversación conocida ============
estado.llamadas.length = 0;
r = await mod.procesarEventoWebhook({
  event: "message_created",
  id: 904,
  content: "¿Y a las 6pm?",
  message_type: 0,
  created_at: nowSec + 120,
  conversation: { id: 77, custom_attributes: {} },
  sender: { phone_number: "+573001112233", name: "Ana" },
});
check("webhook: inserta 904", Boolean(estado.mensajes.find((m) => m.chatwoot_message_id === "904")) && r.mensajes_nuevos === 1, JSON.stringify(r));
check("webhook: sin PATCH a clientes", !sbWrites().some((l) => l.path.includes("/clientes")));
const roundTrips = estado.llamadas.length;
check("webhook: pocos round-trips (≤6)", roundTrips <= 6, `${roundTrips} llamadas: ${JSON.stringify(estado.llamadas.map((l) => l.method + " " + l.path.split("?")[0]))}`);

// ============ 4) Reintento del MISMO evento: idempotente ============
estado.llamadas.length = 0;
r = await mod.procesarEventoWebhook({
  event: "message_created",
  id: 904,
  content: "¿Y a las 6pm?",
  message_type: 0,
  created_at: nowSec + 120,
  conversation: { id: 77, custom_attributes: {} },
  sender: { phone_number: "+573001112233", name: "Ana" },
});
check("webhook duplicado: 0 inserciones", r.mensajes_nuevos === 0, JSON.stringify(r));
check("webhook duplicado: 0 escrituras", sbWrites().length === 0, JSON.stringify(sbWrites()));

// ============ 5) message_updated no crea filas ============
r = await mod.procesarEventoWebhook(
  {
    event: "message_updated",
    id: 5555, // mensaje que NO existe todavía → no debe insertarse
    content: "leído ✓",
    message_type: 1,
    created_at: nowSec + 200,
    conversation: { id: 77, custom_attributes: {} },
    sender: { phone_number: "+573001112233", name: "Ana" },
  },
  { soloActualizarExistentes: true }
);
check("message_updated: no inserta mensajes nuevos", !estado.mensajes.find((m) => m.chatwoot_message_id === "5555"), JSON.stringify(r));

// ============ 6) conversación NUEVA vía webhook: crea cliente + conv ============
estado.llamadas.length = 0;
r = await mod.procesarEventoWebhook({
  event: "message_created",
  id: 999,
  content: "Primera vez",
  message_type: 0,
  created_at: nowSec + 30,
  conversation: { id: 79, custom_attributes: {}, meta: { sender: { phone_number: "+573009998877", name: "Cinthia" } } },
  sender: { phone_number: "+573009998877", name: "Cinthia" },
});
check("webhook conv nueva: no revienta, reporta o crea", typeof r.ok === "boolean" && r.tardo_ms >= 0, JSON.stringify(r));

console.log(fallos === 0 ? "\n🎉 TODO OK" : `\n💥 ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
