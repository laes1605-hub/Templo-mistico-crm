#!/usr/bin/env node
/**
 * Visora del workflow de Luna (JSON completo para copiar y pegar en n8n).
 *
 * Sirve n8n/IMPORTAR-EN-N8N.RELLENAR.json (el workflow completo, con las
 * claves de Supabase/Chatwoot/Evolution/Fish Audio ya integradas) en una
 * página simple:
 *
 *   - Ve el JSON completo en un solo bloque.
 *   - Dos campos para pegar la clave de OpenAI y la de Groq (las únicas que
 *     NO están en el repo: en el n8n son variables $env). Se reemplazan los
 *     marcadores AQUI_OPENAI_API_KEY / AQUI_GROQ_API_KEY SOLO en el navegador
 *     (100% cliente: las claves no se guardan ni se envían a ningún sitio).
 *   - Botones "Copiar JSON completo" y "Descargar .json".
 *
 * Uso: node scripts/visora-workflow-luna.mjs [puerto]   (default 4173)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const RUTA_JSON = path.join(raiz, "n8n", "IMPORTAR-EN-N8N.RELLENAR.json");
const PUERTO = Number(process.argv[2] || process.env.PORT || 4173);

if (!fs.existsSync(RUTA_JSON)) {
  console.error("Falta " + RUTA_JSON + " — ejecuta primero: npm run build:luna");
  process.exit(1);
}

const jsonBase = fs.readFileSync(RUTA_JSON, "utf8");
// Verificacion: el bloque <script type="application/json"> solo se rompe con
// la secuencia "</script". El workflow generado no la contiene (los jsCode
// llevan "<" escapado como \\u003c por JSON.stringify).
if (/<\/script/i.test(jsonBase)) {
  console.error("El JSON contiene </script y no puede servirse embebido; usa /workflow.json");
  process.exit(1);
}
const jsonParaScript = jsonBase;

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Luna · Workflow completo (copiar y pegar en n8n)</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: #0b0b12; color: #e5e7eb;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h1 .luna { margin-right: 8px; }
  .sub { color: #9ca3af; font-size: 13px; margin-bottom: 14px; line-height: 1.5; }
  .card {
    background: #12121d; border: 1px solid #26263a; border-radius: 14px;
    padding: 14px; margin-bottom: 14px;
  }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em;
    color: #a78bfa; margin: 0 0 10px; }
  label { display: block; font-size: 12px; color: #9ca3af; margin: 8px 0 4px; }
  input[type="password"], input[type="text"] {
    width: 100%; background: #0b0b12; border: 1px solid #2d2d44; color: #e5e7eb;
    border-radius: 10px; padding: 10px 12px; font-size: 13px; font-family: ui-monospace, Menlo, monospace;
  }
  input:focus { outline: none; border-color: #7c3aed; }
  .fila { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
  button {
    background: #7c3aed; color: #fff; border: 0; border-radius: 10px;
    padding: 11px 16px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  button.sec { background: #1f1f2e; border: 1px solid #2d2d44; color: #d1d5db; font-weight: 500; }
  button:active { transform: translateY(1px); }
  textarea {
    width: 100%; height: 420px; background: #07070d; color: #c4b5fd;
    border: 1px solid #26263a; border-radius: 12px; padding: 12px;
    font-size: 11.5px; line-height: 1.45; font-family: ui-monospace, Menlo, Consolas, monospace;
    white-space: pre; overflow: auto; resize: vertical;
  }
  .estado { font-size: 12px; color: #9ca3af; margin-top: 8px; line-height: 1.6; }
  .ok { color: #34d399; } .pend { color: #fbbf24; }
  .nota { font-size: 12px; color: #9ca3af; line-height: 1.6; }
  .nota b { color: #e5e7eb; }
  code { background: #1c1c2b; padding: 1px 6px; border-radius: 6px; font-size: 11.5px; color: #c4b5fd; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(80px);
    background: #34d399; color: #04150d; font-weight: 700; font-size: 14px;
    padding: 12px 22px; border-radius: 999px; transition: transform .25s; z-index: 9;
    box-shadow: 0 8px 30px rgba(0,0,0,.5);
  }
  .toast.show { transform: translateX(-50%) translateY(0); }
  @media (min-width: 768px) { body { max-width: 1080px; margin: 0 auto; } }
</style>
</head>
<body>
  <h1><span class="luna">🔮</span>Workflow de Luna · JSON completo para n8n</h1>
  <div class="sub">
    El archivo ya trae integradas las claves de <b>Supabase</b>, <b>Chatwoot</b>,
    <b>Evolution</b> y <b>Fish Audio</b>. Solo faltan la de <b>OpenAI</b> y la de
    <b>Groq</b> (en tu n8n son las variables de entorno
    <code>OPENAI_API_KEY</code> y <code>GROQ_API_KEY</code>): pégalas abajo y se
    integran en el JSON <b>directamente en tu navegador</b> — no se guardan ni se
    envían a ningún lado.
  </div>

  <div class="card">
    <h2>1 · Rellenar las dos claves (opcional, solo en tu navegador)</h2>
    <label>Clave de OpenAI (empieza por sk-proj-…)</label>
    <input id="kOpenai" type="password" placeholder="sk-proj-…" autocomplete="off" spellcheck="false">
    <label>Clave de Groq (empieza por gsk_…)</label>
    <input id="kGroq" type="password" placeholder="gsk_…" autocomplete="off" spellcheck="false">
    <div class="estado" id="estado"></div>
  </div>

  <div class="card">
    <h2>2 · Copiar y pegar en n8n</h2>
    <div class="fila">
      <button id="btnCopiar">📋 Copiar JSON completo</button>
      <button id="btnDescargar" class="sec">⬇️ Descargar .json</button>
      <button id="btnSeleccionar" class="sec">Seleccionar todo</button>
    </div>
    <textarea id="json" readonly spellcheck="false"
      placeholder="Cargando el workflow…"></textarea>
    <div class="nota">
      En n8n: <b>Workflows → ⋯ / Import from File</b> (sube el .json descargado) o
      pega el JSON copiado en el editor de workflow.
      Si prefieres no pegar las claves aquí, copia el tal cual y reemplaza los
      marcadores <code>Bearer AQUI_OPENAI_API_KEY</code> y
      <code>Bearer AQUI_GROQ_API_KEY</code> en un editor de texto antes de importar.
    </div>
  </div>

  <div id="toast" class="toast">✔ JSON copiado</div>

  <script type="application/json" id="base-json">__JSON__</script>
  <script>
    const base = document.getElementById("base-json").textContent;
    const ta = document.getElementById("json");
    const kO = document.getElementById("kOpenai");
    const kG = document.getElementById("kGroq");
    const estado = document.getElementById("estado");
    const toast = document.getElementById("toast");

    let jsonFinal = base;

    function recalcular() {
      let s = base;
      const ko = kO.value.trim();
      const kg = kG.value.trim();
      if (ko) s = s.split("Bearer AQUI_OPENAI_API_KEY").join("Bearer " + ko);
      if (kg) s = s.split("Bearer AQUI_GROQ_API_KEY").join("Bearer " + kg);
      jsonFinal = s;
      ta.value = s;
      const faltanO = s.includes("AQUI_OPENAI_API_KEY");
      const faltanG = s.includes("AQUI_GROQ_API_KEY");
      const partes = [];
      partes.push(faltanO
        ? '<span class="pend">● OpenAI: pendiente (quedará el marcador AQUI_OPENAI_API_KEY)</span>'
        : '<span class="ok">● OpenAI: integrada</span>');
      partes.push(faltanG
        ? '<span class="pend">● Groq: pendiente (quedará el marcador AQUI_GROQ_API_KEY)</span>'
        : '<span class="ok">● Groq: integrada</span>');
      const chars = s.length;
      partes.push("<br>" + chars.toLocaleString("es") + " caracteres · " +
        (chars / 1024).toFixed(0) + " KB");
      estado.innerHTML = partes.join(" &nbsp; ");
    }

    function avisar(txt) {
      toast.textContent = txt;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2200);
    }

    async function copiar() {
      try {
        await navigator.clipboard.writeText(jsonFinal);
        avisar("✔ JSON copiado");
      } catch (e) {
        ta.focus();
        ta.select();
        document.execCommand("copy");
        ta.setSelectionRange(0, 0);
        avisar("✔ JSON copiado");
      }
    }

    document.getElementById("btnCopiar").addEventListener("click", copiar);
    document.getElementById("btnDescargar").addEventListener("click", () => {
      const blob = new Blob([jsonFinal], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "luna-workflow-completo.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      avisar("⬇️ Descargado");
    });
    document.getElementById("btnSeleccionar").addEventListener("click", () => {
      ta.focus();
      ta.select();
    });
    kO.addEventListener("input", recalcular);
    kG.addEventListener("input", recalcular);

    recalcular();
  </script>
</body>
</html>`;

const htmlFinal = html.replace("__JSON__", jsonParaScript);

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url === "/" || url === "/index.html") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(htmlFinal);
    return;
  }

  if (url === "/workflow.json") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="luna-workflow-completo.json"',
      "Cache-Control": "no-store"
    });
    res.end(jsonBase);
    return;
  }

  if (url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("no encontrado");
});

server.listen(PUERTO, "0.0.0.0", () => {
  console.log("Visora del workflow de Luna en http://0.0.0.0:" + PUERTO);
  console.log("JSON servido: " + path.relative(raiz, RUTA_JSON) + " (" + (jsonBase.length / 1024).toFixed(0) + " KB)");
  console.log("Claves ya integradas: Supabase, Chatwoot, Evolution, Fish Audio. Pendientes de rellenar: OPENAI_API_KEY, GROQ_API_KEY.");
});
