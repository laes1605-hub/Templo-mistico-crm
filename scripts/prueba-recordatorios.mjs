#!/usr/bin/env node
/**
 * Pruebas de los recordatorios de WhatsApp API (n8n/03-recordatorios-whatsapp-por-etapa.json).
 *
 * NO copia el código: lee el jsCode de los tres nodos Code del workflow que se
 * importa en n8n y lo ejecuta contra un Chatwoot y un Supabase simulados. Así
 * se prueba exactamente lo que va a correr en producción.
 *
 * Cubre el arreglo del 19/09/2026: las etapas se resuelven por NOMBRE en todo
 * el pipeline (antes se exigía grupo = 'templo' y "Datos" ya es 'general'), y
 * los chats del WhatsApp API se reconocen por fuente = meta_business, no por
 * clientes.grupo.
 *
 * Uso: npm run test:recordatorios
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extraerReglas, decidir, preparar, informe, tipoDeEtapa } from "./simular-recordatorios.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUTA_WORKFLOW = path.join(raiz, "n8n", "03-recordatorios-whatsapp-por-etapa.json");
const workflow = JSON.parse(fs.readFileSync(RUTA_WORKFLOW, "utf8"));

const node = (nombre) => {
  const encontrado = (workflow.nodes || []).find((n) => n.name === nombre);
  if (!encontrado) throw new Error("Falta el nodo en el workflow: " + nombre);
  return encontrado.parameters.jsCode;
};

const CODIGO = {
  buscar: node("Buscar clientes y preparar recordatorio"),
  enviar: node("Enviar por WhatsApp API"),
  registrar: node("Registrar envío e impedir duplicados"),
};

// ---------------------------------------------------------------------------
// Mini framework
// ---------------------------------------------------------------------------
let pasadas = 0;
const fallos = [];
function check(nombre, condicion, detalle = "") {
  if (condicion) {
    pasadas++;
    console.log("  ✓ " + nombre);
  } else {
    fallos.push(nombre + (detalle ? " → " + detalle : ""));
    console.log("  ✗ " + nombre + (detalle ? " → " + detalle : ""));
  }
}
function grupo(titulo) {
  console.log("\n" + titulo);
}

// ---------------------------------------------------------------------------
// Compilación de un nodo Code de n8n
// ---------------------------------------------------------------------------
function compilar(jsCode) {
  // Las funciones de n8n se inyectan como argumentos y `this.helpers` se
  // resuelve con .call({ helpers }), igual que en el nodo Code.
  return new Function(
    "helpers",
    "$input",
    "$",
    '"use strict";\nreturn (async function () {\n' + jsCode + "\n}).call({ helpers: helpers });"
  );
}

// Entrada del nodo Code. Se prueban los dos modos de n8n por separado:
//   · «Run Once for All Items» (por defecto): hay $input.all() y $input.first();
//     $input.item puede no existir.
//   · «Run Once for Each Item»: existe $input.item.
const entradaTodos = (json) => ({ all: () => [{ json: json }], first: () => ({ json: json }) });
const entradaPorItem = (json) => ({ item: { json: json }, all: () => [{ json: json }], first: () => ({ json: json }) });
// El más hostil: $input.item existe pero revienta si se toca (como en algunos n8n).
const entradaSinItem = (json) => new Proxy({ all: () => [{ json: json }], first: () => ({ json: json }) }, {
  get(objetivo, prop) {
    if (prop === 'item') throw new Error('Can\'t use $input.item in this mode');
    return objetivo[prop];
  }
});
const entrada = entradaTodos;

// ---------------------------------------------------------------------------
// Chatwoot + Supabase simulados
// ---------------------------------------------------------------------------
function servidorFalso(cfg = {}) {
  const llamadas = [];
  const estado = { enviadosChatwoot: [], insertadosSupabase: [] };

  const httpRequest = async ({ method = "GET", url, body }) => {
    llamadas.push({ method, url, body });
    const u = new URL(url);
    const p = u.pathname;
    const q = u.searchParams;

    if (p.startsWith("/rest/v1")) {
      if (p.endsWith("/pipeline_etapas")) {
        if (cfg.errorEtapas) throw new Error("relation pipeline_etapas does not exist");
        return cfg.etapas || [];
      }
      if (p.endsWith("/conversaciones")) {
        // Igual que PostgREST: la consulta del nodo trae TODAS las filas del API
        // con su cliente (una sola llamada); si piden un chat concreto, esa.
        if (cfg.errorConversaciones) throw new Error("relation conversaciones does not exist");
        // La migración que agrega clientes.estado_desde puede no estar corrida.
        if (cfg.errorEstadoDesde && url.includes("estado_desde")) {
          throw new Error("column clientes.estado_desde does not exist");
        }
        const fuente = String(q.get("fuente") || "").replace(/^eq\./, "");
        const ids = String(q.get("cliente_id") || "")
          .replace(/^in\.\(/, "")
          .replace(/\)$/, "")
          .split(",")
          .filter(Boolean);
        let todas = fuente === "evolution"
          ? cfg.personales || []
          : Array.isArray(cfg.convs) ? cfg.convs : Object.values(cfg.convs || {});
        if (ids.length) todas = todas.filter((f) => ids.indexOf(f.cliente_id) !== -1);
        const cw = String(q.get("chatwoot_conversation_id") || "").replace(/^eq\./, "");
        return cw ? todas.filter((f) => String(f.chatwoot_conversation_id) === cw) : todas;
      }
      if (p.endsWith("/recordatorios_whatsapp")) {
        if (method === "POST") {
          estado.insertadosSupabase.push(body);
          return { ok: true };
        }
        // El nodo pide UNA vez los envíos de las últimas 24 h.
        if (cfg.errorRegistros) throw new Error("relation recordatorios_whatsapp does not exist");
        const corte = String(q.get("enviado_en") || "").replace(/^gte\./, "");
        const todas = Object.entries(cfg.registros || {}).flatMap(([clave, filasDeClave]) => {
          const [clienteId, etapa] = clave.split("|");
          return (filasDeClave || []).map((r) => ({ cliente_id: clienteId, etapa: etapa, ...r }));
        });
        return todas.filter((r) => !corte || (r.enviado_en && new Date(r.enviado_en).toISOString() >= corte));
      }
      throw new Error("Consulta Supabase no simulada: " + url);
    }

    // Chatwoot
    if (p.endsWith("/messages") && method === "GET") {
      if (cfg.errorChatwoot) throw new Error("Request failed with status code 401");
      const id = p.split("/conversations/")[1].split("/")[0];
      return { payload: (cfg.mensajes || {})[id] || [] };
    }
    if (p.endsWith("/messages") && method === "POST") {
      if (cfg.envioFalla) {
        const error = new Error("Request failed with status code 422");
        error.response = { body: { error: "You cannot reply to this conversation" } };
        throw error;
      }
      estado.enviadosChatwoot.push(body);
      return { id: 9001 };
    }
    if (p.endsWith("/conversations") && method === "GET") {
      if (cfg.errorChatwoot) throw new Error("Request failed with status code 401");
      return { data: { payload: cfg.abiertos || [] } };
    }
    throw new Error("Llamada no simulada: " + method + " " + url);
  };

  // Igual que en n8n: el nodo Code recibe `this.helpers` con httpRequest.
  return { helpers: { httpRequest: httpRequest }, llamadas: llamadas, estado: estado };
}

// ---------------------------------------------------------------------------
// Helpers de escenario
// ---------------------------------------------------------------------------
const ETAPAS_REALES = [
  { clave: "nuevo_lead", nombre: "Nuevo Lead", grupo: "general", cuenta_responsable: "meta_business", es_spam: false, es_archivado: false },
  // "Datos" quedó en grupo 'general' al unificar el pipeline: antes el workflow
  // la descartaba por no ser 'templo'.
  { clave: "etapa_1787876104854", nombre: "Datos", grupo: "general", cuenta_responsable: "meta_business", es_spam: false, es_archivado: false },
  { clave: "etapa_templo_1787618330816", nombre: "No contesta", grupo: "templo", cuenta_responsable: "evolution", es_spam: false, es_archivado: false },
  { clave: "spam", nombre: "Spam", grupo: "personal", cuenta_responsable: "evolution", es_spam: true, es_archivado: false },
];

const AHORA = Math.floor(Date.now() / 1000);
const hace = (horas) => AHORA - Math.round(horas * 3600);

function conversacion(extra = {}) {
  return {
    id: 271,
    labels: [],
    meta: { sender: { name: "Ana Perez", phone_number: "+595982647259" } },
    ...extra,
  };
}

const iso = (segundos) => new Date(segundos * 1000).toISOString();

// Fila de `conversaciones` con su cliente, tal como la devuelve Supabase con
// clientes!inner(*). El tiempo sin contestar sale de ultimo_entrante_api_en.
function filaSupabase(extra = {}, clienteExtra = {}) {
  return {
    id: "conv-271",
    cliente_id: "cli-1",
    chatwoot_conversation_id: 271,
    chatwoot_conversation_ids: ["271"],
    numero_whatsapp: "+595982647259",
    fuente: "meta_business",
    estado: "activa",
    archivada: false,
    silenciado: false,
    ultimo_entrante_api_en: iso(hace(2)),
    ultimo_mensaje_en: iso(hace(2)),
    clientes: {
      id: "cli-1",
      nombre: "Ana Perez",
      telefono: "+595982647259",
      estado: "etapa_1787876104854",
      grupo: "personal",
      es_spam: false,
      ...clienteExtra,
    },
    ...extra,
  };
}

// La misma fila con las horas sin contestar que se quieran probar.
function filaConHoras(horas, extra = {}, clienteExtra = {}) {
  return filaSupabase(
    { ultimo_entrante_api_en: iso(hace(horas)), ultimo_mensaje_en: iso(hace(horas)), ...extra },
    clienteExtra
  );
}

async function ejecutarBuscar(cfg) {
  const servidor = servidorFalso(cfg);
  const fn = compilar(CODIGO.buscar);
  const salida = await fn(servidor.helpers, { first: () => ({ json: {} }) }, () => ({}));
  const items = Array.isArray(salida) ? salida.map((i) => i.json) : [];
  return {
    items,
    recordatorios: items.filter((i) => !i._diagnostico),
    diagnostico: items.find((i) => i._diagnostico) || null,
    servidor,
  };
}

function escenario(extra = {}) {
  return {
    etapas: ETAPAS_REALES,
    convs: [filaSupabase()],
    // Chatwoot ya solo se usa para verificar horas y para enviar: el listado de
    // conversaciones (abiertos) ya no se consulta.
    mensajes: { 271: [{ message_type: 0, created_at: hace(2), content: "hola" }] },
    registros: {},
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1) Etapas: se resuelven por NOMBRE en todo el pipeline
// ---------------------------------------------------------------------------
grupo("1) Etapas por nombre (causa de que no llegaran los recordatorios)");

{
  const r = await ejecutarBuscar(escenario());
  check("«Datos» en grupo 'general' ya genera recordatorio", r.recordatorios.length === 1, "recibidos: " + r.recordatorios.length);
  check("El recordatorio es de tipo datos y espera los datos/fotos", r.recordatorios[0]?.etapa === "datos" && /estamos esperando los datos/.test(r.recordatorios[0]?.mensaje || ""));
  check("Intento 1 con 2 h desde la última respuesta", r.recordatorios[0]?.intento === 1);
  check(
    "Ya NO se filtra pipeline_etapas por grupo=templo",
    !r.servidor.llamadas.some((l) => l.url.includes("pipeline_etapas") && l.url.includes("grupo=eq.templo"))
  );
  check("El diagnóstico informa las etapas reconocidas", r.diagnostico?.etapasReconocidas?.datos?.clave === "etapa_1787876104854");
}

{
  const r = await ejecutarBuscar(escenario({ convs: [filaSupabase({}, { estado: "etapa_templo_1787618330816" })] }));
  check("«No contesta» (grupo templo) genera el recordatorio de llamada", r.recordatorios.length === 1 && r.recordatorios[0].etapa === "noContesta");
  check("Plantilla de llamada correcta", /atender la llamada/.test(r.recordatorios[0]?.mensaje || ""));
}

{
  const r = await ejecutarBuscar(escenario({ convs: [filaSupabase({}, { estado: "Datos" })] }));
  check("Si clientes.estado guarda el NOMBRE de la etapa también se resuelve", r.recordatorios.length === 1);
}

{
  const r = await ejecutarBuscar(escenario({ etapas: [{ clave: "x", nombre: "En Consulta", grupo: "general" }] }));
  check("Sin etapa de recordatorio NO revienta el workflow", r.items.length === 1 && r.diagnostico !== null);
  check("Aviso claro de etapa faltante", (r.diagnostico?.avisos || []).some((a) => /Datos/.test(a)));
}

// ---------------------------------------------------------------------------
// 2) Qué chats entran (fuente meta_business, no clientes.grupo)
// ---------------------------------------------------------------------------
grupo("2) Qué chats entran (fuente meta_business, sin depender de Chatwoot)");

{
  const r = await ejecutarBuscar(escenario({ convs: [filaSupabase({}, { grupo: "personal" })] }));
  check("Cliente con grupo 'personal' en etapa Datos recibe recordatorio", r.recordatorios.length === 1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: [filaSupabase({}, { grupo: "templo" })] }));
  check("Cliente con grupo 'templo' también", r.recordatorios.length === 1);
}
{
  // Este era el fallo de «solo envió a uno»: la lista salía del endpoint de
  // Chatwoot (por páginas y con una llamada por chat) y se cortaba.
  const r = await ejecutarBuscar(escenario());
  const listado = r.servidor.llamadas.filter((l) => l.method === "GET" && new URL(l.url).pathname.endsWith("/conversations"));
  check("Ya NO se pide el listado de conversaciones a Chatwoot", listado.length === 0);
  check("Los candidatos salen de una sola consulta a Supabase", r.servidor.llamadas.filter((l) => l.url.includes("/rest/v1/conversaciones")).length === 1);
  check("El diagnóstico dice de dónde salen los candidatos", /Supabase/.test(r.diagnostico?.fuenteDeDatos || ""));
  check("El diagnóstico trae un resumen legible de la pasada", /Revisé 1 chat/.test(r.diagnostico?.resumen || "") && /recordatorios listos: 1/.test(r.diagnostico?.resumen || ""));
}
{
  const r = await ejecutarBuscar(escenario({ convs: [] }));
  check("Sin chats del API no se envía nada y el diagnóstico lo avisa", r.recordatorios.length === 0 && (r.diagnostico?.avisos || []).some((a) => /conversaciones/.test(a)));
}
{
  // «bot-pausado» ya no existe como veto: el silencio lo decide el CRM.
  const r = await ejecutarBuscar(escenario());
  check("El diagnóstico ya no depende de etiquetas de Chatwoot", Array.isArray(r.diagnostico?.pausasQueApagan) && JSON.stringify(r.diagnostico.pausasQueApagan).indexOf("bot") === -1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: [filaSupabase({ silenciado: true })] }));
  check("Chat silenciado en el CRM se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.silenciado === 1);
  check("Y el aviso lo explica", (r.diagnostico.avisos || []).some((a) => /silenciad/.test(a)));
}
{
  const r = await ejecutarBuscar(escenario({ convs: [filaSupabase({ archivada: true })] }));
  check("Conversación archivada se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.archivada === 1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: [filaSupabase({}, { es_spam: true })] }));
  check("Cliente marcado como spam se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.spam === 1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: [filaSupabase({}, { estado: "consulta_hecha" })] }));
  check("Etapa sin recordatorio (Consulta Hecha) se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.etapaSinRecordatorio === 1);
}
{
  // Nunca ha escrito: no hay hora de entrante en el CRM y Chatwoot tampoco
  // devuelve ningún mensaje del cliente.
  const r = await ejecutarBuscar(
    escenario({
      convs: [filaSupabase({ ultimo_entrante_api_en: null, ultimo_mensaje_en: null })],
      mensajes: { 271: [{ message_type: "outgoing", created_at: hace(2) }] },
    })
  );
  check("Chat donde el cliente nunca ha escrito se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.sinMensajesEntrantes === 1);
}
{
  // El CRM registró un mensaje NUEVO después del último entrante que tenía
  // guardado (puede ser del cliente): se confirma la hora contra Chatwoot.
  const r = await ejecutarBuscar(
    escenario({
      convs: [filaSupabase({ ultimo_entrante_api_en: iso(hace(5)), ultimo_mensaje_en: iso(hace(0.6)) })],
      mensajes: { 271: [{ message_type: 0, created_at: hace(0.6) }] },
    })
  );
  check("Verifica contra Chatwoot cuando hubo actividad posterior", r.diagnostico.conteo.verificadosEnChatwoot === 1 && r.recordatorios[0]?.fuenteTiempo === "chatwoot");
  check("Con la hora real (36 min) manda la variante 1, no la 2", r.recordatorios[0]?.intento === 1, "intento: " + r.recordatorios[0]?.intento);
}
{
  // Si esa verificación no se puede hacer, se usa la hora del CRM y se avisa.
  const r = await ejecutarBuscar(
    escenario({
      errorChatwoot: true,
      convs: [filaSupabase({ ultimo_entrante_api_en: iso(hace(5)), ultimo_mensaje_en: iso(hace(0.6)) })],
    })
  );
  check("Sin Chatwoot igual se envía con la hora del CRM", r.recordatorios.length === 1 && r.recordatorios[0].fuenteTiempo === "crm");
  check("Y el diagnóstico deja el error visible", (r.diagnostico.errores || []).some((e) => /Chatwoot/.test(e)));
}

// ---------------------------------------------------------------------------
// 2b) «No contesta»: reloj desde que entra a la etapa y envío por WhatsApp Personal
// ---------------------------------------------------------------------------
grupo("2b) «No contesta»: reloj por etapa y envío por el WhatsApp Personal");

const chatPersonal = () => [
  { cliente_id: "cli-1", chatwoot_conversation_id: 273, chatwoot_conversation_ids: ["273"], archivada: false, silenciado: false, ultimo_entrante_en: null },
];
const enNoContesta = (horasEtapa, horasMensaje, extra = {}) =>
  escenario({
    convs: [filaConHoras(horasMensaje, {}, { estado: "etapa_templo_1787618330816", estado_desde: iso(hace(horasEtapa)), ...extra })],
    personales: chatPersonal(),
  });

{
  const r = await ejecutarBuscar(enNoContesta(0.33, 30));
  check(
    "Con 20 min en la etapa todavía no sale (aunque su mensaje sea de hace 30 h)",
    r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.esperandoTiempo === 1
  );
}
{
  const r = await ejecutarBuscar(enNoContesta(0.67, 30));
  check("40 min en la etapa → plantilla 1", r.recordatorios[0]?.intento === 1, "intento: " + r.recordatorios[0]?.intento);
  check("Se envía por el chat de WhatsApp Personal", r.recordatorios[0]?.canal === "personal" && r.recordatorios[0]?.conversationId === 273);
  check("El reloj es el de la etapa", r.recordatorios[0]?.reloj === "etapa");
  check(
    "La ventana de 24 h del API ya no bloquea ese recordatorio",
    r.diagnostico.conteo.omitidas.ventanaCerrada === 0 && r.diagnostico.conteo.enviadosPorPersonal === 1
  );
}
{
  const r = await ejecutarBuscar(enNoContesta(48, 80));
  check("Dos días en «No contesta» → plantilla 4 por el personal", r.recordatorios[0]?.intento === 4 && r.recordatorios[0]?.canal === "personal");
}
{
  const r = await ejecutarBuscar(
    escenario({ convs: [filaConHoras(30, {}, { estado: "etapa_templo_1787618330816", estado_desde: iso(hace(48)) })], personales: [] })
  );
  check(
    "Sin WhatsApp Personal y ventana cerrada se omite con motivo",
    r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.sinChatPersonal === 1
  );
  check("Y el aviso lo explica", (r.diagnostico.avisos || []).some((a) => /WhatsApp Personal/.test(a)));
}
{
  const r = await ejecutarBuscar(
    escenario({ convs: [filaConHoras(5, {}, { estado: "etapa_templo_1787618330816", estado_desde: iso(hace(1)) })], personales: [] })
  );
  check("Sin WhatsApp Personal se usa el chat del API (con su ventana)", r.recordatorios[0]?.canal === "api" && r.recordatorios[0]?.intento === 1);
}
{
  // «Datos» sigue contando desde el último mensaje del cliente.
  const r = await ejecutarBuscar(escenario({ convs: [filaConHoras(5)], personales: chatPersonal() }));
  check("«Datos» no usa el reloj de la etapa ni el canal personal", r.recordatorios[0]?.reloj === "mensaje" && r.recordatorios[0]?.canal === "api" && r.recordatorios[0]?.intento === 2);
}
{
  // Migración pendiente: el nodo reintenta sin la columna y sigue funcionando.
  const r = await ejecutarBuscar(escenario({ errorEstadoDesde: true }));
  check("Si falta clientes.estado_desde el workflow sigue funcionando", r.recordatorios.length === 1 && r.diagnostico.estadoDesdeDisponible === false);
  check("Y el aviso lo dice", (r.diagnostico.avisos || []).some((a) => /estado_desde/.test(a)));
}

// ---------------------------------------------------------------------------
// 3) Variante por tiempo sin contestar: 30 min · 3 h · 12 h · 23 h 30 min
// ---------------------------------------------------------------------------
grupo("3) Cada cliente recibe la variante acorde a su tiempo sin contestar");

const hace24 = new Date(Date.now() - 3600 * 1000).toISOString();
const tiempos = [
  { horas: 0.33, previos: [], variante: 0, nota: "20 min → todavía no cumple los 30 min" },
  { horas: 0.6, previos: [], variante: 1, nota: "36 min → variante 1" },
  { horas: 1, previos: [], variante: 1, nota: "1 h sin contestar (sin ningún envío) → variante 1" },
  { horas: 4, previos: [], variante: 2, nota: "4 h sin contestar y sin envíos previos → variante 2" },
  { horas: 8, previos: [], variante: 2, nota: "8 h sin contestar → variante 2" },
  { horas: 13, previos: [], variante: 3, nota: "13 h sin contestar → variante 3" },
  { horas: 23.7, previos: [], variante: 4, nota: "23,7 h sin contestar → variante 4" },
  {
    horas: 4,
    previos: [{ tipo: "datos", plantilla: 2, enviado_en: hace24 }],
    variante: 0,
    nota: "4 h, pero la variante 2 ya salió hace menos de 24 h → no se repite",
  },
  {
    horas: 4,
    previos: [{ tipo: "datos", plantilla: 2, enviado_en: "2026-08-27T15:15:17Z" }],
    variante: 2,
    nota: "4 h con un envío viejo (más de 24 h) → la variante 2 sí sale",
  },
];
for (const t of tiempos) {
  const r = await ejecutarBuscar(
    escenario({
      convs: [filaConHoras(t.horas)],
      registros: { "cli-1|etapa_1787876104854": t.previos },
    })
  );
  check(t.nota, (r.recordatorios[0]?.intento || 0) === t.variante, "intento: " + r.recordatorios[0]?.intento);
}

{
  const r = await ejecutarBuscar(escenario({ convs: [filaConHoras(25)] }));
  check("Pasadas 24 h no se intenta (Meta rechazaría el texto libre)", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.ventanaCerrada === 1);
  check("Y el diagnóstico lo explica", (r.diagnostico.avisos || []).some((a) => /ventana de 24 h/.test(a)));
}
{
  // Los envíos del tipo "noContesta" también cuentan para no repetir la variante.
  const r = await ejecutarBuscar(
    escenario({
      convs: [filaConHoras(5, {}, { estado: "etapa_templo_1787618330816" })],
      registros: { "cli-1|etapa_templo_1787618330816": [{ tipo: "noContesta", plantilla: 2, enviado_en: hace24 }] },
    })
  );
  check(
    "La variante 2 guardada como 'noContesta' no se repite",
    r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.varianteYaEnviada === 1
  );
}
{
  const r = await ejecutarBuscar(
    escenario({
      convs: [filaConHoras(5, {}, { estado: "etapa_templo_1787618330816" })],
      registros: { "cli-1|etapa_templo_1787618330816": [{ tipo: "sinRespuesta", plantilla: 2, enviado_en: hace24 }] },
    })
  );
  check("También cuenta los guardados como 'sinRespuesta'", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.varianteYaEnviada === 1);
}

// ---------------------------------------------------------------------------
// 4) Credenciales: variables de entorno del n8n o el respaldo del nodo
// ---------------------------------------------------------------------------
grupo("4) Credenciales escritas en el nodo (n8n sin variables de entorno)");

{
  const r = await ejecutarBuscar(escenario());
  const todoElCodigo = CODIGO.buscar + CODIGO.enviar + CODIGO.registrar;
  check("Los tres nodos traen la URL de Supabase escrita", (todoElCodigo.match(/const SUPABASE_URL = 'https:\/\/[^']+'/g) || []).length === 3);
  check("Los tres nodos traen la service_role escrita", (todoElCodigo.match(/const SUPABASE_SERVICE_ROLE_KEY = 'eyJ/g) || []).length === 3);
  check("Los tres nodos traen el Chatwoot y su token escritos", (todoElCodigo.match(/const CHATWOOT_URL = 'https:/g) || []).length === 3 && (todoElCodigo.match(/const CHATWOOT_API_TOKEN = '/g) || []).length === 3);
  check("Ya NO se usa $env en ningún nodo (esta instancia de n8n lo bloquea)", todoElCodigo.indexOf("$env") === -1);
  check("Sin $env el nodo igual funciona", r.recordatorios.length === 1);
}
{
  // Cambiar de proyecto = editar SOLO la línea de la URL en el nodo.
  const codigoOtroProyecto = CODIGO.buscar.replace(
    "const SUPABASE_URL = 'https://zcljlddtcoyfyvshlyfk.supabase.co';",
    "const SUPABASE_URL = 'https://proyecto-nuevo.supabase.co';"
  );
  const servidor = servidorFalso(escenario());
  const salida = await compilar(codigoOtroProyecto)(servidor.helpers, { first: () => ({ json: {} }) }, () => ({}));
  const llamadasSupabase = servidor.llamadas.filter((l) => l.url.includes("supabase.co"));
  check(
    "Cambiar la línea SUPABASE_URL redirige TODAS las consultas al proyecto nuevo",
    llamadasSupabase.length > 0 && llamadasSupabase.every((l) => l.url.startsWith("https://proyecto-nuevo.supabase.co"))
  );
  check("Y el workflow sigue funcionando con el proyecto nuevo", salida.filter((i) => !i.json._diagnostico).length === 1);
}
{
  const r = await ejecutarBuscar(escenario({ errorEtapas: true }));
  check("Si Supabase no responde, no revienta y avisa", r.items.length === 1 && (r.diagnostico.avisos || []).some((a) => /pipeline_etapas/.test(a)));
}
{
  const r = await ejecutarBuscar(escenario({ errorConversaciones: true }));
  check("Si Supabase no devuelve conversaciones, no revienta y avisa", r.items.length === 1 && (r.diagnostico?.avisos || []).some((a) => /conversaciones/.test(a)));
}
{
  // Sin la lista de envíos de 24 h no se puede saber qué se repite: no se envía.
  const r = await ejecutarBuscar(escenario({ errorRegistros: true }));
  check("Si no se pueden leer los envíos recientes NO se envía nada (evita repetir)", r.recordatorios.length === 0 && (r.diagnostico?.avisos || []).some((a) => /24 h/.test(a)));
}
{
  const r = await ejecutarBuscar(escenario());
  check("El nodo apunta al proyecto Supabase del CRM", /zcljlddtcoyfyvshlyfk\.supabase\.co/.test(CODIGO.buscar));
  check("El diagnóstico explica cómo se resuelven las etapas", Boolean(r.diagnostico?.estadosDeLaEtapa));
}


// ---------------------------------------------------------------------------
// 7) La cadena en línea (aquí estaba el fallo de «solo envió a 1»)
// ---------------------------------------------------------------------------
grupo("7) Cadena en línea sin bucle: la tanda completa sale en la misma pasada");

{
  const conexiones = workflow.connections || {};
  const destinos = (nombre) => ((conexiones[nombre] || {}).main?.[0] || []).map((c) => c.node).join();

  check(
    "No hay nodo de bucle «Procesar uno a uno» (no puede cortar la pasada)",
    !workflow.nodes.some((n) => n.type === "n8n-nodes-base.splitInBatches")
  );
  check("«Cada 15 minutos» conecta con la búsqueda", destinos("Cada 15 minutos") === "Buscar clientes y preparar recordatorio");
  check("La búsqueda conecta con el envío", destinos("Buscar clientes y preparar recordatorio") === "Enviar por WhatsApp API");
  check("El envío conecta con el registro", destinos("Enviar por WhatsApp API") === "Registrar envío e impedir duplicados");
  check("El registro es el último nodo (no vuelve a ningún lado)", destinos("Registrar envío e impedir duplicados") === "");
  for (const nombre of [
    "Buscar clientes y preparar recordatorio",
    "Enviar por WhatsApp API",
    "Registrar envío e impedir duplicados",
  ]) {
    const nodo = workflow.nodes.find((n) => n.name === nombre);
    check(
      "«" + nombre + "» está en modo «Run Once for All Items»",
      nodo.parameters.mode === "runOnceForAllItems",
      String(nodo.parameters.mode)
    );
  }
}

{
  // Una pasada completa como la ejecuta n8n: el nodo Code recibe TODA la tanda
  // (modo «Run Once for All Items») y debe procesarla completa, no solo el
  // primer ítem (ese era el fallo: salía un único recordatorio por pasada).
  async function simularPasada(items, servidor) {
    const enviar = compilar(CODIGO.enviar);
    const registrar = compilar(CODIGO.registrar);
    const lote = (jsons) => ({ all: () => jsons.map((json) => ({ json })) });
    const trasEnviar = await enviar(servidor.helpers, lote(items), () => ({}));
    const trasRegistrar = await registrar(
      servidor.helpers,
      lote(trasEnviar.map((i) => i.json)),
      () => ({})
    );
    return {
      enviados: trasEnviar.filter((i) => i.json.enviado === true).length,
      registrados: trasRegistrar.filter((i) => i.json.registrado === true).length,
      diagnosticos: trasEnviar.filter((i) => i.json._diagnostico === true).length,
      noEnviados: trasEnviar.filter((i) => i.json.enviado !== true).length,
    };
  }

  const dosClientes = () => [
    filaConHoras(2),
    filaConHoras(
      4,
      { id: "conv-272", cliente_id: "cli-2", chatwoot_conversation_id: 272, chatwoot_conversation_ids: ["272"], numero_whatsapp: "+595981111222" },
      { id: "cli-2", nombre: "Luis Gomez", estado: "etapa_1787876104854" }
    ),
  ];

  const servidor = servidorFalso({ etapas: ETAPAS_REALES, convs: dosClientes(), registros: {} });

  const preparados = await ejecutarBuscar({ etapas: ETAPAS_REALES, convs: dosClientes(), registros: {} });
  check("El primer nodo prepara un recordatorio por cada cliente elegible", preparados.recordatorios.length === 2);

  const servidorPasada = servidorFalso({});
  const resultado = await simularPasada(preparados.items, servidorPasada);
  check(
    "Una pasada envía TODOS los recordatorios preparados (no solo el primero)",
    resultado.enviados === 2,
    "enviados: " + resultado.enviados
  );
  check("Y registra los dos envíos para no repetirlos", resultado.registrados === 2, "registrados: " + resultado.registrados);
  check("El ítem de diagnóstico pasa la pasada sin enviarse", resultado.diagnosticos === 1 && servidorPasada.estado.enviadosChatwoot.length === 2);
  check("Nada más se envía en la pasada", resultado.noEnviados === 1, "no enviados: " + resultado.noEnviados);
}

{
  // Si $input.item revienta (modo «todos los ítems»), el nodo igual funciona.
  const servidor = servidorFalso({});
  const item = { conversationId: 271, mensaje: "Hola" };
  const salida = await compilar(CODIGO.enviar)(servidor.helpers, entradaSinItem(item), () => ({}));
  check("El envío funciona aunque $input.item no exista", salida[0].json.enviado === true && servidor.estado.enviadosChatwoot.length === 1);

  const servidor2 = servidorFalso({});
  const salida2 = await compilar(CODIGO.enviar)(servidor2.helpers, entradaPorItem(item), () => ({}));
  check("El envío también funciona en modo «Run Once for Each Item»", salida2[0].json.enviado === true && servidor2.estado.enviadosChatwoot.length === 1);

  const servidor3 = servidorFalso({});
  const lote = { all: () => [{ json: { conversationId: 271, mensaje: "A" } }, { json: { conversationId: 272, mensaje: "B" } }] };
  const salida3 = await compilar(CODIGO.enviar)(servidor3.helpers, lote, () => ({}));
  check("Con un lote de varios ítems los envía todos", salida3.length === 2 && servidor3.estado.enviadosChatwoot.length === 2);

  const servidor4 = servidorFalso({});
  const registro = await compilar(CODIGO.registrar)(servidor4.helpers, { all: () => [{ json: { enviado: true, clienteId: "cli-1", conversacionId: "conv-1", estado: "e1", etapa: "datos", intento: 1, mensaje: "x" } }] }, () => ({}));
  check("El registro también aguanta lotes y modo todos-los-ítems", registro[0].json.registrado === true && servidor4.estado.insertadosSupabase.length === 1);

  const servidor5 = servidorFalso({});
  const dosEnvios = {
    all: () => [
      { json: { enviado: true, clienteId: "cli-1", conversacionId: "conv-1", estado: "e1", etapa: "datos", intento: 1, mensaje: "x" } },
      { json: { enviado: true, clienteId: "cli-2", conversacionId: "conv-2", estado: "e1", etapa: "datos", intento: 3, mensaje: "y" } },
    ],
  };
  const registro2 = await compilar(CODIGO.registrar)(servidor5.helpers, dosEnvios, () => ({}));
  check(
    "El registro guarda TODOS los envíos de la tanda (no solo el primero)",
    registro2.filter((i) => i.json.registrado === true).length === 2 && servidor5.estado.insertadosSupabase.length === 2
  );
}

// ---------------------------------------------------------------------------
// 5) Envío y registro
// ---------------------------------------------------------------------------
grupo("5) Envío y registro");

{
  const servidor = servidorFalso({});
  const item = { json: { conversationId: 271, clienteId: "cli-1", conversacionId: "conv-271", estado: "etapa_1787876104854", etapa: "datos", intento: 2, mensaje: "Hola Ana, faltan tus datos.", telefono: "595982647259" } };
  const salida = await compilar(CODIGO.enviar)(servidor.helpers, entrada(item.json), () => ({}));
  check("Envía el mensaje por la conversación de Chatwoot", salida[0].json.enviado === true && servidor.estado.enviadosChatwoot[0].content === item.json.mensaje);
  check("Marca el mensaje como outgoing y no privado", servidor.estado.enviadosChatwoot[0].message_type === "outgoing" && servidor.estado.enviadosChatwoot[0].private === false);
}
{
  const servidor = servidorFalso({});
  const item = { json: { _diagnostico: true, conteo: {} } };
  const salida = await compilar(CODIGO.enviar)(servidor.helpers, entrada(item.json), () => ({}));
  check("El ítem de diagnóstico NO se envía a Chatwoot", salida[0].json.enviado === false && servidor.estado.enviadosChatwoot.length === 0);
}
{
  const servidor = servidorFalso({ envioFalla: true });
  const salida = await compilar(CODIGO.enviar)(servidor.helpers, entrada({ conversationId: 271, mensaje: "hola" }), () => ({}));
  check("Si Chatwoot rechaza, guarda el motivo visible", salida[0].json.enviado === false && /422/.test(salida[0].json.error || ""));
}
{
  const servidor = servidorFalso({});
  const item = { json: { enviado: true, conversationId: 271, conversacionId: "conv-271", clienteId: "cli-1", estado: "etapa_1787876104854", etapa: "datos", intento: 1, mensaje: "Hola" } };
  const salida = await compilar(CODIGO.registrar)(servidor.helpers, entrada(item.json), () => ({}));
  const guardado = servidor.estado.insertadosSupabase[0] || {};
  check("Registra el envío en recordatorios_whatsapp", salida[0].json.registrado === true);
  check(
    "Guarda cliente, etapa, tipo, plantilla y fecha",
    guardado.cliente_id === "cli-1" && guardado.etapa === "etapa_1787876104854" && guardado.tipo === "datos" && guardado.plantilla === 1 && /^\d{4}-\d{2}-\d{2}$/.test(guardado.fecha || "")
  );
}
{
  const servidor = servidorFalso({});
  await compilar(CODIGO.registrar)(servidor.helpers, entrada({ _diagnostico: true }), () => ({}));
  await compilar(CODIGO.registrar)(servidor.helpers, entrada({ enviado: false }), () => ({}));
  check("No registra nada si el envío falló ni para el diagnóstico", servidor.estado.insertadosSupabase.length === 0);
}

// ---------------------------------------------------------------------------
// 6) Estructura del workflow importable
// ---------------------------------------------------------------------------
grupo("6) Workflow importable");

check("Mantiene el nombre del workflow", workflow.name === "WhatsApp API · Recordatorios por etapa");
check("No viaja activo (se activa a mano en n8n)", workflow.active === false);
check(
  "Conserva el disparador cada 15 minutos",
  workflow.nodes.find((n) => n.name === "Cada 15 minutos").parameters.rule.interval[0].minutesInterval === 15
);
check(
  "Conserva los tres nodos Code y ninguno de bucle",
  ["Buscar clientes y preparar recordatorio", "Enviar por WhatsApp API", "Registrar envío e impedir duplicados"].every((n) =>
    workflow.nodes.some((x) => x.name === n)
  ) && !workflow.nodes.some((x) => x.type === "n8n-nodes-base.splitInBatches")
);

{
  const rutaPegar = path.join(raiz, "n8n", "recordatorios", "CODIGO-PARA-PEGAR.md");
  const existe = fs.existsSync(rutaPegar);
  const contenido = existe ? fs.readFileSync(rutaPegar, "utf8") : "";
  check("Existe el archivo para copiar y pegar (CODIGO-PARA-PEGAR.md)", existe);
  for (const [nombre, jsCode] of Object.entries({ "Buscar clientes y preparar recordatorio": CODIGO.buscar, "Enviar por WhatsApp API": CODIGO.enviar, "Registrar envío e impedir duplicados": CODIGO.registrar })) {
    check("El bloque de «" + nombre + "» coincide con el nodo del workflow", contenido.includes(jsCode));
  }
}


// ---------------------------------------------------------------------------
// 8) Simulador (prueba en seco): mismas reglas que n8n
// ---------------------------------------------------------------------------
grupo("8) Simulador de prueba en seco");

{
  const reglas = extraerReglas();
  check("Extrae los umbrales del propio workflow", JSON.stringify(reglas.umbralesHoras) === "[0.5,3,12,23.5]", JSON.stringify(reglas.umbralesHoras));
  check("Extrae la ventana de 24 h del propio workflow", reglas.ventanaApiHoras === 24);
  check("Solo Datos y No contesta generan recordatorio", tipoDeEtapa("Datos", reglas) === "datos" && tipoDeEtapa("No contesta", reglas) === "noContesta");
  check("«Nuevo Lead» y las demás etapas NO generan recordatorio", tipoDeEtapa("Nuevo Lead", reglas) === null && tipoDeEtapa("En Consulta", reglas) === null && tipoDeEtapa("Trabajo Completado", reglas) === null);
  check("«Sin respuesta» (nombre alternativo) también es no contesta", tipoDeEtapa("Sin respuesta", reglas) === "noContesta");
  check("El nombre se reconoce sin acentos ni mayúsculas y con sufijos", tipoDeEtapa("DATOS (API)", reglas) === "datos");

  // La decisión del simulador debe coincidir con la del nodo (misma tabla del grupo 3).
  const casos = [
    { horas: 0.33, enviadas: [], esperado: "espera" },
    { horas: 0.6, enviadas: [], esperado: "enviar", intento: 1 },
    { horas: 1, enviadas: [], esperado: "enviar", intento: 1 },
    { horas: 8, enviadas: [], esperado: "enviar", intento: 2 },
    { horas: 13, enviadas: [], esperado: "enviar", intento: 3 },
    { horas: 23.7, enviadas: [], esperado: "enviar", intento: 4 },
    { horas: 25, enviadas: [], esperado: "ventana" },
    { horas: 10, enviadas: [2], esperado: "repetida", intento: 2 },
  ];
  for (const c of casos) {
    const d = decidir({ horas: c.horas, enviadas: c.enviadas }, reglas);
    check(
      "A " + c.horas + " h con variantes ya enviadas " + JSON.stringify(c.enviadas) + " → " + c.esperado + (c.intento ? " (plantilla " + c.intento + ")" : ""),
      d.accion === c.esperado && (!c.intento || d.intento === c.intento),
      JSON.stringify(d)
    );
  }
}

{
  // preparar(): cruza etapas + conversaciones + envíos previos como lo hace n8n.
  const reglas = extraerReglas();
  const etapas = [
    { clave: "etapa_1", nombre: "Datos", es_spam: false, es_archivado: false },
    { clave: "etapa_2", nombre: "No contesta", es_spam: false, es_archivado: false },
    { clave: "nuevo_lead", nombre: "Nuevo Lead", es_spam: false, es_archivado: false },
  ];
  const conversaciones = [
    { cliente_id: "c1", chatwoot_conversation_id: 1, ultimo_entrante_api_en: "2026-09-19T13:00:00Z", clientes: { id: "c1", nombre: "Ana", estado: "etapa_1", es_spam: false } },
    { cliente_id: "c2", chatwoot_conversation_id: 2, ultimo_entrante_api_en: "2026-09-19T13:00:00Z", clientes: { id: "c2", nombre: "Luis", estado: "etapa_2", es_spam: false } },
    { cliente_id: "c3", chatwoot_conversation_id: 3, ultimo_entrante_api_en: "2026-09-19T13:00:00Z", clientes: { id: "c3", nombre: "Sin etapa", estado: "nuevo_lead", es_spam: false } },
    { cliente_id: "c4", chatwoot_conversation_id: 4, ultimo_entrante_api_en: "2026-09-19T13:00:00Z", clientes: { id: "c4", nombre: "Spam", estado: "etapa_1", es_spam: true } },
  ];
  const registros = [
    // La variante 2 ya salió hace 30 minutos: no se repite (y el tipo histórico
    // «sinRespuesta» cuenta igual).
    { cliente_id: "c2", etapa: "etapa_2", tipo: "sinRespuesta", plantilla: 2, enviado_en: "2026-09-19T18:30:00Z" },
  ];
  const ahora = new Date("2026-09-19T19:00:00Z");
  const filas = preparar({ etapas, conversaciones, registros }, reglas, ahora);

  check("Solo entran los clientes de Datos y No contesta (no Nuevo Lead ni spam)", filas.length === 2, "filas: " + filas.length);
  const ana = filas.find((f) => f.cliente === "Ana");
  const luis = filas.find((f) => f.cliente === "Luis");
  check("Calcula las horas sin responder desde el último mensaje del cliente", ana.horas === 6);
  check(
    "Detecta la variante ya enviada aunque esté guardada como «sinRespuesta»",
    luis.enviadas.join() === "2" && luis.etapa === "noContesta"
  );

  const rep = informe(filas, reglas, ahora);
  check(
    "El informe saca a Ana (6 h → plantilla 2) y deja fuera a Luis (misma plantilla ya enviada)",
    rep.salen.length === 1 && rep.salen[0].cliente === "Ana" && rep.salen[0].intento === 2 && rep.repetidas.length === 1 && rep.repetidas[0].cliente === "Luis",
    JSON.stringify({ salen: rep.salen.map((f) => [f.cliente, f.intento]), repetidas: rep.repetidas.map((f) => [f.cliente, f.intento]) })
  );
}

// ---------------------------------------------------------------------------
console.log("\n" + "─".repeat(60));
if (fallos.length) {
  console.log("❌ " + fallos.length + " prueba(s) fallaron de " + (pasadas + fallos.length) + ":");
  for (const f of fallos) console.log("   · " + f);
  process.exit(1);
}
console.log("✅ " + pasadas + " pruebas OK — recordatorios de WhatsApp API");
