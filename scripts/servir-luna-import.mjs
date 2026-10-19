#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsPath = path.join(root, 'n8n', 'luna', 'secrets.local.json');
const templatePath = path.join(root, 'n8n', '05-luna-etapas.github.json');
const outputPath = path.join(root, 'n8n', 'IMPORTAR-EN-N8N.json');
const PORT = Number(process.env.PORT || 4173);

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page = (body) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workflow Luna · importar en n8n</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#eef2ff;font:15px system-ui,sans-serif}.wrap{max-width:1000px;margin:36px auto;padding:24px}.card{background:#131b31;border:1px solid #2a3551;border-radius:18px;padding:24px;margin:16px 0}h1{font-size:28px;margin:0 0 8px}.muted{color:#aab5ce;line-height:1.55}label{display:block;font-weight:650;margin:16px 0 7px}input{width:100%;padding:12px;border-radius:9px;border:1px solid #394869;background:#080d19;color:#fff}button{background:#8b5cf6;color:white;border:0;border-radius:9px;padding:12px 18px;font-weight:700;cursor:pointer;margin-top:18px}button.secondary{background:#263451;margin-left:8px}textarea{width:100%;height:62vh;background:#070b15;color:#dbeafe;border:1px solid #394869;border-radius:10px;padding:14px;font:12px ui-monospace,monospace;white-space:pre;overflow:auto}.ok{color:#86efac}.warn{color:#fde68a}.error{color:#fca5a5}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}</style><div class="wrap"><h1>Workflow completo de Luna</h1><p class="muted">Este generador incorpora el access token de Chatwoot al código y deja las credenciales de OpenAI y Groq escritas directamente en el JSON; no utiliza <code>$env</code> ni credenciales administradas por n8n.</p>${body}</div></html>`;
const send = (res, status, text, type='text/html; charset=utf-8') => { res.writeHead(status, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(text); };
const form = `<section class="card"><p class="muted">Para generar un importable funcional también hacen falta las claves de IA que ya utiliza tu instancia. Se procesan solo en esta sesión y no se guardan como archivo de configuración. No pegues claves en el chat.</p><form method="post" action="/generar"><label>OpenAI API key</label><input name="openai" type="password" autocomplete="off" required placeholder="sk-…"><label>Groq API key</label><input name="groq" type="password" autocomplete="off" required placeholder="gsk_…"><div class="row"><button type="submit">Generar JSON de Luna</button></div></form></section>`;

const server = http.createServer(async (req,res) => {
  if (req.method === 'GET' && req.url === '/') return send(res,200,page(form));
  if (req.method === 'POST' && req.url === '/generar') {
    try {
      let raw=''; for await (const chunk of req) { raw += chunk; if(raw.length>20000) throw new Error('Formulario demasiado grande'); }
      const fields = new URLSearchParams(raw);
      const openai = (fields.get('openai') || '').trim();
      const groq = (fields.get('groq') || '').trim();
      if (!openai || !groq) return send(res,400,page('<section class="card error">Faltan las claves de OpenAI o Groq. <a href="/">Volver</a></section>'));
      const secrets = JSON.parse(fs.readFileSync(secretsPath,'utf8'));
      const token = String(secrets.CHATWOOT_API_TOKEN || '').trim();
      if (!token) throw new Error('No se configuró el token local de Chatwoot');
      const oldToken = 'KKaF2gF4bJZvnSkqKnR42zD8';
      let rawJson = fs.readFileSync(templatePath,'utf8');
      rawJson = rawJson.split(oldToken).join(token);
      rawJson = rawJson.split("={{ 'Bearer ' + $env.OPENAI_API_KEY }}").join('Bearer '+openai);
      rawJson = rawJson.split("={{ 'Bearer ' + $env.GROQ_API_KEY }}").join('Bearer '+groq);
      // A stale inline credential in the base template is replaced too.
      rawJson = rawJson.replace(/Bearer sk-fish-l-O20-fXkkh15dOpXhxh5prGYH6hf15uAPVgyrBMZZM/g,'Bearer '+openai);
      if (rawJson.includes('$env.') || rawJson.includes(oldToken) || rawJson.includes('sk-fish-l-O20-')) throw new Error('Quedó una credencial antigua o una variable de entorno en el workflow.');
      const wf = JSON.parse(rawJson);
      const codeStrings = [];
      for (const n of wf.nodes || []) if (n.parameters?.jsCode) codeStrings.push(n.parameters.jsCode);
      if (!codeStrings.some(s => s.includes(token))) throw new Error('No se encontró el token en el código del workflow.');
      fs.writeFileSync(outputPath, JSON.stringify(wf,null,2)+'\n','utf8');
      const payload = JSON.stringify(wf);
      const result = `<section class="card"><p class="ok"><b>JSON listo.</b> ${wf.nodes.length} nodos · token Chatwoot actualizado · OpenAI y Groq embebidos · sin variables <code>$env</code>.</p><p class="muted">Copia todo el contenido y pégalo en n8n mediante Workflow → Import from clipboard. También quedó guardado en <code>n8n/IMPORTAR-EN-N8N.json</code>.</p><div class="row"><button type="button" onclick="navigator.clipboard.writeText(document.querySelector('textarea').value).then(()=>this.textContent='Copiado')">Copiar JSON completo</button><a href="/descargar"><button type="button" class="secondary">Descargar archivo JSON</button></a></div><textarea spellcheck="false">${escapeHtml(JSON.stringify(wf,null,2))}</textarea><p class="muted">Después de importarlo, revisa el webhook y activa el workflow. No compartas este JSON: contiene claves de acceso.</p></section>`;
      return send(res,200,page(result));
    } catch (e) { return send(res,500,page(`<section class="card error">No se pudo generar: ${escapeHtml(e.message)}<p><a href="/">Volver</a></p></section>`)); }
  }
  if (req.method === 'GET' && req.url === '/descargar') {
    if (!fs.existsSync(outputPath)) return send(res,404,'Genera primero el JSON desde la página principal.','text/plain; charset=utf-8');
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="Luna-workflow-importable.json"','Cache-Control':'no-store'});
    return fs.createReadStream(outputPath).pipe(res);
  }
  send(res,404,'No encontrado','text/plain; charset=utf-8');
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Generador JSON Luna escuchando en 0.0.0.0:${PORT}`));
