#!/usr/bin/env node
/**
 * Builder del workflow de recordatorios de WhatsApp API.
 *
 * Toma n8n/03-recordatorios-whatsapp-por-etapa.json (estructura, credenciales
 * del disparador, conexiones) e inyecta el código de los tres nodos Code desde
 * n8n/recordatorios/code/*.js. Así el JavaScript se edita en archivos .js
 * normales (con resaltado y pruebas) en vez de dentro de la cadena del JSON.
 *
 * Uso: node n8n/build-recordatorios-workflow.mjs   (o npm run build:recordatorios)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(__dirname, "03-recordatorios-whatsapp-por-etapa.json");
const CODE = path.join(__dirname, "recordatorios", "code");

const NODOS = {
  "Buscar clientes y preparar recordatorio": "buscar-y-preparar.js",
  "Enviar por WhatsApp API": "enviar-whatsapp-api.js",
  "Registrar envío e impedir duplicados": "registrar-envio.js",
};

const wf = JSON.parse(fs.readFileSync(WORKFLOW, "utf8"));
const porNombre = new Map((wf.nodes || []).map((n) => [n.name, n]));

for (const [nombre, archivo] of Object.entries(NODOS)) {
  const nodo = porNombre.get(nombre);
  if (!nodo) throw new Error("No existe el nodo: " + nombre);
  const codigo = fs.readFileSync(path.join(CODE, archivo), "utf8").replace(/\s+$/, "");
  nodo.parameters = nodo.parameters || {};
  nodo.parameters.jsCode = codigo;
  console.log("· " + nombre + " ← n8n/recordatorios/code/" + archivo + " (" + codigo.split("\n").length + " líneas)");
}

// El JSON del repositorio es solo para importar: nunca debe viajar activo.
wf.active = false;

fs.writeFileSync(WORKFLOW, JSON.stringify(wf, null, 2) + "\n");
console.log("✅ n8n/03-recordatorios-whatsapp-por-etapa.json actualizado");
