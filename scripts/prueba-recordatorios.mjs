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
import { fileURLToPath } from "node:url";

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
        const cw = String(q.get("chatwoot_conversation_id") || "").replace(/^eq\./, "");
        const fila = (cfg.convs || {})[cw];
        return fila ? [fila] : [];
      }
      if (p.endsWith("/recordatorios_whatsapp")) {
        if (method === "POST") {
          estado.insertadosSupabase.push(body);
          return { ok: true };
        }
        const clienteId = String(q.get("cliente_id") || "").replace(/^eq\./, "");
        const etapa = String(q.get("etapa") || "").replace(/^eq\./, "");
        const tipos = String(q.get("tipo") || "")
          .replace(/^in\.\(/, "")
          .replace(/\)$/, "")
          .split(",")
          .filter(Boolean);
        const filas = ((cfg.registros || {})[clienteId + "|" + etapa] || []).filter((r) => tipos.includes(r.tipo));
        return filas;
      }
      throw new Error("Consulta Supabase no simulada: " + url);
    }

    // Chatwoot
    if (p.endsWith("/messages") && method === "GET") {
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

function filaSupabase(extra = {}, clienteExtra = {}) {
  return {
    id: "conv-271",
    cliente_id: "cli-1",
    numero_whatsapp: "+595982647259",
    fuente: "meta_business",
    archivada: false,
    clientes: { id: "cli-1", estado: "etapa_1787876104854", grupo: "personal", es_spam: false, ...clienteExtra },
    ...extra,
  };
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
    convs: { 271: filaSupabase() },
    abiertos: [conversacion()],
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
  const r = await ejecutarBuscar(escenario({ convs: { 271: filaSupabase({}, { estado: "etapa_templo_1787618330816" }) } }));
  check("«No contesta» (grupo templo) genera el recordatorio de llamada", r.recordatorios.length === 1 && r.recordatorios[0].etapa === "noContesta");
  check("Plantilla de llamada correcta", /atender la llamada/.test(r.recordatorios[0]?.mensaje || ""));
}

{
  const r = await ejecutarBuscar(escenario({ convs: { 271: filaSupabase({}, { estado: "Datos" }) } }));
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
grupo("2) Qué chats entran");

{
  const r = await ejecutarBuscar(escenario({ convs: { 271: filaSupabase({}, { grupo: "personal" }) } }));
  check("Cliente con grupo 'personal' en etapa Datos recibe recordatorio", r.recordatorios.length === 1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: { 271: filaSupabase({}, { grupo: "templo" }) } }));
  check("Cliente con grupo 'templo' también", r.recordatorios.length === 1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: {}, abiertos: [conversacion()] }));
  check("Chat sin vínculo en Supabase (fuente meta_business) se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.sinVinculoApi === 1);
}
{
  const r = await ejecutarBuscar(escenario({ abiertos: [conversacion({ labels: ["bot-pausado"] })] }));
  check("Etiqueta bot-pausado silencia el chat", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.etiquetaSilencio === 1);
}
{
  const r = await ejecutarBuscar(escenario({ abiertos: [conversacion({ labels: ["recordatorios-pausados"] })] }));
  check("Etiqueta recordatorios-pausados silencia el chat", r.recordatorios.length === 0);
}
{
  const r = await ejecutarBuscar(escenario({ abiertos: [conversacion({ labels: ["Bot Pausado"] })] }));
  check("La etiqueta se reconoce con espacios y mayúsculas («Bot Pausado»)", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.etiquetaSilencio === 1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: { 271: filaSupabase({ archivada: true }) } }));
  check("Conversación archivada se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.archivada === 1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: { 271: filaSupabase({}, { es_spam: true }) } }));
  check("Cliente marcado como spam se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.spam === 1);
}
{
  const r = await ejecutarBuscar(escenario({ convs: { 271: filaSupabase({}, { estado: "consulta_hecha" }) } }));
  check("Etapa sin recordatorio (Consulta Hecha) se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.etapaSinRecordatorio === 1);
}
{
  const r = await ejecutarBuscar(escenario({ mensajes: { 271: [{ message_type: "outgoing", created_at: hace(2) }] } }));
  check("Chat donde el cliente nunca ha escrito se omite", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.sinMensajesEntrantes === 1);
}

// ---------------------------------------------------------------------------
// 3) Tiempos: 30 min · 3 h · 12 h · 23 h 30 min
// ---------------------------------------------------------------------------
grupo("3) Tiempos de cada intento");

const tiempos = [
  { horas: 0.33, previos: [], intento: 0, nota: "20 min → todavía no" },
  { horas: 0.6, previos: [], intento: 1, nota: "36 min → intento 1" },
  { horas: 4, previos: [{ tipo: "datos" }], intento: 2, nota: "4 h con 1 enviado → intento 2" },
  { horas: 13, previos: [{ tipo: "datos" }, { tipo: "datos" }], intento: 3, nota: "13 h con 2 enviados → intento 3" },
  { horas: 23.7, previos: [{ tipo: "datos" }, { tipo: "datos" }, { tipo: "datos" }], intento: 4, nota: "23,7 h con 3 enviados → intento 4" },
  { horas: 23.9, previos: [{ tipo: "datos" }, { tipo: "datos" }, { tipo: "datos" }, { tipo: "datos" }], intento: 0, nota: "4 enviados → no se repite" },
];
for (const t of tiempos) {
  const r = await ejecutarBuscar(
    escenario({
      mensajes: { 271: [{ message_type: 0, created_at: hace(t.horas) }] },
      registros: { "cli-1|etapa_1787876104854": t.previos.map((p, i) => ({ tipo: p.tipo, plantilla: i + 1, enviado_en: new Date().toISOString() })) },
    })
  );
  check(t.nota, (r.recordatorios[0]?.intento || 0) === t.intento, "intento: " + r.recordatorios[0]?.intento);
}

{
  const r = await ejecutarBuscar(escenario({ mensajes: { 271: [{ message_type: 0, created_at: hace(23.9) }] }, registros: { "cli-1|etapa_1787876104854": [{ tipo: "datos" }, { tipo: "datos" }, { tipo: "datos" }].map((p, i) => ({ tipo: p.tipo, plantilla: i + 1 })) } }));
  check("A 23,9 h (dentro de la ventana de 24 h) sale el 4.º intento", r.recordatorios[0]?.intento === 4);
}
{
  const r = await ejecutarBuscar(escenario({ mensajes: { 271: [{ message_type: 0, created_at: hace(25) }] } }));
  check("Pasadas 24 h no se intenta (Meta rechazaría el texto libre)", r.recordatorios.length === 0 && r.diagnostico.conteo.omitidas.ventanaCerrada === 1);
  check("Y el diagnóstico lo explica", (r.diagnostico.avisos || []).some((a) => /ventana de 24 h/.test(a)));
}
{
  // Los envíos viejos del tipo "noContesta" también cuentan para no repetir.
  const r = await ejecutarBuscar(
    escenario({
      convs: { 271: filaSupabase({}, { estado: "etapa_templo_1787618330816" }) },
      mensajes: { 271: [{ message_type: 0, created_at: hace(5) }] },
      registros: { "cli-1|etapa_templo_1787618330816": [{ tipo: "noContesta", plantilla: 1, enviado_en: "2026-08-29T01:30:16Z" }] },
    })
  );
  check("Cuenta los envíos antiguos guardados como 'noContesta'", r.recordatorios[0]?.intento === 2, "intento: " + r.recordatorios[0]?.intento);
}
{
  const r = await ejecutarBuscar(
    escenario({
      convs: { 271: filaSupabase({}, { estado: "etapa_templo_1787618330816" }) },
      mensajes: { 271: [{ message_type: 0, created_at: hace(5) }] },
      registros: { "cli-1|etapa_templo_1787618330816": [{ tipo: "sinRespuesta", plantilla: 1, enviado_en: "2026-08-27T15:15:17Z" }] },
    })
  );
  check("También cuenta los guardados como 'sinRespuesta'", r.recordatorios[0]?.intento === 2, "intento: " + r.recordatorios[0]?.intento);
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
  const r = await ejecutarBuscar(escenario({ errorChatwoot: true }));
  check("Si el token de Chatwoot falla, el diagnóstico lo dice", (r.diagnostico?.errores || []).some((e) => /CHATWOOT/.test(e)));
}
{
  const r = await ejecutarBuscar(escenario());
  check("El nodo apunta al proyecto Supabase del CRM", /zcljlddtcoyfyvshlyfk\.supabase\.co/.test(CODIGO.buscar));
  check("El diagnóstico explica cómo se resuelven las etapas", Boolean(r.diagnostico?.estadosDeLaEtapa));
}


// ---------------------------------------------------------------------------
// 7) El bucle completo (aquí estaba el fallo que impedía todo envío)
// ---------------------------------------------------------------------------
grupo("7) Bucle «Procesar uno a uno»: la salida correcta es «loop»");

{
  // En n8n, "Loop Over Items (Split in Batches)" tiene las salidas en este
  // orden: 0 = done, 1 = loop. Los ítems salen SIEMPRE por «loop»; «done»
  // entrega [] hasta que el bucle se agota (SplitInBatchesV3: `return [[], items]`).
  const conexiones = workflow.connections || {};
  const salidas = ((conexiones["Procesar uno a uno"] || {}).main) || [];
  const destinos = (i) => (salidas[i] || []).map((c) => c.node);

  check(
    "La salida 1 (loop) lleva los ítems a «Enviar por WhatsApp API»",
    destinos(1).join() === "Enviar por WhatsApp API",
    "destinos: " + JSON.stringify(destinos(1))
  );
  check(
    "La salida 0 (done) está vacía: ahí no se envía nada",
    destinos(0).length === 0,
    "destinos: " + JSON.stringify(destinos(0))
  );
  check(
    "La salida 0 (done) NO se auto-conecta al bucle",
    !destinos(0).includes("Procesar uno a uno")
  );
  check(
    "«Enviar por WhatsApp API» pasa a «Registrar envío e impedir duplicados»",
    ((conexiones["Enviar por WhatsApp API"] || {}).main[0] || []).map((c) => c.node).join() === "Registrar envío e impedir duplicados"
  );
  check(
    "«Registrar envío e impedir duplicados» vuelve al bucle para el siguiente ítem",
    ((conexiones["Registrar envío e impedir duplicados"] || {}).main[0] || []).map((c) => c.node).join() === "Procesar uno a uno"
  );
  check(
    "El disparador y la búsqueda siguen encadenados",
    ((conexiones["Cada 15 minutos"] || {}).main[0] || []).map((c) => c.node).join() === "Buscar clientes y preparar recordatorio" &&
      ((conexiones["Buscar clientes y preparar recordatorio"] || {}).main[0] || []).map((c) => c.node).join() === "Procesar uno a uno"
  );
}

{
  // Simulación del bucle tal como lo ejecuta n8n con lotes de 1 ítem:
  // el nodo de bucle entrega un ítem por «loop», el envío lo manda, el registro
  // lo guarda y vuelve a entrar; cuando no quedan ítems, «done» sale vacío.
  async function simularBucle(items, servidor) {
    const enviar = compilar(CODIGO.enviar);
    const registrar = compilar(CODIGO.registrar);
    let enviados = 0;
    let registrados = 0;
    for (const item of items) {
      // `items` ya son los json de salida del primer nodo (no objetos {json}).
      const trasEnviar = await enviar(servidor.helpers, entradaTodos(item), () => ({}));
      const trasRegistrar = await registrar(servidor.helpers, entradaTodos(trasEnviar[0].json), () => ({}));
      if (trasEnviar[0].json.enviado === true) enviados++;
      if (trasRegistrar[0].json.registrado === true) registrados++;
    }
    return { enviados, registrados, done: [] }; // «done» entrega [] al final
  }

  const servidor = servidorFalso({
    etapas: ETAPAS_REALES,
    convs: {
      271: filaSupabase(),
      272: filaSupabase({ id: "conv-272", cliente_id: "cli-2" }, { id: "cli-2", estado: "etapa_1787876104854" }),
    },
    abiertos: [
      conversacion(),
      conversacion({ id: 272, meta: { sender: { name: "Luis Gomez", phone_number: "+595981111222" } } }),
    ],
    mensajes: {
      271: [{ message_type: 0, created_at: hace(2), content: "hola" }],
      272: [{ message_type: 0, created_at: hace(4), content: "buenas" }],
    },
    registros: {},
  });

  const preparados = await ejecutarBuscar({
    etapas: ETAPAS_REALES,
    convs: {
      271: filaSupabase(),
      272: filaSupabase({ id: "conv-272", cliente_id: "cli-2" }, { id: "cli-2", estado: "etapa_1787876104854" }),
    },
    abiertos: [
      conversacion(),
      conversacion({ id: 272, meta: { sender: { name: "Luis Gomez", phone_number: "+595981111222" } } }),
    ],
    mensajes: {
      271: [{ message_type: 0, created_at: hace(2), content: "hola" }],
      272: [{ message_type: 0, created_at: hace(4), content: "buenas" }],
    },
    registros: {},
  });
  check("El primer nodo prepara un recordatorio por cada cliente elegible", preparados.recordatorios.length === 2);

  const servidorBucle = servidorFalso({});
  const resultado = await simularBucle(preparados.items, servidorBucle);
  check("El bucle envía TODOS los recordatorios preparados (no solo el primero)", resultado.enviados === 2, "enviados: " + resultado.enviados);
  check("Y registra los dos envíos para no repetirlos", resultado.registrados === 2, "registrados: " + resultado.registrados);
  check("El ítem de diagnóstico pasa el bucle sin enviarse", servidorBucle.estado.enviadosChatwoot.length === 2);
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
check("Conserva los tres nodos Code y el bucle uno a uno", ["Buscar clientes y preparar recordatorio", "Enviar por WhatsApp API", "Registrar envío e impedir duplicados", "Procesar uno a uno"].every((n) => workflow.nodes.some((x) => x.name === n)));

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
console.log("\n" + "─".repeat(60));
if (fallos.length) {
  console.log("❌ " + fallos.length + " prueba(s) fallaron de " + (pasadas + fallos.length) + ":");
  for (const f of fallos) console.log("   · " + f);
  process.exit(1);
}
console.log("✅ " + pasadas + " pruebas OK — recordatorios de WhatsApp API");
