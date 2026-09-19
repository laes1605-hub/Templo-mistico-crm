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

const codigos = {};
for (const [nombre, archivo] of Object.entries(NODOS)) {
  const nodo = porNombre.get(nombre);
  if (!nodo) throw new Error("No existe el nodo: " + nombre);
  const codigo = fs.readFileSync(path.join(CODE, archivo), "utf8").replace(/\s+$/, "");
  codigos[nombre] = codigo;
  nodo.parameters = nodo.parameters || {};
  nodo.parameters.jsCode = codigo;
  console.log("· " + nombre + " ← n8n/recordatorios/code/" + archivo + " (" + codigo.split("\n").length + " líneas)");
}

// El JSON del repositorio es solo para importar: nunca debe viajar activo.
wf.active = false;

fs.writeFileSync(WORKFLOW, JSON.stringify(wf, null, 2) + "\n");
console.log("✅ n8n/03-recordatorios-whatsapp-por-etapa.json actualizado");

// ---------------------------------------------------------------------------
// Copia para pegar a mano: los tres nodos con las llaves dentro del código
// (esta instancia de n8n no permite variables de entorno).
// ---------------------------------------------------------------------------
const GUIA = `# Recordatorios de WhatsApp API · código para pegar en n8n

Las credenciales van **escritas dentro de cada nodo** porque esta instancia de n8n
no permite variables de entorno. Si cambias de proyecto Supabase, edita en los
tres nodos solo estas dos líneas:

\`\`\`js
const SUPABASE_URL = 'https://zcljlddtcoyfyvshlyfk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJ...';
\`\`\`

> Este archivo se genera con \`npm run build:recordatorios\`. No lo edites a mano:
> edita \`n8n/recordatorios/code/*.js\` y vuelve a generarlo.

## Cómo pegarlo (2 minutos)

1. En n8n abre el workflow **WhatsApp API · Recordatorios por etapa**.
2. Entra al nodo, borra todo el contenido del campo **Code** y pega el bloque que
   corresponda (cada bloque va completo, de la primera línea a la última).
3. Repite con los tres nodos Code: **Buscar clientes y preparar recordatorio**,
   **Enviar por WhatsApp API** y **Registrar envío e impedir duplicados**.
4. Guarda, pulsa **Execute Workflow** una vez y revisa la salida del primer nodo:
   el último ítem trae el diagnóstico (si no sale nada, ahí dice por qué).
5. Actívalo y **desactiva el workflow anterior** de recordatorios para no duplicar envíos.

`;

let md = GUIA;
for (const [nombre, codigo] of Object.entries(codigos)) {
  md += `## Nodo «${nombre}»\n\n\`\`\`javascript\n${codigo}\n\`\`\`\n\n`;
}
fs.writeFileSync(path.join(__dirname, "recordatorios", "CODIGO-PARA-PEGAR.md"), md);
console.log("✅ n8n/recordatorios/CODIGO-PARA-PEGAR.md actualizado (listo para copiar y pegar)");
