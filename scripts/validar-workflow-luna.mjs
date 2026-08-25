#!/usr/bin/env node
/**
 * Validador del workflow de Luna por etapas.
 *
 * 1) Estructura: conexiones validas, sin referencias a nodos eliminados,
 *    todos los nodos alcanzables, codigo de cada nodo compila.
 * 2) Comportamiento: ejecuta el jsCode REAL de los nodos nuevos con un mock
 *    de n8n y verifica la maquina de etapas, la memoria y el anti-repetidos.
 *
 * Uso: npm run check:luna   (o: node scripts/validar-workflow-luna.mjs)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const RUTA_WF = path.join(raiz, "n8n", "IMPORTAR-EN-N8N.json");

let fallos = 0;
let pruebas = 0;
function ok(cond, etiqueta, detalle = "") {
  pruebas++;
  if (cond) {
    console.log("  ✔ " + etiqueta);
  } else {
    fallos++;
    console.log("  ✘ " + etiqueta + (detalle ? "  →  " + detalle : ""));
  }
}
function grupo(t) {
  console.log("\n" + t);
}

// ---------------------------------------------------------------------------
// MOCK DE N8N
// ---------------------------------------------------------------------------
function item(json, binary = {}) {
  return { json, binary };
}
function crearContexto({ entrada, refs = {}, http = async () => ({}), binarios = {} }) {
  const llamadas = [];
  const $ = (nombre) => {
    if (!(nombre in refs)) throw new Error("Referencia a nodo sin datos en el test: " + nombre);
    const v = refs[nombre];
    const lista = Array.isArray(v) ? v : [v];
    return {
      first: () => item(lista[0]),
      all: () => lista.map((j) => item(j)),
      item: item(lista[0]),
      last: () => item(lista[lista.length - 1])
    };
  };
  const $input = {
    first: () => item(entrada),
    all: () => [item(entrada)],
    item: item(entrada)
  };
  const ctx = {
    helpers: {
      httpRequest: async (opts) => {
        llamadas.push(opts);
        return http(opts, llamadas.length);
      },
      getBinaryDataBuffer: async () => Buffer.from("img")
    }
  };
  const wrapper = new Function("$input", "$", "return (async () => {\n__CODE__\n}).call(this);");
  return { ctx, $input, $, llamadas, wrapper };
}

async function correr(jsCode, opts) {
  const { ctx, $input, $, llamadas, wrapper } = crearContexto(opts);
  const fn = new Function("$input", "$", "return (async () => {\n" + jsCode + "\n}).call(this);");
  const salida = await fn.call(ctx, $input, $);
  return { salida: Array.isArray(salida) ? salida[0].json : salida, llamadas };
}

function jsDe(wf, nombre) {
  const nodo = wf.nodes.find((n) => n.name === nombre);
  if (!nodo) throw new Error("Falta el nodo " + nombre);
  return nodo.parameters.jsCode;
}

const pipelineTemplo = [
  { clave: "nuevo_lead_templo", nombre: "Nuevo Lead", grupo: "templo" },
  { clave: "sin_respuesta_templo", nombre: "Sin respuesta", grupo: "templo" },
  { clave: "datos_templo", nombre: "Datos", grupo: "templo" },
  { clave: "por_consulta_templo", nombre: "Por consulta", grupo: "templo" },
  { clave: "consulta_hecha_templo", nombre: "Consulta Hecha", grupo: "templo" }
];


// ---------------------------------------------------------------------------
const wf = JSON.parse(fs.readFileSync(RUTA_WF, "utf8"));
const nombres = wf.nodes.map((n) => n.name);

grupo("1. Estructura del workflow");
ok(nombres.length > 50, "carga el workflow con todos sus nodos", nombres.length + " nodos");
ok(!("pinData" in wf) || Object.keys(wf.pinData).length === 0, "sin pinData (no responde con datos falsos)");

// Conexiones validas
let malasConexiones = [];
for (const [origen, salidas] of Object.entries(wf.connections)) {
  if (!nombres.includes(origen)) malasConexiones.push("origen " + origen);
  for (const rama of salidas.main || []) for (const d of rama) if (!nombres.includes(d.node)) malasConexiones.push("destino " + d.node);
}
ok(malasConexiones.length === 0, "todas las conexiones apuntan a nodos que existen", malasConexiones.join(", "));

// Sin referencias a nodos eliminados/renombrados
const PROHIBIDOS = ["Detectar Cierre", "chatwoot1", "Analizar y Actualizar Checklist", "Construir System Prompt", "Obtener Checklist"];
const serializado = JSON.stringify(wf);

// GitHub push protection rechaza llaves de OpenAI/Groq dentro del repo
const MARCA_OPENAI = "sk-" + "proj-";
const MARCA_GROQ = "gs" + "k_";

// El archivo que se importa en n8n no puede depender de $env: la instancia del
// Templo tiene N8N_BLOCK_ENV_ACCESS_IN_NODE y niega el acceso a variables.
ok(!serializado.includes("$env."), "el archivo importable no usa $env (tu n8n tiene N8N_BLOCK_ENV_ACCESS_IN_NODE)");
ok(/Bearer\s+\S/.test(serializado), "  y lleva las llaves dentro de los headers Authorization");

// La copia del repo es la contraparte: sin secretos y con $env
const RUTA_GITHUB = path.join(raiz, "n8n", "05-luna-etapas.github.json");
if (fs.existsSync(RUTA_GITHUB)) {
  const gh = fs.readFileSync(RUTA_GITHUB, "utf8");
  ok(!gh.includes(MARCA_OPENAI) && !gh.includes(MARCA_GROQ), "la version del repo no lleva llaves de OpenAI/Groq");
  ok(gh.includes("$env.OPENAI_API_KEY") && gh.includes("$env.GROQ_API_KEY"), "  y las lee de variables de entorno");
  ok(JSON.parse(gh).nodes.length === wf.nodes.length, "  tiene los mismos nodos que el importable");
  const nombresGh = JSON.parse(gh).nodes.map(n => n.name);
  ok(nombresGh.every(n => nombres.includes(n)), "  y los mismos nombres de nodo");
}
const presentes = PROHIBIDOS.filter((p) => serializado.includes("$('" + p + "')") || serializado.includes('$("' + p + '")') || serializado.includes('"name": "' + p + '"'));
ok(presentes.length === 0, "sin referencias a nodos eliminados", presentes.join(", "));

// Todas las referencias $('X') del codigo existen
const refsMalas = new Set();
for (const nodo of wf.nodes) {
  for (const valor of Object.values(nodo.parameters || {})) {
    if (typeof valor !== "string") continue;
    for (const m of valor.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!nombres.includes(m[1])) refsMalas.add(nodo.name + " → " + m[1]);
    }
  }
}
ok(refsMalas.size === 0, "todas las referencias $('Nodo') existen", [...refsMalas].join(" | "));

// Alcanzabilidad desde el Webhook
const alcanzables = new Set(["Webhook"]);
const cola = ["Webhook"];
while (cola.length) {
  const actual = cola.pop();
  for (const rama of wf.connections[actual]?.main || []) {
    for (const d of rama) {
      if (!alcanzables.has(d.node)) {
        alcanzables.add(d.node);
        cola.push(d.node);
      }
    }
  }
}
const huerfanos = nombres.filter((n) => !alcanzables.has(n));
ok(huerfanos.length === 0, "todos los nodos estan conectados al Webhook", huerfanos.join(", "));

// Sin stubs y codigo compilable
const conStub = wf.nodes.filter((n) => typeof n.parameters?.jsCode === "string" && n.parameters.jsCode.includes("__STUB"));
ok(conStub.length === 0, "sin stubs pendientes", conStub.map((n) => n.name).join(", "));

let noCompila = [];
for (const nodo of wf.nodes) {
  if (typeof nodo.parameters?.jsCode !== "string") continue;
  try {
    new Function("$input", "$", "return (async () => {\n" + nodo.parameters.jsCode + "\n}).call(this);");
  } catch (e) {
    noCompila.push(nodo.name + ": " + e.message);
  }
}
ok(noCompila.length === 0, "el codigo de todos los nodos compila", noCompila.join(" | "));

// La rama de clasificacion no vuelve a la respuesta (doble envio)
const destinosCierre = (wf.connections["Pulir y Auditar Respuesta"]?.main?.[0] || []).map((d) => d.node);
ok(destinosCierre.includes("Verificar si Enviar Audio"), "la respuesta sale una sola vez por Pulir y Auditar Respuesta");
ok(!(wf.connections["Notificar Maestro Lead Caliente"]?.main?.[0] || []).length, "la rama de clasificacion termina y no duplica el mensaje");

// ---------------------------------------------------------------------------
grupo("2. Leer Estado del Lead — normaliza las etapas del CRM");
const codeEtapa = jsDe(wf, "Leer Estado del Lead");

async function etapaDe(claveEstado, pipeline = []) {
  const { salida } = await correr(codeEtapa, {
    entrada: { body: { conversation: { id: 55, custom_attributes: {}, labels: [] }, sender: { phone_number: "+573001112233", name: "Ana" } } },
    refs: { "Consolidar Lista": { body: {}, listaConsolidada: "hola" } },
    http: async (opts) => {
      if (opts.url.includes("/rest/v1/conversaciones")) {
        return [{ id: "conv-1", cliente_id: "cli-1", numero_whatsapp: "+573001112233", fuente: "meta_business", clientes: { id: "cli-1", estado: claveEstado, grupo: "templo", nombre: "Ana", es_spam: false } }];
      }
      if (opts.url.includes("pipeline_etapas")) return pipeline;
      return { custom_attributes: {}, labels: [] };
    }
  });
  return salida;
}

for (const [clave, esperado] of [
  ["nuevo_lead_templo", "lead_nuevo"],
  ["nuevo_lead", "lead_nuevo"],
  ["sin_respuesta_templo", "sin_respuesta"],
  ["No Contesta", "sin_respuesta"],
  ["datos", "datos"],
  ["solicitar_datos", "datos"],
  ["por_consulta", "por_consulta"],
  ["en_consulta_templo", "por_consulta"],
  ["consulta_hecha_templo", "tardia"],
  ["pago_recibido", "tardia"],
  [null, "lead_nuevo"]
]) {
  const r = await etapaDe(clave);
  ok(r.etapa === esperado, "etapa '" + clave + "' → " + esperado, "obtenido: " + r.etapa);
  const debeActuar = ["lead_nuevo", "sin_respuesta", "datos", "por_consulta"].includes(esperado);
  ok(r.lunaActua === debeActuar, "  lunaActua=" + debeActuar + " para '" + clave + "'", "obtenido: " + r.lunaActua);
}

// El caso que detuvo el flujo en produccion: etapa fuera del mapa
const desconocida = await etapaDe("etapa_templo_1700000000000", [{ clave: "etapa_templo_1700000000000", nombre: "Interesados", grupo: "templo" }]);
ok(desconocida.lunaActua === false, "etapa no reconocida → Luna no responde", desconocida.etapa);
ok(desconocida.etapaReconocida === false, "  y queda marcada como NO reconocida (alerta de configuracion)");
ok(desconocida._debug.etapasDelGrupo.length === 1, "  el debug lista las etapas reales del CRM", desconocida._debug.etapasDelGrupo.join(","));

// El CRM crea las etapas con clave "etapa_<grupo>_<timestamp>": se reconocen por NOMBRE
const pipelineTimestamp = [
  { clave: "etapa_templo_1787627846101", nombre: "Lead Nuevo", grupo: "templo" },
  { clave: "etapa_templo_1787627846102", nombre: "Sin respuesta", grupo: "templo" },
  { clave: "etapa_templo_1787627846103", nombre: "Datos", grupo: "templo" },
  { clave: "etapa_templo_1787627846104", nombre: "Por consulta", grupo: "templo" },
  { clave: "etapa_templo_1787627846105", nombre: "Consulta Hecha", grupo: "templo" }
];
for (const [clave, nombre, esperado] of [
  ["etapa_templo_1787627846101", "Lead Nuevo", "lead_nuevo"],
  ["etapa_templo_1787627846102", "Sin respuesta", "sin_respuesta"],
  ["etapa_templo_1787627846103", "Datos", "datos"],
  ["etapa_templo_1787627846104", "Por consulta", "por_consulta"],
  ["etapa_templo_1787627846105", "Consulta Hecha", "tardia"]
]) {
  const r = await etapaDe(clave, pipelineTimestamp);
  ok(r.etapa === esperado, "clave-timestamp " + clave + " (" + nombre + ") → " + esperado, "obtenido: " + r.etapa);
  ok(r._debug.nombreEtapaEnCrm === nombre, "  el debug muestra el nombre real de la etapa", r._debug.nombreEtapaEnCrm);
}
const nuevoLeadOtroNombre = await etapaDe("etapa_templo_9", [{ clave: "etapa_templo_9", nombre: "Nuevo Lead", grupo: "templo" }]);
ok(nuevoLeadOtroNombre.etapa === "lead_nuevo", 'tambien reconoce "Nuevo Lead"', nuevoLeadOtroNombre.etapa);

const tardia = await etapaDe("consulta_hecha_templo", pipelineTemplo);
ok(tardia.lunaActua === false && tardia.etapaReconocida === true, "etapa tardia conocida → silencio sin alerta de configuracion");

// ETAPAS_EXTRA: una linea y la etapa propia queda atendida por Luna
const conExtra = codeEtapa.replace("const ETAPAS_EXTRA = {", 'const ETAPAS_EXTRA = { "primer_contacto": "lead_nuevo",');
{
  const { salida } = await correr(conExtra, {
    entrada: { body: { conversation: { id: 55 }, sender: {} } },
    http: async (opts) => {
      if (opts.url.includes("/rest/v1/conversaciones")) return [{ id: "c", cliente_id: "cli", clientes: { estado: "primer_contacto", grupo: "templo" } }];
      if (opts.url.includes("pipeline_etapas")) return pipelineTemplo;
      return {};
    }
  });
  ok(salida.etapa === "lead_nuevo" && salida.lunaActua === true, "ETAPAS_EXTRA permite atender una etapa propia", salida.etapa);
}

// ACTUAR_EN_ETAPA_NO_RECONOCIDA: red de seguridad en modo retencion
const conRed = codeEtapa.replace("const ACTUAR_EN_ETAPA_NO_RECONOCIDA = false;", "const ACTUAR_EN_ETAPA_NO_RECONOCIDA = true;");
{
  const { salida } = await correr(conRed, {
    entrada: { body: { conversation: { id: 55 }, sender: {} } },
    http: async (opts) => {
      if (opts.url.includes("/rest/v1/conversaciones")) return [{ id: "c", cliente_id: "cli", clientes: { estado: "etapa_rara", grupo: "templo" } }];
      if (opts.url.includes("pipeline_etapas")) return pipelineTemplo;
      return {};
    }
  });
  ok(salida.lunaActua === true && salida.etapa === "por_consulta", "con la red activada responde en modo retencion", salida.etapa);
}

// Rama falsa conectada: el silencio queda registrado, no se pierde
ok((wf.connections["Luna Actua en esta Etapa?"]?.main || []).length === 2, "el IF de etapa tiene rama falsa conectada");
ok((wf.connections["Luna Actua en esta Etapa?"]?.main?.[1] || []).some(d => d.node === "Registrar Silencio de Luna"), "  y apunta a Registrar Silencio de Luna");

const codeSilencio = jsDe(wf, "Registrar Silencio de Luna");
async function silencio({ etapaClave, reconocida }) {
  const { salida, llamadas } = await correr(codeSilencio, {
    entrada: { etapaClave, etapaReconocida: reconocida, conversationId: 55, etapasDelGrupo: ["nuevo_lead_templo (Nuevo Lead)"] },
    http: async () => ({})
  });
  return { salida, llamadas };
}
let sil = await silencio({ etapaClave: "primer_contacto", reconocida: false });
const notaSil = sil.llamadas.find(l => l.url.includes("/messages"));
ok(Boolean(notaSil) && notaSil.body.private === true, "etapa no reconocida deja nota privada en el chat");
ok(sil.salida.lunaRespondio === false, "  y marca lunaRespondio=false");
sil = await silencio({ etapaClave: "consulta_hecha_templo", reconocida: true });
ok(sil.llamadas.length === 0, "etapa tardia conocida no ensucia el chat con notas");

// ---------------------------------------------------------------------------
grupo("3. Vision — clasifica rostro, pareja y palma");
const codeVision = jsDe(wf, "Inyectar Analisis");
async function vision(textoVision) {
  const { salida } = await correr(codeVision, {
    entrada: { choices: [{ message: { content: textoVision } }] },
    refs: {
      Webhook: { body: { conversation: { id: 55 }, attachments: [{ file_type: "image" }] } },
      "Preparar Imagen": { fotoUrl: "https://cdn/1.jpg" }
    }
  });
  return salida;
}
let v = await vision('{"contenido":"rostro","personas_visibles":1,"es_palma":false,"calidad":"buena","descripcion":"mujer joven"}');
ok(v.fotoEvento.tipo === "rostro", "una persona → rostro", v.fotoEvento.tipo);
v = await vision('{"contenido":"pareja","personas_visibles":2,"es_palma":false,"calidad":"buena","descripcion":"dos personas"}');
ok(v.fotoEvento.tipo === "pareja", "dos personas → pareja", v.fotoEvento.tipo);
v = await vision('{"contenido":"palma","personas_visibles":0,"es_palma":true,"manos_visibles":1,"calidad":"buena","descripcion":"palma abierta"}');
ok(v.fotoEvento.tipo === "palma", "palma abierta → palma", v.fotoEvento.tipo);
v = await vision('```json\n{"contenido":"rostro","personas_visibles":1}\n```');
ok(v.fotoEvento.tipo === "rostro", "JSON con markdown igual se interpreta", v.fotoEvento.tipo);
v = await vision("respuesta rota del modelo");
ok(v.fotoEvento.tipo === "otro", "respuesta inutil → otro (no se inventa nada)", v.fotoEvento.tipo);
v = await vision('{"contenido":"palma","personas_visibles":0,"es_palma":true}');
ok(v.body.content.startsWith("[IMAGEN ANALIZADA]"), "el analisis queda como mensaje del turno");

// ---------------------------------------------------------------------------
grupo("4. Fusionar Memoria — guarda sin pisar y asigna fotos");
const codeFusion = jsDe(wf, "Fusionar Memoria");

async function fusionar({ attrs = {}, ia = null, foto = null, etapa = "datos" }) {
  const refs = {
    "Leer Estado del Lead": {
      body: { conversation: { id: 55 } },
      conversationId: 55,
      clienteId: "cli-1",
      grupo: "templo",
      etapa,
      etapaClave: etapa,
      etapaNombre: etapa,
      lunaActua: true,
      etapasPipeline: [],
      attrs,
      labels: [],
      nombreContacto: "Ana",
      telefono: "+573001112233",
      chatwootUrl: "https://crm/x"
    },
    "Consolidar Lista": { listaConsolidada: "mensaje del turno", body: { conversation: { id: 55 } } }
  };
  if (foto) refs["Inyectar Analisis"] = { fotoEvento: foto };
  const entrada = ia
    ? { choices: [{ message: { content: JSON.stringify(ia) } }] }
    : { error: "sin ia" };
  const { salida, llamadas } = await correr(codeFusion, { entrada, refs, http: async () => ({}) });
  return { salida, llamadas };
}

let f = await fusionar({ attrs: { tipo_trabajo: "personal", nombre_cliente: "Ana Perez" }, ia: { nombre_cliente: "Otro Nombre", nombre_otra_persona: "Karla", tipo_trabajo: "pareja", motivo_categoria: "amarre", motivo_conocido: true } });
ok(f.salida.checklist.nombre_cliente === "Ana Perez", "un nombre guardado NUNCA se sobreescribe", f.salida.checklist.nombre_cliente);
ok(f.salida.checklist.tipo_trabajo === "personal", "el tipo de trabajo guardado manda", f.salida.checklist.tipo_trabajo);
ok(f.salida.checklist.nombre_otra_persona === "", "en trabajo personal no se guarda otra persona", f.salida.checklist.nombre_otra_persona);
ok(f.salida.checklist.motivo_categoria === "amarre", "el motivo nuevo si se guarda", f.salida.checklist.motivo_categoria);

f = await fusionar({ attrs: { tipo_trabajo: "personal" }, foto: { tipo: "palma", url: "https://cdn/palma.jpg", personas: 0 } });
ok(f.salida.checklist.foto_mano === true, "personal + palma → foto_mano", JSON.stringify(f.salida.checklist.foto_mano));
ok(f.salida.checklist.foto_cliente === false, "la palma no cuenta como foto del cliente");
ok(f.salida.checklist.foto_mano_url === "https://cdn/palma.jpg", "se guarda la URL de la foto para el Maestro");

f = await fusionar({ attrs: { tipo_trabajo: "pareja" }, foto: { tipo: "pareja", url: "https://cdn/2.jpg", personas: 2 } });
ok(f.salida.checklist.foto_cliente && f.salida.checklist.foto_otra_persona, "pareja + foto de los dos → cubre las dos fotos");
ok(f.salida.faltantes.length === 2, "solo faltan los dos nombres", f.salida.faltantesTexto);

f = await fusionar({ attrs: { tipo_trabajo: "pareja", foto_cliente: true } , foto: { tipo: "rostro", url: "https://cdn/k.jpg", personas: 1 } });
ok(f.salida.checklist.foto_otra_persona === true, "pareja + segundo rostro → foto de la persona a consultar");

f = await fusionar({ attrs: {}, foto: { tipo: "rostro", url: "https://cdn/temprana.jpg", personas: 1 } });
ok(f.salida.fotosPendientes.length === 1, "foto llegada antes de saber el tipo queda en cola");
f = await fusionar({ attrs: { tipo_trabajo: "personal" }, ia: null });
ok(f.salida.consultaCompleta === false, "sin datos no hay consulta completa");

f = await fusionar({
  attrs: { tipo_trabajo: "pareja", nombre_cliente: "Ana Perez", nombre_otra_persona: "Karla Gomez", foto_cliente: true, foto_otra_persona: true, motivo_conocido: true, motivo_categoria: "retorno", motivo_resumen: "Quiere recuperar a su pareja" }
});
ok(f.salida.consultaCompleta === true, "con todo guardado la consulta queda completa");
ok(f.salida.faltantes.length === 0, "nada pendiente");
ok(f.salida.contextoMemoria.includes("PROHIBIDO PEDIRLO"), "la memoria le dice a Luna que no vuelva a pedir");
ok(f.salida.contextoMemoria.includes("PROHIBIDO VOLVER A PREGUNTAR POR QUE VIENE"), "la memoria bloquea repetir el motivo");

f = await fusionar({ attrs: { tipo_trabajo: "personal", nombre_cliente: "Ana Perez", foto_cliente: true, foto_mano: true, motivo_conocido: true } });
ok(f.salida.faltantes.length === 0, "personal completo: nombre + foto + palma");
ok(f.salida.contextoMemoria.includes("prohibido pedir nombres o fotos de otra persona"), "en personal se bloquea pedir datos de terceros");

// Persistencia
f = await fusionar({ attrs: { tipo_trabajo: "pareja", nombre_cliente: "Ana" }, ia: { nombre_otra_persona: "Karla", motivo_conocido: true, motivo_categoria: "retorno" } });
const aChatwoot = f.llamadas.find((l) => l.url.includes("/custom_attributes"));
ok(Boolean(aChatwoot), "guarda el checklist en Chatwoot custom_attributes");
ok(aChatwoot && aChatwoot.body.custom_attributes.nombre_otra_persona === "Karla", "  con el nombre recien detectado");
const aSupabase = f.llamadas.find((l) => l.method === "PATCH" && l.url.includes("/rest/v1/clientes"));
ok(Boolean(aSupabase), "sincroniza el cliente en Supabase");
const nota = f.llamadas.find((l) => l.url.includes("/messages"));
ok(Boolean(nota) && nota.body.private === true, "deja ficha privada para el Maestro cuando hay novedades");

// ---------------------------------------------------------------------------
grupo("5. Pulir y Auditar — Luna no pide lo que ya tiene");
const codePulir = jsDe(wf, "Pulir y Auditar Respuesta");

async function pulir({ texto, checklist, etapa = "datos", faltantes = [], motivoOk = false }) {
  const { salida } = await correr(codePulir, {
    entrada: { choices: [{ message: { content: texto } }] },
    refs: {
      "Fusionar Memoria": {
        checklist,
        etapa,
        etapaNombre: etapa,
        faltantes,
        conversationId: 55,
        contactName: "Ana",
        contactPhone: "+573001112233",
        chatwootUrl: "https://crm/x",
        contextoMemoria: "",
        novedades: []
      }
    }
  });
  return salida;
}

const completoPareja = { tipo_trabajo: "pareja", nombre_cliente: "Ana Perez", nombre_otra_persona: "Karla Gomez", foto_cliente: true, foto_otra_persona: true, motivo_conocido: true, motivo_categoria: "retorno" };
let p = await pulir({ texto: "Hola Ana, para continuar necesito tu nombre completo y una foto tuya.", checklist: completoPareja, etapa: "datos", faltantes: [] });
ok(p.corregido === true, "detecta que pidio el nombre ya guardado");
ok(!/tu nombre|nombre completo/i.test(p.textoRespuesta), "el mensaje corregido no vuelve a pedir el nombre", p.textoRespuesta);
ok(p.consultaLista === true, "con el archivo completo marca consultaLista");

p = await pulir({ texto: "Entiendo Ana. Ya le envie tus datos al Maestro. Me envias una foto de Karla?", checklist: completoPareja, etapa: "por_consulta", faltantes: [] });
ok(p.violaciones.includes("pidio_datos_en_por_consulta") || p.violaciones.includes("pidio_foto_pareja_ya_guardada"), "en Por consulta no se puede pedir nada", p.violaciones.join(","));
ok(/Maestro/i.test(p.textoRespuesta) && !/\?/.test(p.textoRespuesta.replace(/llamada\?/i, "")), "responde reteniendo al cliente", p.textoRespuesta);

p = await pulir({ texto: "Cuentame, cual es el motivo de tu consulta?", checklist: completoPareja, etapa: "datos", faltantes: [] });
ok(p.violaciones.includes("pregunto_motivo_en_datos"), "en Datos no se vuelve a preguntar el motivo", p.violaciones.join(","));

const faltaFoto = { tipo_trabajo: "personal", nombre_cliente: "Ana Perez", foto_cliente: true, foto_mano: false, motivo_conocido: true };
p = await pulir({
  texto: "Gracias Ana. Ahora necesito una foto de la palma de tu mano derecha.",
  checklist: faltaFoto,
  etapa: "datos",
  faltantes: [{ clave: "foto_mano", etiqueta: "una foto de la palma de tu mano derecha" }]
});
ok(p.corregido === false, "pedir lo que SI falta no se corrige", p.violaciones.join(","));
ok(p.consultaLista === false, "si falta la palma no hay consulta lista");

p = await pulir({ texto: "Perfecto. Ya tengo todo. [CONSULTA_LISTA]", checklist: completoPareja, etapa: "datos", faltantes: [] });
ok(!p.textoRespuesta.includes("CONSULTA_LISTA"), "el marcador nunca llega al cliente", p.textoRespuesta);

p = await pulir({ texto: "Hola, en que te puedo ayudar?", checklist: {}, etapa: "lead_nuevo", faltantes: [{ clave: "tipo_trabajo", etiqueta: "tipo de trabajo" }] });
ok(/soy luna/i.test(p.textoRespuesta), "en Lead Nuevo garantiza saludo y presentacion", p.textoRespuesta);
ok(p.motivoOk === false, "el salto a Datos solo ocurre en Sin respuesta");

p = await pulir({ texto: "Entiendo tu dolor, el Maestro ha ayudado a muchas personas. Para preparar la consulta necesito tu nombre completo. [MOTIVO_OK]", checklist: { tipo_trabajo: "pareja", motivo_conocido: true, motivo_categoria: "retorno" }, etapa: "sin_respuesta", faltantes: [{ clave: "nombre_cliente", etiqueta: "tu nombre completo" }] });
ok(p.motivoOk === true, "con motivo y tipo definidos autoriza el paso a Datos");
ok(!p.textoRespuesta.includes("MOTIVO_OK"), "  y oculta el marcador");

p = await pulir({ texto: "Entiendo. Enviame una foto de la palma de tu mano.", checklist: { tipo_trabajo: "pareja", nombre_cliente: "Ana", motivo_conocido: true }, etapa: "datos", faltantes: [{ clave: "foto_cliente", etiqueta: "una foto tuya" }] });
ok(p.violaciones.includes("pidio_palma_en_pareja"), "en pareja jamas pide la palma", p.violaciones.join(","));

// Falsos positivos: pedir lo que SI falta no puede corregirse
p = await pulir({
  texto: "Gracias Ana. Ya tengo tu foto. Ahora necesito una foto de la palma de tu mano derecha.",
  checklist: faltaFoto,
  etapa: "datos",
  faltantes: [{ clave: "foto_mano", etiqueta: "una foto de la palma de tu mano derecha" }]
});
ok(p.corregido === false, "no corrige cuando pide la foto que de verdad falta", p.violaciones.join(","));

p = await pulir({
  texto: "Cual es el nombre completo de la persona a consultar?",
  checklist: { tipo_trabajo: "pareja", nombre_cliente: "Ana Perez", motivo_conocido: true },
  etapa: "datos",
  faltantes: [{ clave: "nombre_otra_persona", etiqueta: "el nombre completo de la persona a consultar" }]
});
ok(p.corregido === false, "no corrige cuando pregunta el nombre que falta", p.violaciones.join(","));

p = await pulir({
  texto: "Siento mucho lo que estas viviendo. Cuentame, hace cuanto terminaron?",
  checklist: {},
  etapa: "sin_respuesta",
  faltantes: [{ clave: "tipo_trabajo", etiqueta: "tipo de trabajo" }]
});
ok(p.corregido === false && p.violaciones.length === 0, "en Sin respuesta si puede preguntar el motivo", p.violaciones.join(","));

p = await pulir({
  texto: "Tranquila Ana, el Maestro te llama pronto. En que horario te queda mejor recibir la llamada?",
  checklist: completoPareja,
  etapa: "por_consulta",
  faltantes: []
});
ok(p.violaciones.length === 0, "en Por consulta puede coordinar la hora de la llamada", p.violaciones.join(","));

// ---------------------------------------------------------------------------
grupo("6. Aplicar Transicion — mueve el lead en el CRM");
const codeTransicion = jsDe(wf, "Aplicar Transicion de Etapa");

async function transicion({ etapa, motivoOk = false, consultaLista = false, pipeline = [], novedades = [], checklist = {}, tipo = "pareja", historial = 2 }) {
  const refs = {
    "Fusionar Memoria": { checklist, grupo: "templo", etapasPipeline: pipeline, etapasPipelineLength: pipeline.length, novedades, conversationId: 55, clienteId: "cli-1", chatwootUrl: "https://crm/x", labels: [] },
    Historial: { payload: Array.from({ length: historial }, (_, i) => ({ message_type: 0, id: i })) }
  };
  const { salida, llamadas } = await correr(codeTransicion, {
    entrada: {
      etapa,
      motivoOk,
      consultaLista,
      conversationId: 55,
      clienteId: "cli-1",
      telefono: "+573001112233",
      contactName: "Ana",
      chatwootUrl: "https://crm/x",
      novedades,
      checklist,
      labels: []
    },
    refs,
    http: async () => ({})
  });
  return { salida, llamadas };
}


let t = await transicion({ etapa: "lead_nuevo", pipeline: pipelineTemplo });
ok(t.salida.etapaNueva === "sin_respuesta", "Lead Nuevo → Sin respuesta apenas saluda", t.salida.etapaNueva);
let patch = t.llamadas.find((l) => l.method === "PATCH" && l.url.includes("/rest/v1/clientes"));
ok(patch && patch.body.estado === "sin_respuesta_templo", "  y escribe la clave real del pipeline del Templo", patch && patch.body.estado);

t = await transicion({ etapa: "sin_respuesta", motivoOk: true, pipeline: pipelineTemplo });
ok(t.salida.etapaNueva === "datos", "Sin respuesta → Datos cuando ya sabe motivo y tipo", t.salida.etapaNueva);

t = await transicion({ etapa: "sin_respuesta", motivoOk: false, pipeline: pipelineTemplo });
ok(t.salida.etapaNueva === "sin_respuesta", "Sin respuesta se queda si aun no sabe el motivo");

t = await transicion({ etapa: "sin_respuesta", motivoOk: false, historial: 6, pipeline: pipelineTemplo });
ok(t.salida.etapaNueva === "datos" && t.salida._debug.forzado === true, "anti-atasco: a los 5 mensajes avanza a Datos", t.salida.etapaNueva);

t = await transicion({ etapa: "datos", consultaLista: true, checklist: completoPareja, pipeline: pipelineTemplo });
ok(t.salida.etapaNueva === "por_consulta", "Datos → Por consulta con el archivo completo");
const notif = t.llamadas.find((l) => l.url.includes("evo.crmesteban.duckdns.org/message/sendText"));
ok(Boolean(notif), "  notifica al Maestro por WhatsApp");
ok(notif && notif.body.text.includes("CONSULTA LISTA PARA LLAMAR"), "  con el expediente listo para llamar");
ok(notif && notif.body.text.includes("Telefono"), "  incluye el telefono del cliente");
const labels = t.llamadas.find((l) => l.url.includes("/labels"));
ok(labels && labels.body.labels.includes("consulta-pendiente"), "  etiqueta consulta-pendiente para el comando del Maestro");
const attrsT = t.llamadas.find((l) => l.url.includes("/custom_attributes"));
ok(attrsT && attrsT.body.custom_attributes.consulta_lista_enviada === true, "  marca consulta_lista_enviada");

t = await transicion({ etapa: "datos", consultaLista: false, checklist: faltaFoto, pipeline: pipelineTemplo });
ok(t.salida.etapaNueva === "datos", "Datos NO avanza si todavia falta algo");
ok(!t.llamadas.some((l) => l.method === "PATCH" && l.url.includes("/clientes")), "  y no toca la etapa del CRM");

t = await transicion({ etapa: "por_consulta", pipeline: pipelineTemplo });
ok(t.salida.etapaNueva === "por_consulta" && t.salida.transicion === false, "Por consulta no se mueve: Luna retiene");

t = await transicion({ etapa: "por_consulta", novedades: ["foto_cliente"], checklist: completoPareja, pipeline: pipelineTemplo });
ok(t.llamadas.some((l) => l.url.includes("message/sendText") && l.body.text.includes("EXPEDIENTE ACTUALIZADO")), "si llega algo nuevo en Por consulta, actualiza el expediente del Maestro");

t = await transicion({ etapa: "lead_nuevo", pipeline: pipelineTimestamp });
patch = t.llamadas.find((l) => l.method === "PATCH" && l.url.includes("/rest/v1/clientes"));
ok(patch && patch.body.estado === "etapa_templo_1787627846102", "con claves-timestamp escribe la clave real de 'Sin respuesta'", patch && patch.body.estado);

t = await transicion({ etapa: "datos", consultaLista: true, checklist: completoPareja, pipeline: pipelineTimestamp });
patch = t.llamadas.find((l) => l.method === "PATCH" && l.url.includes("/rest/v1/clientes"));
ok(patch && patch.body.estado === "etapa_templo_1787627846104", "  y la de 'Por consulta'", patch && patch.body.estado);

t = await transicion({ etapa: "lead_nuevo", pipeline: [{ clave: "etapa_templo_1", nombre: "Interesados", grupo: "templo" }] });
patch = t.llamadas.find((l) => l.method === "PATCH" && l.url.includes("/rest/v1/clientes"));
ok(!patch && /no existe la etapa/.test(t.salida._debug.errorEstado || ""), "si la etapa destino no existe en el pipeline no inventa una clave", t.salida._debug.errorEstado);

t = await transicion({ etapa: "lead_nuevo", pipeline: [] });
ok(t.salida.etapaNuevaClave === "sin_respuesta", "sin pipeline cargado usa la clave por defecto", t.salida.etapaNuevaClave);

// Lead recien creado: el cliente aun no existe cuando se leyo el estado
{
  const llamadas2 = [];
  const ctx = {
    helpers: {
      httpRequest: async (opts) => {
        llamadas2.push(opts);
        if (opts.method === "GET" && opts.url.includes("/rest/v1/conversaciones")) return [{ cliente_id: "cli-nuevo" }];
        return {};
      }
    }
  };
  const fn = new Function("$input", "$", "return (async () => {\n" + codeTransicion + "\n}).call(this);");
  await fn.call(ctx, { first: () => item({ etapa: "lead_nuevo", conversationId: 55, clienteId: null, telefono: "+5730", contactName: "Ana", chatwootUrl: "u", novedades: [], checklist: {}, labels: [] }) },
    (n) => ({ first: () => item(n === "Fusionar Memoria" ? { checklist: {}, grupo: "templo", etapasPipeline: pipelineTemplo, novedades: [], conversationId: 55, clienteId: null } : { payload: [] }) }));
  const patchNuevo = llamadas2.find((l) => l.method === "PATCH" && l.url.includes("/rest/v1/clientes"));
  ok(patchNuevo && patchNuevo.url.includes("cli-nuevo"), "si el lead es nuevo, busca el cliente y mueve la etapa igual", patchNuevo && patchNuevo.url);
}

// ---------------------------------------------------------------------------
grupo("7. Prompt por etapa");
const codePrompt = jsDe(wf, "Construir Prompt por Etapa");
async function prompt({ etapa, checklist = {}, faltantes = [], contextoMemoria = "MEMORIA", cerebro = "" }) {
  const { salida } = await correr(codePrompt, {
    entrada: {},
    refs: {
      "Fusionar Memoria": { checklist, etapa, etapaNombre: etapa, faltantes, contextoMemoria, listaConsolidada: "hola" },
      Historial: { payload: [{ id: 1, message_type: 0, content: "hola", created_at: 1 }, { id: 2, message_type: 1, content: "hola, soy Luna", created_at: 2 }] },
      "Cerebro · Leer memoria": { prompt: cerebro }
    }
  });
  return salida;
}

let pr = await prompt({ etapa: "lead_nuevo", cerebro: "REGLA DEL CEREBRO: ofrece siempre la consulta gratuita." });
let sys = pr.body.messages[0].content;
ok(sys.includes("ETAPA 1 — LEAD NUEVO"), "incluye el motor de etapas");
ok(sys.includes("ESTAS EN ETAPA 1"), "marca la etapa activa");
ok(sys.includes("PROHIBIDO pedir nombres, fotos o la palma en esta etapa"), "prohibe pedir datos en Lead Nuevo");
ok(sys.includes("amarre sexual") && sys.includes("entierros y salamientos"), "conserva el catalogo de interpretacion (amarres, trabajos pesados)");
ok(sys.includes("REGLA DEL CEREBRO"), "inyecta la memoria del Cerebro IA");
ok(pr.body.messages[pr.body.messages.length - 1].role === "user", "el ultimo mensaje es del cliente");
ok(pr.body.messages[pr.body.messages.length - 1].content.includes("MEMORIA"), "e inyecta el archivo de Luna");

pr = await prompt({ etapa: "datos", checklist: { tipo_trabajo: "pareja", motivo_conocido: true }, faltantes: [{ clave: "foto_cliente", etiqueta: "una foto tuya" }] });
sys = pr.body.messages[0].content;
ok(sys.includes("ESTAS EN ETAPA 3 (DATOS)"), "en Datos activa la etapa 3");
ok(sys.includes("PROHIBIDO volver a preguntar por que viene"), "en Datos prohibe repetir el motivo");

pr = await prompt({ etapa: "por_consulta", checklist: { tipo_trabajo: "pareja" }, faltantes: [] });
sys = pr.body.messages[0].content;
ok(sys.includes("ESTAS EN ETAPA 4 (POR CONSULTA)"), "en Por consulta activa la etapa 4");
ok(sys.includes("PROHIBIDO pedir cualquier dato"), "en Por consulta prohibe pedir datos");

// ---------------------------------------------------------------------------
grupo("8. Recorrido completo de un lead de pareja, turno a turno");

const store = { attrs: {}, estado: "nuevo_lead_templo", etiquetas: [], notificados: [] };
const CLAVE_A_CANON = {
  nuevo_lead_templo: "lead_nuevo",
  sin_respuesta_templo: "sin_respuesta",
  datos_templo: "datos",
  por_consulta_templo: "por_consulta"
};
let turnoCliente = 0;

async function turno({ ia = null, foto = null, respuestaLuna }) {
  turnoCliente++;
  const etapa = CLAVE_A_CANON[store.estado] || "lead_nuevo";
  const fusionRefs = {
    "Leer Estado del Lead": {
      body: { conversation: { id: 55 } },
      conversationId: 55,
      clienteId: "cli-1",
      grupo: "templo",
      etapa,
      etapaClave: store.estado,
      etapaNombre: etapa,
      lunaActua: true,
      etapasPipeline: pipelineTemplo,
      attrs: JSON.parse(JSON.stringify(store.attrs)),
      labels: store.etiquetas.slice(),
      nombreContacto: "Ana",
      telefono: "+573001112233",
      chatwootUrl: "https://crm/55"
    },
    "Consolidar Lista": { listaConsolidada: "turno " + turnoCliente, body: { conversation: { id: 55 } } }
  };
  if (foto) fusionRefs["Inyectar Analisis"] = { fotoEvento: foto };

  const rFusion = await correr(codeFusion, {
    entrada: ia ? { choices: [{ message: { content: JSON.stringify(ia) } }] } : {},
    refs: fusionRefs,
    http: async (opts) => {
      if (opts.url.includes("/custom_attributes")) Object.assign(store.attrs, opts.body.custom_attributes);
      return {};
    }
  });
  const fus = rFusion.salida;

  const rPulir = await correr(codePulir, {
    entrada: { choices: [{ message: { content: respuestaLuna } }] },
    refs: { "Fusionar Memoria": fus }
  });
  const pul = rPulir.salida;

  const rTrans = await correr(codeTransicion, {
    entrada: { ...pul, labels: store.etiquetas.slice() },
    refs: { "Fusionar Memoria": fus, Historial: { payload: Array.from({ length: turnoCliente }, (_, i) => ({ message_type: 0, id: i })) } },
    http: async (opts) => {
      if (opts.method === "PATCH" && opts.url.includes("/rest/v1/clientes") && opts.body.estado) store.estado = opts.body.estado;
      if (opts.url.includes("/labels")) store.etiquetas = opts.body.labels;
      if (opts.url.includes("message/sendText")) store.notificados.push(opts.body.text);
      return {};
    }
  });
  return { fus, pul, tr: rTrans.salida };
}

// Turno 1: lead nuevo, la cliente solo dice hola
let r = await turno({
  ia: { tipo_trabajo: "desconocido", motivo_conocido: false, motivo_categoria: "desconocido" },
  respuestaLuna: "Hola, bienvenido al Templo Mistico. Soy Luna, asistente del Maestro Raul. Cuentame, en que te puedo ayudar?"
});
ok(store.estado === "sin_respuesta_templo", "turno 1: saluda y pasa a Sin respuesta", store.estado);
ok(r.pul.corregido === false, "  el saludo no se corrige");

// Turno 2: cuenta el caso (quiere recuperar a su pareja)
r = await turno({
  ia: { tipo_trabajo: "pareja", motivo_categoria: "retorno", motivo_resumen: "Termino con su pareja hace 3 meses y quiere recuperarla.", motivo_conocido: true },
  respuestaLuna: "Lamento mucho lo que estas viviendo, el Maestro ha ayudado a muchas personas en tu misma situacion. Para preparar tu consulta necesito tu nombre completo. [MOTIVO_OK]"
});
ok(store.estado === "datos_templo", "turno 2: entiende el motivo y pasa a Datos", store.estado);
ok(store.attrs.motivo_categoria === "retorno", "  guarda el motivo en el archivo", store.attrs.motivo_categoria);
ok(/nombre completo/.test(r.pul.textoRespuesta), "  y pide el primer dato", r.pul.textoRespuesta);

// Turno 3: da los dos nombres
r = await turno({
  ia: { tipo_trabajo: "pareja", motivo_categoria: "retorno", motivo_resumen: "Termino con su pareja hace 3 meses y quiere recuperarla.", motivo_conocido: true, nombre_cliente: "Ana Perez", nombre_otra_persona: "Karla Gomez" },
  respuestaLuna: "Gracias Ana. Ya tengo los nombres. Ahora enviame una foto tuya y una foto de Karla, o una foto donde salgan las dos."
});
ok(store.attrs.nombre_cliente === "Ana Perez" && store.attrs.nombre_otra_persona === "Karla Gomez", "turno 3: guarda los dos nombres");
ok(store.estado === "datos_templo", "  sigue en Datos porque faltan fotos", store.estado);

// Turno 4: manda una sola foto con las dos
r = await turno({
  ia: { tipo_trabajo: "pareja", motivo_categoria: "retorno", motivo_conocido: true, nombre_cliente: "Ana Perez", nombre_otra_persona: "Karla Gomez" },
  foto: { tipo: "pareja", personas: 2, url: "https://cdn/dos.jpg", calidad: "buena" },
  respuestaLuna: "Perfecto, ya tengo la foto de las dos. Ya le envie todo al Maestro Raul y el te llama pronto. [CONSULTA_LISTA]"
});
ok(store.estado === "por_consulta_templo", "turno 4: con todo completo pasa a Por consulta", store.estado);
ok(store.notificados.length === 1 && store.notificados[0].includes("CONSULTA LISTA PARA LLAMAR"), "  y le avisa al Maestro con el expediente");
ok(store.notificados[0].includes("Karla Gomez"), "  el expediente lleva el nombre de la persona a consultar");
ok(store.etiquetas.includes("etapa-por_consulta") && store.etiquetas.includes("consulta-pendiente"), "  etiqueta la conversacion");

// Turno 5: ya en Por consulta, el cliente pregunta precio y reenvia una foto
r = await turno({
  ia: { tipo_trabajo: "pareja", motivo_categoria: "retorno", motivo_conocido: true, nombre_cliente: "Ana Perez", nombre_otra_persona: "Karla Gomez" },
  respuestaLuna: "Hola Ana, cuanto cuesta el trabajo? Me puedes enviar de nuevo tu nombre completo y una foto tuya?"
});
ok(store.estado === "por_consulta_templo", "turno 5: Por consulta no se mueve", store.estado);
ok(r.pul.corregido === true, "  corrige el intento de volver a pedir datos", r.pul.violaciones.join(","));
ok(!/nombre completo|foto tuya/i.test(r.pul.textoRespuesta), "  el mensaje final no pide nada", r.pul.textoRespuesta);
ok(/Maestro/.test(r.pul.textoRespuesta), "  solo retiene al cliente hasta la llamada", r.pul.textoRespuesta);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log("\n────────────────────────────────────────");
console.log("Pruebas: " + pruebas + "  |  Fallos: " + fallos);
if (fallos > 0) {
  console.log("❌ VALIDACION FALLIDA");
  process.exit(1);
}
console.log("✅ WORKFLOW DE LUNA VALIDADO");
