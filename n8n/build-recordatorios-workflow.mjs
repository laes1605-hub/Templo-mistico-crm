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

// ---------------------------------------------------------------------------
// CONEXIONES DEL BUCLE (aquí estaba el error que impedía todo envío)
// ---------------------------------------------------------------------------
// En n8n el nodo "Loop Over Items (Split in Batches)" tiene DOS salidas, y en
// este orden: 0 = "done" y 1 = "loop" (ver SplitInBatchesV3: outputNames
// ['done','loop'] y `return [[], returnItems]`). Los ítems salen por "loop"; la
// salida "done" entrega [] hasta que el bucle termina.
//
// El workflow tenía el envío conectado a "done" (vacío) y el "loop" apuntando a
// sí mismo: por eso NO se enviaba nada. El patrón correcto es:
//   loop (salida 1) → Enviar → Registrar → vuelve a entrar al nodo del bucle
const BUCLE = "Procesar uno a uno";
const ENVIO = "Enviar por WhatsApp API";
const REGISTRO = "Registrar envío e impedir duplicados";
const enlace = (nombre) => ({ node: nombre, type: "main", index: 0 });

wf.connections = wf.connections || {};
wf.connections[BUCLE] = { main: [[], [enlace(ENVIO)]] }; // [done vacío, loop → envío]
wf.connections[ENVIO] = { main: [[enlace(REGISTRO)]] };
wf.connections[REGISTRO] = { main: [[enlace(BUCLE)]] };

// Validación: si alguien vuelve a invertir las salidas, el build falla.
const salidasBucle = wf.connections[BUCLE].main;
const destino = (indice) => (salidasBucle[indice] || []).map((c) => c.node);
if (destino(0).length !== 0 || destino(1).join() !== ENVIO) {
  throw new Error(
    "Conexiones del bucle mal armadas: la salida 0 (done) debe estar vacía y la salida 1 (loop) debe ir a «" + ENVIO + "»."
  );
}
if ((wf.connections[ENVIO].main[0] || []).map((c) => c.node).join() !== REGISTRO) {
  throw new Error("«" + ENVIO + "» debe conectar con «" + REGISTRO + "».");
}
if ((wf.connections[REGISTRO].main[0] || []).map((c) => c.node).join() !== BUCLE) {
  throw new Error("«" + REGISTRO + "» debe volver a «" + BUCLE + "» para procesar el siguiente.");
}
console.log("· Conexiones del bucle: done (vacío) · loop → Enviar → Registrar → vuelve al bucle ✓");

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
4. Revisa las conexiones del bucle (es el error que impedía todo envío): del nodo
   **Procesar uno a uno** la flecha debe salir por la salida de **abajo** («loop»)
   hacia **Enviar por WhatsApp API**, y **Registrar envío e impedir duplicados** debe
   volver a entrar a **Procesar uno a uno**. La salida de **arriba** («done») se
   queda sin conectar: entrega un arreglo vacío hasta que el bucle termina.
5. Guarda, pulsa **Execute Workflow** una vez y revisa la salida del primer nodo:
   el último ítem trae el diagnóstico (si no sale nada, ahí dice por qué).
6. Actívalo y **desactiva el workflow anterior** de recordatorios para no duplicar envíos.

`;

let md = GUIA;
for (const [nombre, codigo] of Object.entries(codigos)) {
  md += `## Nodo «${nombre}»\n\n\`\`\`javascript\n${codigo}\n\`\`\`\n\n`;
}
fs.writeFileSync(path.join(__dirname, "recordatorios", "CODIGO-PARA-PEGAR.md"), md);
console.log("✅ n8n/recordatorios/CODIGO-PARA-PEGAR.md actualizado (listo para copiar y pegar)");
