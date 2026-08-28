#!/usr/bin/env node
/**
 * Builder del workflow de Luna por etapas.
 *
 * Toma n8n/luna/base-workflow.json (el workflow actual del usuario, con stubs
 * en los nodos que se reescriben), inyecta el codigo nuevo desde
 * n8n/luna/code/*.js y reescribe las conexiones.
 *
 * Salida: n8n/05-luna-etapas.json (importable en n8n).
 *
 * Uso: node n8n/build-luna-workflow.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const BASE = path.join(__dirname, "luna", "base-workflow.json");
const CODE = path.join(__dirname, "luna", "code");
// IMPORTAR-EN-N8N.json           → EL QUE SE IMPORTA EN n8n (llaves dentro, sin $env).
//                                  No se versiona (lleva secretos) pero SI es visible.
// IMPORTAR-EN-N8N.RELLENAR.json  → igual al anterior pero con marcadores
//                                  AQUI_OPENAI_API_KEY / AQUI_GROQ_API_KEY cuando
//                                  falta secrets.local.json. Se reemplazan en un
//                                  editor de texto (Bloc de notas) y a importar:
//                                  no hace falta editar NADA dentro de n8n.
// 05-luna-etapas.github.json     → copia para el repo (sin secretos, usa $env).
const SALIDA = path.join(__dirname, "IMPORTAR-EN-N8N.json");
const SALIDA_RELLENAR = path.join(__dirname, "IMPORTAR-EN-N8N.RELLENAR.json");
const SALIDA_GITHUB = path.join(__dirname, "05-luna-etapas.github.json");

const wf = JSON.parse(fs.readFileSync(BASE, "utf8"));
const codigo = (nombre) => fs.readFileSync(path.join(CODE, nombre), "utf8");

wf.name = "Luna · Asistente por Etapas (Templo Mistico)";
wf.nodes = wf.nodes || [];
delete wf.pinData;
wf.settings = { executionOrder: "v1", saveExecutionProgress: true, saveManualExecutions: true };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const porNombre = new Map(wf.nodes.map((n) => [n.name, n]));
// IDs deterministas: reconstruir el workflow no debe cambiar el diff
const uuid = (semilla) => {
  const h = crypto.createHash("sha1").update(String(semilla)).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "4" + h.slice(13, 16), "8" + h.slice(17, 20), h.slice(20, 32)].join("-");
};

function reemplazarJsCode(nombre, archivo) {
  const nodo = porNombre.get(nombre);
  if (!nodo) throw new Error("No existe el nodo: " + nombre);
  nodo.parameters.jsCode = codigo(archivo);
  return nodo;
}

function eliminarNodo(nombre) {
  const i = wf.nodes.findIndex((n) => n.name === nombre);
  if (i !== -1) wf.nodes.splice(i, 1);
  porNombre.delete(nombre);
}

function renombrarNodo(viejo, nuevo) {
  const nodo = porNombre.get(viejo);
  if (!nodo) throw new Error("No existe el nodo: " + viejo);
  nodo.name = nuevo;
  porNombre.delete(viejo);
  porNombre.set(nuevo, nodo);
  return nodo;
}

function agregarNodo(nodo) {
  if (!nodo.id) nodo.id = uuid("nodo:" + nodo.name);
  if (!nodo.typeVersion) nodo.typeVersion = 2;
  wf.nodes.push(nodo);
  porNombre.set(nodo.name, nodo);
  return nodo;
}

// ---------------------------------------------------------------------------
// 1) NODOS REESCRITOS
// ---------------------------------------------------------------------------
// El candado se mantiene en un archivo versionado para que la pausa
// automatica de cada chat se aplique antes de gastar llamadas de IA.
reemplazarJsCode("Verificar CRM", "verificar-crm.js");
porNombre.get("Verificar CRM").notes = "Corta por numero/canal, kill switch global, spam y pausa automatica de Datos.";

reemplazarJsCode("Preparar Imagen", "preparar-imagen.js");
porNombre.get("Preparar Imagen").notes = "Vision v2: clasifica la foto en rostro / pareja / palma y conserva la URL.";

reemplazarJsCode("Inyectar Analisis", "inyectar-analisis.js");

// "Analizar y Actualizar Checklist" (regex) -> "Fusionar Memoria" (archivo persistente)
renombrarNodo("Analizar y Actualizar Checklist", "Fusionar Memoria");
reemplazarJsCode("Fusionar Memoria", "fusionar-memoria.js");
porNombre.get("Fusionar Memoria").notes =
  "Fusiona lo guardado en Chatwoot + la extraccion IA + la vision, y decide que falta.";

// "Detectar Cierre" -> "Pulir y Auditar Respuesta"
renombrarNodo("Detectar Cierre", "Pulir y Auditar Respuesta");
reemplazarJsCode("Pulir y Auditar Respuesta", "pulir-y-auditar.js");
porNombre.get("Pulir y Auditar Respuesta").notes =
  "Red de seguridad: si Luna pide algo que ya tiene, el mensaje se reconstruye solo.";

// chatwoot1 -> nombre claro
renombrarNodo("chatwoot1", "Enviar Mensaje Chatwoot");

// El nodo de historial no depende del item anterior
porNombre.get("Historial").parameters.url =
  "=https://crmesteban.duckdns.org/api/v1/accounts/1/conversations/{{ $('Webhook').first().json.body.conversation.id }}/messages?per_page=50";
porNombre.get("Historial").position = [6480, -1776];

// La clasificacion de lead leia un campo que no existe
const prepClasif = porNombre.get("Preparar Body Clasificacion");
prepClasif.parameters.jsCode = prepClasif.parameters.jsCode.replace("textoConsolidado", "listaConsolidada");

// Tolerancia a fallos externos: nunca dejar al cliente sin respuesta
for (const nombre of ["Analizar Imagen", "Transcribir Audio", "Cerebro · Leer memoria", "Enviar Escribiendo", "Enviar Mensaje Chatwoot"]) {
  const nodo = porNombre.get(nombre);
  if (nodo) nodo.onError = "continueRegularOutput";
}
porNombre.get("Analizar Imagen").retryOnFail = true;
porNombre.get("Analizar Imagen").maxTries = 3;
porNombre.get("Transcribir Audio").retryOnFail = true;
porNombre.get("Transcribir Audio").maxTries = 3;

// ---------------------------------------------------------------------------
// 2) NODOS NUEVOS
// ---------------------------------------------------------------------------
agregarNodo({
  name: "Leer Estado del Lead",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [4688, -1536],
  notes: "Lee la etapa del CRM (Supabase), el pipeline y el checklist de Chatwoot.",
  parameters: { jsCode: codigo("leer-estado-lead.js") }
});

agregarNodo({
  name: "Luna Actua en esta Etapa?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.3,
  position: [4912, -1536],
  notes: "Luna solo habla en Lead Nuevo y Datos; despues de enviar la lista queda pausada en el chat.",
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 3 },
      conditions: [
        {
          id: uuid("cond:lunaActua"),
          leftValue: "={{ $json.lunaActua }}",
          rightValue: "true",
          operator: { type: "string", operation: "equals", name: "filter.operator.equals" }
        }
      ],
      combinator: "and"
    },
    looseTypeValidation: true,
    options: {}
  }
});

agregarNodo({
  name: "Registrar Silencio de Luna",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [4912, -1312],
  onError: "continueRegularOutput",
  notes: "Rama falsa: Luna permanece en silencio fuera de Lead Nuevo y Datos, o si la etapa no se reconoce.",
  parameters: { jsCode: codigo("registrar-silencio.js") }
});

agregarNodo({
  name: "Preparar Analisis de Caso",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [6704, -1776],
  parameters: { jsCode: codigo("preparar-analisis-caso.js") }
});

agregarNodo({
  name: "Analizar Caso con IA",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.5,
  position: [6928, -1776],
  onError: "continueRegularOutput",
  retryOnFail: true,
  maxTries: 2,
  notes: "Extrae motivo, tipo de trabajo y nombres en JSON estricto.",
  parameters: {
    method: "POST",
    url: "https://api.openai.com/v1/chat/completions",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "Content-Type", value: "application/json" },
        {
          name: "Authorization",
          value:
            "={{ 'Bearer ' + $env.OPENAI_API_KEY }}"
        }
      ]
    },
    sendBody: true,
    contentType: "raw",
    rawContentType: "application/json",
    body: "={{ $json.bodyString }}",
    options: { timeout: 20000 }
  }
});

agregarNodo({
  name: "Construir Prompt por Etapa",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [6480, -1536],
  notes: "Persona de Luna + catalogo de interpretacion + reglas de la etapa actual.",
  parameters: { jsCode: codigo("construir-prompt.js") }
});

agregarNodo({
  name: "Aplicar Transicion de Etapa",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [7824, -1728],
  onError: "continueRegularOutput",
  notes: "Mueve el lead en el CRM, etiqueta y envia el expediente al Maestro.",
  parameters: { jsCode: codigo("aplicar-transicion.js") }
});

// El prompt viejo quedaba duplicado: se elimina si venia en la base
eliminarNodo("code");
eliminarNodo("Construir System Prompt");
eliminarNodo("Obtener Checklist");

// ---------------------------------------------------------------------------
// 3) REFERENCIAS A NODOS RENOMBRADOS DENTRO DE EXPRESIONES Y CODIGO
// ---------------------------------------------------------------------------
const RENOMBRES = {
  "Detectar Cierre": "Pulir y Auditar Respuesta",
  chatwoot1: "Enviar Mensaje Chatwoot"
};

function arreglarReferencias(texto) {
  let out = texto;
  for (const [viejo, nuevo] of Object.entries(RENOMBRES)) {
    out = out.split("$('" + viejo + "')").join("$('" + nuevo + "')");
    out = out.split('$("' + viejo + '")').join('$("' + nuevo + '")');
  }
  return out;
}

for (const nodo of wf.nodes) {
  for (const [clave, valor] of Object.entries(nodo.parameters || {})) {
    if (typeof valor === "string") nodo.parameters[clave] = arreglarReferencias(valor);
  }
}

// ---------------------------------------------------------------------------
// 4) CONEXIONES
// ---------------------------------------------------------------------------
const c = (nodo) => ({ node: nodo, type: "main", index: 0 });

wf.connections = {
  Webhook: { main: [[c("Sincronizar Supabase"), c("If")]] },
  If: { main: [[c("Es el Maestro?")]] },
  "Es el Maestro?": { main: [[c("Detectar Comando")], [c("Verificar CRM")]] },

  // Comandos del Maestro
  "Detectar Comando": { main: [[c("Que Comando?")]] },
  "Que Comando?": { main: [[c("Obtener Consultas Pendientes")]] },
  "Obtener Consultas Pendientes": { main: [[c("Formatear Todo")]] },
  "Formatear Todo": { main: [[c("Enviar Lista al Maestro")]] },

  // Candados
  "Verificar CRM": { main: [[c("Bot Puede Contestar?")]] },
  "Bot Puede Contestar?": { main: [[c("Tipo de Mensaje")]] },

  // Tipos de mensaje
  "Tipo de Mensaje": {
    main: [[c("Descargar Audio")], [c("Descargar Imagen")], [c("Guardar Timestamp")]]
  },
  "Descargar Audio": { main: [[c("Renombrar Audio")]] },
  "Renombrar Audio": { main: [[c("Transcribir Audio")]] },
  "Transcribir Audio": { main: [[c("Inyectar Texto")]] },
  "Inyectar Texto": { main: [[c("Guardar Timestamp")]] },
  "Descargar Imagen": { main: [[c("Preparar Imagen")]] },
  "Preparar Imagen": { main: [[c("Analizar Imagen")]] },
  "Analizar Imagen": { main: [[c("Inyectar Analisis")]] },
  "Inyectar Analisis": { main: [[c("Guardar Timestamp")]] },

  // Anti-duplicidad y consolidacion
  "Guardar Timestamp": { main: [[c("Wait1")]] },
  Wait1: { main: [[c("Verificar Ultimo Mensaje")]] },
  "Verificar Ultimo Mensaje": { main: [[c("Soy el Ultimo?")]] },
  "Soy el Ultimo?": { main: [[c("Continuar Procesamiento?")]] },
  "Continuar Procesamiento?": { main: [[c("Consolidar Lista")]] },
  "Consolidar Lista": { main: [[c("Leer Estado del Lead")]] },

  // Nuevo motor de etapas
  "Leer Estado del Lead": { main: [[c("Luna Actua en esta Etapa?")]] },
  "Luna Actua en esta Etapa?": { main: [[c("Historial")], [c("Registrar Silencio de Luna")]] },
  "Registrar Silencio de Luna": { main: [[]] },
  Historial: { main: [[c("Preparar Analisis de Caso")]] },
  "Preparar Analisis de Caso": { main: [[c("Analizar Caso con IA")]] },
  "Analizar Caso con IA": { main: [[c("Fusionar Memoria")]] },
  "Fusionar Memoria": { main: [[c("Verificar Intervencion Humana")]] },
  "Verificar Intervencion Humana": { main: [[c("Bot Puede Responder?")]] },
  "Bot Puede Responder?": { main: [[c("Cerebro · Leer memoria")]] },
  "Cerebro · Leer memoria": { main: [[c("Construir Prompt por Etapa")]] },
  "Construir Prompt por Etapa": { main: [[c("Debug Contexto")]] },
  "Debug Contexto": { main: [[c("OpenAI Respuesta")]] },

  // Respuesta
  "OpenAI Respuesta": { main: [[c("Pulir y Auditar Respuesta")], [c("Preparar Body Backup")]] },
  "Preparar Body Backup": { main: [[c("OpenAI Backup")]] },
  "OpenAI Backup": { main: [[c("Pulir y Auditar Respuesta")]] },
  "Pulir y Auditar Respuesta": {
    main: [[c("Aplicar Transicion de Etapa"), c("Preparar Body Clasificacion"), c("Verificar si Enviar Audio")]]
  },
  "Aplicar Transicion de Etapa": { main: [[]] },

  // Clasificacion de lead (rama lateral, no vuelve a la respuesta)
  "Preparar Body Clasificacion": { main: [[c("Clasificar Lead")]] },
  "Clasificar Lead": { main: [[c("Extraer Clasificacion")]] },
  "Extraer Clasificacion": { main: [[c("Quitar Etiquetas Anteriores")]] },
  "Quitar Etiquetas Anteriores": { main: [[c("Preparar Etiquetas")]] },
  "Preparar Etiquetas": { main: [[c("Actualizar Etiqueta Chatwoot")]] },
  "Actualizar Etiqueta Chatwoot": { main: [[c("Es Caliente?")]] },
  "Es Caliente?": { main: [[c("Notificar Maestro Lead Caliente")], []] },
  "Notificar Maestro Lead Caliente": { main: [[]] },

  // Envio (audio o texto)
  "Verificar si Enviar Audio": { main: [[c("Enviar Audio?")]] },
  "Enviar Audio?": { main: [[c("Preparar Body Audio")], [c("Calcular Delay")]] },
  "Preparar Body Audio": { main: [[c("Generar Audio Luna")]] },
  "Generar Audio Luna": { main: [[c("Preparar OGG para WhatsApp")]] },
  "Preparar OGG para WhatsApp": { main: [[c("Enviar Audio Chatwoot")]] },
  "Calcular Delay": { main: [[c("Enviar Escribiendo")]] },
  "Enviar Escribiendo": { main: [[c("Wait")]] },
  Wait: { main: [[c("Enviar Mensaje Chatwoot")]] },
  "Enviar Mensaje Chatwoot": { main: [[]] }
};

const base = JSON.stringify(wf, null, 2) + "\n";
const MARCAS_LLAVES = ["sk-" + "proj-", "gs" + "k_"];

// 1) Version del repo: jamas puede llevar llaves (GitHub push protection).
if (MARCAS_LLAVES.some((marca) => base.includes(marca))) {
  throw new Error("El workflow tiene llaves dentro y no puede versionarse");
}
fs.writeFileSync(SALIDA_GITHUB, base, "utf8");

// 2) Version para importar en n8n: llaves dentro y SIN $env, porque el n8n del
//    Templo tiene N8N_BLOCK_ENV_ACCESS_IN_NODE y niega el acceso a $env.
const RUTA_SECRETS = path.join(__dirname, "luna", "secrets.local.json");
if (fs.existsSync(RUTA_SECRETS)) {
  const secretos = JSON.parse(fs.readFileSync(RUTA_SECRETS, "utf8"));
  let importable = base;
  for (const [clave, valor] of Object.entries(secretos)) {
    if (!valor) continue;
    importable = importable.split("={{ 'Bearer ' + $env." + clave + " }}").join("Bearer " + valor);
  }
  if (importable.includes("$env.")) {
    throw new Error("El archivo importable quedo con $env y fallaria con N8N_BLOCK_ENV_ACCESS_IN_NODE");
  }
  if (!/Bearer\s+\S/.test(importable)) {
    throw new Error("El archivo importable quedo sin llaves en los headers Authorization");
  }
  fs.writeFileSync(SALIDA, importable, "utf8");
} else {
  // Sin secrets.local.json: generar la versión RELLENAR con marcadores claros.
  // El usuario reemplaza los marcadores en un editor de texto y el archivo
  // queda EXACTAMENTE igual al importable con llaves (misma configuración
  // interna, nada que tocar dentro de n8n).
  let plantilla = base;
  for (const clave of ["OPENAI_API_KEY", "GROQ_API_KEY"]) {
    plantilla = plantilla
      .split("={{ 'Bearer ' + $env." + clave + " }}")
      .join("Bearer AQUI_" + clave);
  }
  if (plantilla.includes("$env.")) {
    throw new Error("La plantilla quedo con $env y fallaria con N8N_BLOCK_ENV_ACCESS_IN_NODE");
  }
  fs.writeFileSync(SALIDA_RELLENAR, plantilla, "utf8");
  console.log("! Falta n8n/luna/secrets.local.json: se genero " + path.relative(raiz, SALIDA_RELLENAR));
  console.log("  Reemplaza AQUI_OPENAI_API_KEY y AQUI_GROQ_API_KEY en un editor de texto antes de importar en n8n.");
}

const nombres = wf.nodes.map((n) => n.name);
const destinos = new Set();
for (const [origen, salidas] of Object.entries(wf.connections)) {
  if (!nombres.includes(origen)) throw new Error("Conexion desde nodo inexistente: " + origen);
  for (const rama of salidas.main || []) for (const d of rama) destinos.add(d.node);
}
for (const d of destinos) if (!nombres.includes(d)) throw new Error("Conexion hacia nodo inexistente: " + d);

console.log("✔ Nodos:", wf.nodes.length, "| conexiones desde:", Object.keys(wf.connections).length);
console.log("✔ Version del repo (sin secretos, usa $env):", path.relative(raiz, SALIDA_GITHUB));
if (fs.existsSync(SALIDA)) {
  console.log("");
  console.log("  ⮕ IMPORTA EN n8n: " + path.relative(raiz, SALIDA) + "   ← llaves dentro, no usa $env");
  console.log("    (" + path.relative(raiz, SALIDA_GITHUB) + " es solo para GitHub y falla en tu n8n)");
}
