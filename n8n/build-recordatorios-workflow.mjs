#!/usr/bin/env node
/**
 * Builder del workflow de recordatorios de WhatsApp API.
 *
 * Toma n8n/03-recordatorios-whatsapp-por-etapa.json (estructura, credenciales
 * del disparador, conexiones) e inyecta el código de los tres nodos Code desde
 * n8n/recordatorios/code/*.js. Así el JavaScript se edita en archivos .js
 * normales (con resaltado y pruebas) en vez de dentro de la cadena del JSON.
 *
 * Además deja la cadena en línea y SIN el nodo «Procesar uno a uno»: cada nodo
 * Code procesa todos los ítems que recibe, así que un bucle solo agregaba una
 * pieza que podía cortar la pasada en el primer cliente (era el motivo de que
 * saliera un único recordatorio).
 *
 * Uso: node n8n/build-recordatorios-workflow.mjs   (o npm run build:recordatorios)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(__dirname, "03-recordatorios-whatsapp-por-etapa.json");
const CODE = path.join(__dirname, "recordatorios", "code");

const DISPARADOR = "Cada 15 minutos";
const BUSCAR = "Buscar clientes y preparar recordatorio";
const ENVIO = "Enviar por WhatsApp API";
const REGISTRO = "Registrar envío e impedir duplicados";

const NODOS = {
  [BUSCAR]: "buscar-y-preparar.js",
  [ENVIO]: "enviar-whatsapp-api.js",
  [REGISTRO]: "registrar-envio.js",
};

const wf = JSON.parse(fs.readFileSync(WORKFLOW, "utf8"));
const porNombre = new Map((wf.nodes || []).map((n) => [n.name, n]));

// ---------------------------------------------------------------------------
// 1) CÓDIGO DE LOS TRES NODOS
// ---------------------------------------------------------------------------
// El modo siempre explícito: «Run Once for All Items» es el único que procesa la
// tanda completa. Si alguien lo cambia a «una vez por ítem», el nodo solo
// enviaría el primer recordatorio de cada pasada.
const codigos = {};
for (const [nombre, archivo] of Object.entries(NODOS)) {
  const nodo = porNombre.get(nombre);
  if (!nodo) throw new Error("No existe el nodo: " + nombre);
  const codigo = fs.readFileSync(path.join(CODE, archivo), "utf8").replace(/\s+$/, "");
  codigos[nombre] = codigo;
  nodo.parameters = nodo.parameters || {};
  nodo.parameters.mode = "runOnceForAllItems";
  nodo.parameters.jsCode = codigo;
  console.log("· " + nombre + " ← n8n/recordatorios/code/" + archivo + " (" + codigo.split("\n").length + " líneas)");
}

// ---------------------------------------------------------------------------
// 2) SIN BUCLE: CADENA EN LÍNEA
// ---------------------------------------------------------------------------
// El nodo «Loop Over Items (Split in Batches)» tiene dos salidas (0 = done,
// 1 = loop) y hay que devolver la flecha a su entrada para que saque el
// siguiente ítem. Con los nodos Code ya procesando la tanda completa, ese bucle
// sobra: se elimina del JSON para que no pueda volver a cortar los envíos.
const antes = (wf.nodes || []).length;
wf.nodes = (wf.nodes || []).filter((n) => n.type !== "n8n-nodes-base.splitInBatches");
if (wf.nodes.length === antes) console.log("· (no había nodo de bucle que quitar)");
else console.log("· Nodo de bucle eliminado: los nodos Code procesan la tanda completa");

// Posiciones en el lienzo, para que el workflow se vea ordenado.
const posiciones = { [BUSCAR]: [-160, 0], [ENVIO]: [80, 0], [REGISTRO]: [320, 0] };
for (const [nombre, posicion] of Object.entries(posiciones)) {
  const nodo = porNombre.get(nombre);
  if (nodo) nodo.position = posicion;
}

const enlace = (nombre) => ({ node: nombre, type: "main", index: 0 });
const destinos = (nombre) =>
  ((wf.connections[nombre] || {}).main?.[0] || []).map((c) => c.node).join();

wf.connections = {
  [DISPARADOR]: { main: [[enlace(BUSCAR)]] },
  [BUSCAR]: { main: [[enlace(ENVIO)]] },
  [ENVIO]: { main: [[enlace(REGISTRO)]] },
  [REGISTRO]: { main: [[]] },
};

// Validación: si alguien vuelve a meter un bucle o a cruzar la cadena, el build falla.
for (const [origen, destinoEsperado] of [
  [DISPARADOR, BUSCAR],
  [BUSCAR, ENVIO],
  [ENVIO, REGISTRO],
]) {
  if (destinos(origen) !== destinoEsperado) {
    throw new Error("«" + origen + "» debe conectar con «" + destinoEsperado + "».");
  }
}
if (destinos(REGISTRO) !== "") {
  throw new Error("«" + REGISTRO + "» es el último nodo: no debe conectar con nada (ni volver al bucle).");
}
if ((wf.nodes || []).some((n) => n.type === "n8n-nodes-base.splitInBatches")) {
  throw new Error("Volvió a aparecer un nodo de bucle: los nodos Code ya procesan toda la tanda.");
}
for (const nombre of Object.keys(NODOS)) {
  if (porNombre.get(nombre).parameters.mode !== "runOnceForAllItems") {
    throw new Error("El nodo «" + nombre + "» debe quedar en modo «Run Once for All Items».");
  }
}
console.log("· Cadena en línea: Buscar → Enviar → Registrar (sin bucle) ✓");

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

## Lo que cambió (2026-09-19)

1. **Salía un solo recordatorio por pasada**: los nodos Code leían \`$input.item\`
   (el primer ítem) en vez de la tanda completa. Ahora recorren **todos** los
   ítems que reciben.
2. **La variante se elige por tiempo sin contestar**: 30 min → 1 · 3 h → 2 ·
   12 h → 3 · 23 h 30 → 4. Ya no depende de cuántos avisos lleve el cliente.
3. **No se repite la misma variante**: si esa plantilla ya salió en las últimas
   24 h para ese cliente y esa etapa, se omite (antes saldría cada 15 minutos).
4. **Se eliminó el nodo «Procesar uno a uno»** y el bucle: la cadena es
   Buscar → Enviar → Registrar. Un bucle mal conectado cortaba la pasada en el
   primer cliente.
5. **Tope de 60 envíos por pasada** (los que sobren salen en la siguiente, 15 min
   después) y los nodos Code deben quedar en modo **Run Once for All Items**.

## Cómo ponerlo (2 minutos, lo más seguro)

1. En n8n abre el workflow **WhatsApp API · Recordatorios por etapa**.
2. Menú (⋮) → **Import from File** → elige
   \`03-recordatorios-whatsapp-por-etapa.json\`. Se abre como workflow nuevo y ya
   trae los tres nodos Code, la cadena en línea y el disparador cada 15 minutos.
3. Guárdalo, actívalo y **desactiva el workflow anterior** para no duplicar envíos.
4. Pulsa **Execute Workflow** una vez: el último ítem de la salida del primer nodo
   trae el diagnóstico (a quién le toca, a quién no y por qué).

## Si prefieres pegar el código a mano

1. Borra el contenido del campo **Code** y pega el bloque completo del nodo que
   corresponda (los tres bloques van abajo).
2. **Borra el nodo «Procesar uno a uno»** (y cualquier copia con «1» al final,
   tipo «Procesar uno a uno1»).
3. Deja la cadena así: **Cada 15 minutos → Buscar clientes y preparar recordatorio
   → Enviar por WhatsApp API → Registrar envío e impedir duplicados**. El último
   nodo no conecta con nada.
4. En cada nodo Code, arriba a la derecha, revisa que el modo sea
   **Run Once for All Items** (no «Run Once for Each Item»).

`;

let md = GUIA;
for (const [nombre, codigo] of Object.entries(codigos)) {
  md += `## Nodo «${nombre}»\n\n\`\`\`javascript\n${codigo}\n\`\`\`\n\n`;
}
fs.writeFileSync(path.join(__dirname, "recordatorios", "CODIGO-PARA-PEGAR.md"), md);
console.log("✅ n8n/recordatorios/CODIGO-PARA-PEGAR.md actualizado (listo para copiar y pegar)");
