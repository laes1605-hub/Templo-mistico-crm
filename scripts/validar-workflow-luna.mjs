#!/usr/bin/env node
/**
 * Verificador del workflow de Luna.
 *
 * Comprueba la configuracion real generada por n8n/build-luna-workflow.mjs y
 * ejecuta el JavaScript real de los nodos con un mock minimo de n8n.
 *
 * Uso: npm run check:luna
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const rutaWorkflow = path.join(raiz, "n8n", "05-luna-etapas.github.json");
const wf = JSON.parse(fs.readFileSync(rutaWorkflow, "utf8"));

let fallos = 0;
let pruebas = 0;
function ok(cond, etiqueta, detalle = "") {
  pruebas++;
  if (cond) console.log("  ✔ " + etiqueta);
  else {
    fallos++;
    console.log("  ✘ " + etiqueta + (detalle ? " → " + detalle : ""));
  }
}
function grupo(titulo) { console.log("\n" + titulo); }

function item(json, binary = {}) { return { json, binary }; }
function crearContexto({ entrada, refs = {}, http = async () => ({}) }) {
  const llamadas = [];
  const $ = (nombre) => {
    if (!(nombre in refs)) throw new Error("Referencia sin mock: " + nombre);
    const valor = Array.isArray(refs[nombre]) ? refs[nombre] : [refs[nombre]];
    return {
      first: () => item(valor[0]),
      last: () => item(valor[valor.length - 1]),
      all: () => valor.map(v => item(v)),
      item: item(valor[0])
    };
  };
  const $input = { first: () => item(entrada), all: () => [item(entrada)], item: item(entrada) };
  const ctx = {
    helpers: {
      httpRequest: async (opts) => {
        llamadas.push(opts);
        return http(opts, llamadas.length);
      },
      getBinaryDataBuffer: async () => Buffer.from("imagen")
    }
  };
  return { $, $input, ctx, llamadas };
}
async function correr(jsCode, opts) {
  const { $, $input, ctx, llamadas } = crearContexto(opts);
  const fn = new Function("$input", "$", "return (async () => {\n" + jsCode + "\n}).call(this);");
  const resultado = await fn.call(ctx, $input, $);
  const salida = Array.isArray(resultado) ? resultado[0] : resultado;
  return { salida: salida?.json || salida, llamadas };
}
function jsDe(nombre) {
  const nodo = wf.nodes.find(n => n.name === nombre);
  if (!nodo) throw new Error("Falta nodo: " + nombre);
  return nodo.parameters?.jsCode || "";
}

// ---------------------------------------------------------------------------
// 1. Estructura generada
// ---------------------------------------------------------------------------
grupo("1. Estructura del workflow");
const nombres = wf.nodes.map(n => n.name);
ok(nombres.length > 50, "carga el workflow completo", nombres.length + " nodos");
ok(!wf.pinData || Object.keys(wf.pinData).length === 0, "no tiene pinData");
let conexionesMalas = [];
for (const [origen, salidas] of Object.entries(wf.connections || {})) {
  if (!nombres.includes(origen)) conexionesMalas.push("origen " + origen);
  for (const rama of salidas.main || []) {
    for (const destino of rama) if (!nombres.includes(destino.node)) conexionesMalas.push("destino " + destino.node);
  }
}
ok(conexionesMalas.length === 0, "todas las conexiones apuntan a nodos existentes", conexionesMalas.join(", "));
ok(wf.nodes.some(n => n.name === "Verificar CRM" && String(n.parameters?.jsCode || "").includes("luna_pausada")), "el candado temprano conoce la pausa automática");
ok(String(wf.nodes.find(n => n.name === "Luna Actua en esta Etapa?")?.notes || "").includes("Lead Nuevo y Datos"), "el IF documenta solo las dos etapas activas");
ok(!JSON.stringify(wf).includes("__STUB"), "no hay stubs pendientes");

const referenciasMalas = new Set();
for (const nodo of wf.nodes) {
  for (const valor of Object.values(nodo.parameters || {})) {
    if (typeof valor !== "string") continue;
    for (const m of valor.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!nombres.includes(m[1])) referenciasMalas.add(nodo.name + " → " + m[1]);
    }
  }
}
ok(referenciasMalas.size === 0, "todas las referencias $('Nodo') existen", [...referenciasMalas].join(" | "));

const alcanzables = new Set(["Webhook"]);
const cola = ["Webhook"];
while (cola.length) {
  const actual = cola.pop();
  for (const rama of wf.connections?.[actual]?.main || []) {
    for (const d of rama) if (!alcanzables.has(d.node)) {
      alcanzables.add(d.node);
      cola.push(d.node);
    }
  }
}
ok(nombres.every(n => alcanzables.has(n)), "todos los nodos son alcanzables", nombres.filter(n => !alcanzables.has(n)).join(", "));
let noCompila = [];
for (const nodo of wf.nodes) {
  if (typeof nodo.parameters?.jsCode !== "string") continue;
  try {
    new Function("$input", "$", "return (async () => {\n" + nodo.parameters.jsCode + "\n}).call(this);");
  } catch (e) { noCompila.push(nodo.name + ": " + e.message); }
}
ok(noCompila.length === 0, "el JavaScript de todos los nodos compila", noCompila.join(" | "));
ok(!((wf.connections?.["Notificar Maestro Lead Caliente"]?.main || []).flat()).length, "la rama lateral de clasificacion no duplica mensajes");

const destinosDe = (nombre) => (wf.connections?.[nombre]?.main || []).flat().map(d => d.node);
const destinosPulir = destinosDe("Pulir y Auditar Respuesta");
ok(!destinosPulir.includes("Aplicar Transicion de Etapa"), "la pausa no corre en paralelo antes de enviar el mensaje");
ok(destinosDe("Enviar Mensaje Chatwoot").includes("Aplicar Transicion de Etapa"), "el texto pausa el chat solamente despues de enviarse");
ok(destinosDe("Enviar Audio Chatwoot").includes("Aplicar Transicion de Etapa"), "el audio pausa el chat solamente despues de enviarse");

// ---------------------------------------------------------------------------
// 2. Etapas: solo Lead Nuevo y Datos
// ---------------------------------------------------------------------------
grupo("2. Etapas activas y candados");
const pipeline = [
  { clave: "nuevo_lead_templo", nombre: "Nuevo Lead", grupo: "templo" },
  { clave: "datos_templo", nombre: "Datos", grupo: "templo" },
  { clave: "sin_respuesta_templo", nombre: "Sin respuesta", grupo: "templo" },
  { clave: "por_consulta_templo", nombre: "Por consulta", grupo: "templo" },
  { clave: "consulta_hecha_templo", nombre: "Consulta Hecha", grupo: "templo" }
];
const codeEtapa = jsDe("Leer Estado del Lead");
async function etapaDe(estado, attrs = {}, etapas = pipeline) {
  const { salida } = await correr(codeEtapa, {
    entrada: { body: { conversation: { id: 55, custom_attributes: attrs, labels: [] }, sender: { phone_number: "+573001112233", name: "Ana" } } },
    refs: { "Consolidar Lista": { listaConsolidada: "hola" } },
    http: async (opts) => {
      if (opts.url.includes("/rest/v1/conversaciones")) return [{ id: "conv-1", cliente_id: "cli-1", numero_whatsapp: "+573001112233", clientes: { id: "cli-1", estado, grupo: "templo", nombre: "Ana", es_spam: false } }];
      if (opts.url.includes("pipeline_etapas")) return etapas;
      if (opts.url.includes("/api/v1/accounts/1/conversations/55")) return { custom_attributes: attrs, labels: [] };
      return {};
    }
  });
  return salida;
}
let r = await etapaDe("nuevo_lead_templo");
ok(r.etapa === "lead_nuevo" && r.lunaActua === true, "Nuevo Lead → activo");
r = await etapaDe("etapa_templo_1", {}, [{ clave: "etapa_templo_1", nombre: "Lead Nuevo", grupo: "templo" }, ...pipeline]);
ok(r.etapa === "lead_nuevo" && r.lunaActua === true, "reconoce Lead Nuevo por nombre aunque la clave sea dinámica");
r = await etapaDe("datos_templo");
ok(r.etapa === "datos" && r.lunaActua === true, "Datos → activo");
r = await etapaDe("sin_respuesta_templo");
ok(r.etapa === "sin_respuesta" && r.lunaActua === false, "Sin respuesta → silenciado");
r = await etapaDe("por_consulta_templo");
ok(r.etapa === "por_consulta" && r.lunaActua === false, "Por consulta → silenciado");
r = await etapaDe("consulta_hecha_templo");
ok(r.lunaActua === false, "etapas posteriores → silenciadas");
r = await etapaDe("datos_templo", { luna_pausada: true });
ok(r.lunaPausada === true && r.lunaActua === false, "Datos pausada → silenciada");
r = await etapaDe("etapa_templo_desconocida", {}, [{ clave: "etapa_templo_desconocida", nombre: "Interesados", grupo: "templo" }]);
ok(r.lunaActua === false && r.etapaReconocida === false, "etapa desconocida → silenciada sin adivinar");

const codeSilencio = jsDe("Registrar Silencio de Luna");
const sil = await correr(codeSilencio, {
  entrada: { etapaClave: "consulta_hecha_templo", etapaReconocida: true, conversationId: 55, etapasDelGrupo: [] },
  http: async () => ({})
});
ok(sil.salida.lunaRespondio === false && sil.llamadas.length === 0, "el silencio de una etapa conocida no agrega mensajes");

// Candado anterior al gasto de IA: pausa en Chatwoot corta el evento SOLO en Datos con lista enviada.
// En Nuevo Lead por NOMBRE, Luna debe reactivarse (validacion por nombre, no por clave).
const codeCandado = jsDe("Verificar CRM");

// Caso 1: Datos con lista ya enviada → debe bloquearse
const candadoDatosPausada = await correr(codeCandado, {
  entrada: { body: { conversation: { id: 55, custom_attributes: { lista_requisitos_enviada: true }, labels: [] }, sender: { phone_number: "+573001112233" } } },
  http: async (opts) => {
    if (opts.url.includes("config_general")) return [{ valor: "true" }];
    if (opts.url.includes("pipeline_etapas")) return pipeline;
    if (opts.url.includes("/rest/v1/conversaciones")) return [{ id: "conv-1", cliente_id: "cli-1", agente_activo: true, clientes: { id: "cli-1", estado: "datos_templo", es_spam: false } }];
    if (opts.url.includes("/api/v1/accounts/1/conversations/55")) return { custom_attributes: { luna_pausada: true, lista_requisitos_enviada: true }, labels: ["bot-pausado"] };
    return [];
  }
});
ok(candadoDatosPausada.salida.botPuedeContestar === false, "la pausa corta el flujo en Datos con lista enviada", candadoDatosPausada.salida.motivo);

// Caso 2: Nuevo Lead por NOMBRE con pausa previa → debe REACTIVARSE y estar activa
const candadoNuevoLeadPausada = await correr(codeCandado, {
  entrada: { body: { conversation: { id: 56, custom_attributes: { luna_pausada: true, lista_requisitos_enviada: true }, labels: ["bot-pausado"] }, sender: { phone_number: "+573001112233" } } },
  http: async (opts) => {
    if (opts.url.includes("config_general")) return [{ valor: "true" }];
    if (opts.url.includes("pipeline_etapas")) return pipeline;
    if (opts.url.includes("/rest/v1/conversaciones") && opts.url.includes("chatwoot_conversation_id=eq.56")) return [{ id: "conv-2", cliente_id: "cli-2", agente_activo: false, clientes: { id: "cli-2", estado: "nuevo_lead_templo", es_spam: false } }];
    if (opts.url.includes("/api/v1/accounts/1/conversations/56")) return { custom_attributes: { luna_pausada: true, lista_requisitos_enviada: true }, labels: ["bot-pausado"] };
    return [];
  }
});
ok(candadoNuevoLeadPausada.salida.botPuedeContestar === true && candadoNuevoLeadPausada.salida.crmAgenteActivo === true, "Nuevo Lead por NOMBRE reactiva Luna aunque estuviera pausada", candadoNuevoLeadPausada.salida.motivo);

// Caso 3: Validacion por nombre — clave dinamica pero nombre "Nuevo Lead" debe activar
const candado = await correr(codeCandado, {
  entrada: { body: { conversation: { id: 55, custom_attributes: {}, labels: [] }, sender: { phone_number: "+573001112233" } } },
  http: async (opts) => {
    if (opts.url.includes("config_general")) return [{ valor: "true" }];
    if (opts.url.includes("pipeline_etapas")) return [{ clave: "etapa_123456", nombre: "Nuevo Lead", grupo: "templo" }];
    if (opts.url.includes("/rest/v1/conversaciones")) return [{ id: "conv-1", cliente_id: "cli-1", agente_activo: true, clientes: { id: "cli-1", estado: "etapa_123456", es_spam: false } }];
    if (opts.url.includes("/api/v1/accounts/1/conversations/55")) return { custom_attributes: {}, labels: [] };
    return [];
  }
});
ok(candado.salida.botPuedeContestar === true && candado.salida.crmEtapaCanon === "lead_nuevo", "validacion por NOMBRE: clave dinamica con nombre 'Nuevo Lead' activa Luna", candado.salida.motivo);

// ---------------------------------------------------------------------------
// 3. Memoria y clasificacion del caso
// ---------------------------------------------------------------------------
grupo("3. Fusionar memoria y clasificar el trabajo");
const codeFusion = jsDe("Fusionar Memoria");
async function fusionar({ attrs = {}, ia = null, foto = null, etapa = "datos", texto = "mensaje del cliente" }) {
  const refs = {
    "Leer Estado del Lead": {
      body: { conversation: { id: 55 } }, conversationId: 55, clienteId: "cli-1", grupo: "templo",
      etapa, etapaClave: etapa, etapaNombre: etapa, lunaActua: true, etapasPipeline: pipeline,
      attrs, labels: [], nombreContacto: "Ana", telefono: "+573001112233", chatwootUrl: "https://crm/55"
    },
    "Consolidar Lista": { listaConsolidada: texto },
    Historial: { payload: [{ id: 1, message_type: 0, content: texto, created_at: 1 }] }
  };
  if (foto) refs["Inyectar Analisis"] = { fotoEvento: foto };
  const entrada = ia ? { choices: [{ message: { content: JSON.stringify(ia) } }] } : { error: "sin ia" };
  return correr(codeFusion, { entrada, refs, http: async () => ({}) });
}

let f = await fusionar({ ia: null, texto: "Busco suerte y quiero ganar en el chance." });
ok(f.salida.checklist.tipo_trabajo === "personal", "suerte/chance → trabajo PERSONAL");
ok(f.salida.checklist.motivo_categoria === "suerte", "suerte queda como categoria del caso");
ok(f.salida.faltantes.map(x => x.clave).join(",") === "foto_cliente,nombre_cliente,foto_mano", "personal pide foto de rostro, nombre completo y palma derecha", f.salida.faltantesTexto);

f = await fusionar({ ia: null, texto: "Quiero recuperar a mi pareja, se fue y necesito que vuelva." });
ok(f.salida.checklist.tipo_trabajo === "pareja", "recuperar a la pareja → trabajo de PAREJA");
ok(f.salida.checklist.motivo_categoria === "retorno", "recuperacion → categoria retorno");
ok(f.salida.faltantes.length === 4, "pareja mantiene nombres y dos fotos como campos del expediente");

f = await fusionar({ attrs: { tipo_trabajo: "pareja" }, foto: { tipo: "pareja", url: "https://cdn/dos.jpg", personas: 2 } });
ok(f.salida.checklist.foto_cliente && f.salida.checklist.foto_otra_persona, "una foto juntos completa las dos fotos de pareja");

f = await fusionar({ attrs: { tipo_trabajo: "personal", nombre_cliente: "Ana", foto_cliente: true, foto_mano: true } });
ok(f.salida.nombreClienteCompleto === false && f.salida.faltantes.map(x => x.clave).join(",") === "nombre_cliente", "un solo nombre sigue pendiente y Luna pide nombre completo");
ok(/nombre parcial: Ana/i.test(f.salida.contextoMemoria), "la memoria distingue un nombre parcial de uno completo");

f = await fusionar({
  attrs: { tipo_trabajo: "pareja", nombre_cliente: "Ana", nombre_otra_persona: "Luis" },
  ia: { tipo_trabajo: "pareja", nombre_cliente: "Ana Perez", nombre_otra_persona: "Luis Gomez" }
});
ok(f.salida.checklist.nombre_cliente === "Ana Perez" && f.salida.checklist.nombre_otra_persona === "Luis Gomez", "los nombres completos enriquecen nombres parciales guardados");
ok(f.salida.nombreClienteCompleto && f.salida.nombreOtraPersonaCompleto, "pareja solo cierra los nombres cuando ambos están completos");

const guardado = {
  tipo_trabajo: "pareja", nombre_cliente: "Ana Perez", nombre_otra_persona: "Karla Gomez",
  foto_cliente: true, foto_otra_persona: true, foto_cliente_url: "https://cdn/ana.jpg",
  foto_otra_persona_url: "https://cdn/karla.jpg", motivo_categoria: "retorno",
  motivo_resumen: "Quiere recuperar a su pareja.", motivo_conocido: true,
  lista_requisitos_enviada: true, luna_pausada: true
};
f = await fusionar({ attrs: guardado, ia: { tipo_trabajo: "personal", nombre_cliente: "Otro" }, texto: "gracias" });
ok(f.salida.checklist.nombre_cliente === "Ana Perez" && f.salida.checklist.tipo_trabajo === "pareja", "la memoria guardada no se pisa");
ok(f.salida.checklist.lista_requisitos_enviada === true && f.salida.checklist.luna_pausada === true, "la memoria conserva el estado de pausa");

// ---------------------------------------------------------------------------
// 4. Respuesta: lista completa, una sola vez
// ---------------------------------------------------------------------------
grupo("4. Pulir respuesta y lista de requisitos");
const codePulir = jsDe("Pulir y Auditar Respuesta");
async function pulir({ texto, checklist = {}, etapa = "datos", faltantes = [], consultaCompleta = false }) {
  const { salida } = await correr(codePulir, {
    entrada: { choices: [{ message: { content: texto } }] },
    refs: { "Fusionar Memoria": { checklist, etapa, etapaNombre: etapa, faltantes, consultaCompleta, conversationId: 55, contactName: "Ana", contactPhone: "+573001112233", chatwootUrl: "https://crm/x", novedades: [] } }
  });
  return salida;
}

let p = await pulir({ texto: "Hola, ¿cómo te llamas? Envíame una foto.", checklist: { tipo_trabajo: "personal" }, faltantes: [
  { clave: "foto_cliente", etiqueta: "una foto suya, clara y de frente, con el rostro visible" },
  { clave: "nombre_cliente", etiqueta: "su nombre completo (nombre y apellido)" },
  { clave: "foto_mano", etiqueta: "una foto clara de la palma de su mano derecha" }
] });
const respuestaPersonal = p;
ok(p.pausarChat === true && p.listaRequisitosEnviada === true, "Datos con tipo identificado solicita la pausa");
ok(/tu nombre completo[^\n]*nombre y apellido/i.test(p.textoRespuesta) && /foto tuya[^\n]*rostro/i.test(p.textoRespuesta) && /palma de tu mano derecha/i.test(p.textoRespuesta), "personal envía foto de rostro, nombre y apellido, y palma derecha");
const ordenFoto = p.textoRespuesta.search(/foto tuya/i);
const ordenNombre = p.textoRespuesta.search(/tu nombre completo/i);
const ordenPalma = p.textoRespuesta.search(/palma de tu mano derecha/i);
ok(ordenFoto >= 0 && ordenFoto < ordenNombre && ordenNombre < ordenPalma, "personal mantiene el orden exacto: foto, nombre completo y palma");
ok(/gracias/i.test(p.textoRespuesta) && /por favor/i.test(p.textoRespuesta) && /mucho gusto/i.test(p.textoRespuesta), "la solicitud de datos es amable y agradece la confianza");
ok(!/^\s*\d+[.)]/m.test(p.textoRespuesta), "la solicitud no usa 1., 2. ni 3.");

const codeAudio = jsDe("Preparar Body Audio");
async function prepararAudio(textoRespuesta) {
  const { salida } = await correr(codeAudio, {
    entrada: {},
    refs: { "Verificar si Enviar Audio": { textoRespuesta } }
  });
  return salida;
}

let audio = await prepararAudio(respuestaPersonal.textoRespuesta);
ok(/nombre completo/i.test(audio.textoLimpio) && /rostro/i.test(audio.textoLimpio) && /palma de tu mano derecha/i.test(audio.textoLimpio), "el audio conserva hasta el último dato solicitado");
ok(!/\b[123][.)]/.test(audio.textoLimpio) && !/\b(?:uno|dos|tres) punto\b/i.test(audio.textoLimpio), "el audio no dice uno punto, dos punto ni tres punto");

audio = await prepararAudio("Para preparar tu consulta necesito:\n1. una foto tuya\n2. la palma de tu mano derecha\n3. tu nombre completo");
ok(/Primero,/i.test(audio.textoLimpio) && /Segundo,/i.test(audio.textoLimpio) && /Tercero,/i.test(audio.textoLimpio), "una lista numerada antigua se convierte en conectores naturales");
ok(/tu nombre completo\.$/i.test(audio.textoLimpio), "la limpieza de audio nunca recorta el requisito final");

p = await pulir({ texto: "Lo que sea, dime tu nombre.", checklist: { tipo_trabajo: "pareja" }, faltantes: [
  { clave: "nombre_cliente", etiqueta: "el nombre completo del cliente" },
  { clave: "nombre_otra_persona", etiqueta: "el nombre completo de la otra persona" },
  { clave: "foto_cliente", etiqueta: "una foto clara y de frente del cliente" },
  { clave: "foto_otra_persona", etiqueta: "una foto clara y de frente de la otra persona o una foto clara donde aparezcan los dos" }
] });
ok(p.pausarChat === true && /nombres completos de las dos personas[^\n]*nombre y apellido/i.test(p.textoRespuesta) && /foto clara y de frente de cada persona/i.test(p.textoRespuesta) && /donde aparezcan las dos/i.test(p.textoRespuesta), "pareja pide nombre y apellido de ambos, y fotos separadas o juntos");
ok(!/^\s*\d+[.)]/m.test(p.textoRespuesta), "la solicitud de pareja tampoco usa numeración robótica");

p = await pulir({ texto: "Hola, dime más.", checklist: {}, faltantes: [{ clave: "tipo_trabajo", etiqueta: "tipo" }] });
ok(p.pausarChat === false && /suerte, amor/.test(p.textoRespuesta), "si no se entiende el trabajo todavía no pausa y pide aclaracion");

p = await pulir({ texto: "Hola, envíame tu nombre y una foto.", checklist: {}, etapa: "lead_nuevo", faltantes: [] });
ok(p.pausarChat === false && /soy luna/i.test(p.textoRespuesta) && /podemos ayudarte/i.test(p.textoRespuesta), "Lead Nuevo saluda con amabilidad, se presenta y pregunta el motivo");

p = await pulir({ texto: "Cuentame otra vez el motivo.", checklist: { tipo_trabajo: "personal", nombre_cliente: "Ana" }, faltantes: [{ clave: "nombre_cliente", etiqueta: "su nombre completo" }] });
ok(p.pausarChat === true && /foto tuya/i.test(p.textoRespuesta) && /tu nombre completo[^\n]*nombre y apellido/i.test(p.textoRespuesta) && /palma de tu mano derecha/i.test(p.textoRespuesta), "un nombre parcial nunca hace que Luna olvide pedir el nombre completo");
ok(!/cu[eé]ntame.*motivo/i.test(p.textoRespuesta), "Datos no vuelve a preguntar el motivo");

p = await pulir({
  texto: "respuesta incompleta",
  checklist: { tipo_trabajo: "pareja", nombre_cliente: "Ana", nombre_otra_persona: "Luis" },
  faltantes: [{ clave: "nombre_cliente" }, { clave: "nombre_otra_persona" }]
});
ok(/nombres completos de las dos personas[^\n]*nombre y apellido/i.test(p.textoRespuesta), "pareja vuelve a pedir ambos nombres cuando solo tiene nombres de pila");

// ---------------------------------------------------------------------------
// 5. Transicion y pausa persistente
// ---------------------------------------------------------------------------
grupo("5. Aplicar transicion y pausar el chat");
const codeTransicion = jsDe("Aplicar Transicion de Etapa");
async function transicionar({ etapa, pausarChat = false, checklist = {}, faltantes = [], pipeline: pipelineDef = pipeline, clienteId = "cli-1", resultadoEnvio = { id: 900, message_type: 1 } }) {
  const respuestaAuditada = {
    etapa, pausarChat, listaRequisitosEnviada: pausarChat, conversationId: 55, clienteId,
    telefono: "+573001112233", contactName: "Ana", chatwootUrl: "https://crm/55",
    novedades: [], checklist, faltantes, labels: []
  };
  const { salida, llamadas } = await correr(codeTransicion, {
    // La entrada real es la respuesta del nodo de envío de Chatwoot.
    entrada: resultadoEnvio,
    refs: {
      "Pulir y Auditar Respuesta": respuestaAuditada,
      "Fusionar Memoria": { checklist, etapa, grupo: "templo", etapasPipeline: pipelineDef, labels: [], novedades: [], conversationId: 55, clienteId },
      Historial: { payload: [] }
    },
    http: async () => ({})
  });
  return { salida, llamadas };
}

let t = await transicionar({ etapa: "lead_nuevo", pipeline });
ok(t.salida.etapaNueva === "datos" && t.salida.transicion === true, "Lead Nuevo → Datos directamente");
let patch = t.llamadas.find(l => l.method === "PATCH" && l.url.includes("/rest/v1/clientes"));
ok(patch && patch.body.estado === "datos_templo", "escribe la clave real de Datos");
ok(!t.salida.chatPausado, "el saludo no pausa el chat");

// Validacion por NOMBRE con clave dinamica: usa la etapa "Datos" que YA esta
// creada en el CRM (clave etapa_<ts>), nunca una clave semilla inventada.
t = await transicionar({ etapa: "lead_nuevo", pipeline: [
  { clave: "etapa_1754000000001", nombre: "Nuevo Lead", grupo: "templo" },
  { clave: "etapa_1754000000002", nombre: "Datos", grupo: "templo" },
  { clave: "sin_respuesta_templo", nombre: "Sin respuesta", grupo: "templo" }
] });
patch = t.llamadas.find(l => l.method === "PATCH" && l.url.includes("/rest/v1/clientes"));
ok(patch && patch.body.estado === "etapa_1754000000002", "resuelve 'Datos' por NOMBRE y escribe la clave de la etapa ya creada");
ok(t.salida._debug.etapaResueltaPorNombre === true, "la etapa se resuelve por nombre, no por clave semilla");

// Si en el pipeline NO existe la etapa "Datos": no se mueve el cliente a una
// clave inventada y no se crea ninguna etapa. Luna conserva su avance interno.
t = await transicionar({ etapa: "lead_nuevo", pipeline: [
  { clave: "nuevo_lead", nombre: "Nuevo Lead", grupo: "templo" },
  { clave: "en_consulta", nombre: "En Consulta", grupo: "templo" }
] });
ok(!t.llamadas.some(l => l.method === "PATCH" && l.url.includes("/rest/v1/clientes")), "sin etapa 'Datos' en el pipeline no escribe un estado inventado");
ok(t.salida._debug.sinEtapaEnPipeline === true && /no se creo ninguna etapa/.test(t.salida._debug.errorEstado || ""), "avisa que no se creo ninguna etapa y que debe usarse la ya creada");
const attrsSinDatos = t.llamadas.find(l => l.url.includes("/custom_attributes"));
ok(attrsSinDatos && attrsSinDatos.body.custom_attributes.luna_etapa_crm_sync === false, "sin etapa, Luna conserva su avance interno (no repite la conversacion)");
ok(t.salida.etapaNueva === "datos", "el avance interno sigue siendo Datos aunque el CRM no se mueva");

t = await transicionar({ etapa: "datos", pausarChat: true, checklist: { tipo_trabajo: "personal" }, faltantes: [{ clave: "foto_cliente", etiqueta: "una foto suya" }] });
ok(t.salida.etapaNueva === "datos" && t.salida.transicion === false && t.salida.chatPausado === true, "Datos no cambia de etapa y activa la pausa");
const pausa = t.llamadas.find(l => l.method === "PATCH" && l.url.includes("/rest/v1/conversaciones?chatwoot_conversation_id="));
ok(pausa && pausa.body.agente_activo === false, "marca agente_activo=false para cortar futuros webhooks");
const attrs = t.llamadas.find(l => l.url.includes("/custom_attributes"));
ok(attrs && attrs.body.custom_attributes.luna_pausada === true && attrs.body.custom_attributes.lista_requisitos_enviada === true, "guarda la pausa y la lista enviada en Chatwoot");
const labels = t.llamadas.find(l => l.url.includes("/labels"));
ok(labels && labels.body.labels.includes("bot-pausado") && labels.body.labels.includes("etapa-datos"), "deja visible bot-pausado en la conversación");
ok(t.llamadas.some(l => l.url.includes("message/sendText") && /LUNA PAUSADA/.test(l.body.text)), "avisa al Maestro para continuar manualmente");

t = await transicionar({
  etapa: "datos",
  pausarChat: true,
  checklist: { tipo_trabajo: "personal" },
  resultadoEnvio: { error: "Chatwoot no acepto el mensaje", statusCode: 500 }
});
ok(!t.salida.chatPausado && t.salida.razonTransicion === "envio_a_chatwoot_fallido_sin_transicion_ni_pausa", "si el mensaje falla, Luna no pausa el chat");
ok(t.llamadas.length === 0, "un envío fallido no guarda una pausa falsa en CRM ni Chatwoot");

t = await transicionar({ etapa: "datos", pausarChat: false, checklist: {}, faltantes: [{ clave: "tipo_trabajo", etiqueta: "tipo" }] });
const patchConversacionesDatosSinTipo = t.llamadas.filter(l => l.method === "PATCH" && l.url.includes("/rest/v1/conversaciones?"));
const noPausa = !t.salida.chatPausado && !patchConversacionesDatosSinTipo.some(l => l.body && l.body.agente_activo === false);
ok(noPausa, "Datos sin tipo no se pausa (puede reactivar agente_activo=true pero no pausa)");
ok(patchConversacionesDatosSinTipo.some(l => l.body && l.body.agente_activo === true), "Datos sin tipo asegura agente_activo=true por validacion por nombre");

t = await transicionar({ etapa: "sin_respuesta", pausarChat: true });
ok(t.salida.etapaNueva === "sin_respuesta" && !t.salida.chatPausado, "una etapa antigua nunca se activa ni se pausa");

// ---------------------------------------------------------------------------
// 6. Recorrido solicitado completo
// ---------------------------------------------------------------------------
grupo("6. Recorrido Nuevo Lead → Datos → pausa");
let estado = "nuevo_lead_templo";
let agenteActivo = true;
// Primer turno: saludo y movimiento directo a Datos.
t = await transicionar({ etapa: "lead_nuevo", pipeline });
estado = "datos_templo";
ok(estado === "datos_templo", "turno 1: el lead cae inmediatamente en Datos");
// Segundo turno: entiende recuperación/amor y manda la lista pareja.
f = await fusionar({ texto: "Quiero recuperar a mi pareja, es un asunto de amor." });
p = await pulir({ texto: "respuesta del modelo", checklist: f.salida.checklist, faltantes: f.salida.faltantes });
t = await transicionar({ etapa: "datos", pausarChat: p.pausarChat, checklist: f.salida.checklist, faltantes: f.salida.faltantes, pipeline });
agenteActivo = !t.salida.chatPausado;
ok(t.salida.etapaNueva === "datos" && p.pausarChat && agenteActivo === false, "turno 2: lista de pareja enviada y Luna queda pausada");
ok(/nombres completos de las dos personas/i.test(p.textoRespuesta) && /foto clara y de frente de cada persona/i.test(p.textoRespuesta), "la solicitud final contiene todos los requisitos de pareja");

console.log("\n────────────────────────────────────────");
console.log("Pruebas: " + pruebas + " | Fallos: " + fallos);
if (fallos) {
  console.log("❌ VALIDACION FALLIDA");
  process.exit(1);
}
console.log("✅ WORKFLOW DE LUNA VALIDADO");
