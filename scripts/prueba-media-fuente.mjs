#!/usr/bin/env node
/**
 * Pruebas de `src/lib/media-fuente.ts` — el portero de los adjuntos externos.
 *
 * Es el módulo que decide qué URLs puede visitar el SERVIDOR al bajar un audio
 * o una foto de Chatwoot/Evolution. Un error aquí sería grave (SSRF: hacer que
 * el servidor pida `http://localhost:...` o la API interna del servidor), así
 * que las reglas quedan clavadas en esta prueba:
 *
 *   · hosts privados / loopback / link-local bloqueados,
 *   · de Chatwoot solo se sirven sus ARCHIVOS, nunca su API,
 *   · las cabeceras del token solo viajan hacia el host correcto,
 *   · solo http(s).
 *
 * Uso:  npm run test:media
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origen = path.join(raiz, "src", "lib", "media-fuente.ts");
const js = ts.transpileModule(fs.readFileSync(origen, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const { urlChatwoot, urlEvolution, esHostPrivado, esRutaDeApiBloqueada, esUrlDescargable, cabecerasParaFuente } = mod;

let fallos = 0;
let pruebas = 0;

function probar(nombre, real, esperado) {
  pruebas++;
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    fallos++;
    console.log(`✗ ${nombre}\n    esperado: ${JSON.stringify(esperado)}\n    recibido: ${JSON.stringify(real)}`);
  } else {
    console.log(`✓ ${nombre}`);
  }
}

// --- Hosts privados (lo que NUNCA debe visitar el servidor) -----------------
for (const host of [
  "localhost",
  "algo.local",
  "algo.internal",
  "0.0.0.0",
  "127.0.0.1",
  "10.0.0.7",
  "192.168.1.20",
  "172.16.4.4",
  "172.31.255.255",
  "169.254.169.254", // metadatos de la nube: el objetivo clásico del SSRF
  "::1",
  "fe80::1",
  "fd00::1",
]) {
  probar(`bloquea host privado ${host}`, esHostPrivado(host), true);
}
for (const host of ["8.8.8.8", "172.32.0.1", "crmesteban.duckdns.org", "zcljlddtcoyfyvshlyfk.supabase.co"]) {
  probar(`permite host público ${host}`, esHostPrivado(host), false);
}

// --- Candado de la API de Chatwoot -----------------------------------------
const baseChatwoot = urlChatwoot();
probar(
  "la API de Chatwoot queda bloqueada",
  esRutaDeApiBloqueada(new URL(`${baseChatwoot}/api/v1/accounts/1/conversations`)),
  true
);
probar(
  "los archivos de Chatwoot sí se pueden bajar",
  esRutaDeApiBloqueada(new URL(`${baseChatwoot}/rails/active_storage/blobs/redirect/abc/nota.oga`)),
  false
);
probar(
  "otro host no se confunde con Chatwoot",
  esRutaDeApiBloqueada(new URL("https://evil.example.com/api/v1/accounts/1/conversations")),
  false
);

// --- Qué URLs acepta el descargador ----------------------------------------
const casos = [
  ["https://crmesteban.duckdns.org/rails/active_storage/blobs/redirect/abc/foto.jpg", true],
  ["https://zcljlddtcoyfyvshlyfk.supabase.co/storage/v1/object/public/media-mensajes/mensajes/2026-01/x.ogg", true],
  ["https://evo-crmesteban.duckdns.org/…/media/abc", true],
  ["http://localhost:3000/archivo.mp3", false],
  ["http://169.254.169.254/latest/meta-data/", false],
  ["http://10.0.0.1/secreto", false],
  ["file:///etc/passwd", false],
  ["data:audio/ogg;base64,AAAA", false],
  ["no-es-una-url", false],
  ["", false],
];
for (const [url, permitida] of casos) {
  const r = esUrlDescargable(url);
  probar(`esUrlDescargable(${url || "(vacío)"}) → ${permitida ? "sí" : "no"}`, Boolean(r.ok), permitida);
  if (permitida) probar(`  …devuelve la URL revisada (${url.slice(0, 40)}…)`, Boolean(r.destino), true);
  else probar(`  …explica el motivo (${url.slice(0, 24) || "vacío"})`, Boolean(r.motivo), true);
}

// --- Cabeceras: el token solo va al host correcto --------------------------
process.env.CHATWOOT_API_TOKEN = "token-de-prueba";
process.env.EVOLUTION_API_KEY = "llave-evolution";
process.env.CHATWOOT_URL = "https://crmesteban.duckdns.org";
process.env.EVOLUTION_API_URL = "https://evo-crmesteban.duckdns.org";

const hChatwoot = cabecerasParaFuente(new URL("https://crmesteban.duckdns.org/rails/active_storage/blobs/redirect/a/b.ogg"));
probar("manda el token con guion bajo (compatibilidad)", hChatwoot["api_access_token"], "token-de-prueba");
probar("manda el token con guiones (pasa Caddy)", hChatwoot["api-access-token"], "token-de-prueba");
probar("no manda la llave de Evolution a Chatwoot", hChatwoot.apikey, undefined);

const hEvolution = cabecerasParaFuente(new URL("https://evo-crmesteban.duckdns.org/media/abc"));
probar("manda la llave a Evolution", hEvolution.apikey, "llave-evolution");
probar("no manda el token de Chatwoot a Evolution", hEvolution["api-access-token"], undefined);

const hAjeno = cabecerasParaFuente(new URL("https://otro-servidor.example.com/foto.jpg"));
probar("a un host ajeno no le manda ningún token", Object.keys(hAjeno).filter((k) => k !== "Accept"), []);
probar("a un host ajeno solo le manda Accept", hAjeno.Accept, "*/*");

// --- Configuración ---------------------------------------------------------
process.env.CHATWOOT_URL = "https://chatwoot.midominio.com/";
probar("urlChatwoot() quita la barra final", urlChatwoot(), "https://chatwoot.midominio.com");
delete process.env.CHATWOOT_URL;
probar("urlChatwoot() tiene valor por defecto", urlChatwoot(), "https://crmesteban.duckdns.org");
probar("urlEvolution() tiene valor por defecto", urlEvolution(), "https://evo-crmesteban.duckdns.org");

console.log(
  fallos === 0
    ? `\n✅ ${pruebas} comprobaciones correctas: el portero de adjuntos bloquea lo que debe`
    : `\n❌ HAY ${fallos} FALLO(S) de ${pruebas} comprobaciones`
);
process.exit(fallos === 0 ? 0 : 1);
