#!/usr/bin/env node
/**
 * Sanea credenciales que quedaron incrustadas en el repo (workflows n8n,
 * snapshots, etc.).
 *
 * Para que el repo no vuelva a guardar las llaves reales, ESTE archivo no
 * contiene secretos: lee el historial de credenciales desde un archivo local
 * NO versionado:
 *
 *   scripts/supabase-secretos-viejos.local.json
 *
 * Formato:
 * {
 *   "supabase_url": "...",
 *   "supabase_service_role_key": "...",
 *   "supabase_anon_key": "...",
 *   "chatwoot_api_token": "...",
 *   "fish_audio_api_key": "...",
 *   "evolution_api_key": "...",
 *   "cerebro_api_secret": "...",
 *   "master_number": "..."
 * }
 *
 * Uso:
 *   node scripts/redactar-secretos.mjs
 *   node scripts/redactar-secretos.mjs --dry-run
 *
 * IMPORTANTE: borrar las cadenas del código NO equivale a rotar la credencial.
 * Las llaves que estuvieron en un repo público deben ROTARSE en el proveedor.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const ARCHIVO_SECRETOS = path.join(
  __dirname,
  "supabase-secretos-viejos.local.json"
);

function cargarSecretos() {
  if (!fs.existsSync(ARCHIVO_SECRETOS)) {
    console.log(
      `! No existe ${path.relative(raiz, ARCHIVO_SECRETOS)}; usá --dry-run sólo con los patrones de URL.`
    );
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_SECRETOS, "utf8"));
  } catch (e) {
    console.error("No se pudo leer el archivo de secretos:", e?.message || e);
    return {};
  }
}

function reemplazosDesdeSecretos(s) {
  const pares = [];
  const agregar = (desde, hasta) => {
    if (desde && String(desde).trim()) pares.push([String(desde), hasta]);
  };
  // Orden: específico primero.
  if (s.supabase_url) {
    agregar(s.supabase_url, "https://TU-PROYECTO.supabase.co");
    agregar(String(s.supabase_url).replace(/^https?:\/\//, ""), "TU-PROYECTO.supabase.co");
  }
  agregar(s.supabase_service_role_key, "AQUI_SUPABASE_SERVICE_ROLE_KEY");
  agregar(s.supabase_anon_key, "AQUI_SUPABASE_ANON_KEY");
  agregar(s.chatwoot_api_token, "AQUI_CHATWOOT_API_TOKEN");
  agregar(s.fish_audio_api_key, "AQUI_FISH_AUDIO_API_KEY");
  agregar(s.evolution_api_key, "AQUI_EVOLUTION_API_KEY");
  agregar(s.cerebro_api_secret, "AQUI_CEREBRO_API_SECRET");
  if (s.master_number) {
    agregar(s.master_number, "AQUI_MASTER_NUMBER");
    agregar(String(s.master_number).replace(/^\+/, ""), "AQUI_MASTER_NUMBER");
  }
  // Sort descendente por longitud para no dejar fragmentos.
  return pares.sort((a, b) => b[0].length - a[0].length);
}

const secretos = cargarSecretos();
const REEMPLAZOS = reemplazosDesdeSecretos(secretos);

function archivosVersionados() {
  try {
    const out = execSync("git ls-files", {
      cwd: raiz,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    const excluidas = new Set([".git", "node_modules", ".next", "out", "build", "android/app/build", "android/.gradle", "apk"]);
    const resultado = [];
    const caminar = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (excluidas.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) caminar(p);
        else resultado.push(path.relative(raiz, p));
      }
    };
    caminar(raiz);
    return resultado;
  }
}

const dry = process.argv.includes("--dry-run");
let modificados = 0;
let comprobados = 0;

if (REEMPLAZOS.length === 0) {
  console.log("No hay secretos cargados en el archivo local. Nada que reemplazar.");
  process.exit(0);
}

for (const rel of archivosVersionados()) {
  const abs = path.join(raiz, rel);
  if (!fs.existsSync(abs)) continue;
  if (!/\.(json|js|mjs|ts|tsx|md|sql|env|yml|yaml|txt)$/i.test(rel)) continue;
  let texto = fs.readFileSync(abs, "utf8");
  comprobados++;
  let original = texto;
  for (const [desde, hasta] of REEMPLAZOS) texto = texto.split(desde).join(hasta);
  if (texto !== original) {
    modificados++;
    if (!dry) fs.writeFileSync(abs, texto, "utf8");
    console.log(`${dry ? "DRY" : "OK "} ${rel}`);
  }
}

console.log(`\nArchivos revisados: ${comprobados} · cambios: ${modificados}${dry ? " (solo simulación)" : ""}`);
console.log("Recordá: rotar las credenciales en el proveedor. Quitarlas del repo no las invalida.");
