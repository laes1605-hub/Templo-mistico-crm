#!/usr/bin/env node
/**
 * Simulador de recordatorios (PRUEBA EN SECO: no envía nada).
 *
 * Muestra qué haría el workflow en el próximo ciclo con los datos reales de
 * Supabase: a quién le toca recordatorio, cuál de los cuatro y a quién no y por qué.
 *
 * Uso:
 *   node scripts/simular-recordatorios.mjs                      (lee Supabase)
 *   node scripts/simular-recordatorios.mjs --json datos.json    (usa un respaldo)
 *   node scripts/simular-recordatorios.mjs --ahora 2026-09-19T19:30:00Z
 *
 * Las reglas NO están escritas aquí: se extraen del código del workflow
 * (n8n/03-recordatorios-whatsapp-por-etapa.json), así que el simulador y n8n
 * nunca pueden desincronizarse.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUTA_WORKFLOW = path.join(raiz, "n8n", "03-recordatorios-whatsapp-por-etapa.json");

// ---------------------------------------------------------------------------
// 1) Reglas del workflow (extraídas del propio nodo)
// ---------------------------------------------------------------------------
export function extraerReglas() {
  const wf = JSON.parse(fs.readFileSync(RUTA_WORKFLOW, "utf8"));
  const nodo = (wf.nodes || []).find((n) => n.name === "Buscar clientes y preparar recordatorio");
  if (!nodo) throw new Error("No está el nodo «Buscar clientes y preparar recordatorio» en el workflow");
  const codigo = nodo.parameters.jsCode;

  // Extrae un objeto literal `const NOMBRE = { ... };` del código del nodo,
  // incluyendo las llaves y sin el punto y coma final.
  const bloque = (nombre) => {
    const marca = "const " + nombre + " = {";
    const desde = codigo.indexOf(marca);
    if (desde === -1) throw new Error("No se encontró en el nodo: " + marca);
    const fin = codigo.indexOf("\n};", desde);
    if (fin === -1) throw new Error("Bloque sin cerrar en el nodo: " + nombre);
    return codigo.slice(desde + marca.length - 1, fin + 2);
  };
  // Extrae una constante simple `const NOMBRE = ...;`
  const constante = (nombre) => {
    const marca = "const " + nombre + " = ";
    const desde = codigo.indexOf(marca);
    if (desde === -1) throw new Error("No se encontró en el nodo: " + marca);
    return codigo.slice(desde + marca.length, codigo.indexOf(";", desde + marca.length));
  };
  const valor = (expresion) => new Function("return (" + expresion + ")")();

  return {
    etapasRecordatorio: valor(bloque("ETAPAS_RECORDATORIO")),
    variantesTipo: valor(bloque("VARIANTES_TIPO")),
    umbralesHoras: valor(constante("UMBRALES_HORAS")),
    ventanaApiHoras: valor(constante("VENTANA_API_HORAS")),
    supabaseUrl: (codigo.match(/const SUPABASE_URL = '([^']+)'/) || [])[1],
    supabaseKey: (codigo.match(/const SUPABASE_SERVICE_ROLE_KEY = '([^']+)'/) || [])[1],
  };
}

const normalizar = (valor) =>
  String(valor === null || valor === undefined ? "" : valor)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function tipoDeEtapa(nombre, reglas) {
  const n = normalizar(nombre);
  if (!n) return null;
  for (const tipo of Object.keys(reglas.etapasRecordatorio)) {
    if (reglas.etapasRecordatorio[tipo].some((objetivo) => n === objetivo || n.startsWith(objetivo + " "))) return tipo;
  }
  return null;
}

/** Misma decisión que el nodo: intentos previos + horas sin responder → qué envío toca. */
export function decidir({ horas, intentos }, reglas) {
  if (horas >= reglas.ventanaApiHoras) return { accion: "ventana" };
  if (intentos >= reglas.umbralesHoras.length) return { accion: "completo" };
  if (horas < reglas.umbralesHoras[intentos]) {
    return { accion: "espera", faltaHoras: reglas.umbralesHoras[intentos] - horas, intento: intentos + 1 };
  }
  return { accion: "enviar", intento: intentos + 1, umbralHoras: reglas.umbralesHoras[intentos] };
}

// ---------------------------------------------------------------------------
// 2) Datos: Supabase en vivo o un respaldo en JSON
// ---------------------------------------------------------------------------
async function traer(url, key) {
  const pedir = async (ruta) => {
    const r = await fetch(url + "/rest/v1/" + ruta, { headers: { apikey: key, Authorization: "Bearer " + key } });
    if (!r.ok) throw new Error("Supabase respondió " + r.status + " en " + ruta);
    return r.json();
  };
  const etapas = await pedir("pipeline_etapas?select=*&order=orden.asc");
  const codigos = etapas.map((e) => tipoDeEtapa(e.nombre, REGLAS_GLOBALES)).filter(Boolean);
  const claves = etapas.filter((e) => tipoDeEtapa(e.nombre, REGLAS_GLOBALES)).map((e) => e.clave);
  const conversaciones = await pedir(
    "conversaciones?fuente=eq.meta_business&select=cliente_id,chatwoot_conversation_id,numero_whatsapp,ultimo_entrante_api_en,ultimo_mensaje_en,clientes!inner(id,nombre,nombre_manual,estado,es_spam)&archivada=eq.false&limit=1000"
  );
  const registros = await pedir("recordatorios_whatsapp?select=cliente_id,etapa,tipo,plantilla,enviado_en&order=enviado_en.desc&limit=1000");
  return { etapas, conversaciones, registros, tiposDetectados: codigos };
}

let REGLAS_GLOBALES = null;

export function preparar({ etapas, conversaciones, registros }, reglas, ahora) {
  const tipoPorClave = new Map();
  for (const e of etapas || []) {
    const tipo = tipoDeEtapa(e.nombre, reglas);
    if (tipo && e.clave) tipoPorClave.set(String(e.clave).trim(), tipo);
  }

  // Intentos ya enviados por cliente + etapa (contando todas las variantes de tipo).
  const intentos = new Map();
  for (const r of registros || []) {
    const variantes = (reglas.variantesTipo[r.tipo] || [r.tipo]).map(normalizar);
    if (variantes.indexOf(normalizar(r.tipo)) === -1) continue;
    const clave = r.cliente_id + "|" + r.etapa;
    intentos.set(clave, (intentos.get(clave) || 0) + 1);
  }

  const filas = [];
  for (const c of conversaciones || []) {
    const cliente = c.clientes || {};
    if (!cliente.id || cliente.es_spam === true) continue;
    const tipo = tipoPorClave.get(String(cliente.estado || "").trim());
    if (!tipo) continue;
    const marca = c.ultimo_entrante_api_en || null;
    const horas = marca ? (ahora.getTime() - new Date(marca).getTime()) / 3600000 : null;
    filas.push({
      cliente: cliente.nombre_manual || cliente.nombre || "(sin nombre)",
      clienteId: cliente.id,
      etapa: tipo,
      nombreEtapa: (etapas.find((e) => String(e.clave) === String(cliente.estado)) || {}).nombre || cliente.estado,
      conversacionId: c.chatwoot_conversation_id,
      marca,
      horas,
      intentos: intentos.get(cliente.id + "|" + cliente.estado) || 0,
    });
  }
  return filas;
}

// ---------------------------------------------------------------------------
// 3) Informe
// ---------------------------------------------------------------------------
export function informe(filas, reglas, ahora) {
  const salen = [], esperan = [], ventana = [], sinMarca = [];
  for (const f of filas) {
    if (f.horas === null) { sinMarca.push(f); continue; }
    const d = decidir({ horas: f.horas, intentos: f.intentos }, reglas);
    if (d.accion === "enviar") salen.push({ ...f, ...d });
    else if (d.accion === "espera") esperan.push({ ...f, ...d });
    else if (d.accion === "ventana") ventana.push(f);
    else ventana.push({ ...f, completo: true });
  }
  const porHoras = (a, b) => b.horas - a.horas;
  return { salen: salen.sort(porHoras), esperan: esperan.sort(porHoras), ventana: ventana.sort(porHoras), sinMarca };
}

function linea(campos, anchos) {
  return campos.map((c, i) => String(c ?? "").padEnd(anchos[i]).slice(0, anchos[i])).join("  ");
}

export function imprimir({ salen, esperan, ventana, sinMarca }, reglas, ahora) {
  const h = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " h";
  const e = (t) => (t === "datos" ? "Datos" : "No contesta");
  console.log("\nPrueba en seco (NO envía nada) · " + ahora.toISOString() + " · " + reglas.etapasRecordatorio.datos.join("/") +
    " y " + reglas.etapasRecordatorio.noContesta.slice(0, 2).join("/") + " · intentos a las " + reglas.umbralesHoras.join(" / ") + " h · ventana " + reglas.ventanaApiHoras + " h");

  console.log("\n✅ SALDRÍA AHORA (" + salen.length + ")");
  console.log("  " + linea(["ETAPA", "CLIENTE", "SIN RESPONDER", "ENVÍA", "YA ENVIADOS"], [13, 30, 14, 12, 11]));
  for (const f of salen) console.log("  " + linea([e(f.etapa), f.cliente, h(f.horas), "plantilla " + f.intento, f.intentos], [13, 30, 14, 12, 11]));

  console.log("\n⏳ ESPERAN TIEMPO (" + esperan.length + ")");
  console.log("  " + linea(["ETAPA", "CLIENTE", "SIN RESPONDER", "FALTAN", "PARA"], [13, 30, 14, 10, 12]));
  for (const f of esperan) console.log("  " + linea([e(f.etapa), f.cliente, h(f.horas), h(f.faltaHoras), "intento " + f.intento], [13, 30, 14, 10, 12]));

  console.log("\n⏰ NO SE TOCAN — fuera de la ventana de 24 h del WhatsApp API (" + ventana.length + ")");
  console.log("  " + linea(["ETAPA", "CLIENTE", "ÚLTIMO MENSAJE", "MOTIVO"], [13, 30, 14, 26]));
  for (const f of ventana) {
    console.log("  " + linea([e(f.etapa), f.cliente, h(f.horas), f.completo ? "ya recibió los 4 intentos" : "van al WhatsApp Personal"], [13, 30, 14, 26]));
  }

  if (sinMarca.length) {
    console.log("\n❔ SIN MARCA de mensaje entrante por el API (" + sinMarca.length + "): " + sinMarca.map((f) => f.cliente).join(", "));
  }
  console.log("\nTotal a enviar ahora: " + salen.length + " · en espera: " + esperan.length + " · fuera de ventana: " + ventana.length + "\n");
}

// ---------------------------------------------------------------------------
// 4) Ejecución
// ---------------------------------------------------------------------------
async function principal() {
  const args = process.argv.slice(2);
  const arg = (nombre) => {
    const i = args.indexOf(nombre);
    return i === -1 ? null : args[i + 1];
  };
  const ahora = arg("--ahora") ? new Date(arg("--ahora")) : new Date();
  const reglas = extraerReglas();
  REGLAS_GLOBALES = reglas;

  let datos;
  const archivo = arg("--json");
  if (archivo) {
    datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
  } else {
    if (!reglas.supabaseUrl || !reglas.supabaseKey) throw new Error("El nodo no tiene SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
    console.log("Leyendo Supabase (" + reglas.supabaseUrl + ")… no se envía nada.");
    datos = await traer(reglas.supabaseUrl, reglas.supabaseKey);
  }

  const filas = preparar(datos, reglas, ahora);
  const etapas = Object.fromEntries((datos.etapas || []).filter((x) => tipoDeEtapa(x.nombre, reglas)).map((x) => [x.nombre, x.clave]));
  console.log("\nEtapas con recordatorio encontradas: " + (JSON.stringify(etapas) || "ninguna"));
  imprimir(informe(filas, reglas, ahora), reglas, ahora);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((error) => {
    console.error("Error: " + (error && error.message ? error.message : error));
    process.exit(1);
  });
}
