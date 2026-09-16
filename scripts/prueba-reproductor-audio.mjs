/**
 * Prueba del reproductor de notas de voz del chat (VoiceNotePlayer).
 *
 * Monta el componente REAL en un DOM (jsdom) y ejercita el camino que fallaba:
 * la carga del audio. Cubre los casos que dejaban la burbuja "vacía" y muda:
 *
 *  1. Audio que el navegador no puede pedir directamente (CORS / host que exige
 *     el api_access_token de Chatwoot): debe quedar reproducible usando los
 *     bytes que trae el proxy del CRM (el <audio> recibe un blob: URL), sin
 *     descargar el archivo dos veces.
 *  2. Audio que tampoco se consigue por el proxy: la burbuja debe DECIRLO
 *     (mensaje + botón Reintentar) en vez de quedarse en silencio.
 *  3. Un chat con muchas notas no abre cientos de descargas a la vez.
 *
 * Uso: npm run test:audio   (node scripts/prueba-reproductor-audio.mjs)
 */
import { JSDOM } from "jsdom";
import { createRequire } from "module";

const req = createRequire(import.meta.url);

let fallos = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { fallos++; console.error(`  ✗ FALLO: ${msg}`); }
}

// ---------------------------------------------------------------------------
// 1) Entorno: DOM + stubs de lo que jsdom no implementa
// ---------------------------------------------------------------------------
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://templo-mistico-crm.vercel.app/",
  pretendToBeVisual: true,
});
const { window } = dom;

for (const clave of [
  "document", "navigator", "HTMLElement", "HTMLMediaElement", "HTMLAudioElement",
  "Element", "Node", "Event", "CustomEvent", "MouseEvent", "Blob", "File", "getComputedStyle",
]) {
  Object.defineProperty(global, clave, { value: window[clave], configurable: true, writable: true });
}
global.window = window;
global.requestAnimationFrame = window.requestAnimationFrame?.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom no implementa createObjectURL ni la reproducción de medios.
let contadorObjectUrls = 0;
const objectUrlsVivos = new Set();
window.URL.createObjectURL = (blob) => {
  contadorObjectUrls++;
  const url = `blob:templo/${contadorObjectUrls}`;
  objectUrlsVivos.add(url);
  return url;
};
window.URL.revokeObjectURL = (url) => objectUrlsVivos.delete(url);
global.URL = window.URL;

const llamadasPlay = [];
window.HTMLMediaElement.prototype.play = function () {
  llamadasPlay.push(this);
  this.dispatchEvent(new window.Event("play"));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function () {
  this.dispatchEvent(new window.Event("pause"));
};
window.HTMLMediaElement.prototype.load = function () {};

// El componente crea su <audio> con `new Audio()`: envolvemos el constructor
// para poder inspeccionar qué src le acaba llegando.
const elementosAudio = [];
function AudioEspia(src) {
  const el = window.document.createElement("audio");
  if (src) el.setAttribute("src", src);
  elementosAudio.push(el);
  return el;
}
window.Audio = AudioEspia;
global.Audio = AudioEspia;

// ---------------------------------------------------------------------------
// 2) Red simulada: fetch directo vs. proxy del CRM
// ---------------------------------------------------------------------------
const AUDIO_BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4, 5, 6, 7, 8]);
const URL_CHATWOOT = "https://crmesteban.duckdns.org/rails/active_storage/blobs/redirect/abc/nota.oga?disposition=inline";

let peticiones = [];
/** `directo`: "ok" | "cors" | "fallo"; `proxy`: "ok" | "fallo" */
function instalarFetch({ directo, proxy }) {
  peticiones = [];
  const stub = async (url) => {
    const u = String(url);
    if (u.startsWith("/api/media/download")) {
      peticiones.push({ tipo: "proxy", url: u });
      if (proxy !== "ok") {
        return new Response(JSON.stringify({ error: "El archivo ya no está disponible." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(AUDIO_BYTES, { status: 200, headers: { "Content-Type": "audio/ogg" } });
    }
    peticiones.push({ tipo: "directo", url: u });
    if (directo === "cors") throw new TypeError("Failed to fetch");
    if (directo !== "ok") return new Response("", { status: 404, headers: { "Content-Type": "application/json" } });
    return new Response(AUDIO_BYTES, { status: 200, headers: { "Content-Type": "audio/ogg" } });
  };
  window.fetch = stub;
  global.fetch = stub;
}

// ---------------------------------------------------------------------------
// 3) React + el componente REAL (tsx via sucrase)
// ---------------------------------------------------------------------------
// lucide-react se publica como ESM ("type": "module"); el transform de sucrase
// lo pide con require, así que se sirve el namespace ya importado.
const lucide = await import("lucide-react");
const Module = req("module");
const loadOriginal = Module._load;
Module._load = function (request, ...resto) {
  if (request === "lucide-react") return lucide;
  return loadOriginal.call(this, request, ...resto);
};

req("sucrase/register/ts");
req("sucrase/register/tsx");
const React = req("react");
const { createRoot } = req("react-dom/client");
const componente = req("../src/components/VoiceNotePlayer.tsx");
const VoiceNotePlayer = componente.default;
const pedirTurnoDeDescarga = componente.pedirTurnoDeDescarga;
const { act } = React;

async function montar(props) {
  const contenedor = window.document.createElement("div");
  window.document.body.appendChild(contenedor);
  const root = createRoot(contenedor);
  await act(async () => {
    root.render(React.createElement(VoiceNotePlayer, props));
  });
  return {
    contenedor,
    texto: () => contenedor.textContent || "",
    botonPlay: () => contenedor.querySelector("button[aria-label*='nota de voz']"),
    alerta: () => contenedor.querySelector("[role='alert']"),
    reintentar: () =>
      Array.from(contenedor.querySelectorAll("button")).find((b) => /reintentar/i.test(b.textContent || "")),
    desmontar: async () => {
      await act(async () => root.unmount());
      contenedor.remove();
    },
  };
}

/** Deja correr microtareas/timers para que los efectos asíncronos terminen. */
async function asentar(ms = 40) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

// ---------------------------------------------------------------------------
async function main() {
  assert(typeof VoiceNotePlayer === "function", "el componente VoiceNotePlayer se carga desde src/");
  assert(typeof pedirTurnoDeDescarga === "function", "expone pedirTurnoDeDescarga (cola de descargas)");

  // --- Caso 1: el navegador no puede pedir el archivo directamente ---------
  console.log("\n— Audio que sólo se consigue por el proxy del CRM (caso Chatwoot) —");
  instalarFetch({ directo: "cors", proxy: "ok" });
  const antes = { objectUrls: contadorObjectUrls, elementos: elementosAudio.length };
  const a = await montar({ src: URL_CHATWOOT, isMe: false });
  await asentar(80);

  const tipos = peticiones.map((p) => p.tipo);
  assert(tipos.includes("directo"), "intenta primero la descarga directa");
  assert(tipos.includes("proxy"), "ante el fallo de CORS recurre al proxy /api/media/download");
  assert(tipos.filter((t) => t === "directo").length === 1, "no descarga el archivo dos veces por el camino directo");
  assert(
    peticiones.some((p) => p.tipo === "proxy" && p.url.includes(encodeURIComponent(URL_CHATWOOT))),
    "pide al proxy exactamente la URL de la nota"
  );
  assert(contadorObjectUrls > antes.objectUrls, "convierte los bytes en un blob: URL");

  const audioEl = elementosAudio[elementosAudio.length - 1];
  assert(Boolean(audioEl), "hay un elemento de audio creado por el reproductor");
  assert(
    String(audioEl?.getAttribute("src") || "").startsWith("blob:"),
    `el <audio> recibe el blob: (reproducción sin depender del CORS) — src="${audioEl?.getAttribute("src")}"`
  );
  assert(!a.alerta(), "no muestra error: la nota quedó reproducible");
  assert(!/no se pudo|no está disponible/i.test(a.texto()), "la burbuja no queda muda");

  llamadasPlay.length = 0;
  const boton = a.botonPlay();
  assert(Boolean(boton), "existe el botón de play");
  assert(!boton.disabled, "el botón de play está habilitado tras la carga");
  await act(async () => {
    boton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await asentar(20);
  assert(llamadasPlay.length === 1, "al pulsar, reproduce (una llamada a play())");
  assert(llamadasPlay[0] === audioEl, "reproduce el elemento que tiene el blob: URL");
  assert(/pausar/i.test(a.botonPlay().getAttribute("aria-label") || ""), "el botón pasa a 'Pausar'");
  await a.desmontar();
  assert(objectUrlsVivos.size === 0, "al cerrar la burbuja se libera el blob: URL");

  // --- Caso 2: ni directo ni proxy -> hay que avisar -----------------------
  console.log("\n— Audio imposible de descargar (enlace caído) —");
  instalarFetch({ directo: "fallo", proxy: "fallo" });
  const b = await montar({ src: URL_CHATWOOT, isMe: false });
  await asentar(80);
  assert(Boolean(b.alerta()), "muestra un aviso visible (antes el fallo era silencioso)");
  assert(/no está disponible|no se pudo/i.test(b.texto()), `el aviso explica el problema: "${b.texto().slice(0, 80)}"`);
  assert(Boolean(b.reintentar()), "ofrece el botón Reintentar");

  instalarFetch({ directo: "ok", proxy: "ok" });
  const objectUrlsAntes = contadorObjectUrls;
  await act(async () => {
    b.reintentar().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await asentar(80);
  assert(contadorObjectUrls > objectUrlsAntes, "Reintentar vuelve a descargar el audio");
  assert(!b.alerta(), "tras reintentar con red, desaparece el aviso");
  await b.desmontar();

  // --- Caso 3: cola de descargas ------------------------------------------
  console.log("\n— Descargas simultáneas limitadas (chat con muchas notas) —");
  let enCurso = 0;
  let maximoEnCurso = 0;
  let completadas = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      const liberar = await pedirTurnoDeDescarga();
      enCurso++;
      maximoEnCurso = Math.max(maximoEnCurso, enCurso);
      await new Promise((r) => setTimeout(r, 5));
      enCurso--;
      completadas++;
      liberar();
    })
  );
  assert(maximoEnCurso <= 2, `como mucho 2 descargas a la vez (máximo observado: ${maximoEnCurso})`);
  assert(completadas === 8, "los 8 reproductores llegaron a descargar (la cola no se atasca)");

  console.log(fallos === 0 ? "\n✅ PRUEBA COMPLETA: todas las verificaciones pasaron" : `\n❌ HAY ${fallos} FALLO(S)`);
  return fallos;
}

main()
  .then((n) => process.exit(n === 0 ? 0 : 1))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
