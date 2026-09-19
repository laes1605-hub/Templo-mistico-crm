#!/usr/bin/env node
/**
 * Sirve el workflow de recordatorios para copiar y pegar en n8n.
 *
 *   GET /               → página con el JSON completo y botón «Copiar JSON»
 *   GET /workflow.json  → el JSON crudo (para descargar e importar en n8n)
 *   GET /salud          → { ok: true }
 *
 * Uso: npm run servir:recordatorios   (o PORT=8080 node scripts/servir-recordatorios.mjs)
 *
 * OJO: el JSON lleva las llaves de Supabase y el token de Chatwoot escritos
 * dentro. No compartas la URL del servidor con nadie fuera del equipo.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUTA_WORKFLOW = path.join(raiz, "n8n", "03-recordatorios-whatsapp-por-etapa.json");
const PUERTO = Number(process.env.PORT || 4173);

function leerWorkflow() {
  const json = fs.readFileSync(RUTA_WORKFLOW, "utf8");
  JSON.parse(json); // falla temprano si el archivo quedó mal formado
  return json;
}

const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workflow · Recordatorios de WhatsApp API</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: #0b0a12; color: #e9e6f5; }
  header { padding: 20px 22px 14px; border-bottom: 1px solid #241f36; }
  h1 { margin: 0 0 6px; font-size: 19px; }
  p.sub { margin: 0; color: #a79fc4; font-size: 13.5px; line-height: 1.5; }
  main { padding: 18px 22px 40px; max-width: 1100px; }
  .barra { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
  button, a.boton { font: inherit; font-size: 14px; border-radius: 10px; border: 1px solid #3b3357;
        background: #8b5cf6; color: #fff; padding: 10px 16px; cursor: pointer; text-decoration: none; }
  button.secundario, a.secundario { background: #191527; border-color: #3b3357; color: #cfc7ea; }
  button:hover, a.boton:hover { filter: brightness(1.08); }
  .meta { color: #a79fc4; font-size: 12.5px; margin-left: auto; }
  textarea { width: 100%; height: 58vh; min-height: 340px; background: #12101c; color: #d7d2ec;
        border: 1px solid #2b2540; border-radius: 12px; padding: 14px; font-family: ui-monospace, SFMono-Regular,
        Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.45; resize: vertical; white-space: pre; }
  .pasos { margin-top: 20px; background: #12101c; border: 1px solid #2b2540; border-radius: 12px; padding: 16px 18px; }
  .pasos h2 { margin: 0 0 8px; font-size: 15px; }
  ol { margin: 0; padding-left: 20px; color: #cfc7ea; font-size: 13.5px; line-height: 1.7; }
  code { background: #241f36; padding: 1px 5px; border-radius: 5px; font-size: 12.5px; }
  .ok { color: #6ee7a8; font-size: 13.5px; min-height: 18px; margin-top: 10px; }
  .aviso { margin-top: 16px; color: #f0b98a; font-size: 12.5px; }
</style>
</head>
<body>
<header>
  <h1>Workflow · WhatsApp API · Recordatorios por etapa</h1>
  <p class="sub">Listo para importar en n8n. Trae las llaves escritas dentro del código de los tres nodos,
  así que no hay nada que configurar después de importarlo.</p>
</header>
<main>
  <div class="barra">
    <button id="copiar">📋 Copiar JSON completo</button>
    <a class="boton secundario" href="/workflow.json" download="recordatorios-whatsapp-por-etapa.json">⬇️ Descargar archivo</a>
    <span class="meta" id="meta">cargando…</span>
  </div>
  <textarea id="json" spellcheck="false" readonly aria-label="Contenido del workflow en JSON"></textarea>
  <div class="ok" id="ok"></div>

  <div class="pasos">
    <h2>Cómo importarlo</h2>
    <ol>
      <li>n8n → <b>Workflows</b> → menú <b>⋯</b> → <b>Import from File…</b> y elige el archivo descargado.
          <br>O bien: <b>Import from Clipboard</b> después de pulsar «Copiar JSON completo».</li>
      <li>Abre el workflow y pulsa <b>Execute Workflow</b> una sola vez.</li>
      <li>Revisa la salida del primer nodo: el <b>último ítem</b> trae el diagnóstico
          (<code>_diagnostico: true</code>) con <code>etapasReconocidas</code>, <code>conteo.omitidas</code> y <code>avisos</code>.</li>
      <li><b>Actívalo</b> y <b>desactiva/borra el workflow viejo</b> de recordatorios (y cualquier nodo
          duplicado con «1» al final) para no duplicar envíos.</li>
      <li>Este JSON <b>ya no lleva el nodo «Procesar uno a uno»</b>: la cadena es
          Buscar → Enviar → Registrar y cada nodo procesa toda la tanda.</li>
    </ol>
    <p class="aviso">⚠️ Este archivo contiene la service_role de Supabase y el token de Chatwoot. No compartas
    esta URL fuera del equipo y rota esas llaves cuando puedas.</p>
  </div>
</main>
<script>
  const caja = document.getElementById("json");
  const meta = document.getElementById("meta");
  const ok = document.getElementById("ok");

  fetch("/workflow.json")
    .then((r) => r.text())
    .then((txt) => {
      caja.value = txt;
      const lineas = txt.split("\\n").length;
      meta.textContent = Math.round(txt.length / 1024) + " KB · " + lineas.toLocaleString("es") + " líneas";
    })
    .catch(() => { meta.textContent = "no se pudo cargar el JSON"; });

  document.getElementById("copiar").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(caja.value);
      ok.textContent = "✅ JSON copiado. Pégalo en n8n con Import from Clipboard.";
    } catch (e) {
      caja.removeAttribute("readonly");
      caja.select();
      document.execCommand("copy");
      caja.setAttribute("readonly", "readonly");
      ok.textContent = "✅ JSON copiado (respaldo del navegador).";
    }
    setTimeout(() => { ok.textContent = ""; }, 6000);
  });
</script>
</body>
</html>`;

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/salud") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/workflow.json") {
    let json;
    try {
      json = leerWorkflow();
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("El workflow no se pudo leer: " + error.message);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(json);
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(PAGINA);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("No encontrado");
});

servidor.listen(PUERTO, "0.0.0.0", () => {
  const wf = JSON.parse(leerWorkflow());
  const nodosCode = (wf.nodes || []).filter((n) => n.type === "n8n-nodes-base.code").length;
  console.log(`Workflow de recordatorios disponible en http://0.0.0.0:${PUERTO}`);
  console.log(`· ${wf.name} · ${(wf.nodes || []).length} nodos (${nodosCode} Code) · activo: ${wf.active}`);
});
