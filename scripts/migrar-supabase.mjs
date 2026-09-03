#!/usr/bin/env node
/**
 * Migrar de un proyecto Supabase a otro.
 *
 * Rutas:
 *   1) --schema   → genera `supabase/migrations/0000_migrar_esquema_origen.sql`
 *                   a partir del OpenAPI/PostgREST del proyecto de origen.
 *   2) --datos    → copia filas de ORIGEN → DESTINO vía REST (requiere que en
 *                   DESTINO ya existan las tablas; normalmente aplicando el
 *                   archivo generado en el paso 1).
 *   3) --todo     → ejecuta 1 y 2.
 *   4) --auto-sql → además del archivo, intenta aplicarlo con `psql` usando
 *                   DATABASE_URL_DESTINO.
 *
 * Variables de entorno:
 *   SUPABASE_ORIGEN_URL / SUPABASE_ORIGEN_KEY
 *   SUPABASE_DESTINO_URL / SUPABASE_DESTINO_KEY
 *   MIGRAR_TABLAS               (opcional; "a,b,c" limita las tablas)
 *   BATCH_MIGRAR                (opcional; tamaño de paginación, por defecto 500)
 *
 * Ejemplos:
 *   SUPABASE_ORIGEN_URL=https://viejo.supabase.co \
 *   SUPABASE_ORIGEN_KEY=<service role del viejo> \
 *   node scripts/migrar-supabase.mjs --schema
 *
 *   SUPABASE_ORIGEN_URL=https://viejo.supabase.co \
 *   SUPABASE_ORIGEN_KEY=<service role del viejo> \
 *   SUPABASE_DESTINO_URL=https://nuevo.supabase.co \
 *   SUPABASE_DESTINO_KEY=<service role del nuevo> \
 *   node scripts/migrar-supabase.mjs --datos
 *
 * IMPORTANTE:
 *   - PostgREST expone columnas y tipos, pero no hereda constraints, triggers,
 *     funciones ni FKs. La migración FULL y exacta ideal es `pg_dump` (ver
 *     MIGRAR-OTRO-SUPABASE.md). Este script es el plan B operativo para
 *     salvar esquema + datos de las tablas del CRM.
 *   - El proyecto ORIGEN tiene que responder por REST. Si está suspendido y no
 *     responde, el script no puede leer nada: hay que usar un dump o pedir a
 *     Supabase acceso temporal de exportación.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const SALIDA_ESQUEMA = path.join(raiz, "supabase", "migrations", "0000_migrar_esquema_origen.sql");

const origenUrl = (process.env.SUPABASE_ORIGEN_URL || "").trim().replace(/\/+$/, "");
const origenKey = (process.env.SUPABASE_ORIGEN_KEY || "").trim();
const destinoUrl = (process.env.SUPABASE_DESTINO_URL || "").trim().replace(/\/+$/, "");
const destinoKey = (process.env.SUPABASE_DESTINO_KEY || "").trim();
const tablaLinea = (process.env.MIGRAR_TABLAS || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const BATCH = Math.min(2000, Math.max(50, Number(process.env.BATCH_MIGRAR) || 500));

const modoSchema = process.argv.includes("--schema") || process.argv.includes("--todo");
const modoDatos = process.argv.includes("--datos") || process.argv.includes("--todo");
const autoSql = process.argv.includes("--auto-sql");
const dryRun = process.argv.includes("--dry-run");
const reset = process.argv.includes("--reset");

function errorFatal(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

if (!modoSchema && !modoDatos) {
  errorFatal("Usá --schema, --datos o --todo.");
}
if (!origenUrl || !origenKey) {
  errorFatal("Faltan SUPABASE_ORIGEN_URL / SUPABASE_ORIGEN_KEY.");
}
if (modoDatos && (!destinoUrl || !destinoKey)) {
  errorFatal("Para --datos faltan SUPABASE_DESTINO_URL / SUPABASE_DESTINO_KEY.");
}

// ---------------------------------------------------------------------------
// REST helper
// ---------------------------------------------------------------------------

async function restFetch(url, key, ruta, init) {
  const res = await fetch(`${url}${ruta}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${ruta} → ${text.slice(0, 300)}`);
  }
  return { status: res.status, json, text };
}

async function specOrigen() {
  const r = await restFetch(origenUrl, origenKey, "/", {});
  return r.json?.definitions || r.json?.components?.schemas || {};
}

function tipoSql(schema, nombre) {
  const p = schema.properties?.[nombre] || {};
  const formato = p.format || "";
  if (p.type === "integer") return "integer";
  if (p.type === "number") return "numeric";
  if (p.type === "boolean") return "boolean";
  if (p.type === "array") return "jsonb";
  if (p.type === "object") return "jsonb";
  if (formato === "uuid") return "uuid";
  if (formato === "date-time") return "timestamptz";
  if (formato === "date") return "date";
  if (formato === "int4") return "integer";
  if (formato === "int8") return "bigint";
  return p.type === "string" ? "text" : "text";
}

function columnaSql(schema, nombre) {
  const p = schema.properties?.[nombre] || {};
  const requerida = Array.isArray(schema.required) && schema.required.includes(nombre);
  const partes = [`"${nombre}" ${tipoSql(schema, nombre)}`];
  if (!requerida && p.default === undefined) partes.push("NULL");
  if (p.default !== undefined) partes.push(`DEFAULT ${JSON.stringify(p.default)}`);
  return partes.join(" ");
}

function generarSqlEsquema(definitions) {
  const tablas = Object.entries(definitions)
    .filter(([nombre, def]) => def?.properties && Object.keys(def.properties).length > 0)
    .filter(([nombre]) => tablaLinea.length === 0 || tablaLinea.includes(nombre))
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (tablas.length === 0) errorFatal("No se detectaron tablas en el origen.");

  const lineas = [
    "-- ============================================================================",
    "-- ESQUEMA DE MIGRACIÓN — generado por scripts/migrar-supabase.mjs",
    `-- Generado: ${new Date().toISOString()}`,
    `-- Origen:   ${origenUrl}`,
    "--",
    "-- Aplicar en el Supabase DESTINO ANTES de copiar datos.",
    "-- Reconstruye columnas. Las FK, triggers y funciones exactas se recuperan",
    "-- con pg_dump si tenés acceso a la conexión Postgres del origen.",
    "-- ============================================================================",
    "",
    "create extension if not exists \"pgcrypto\";",
    "",
  ];

  for (const [tabla, def] of tablas) {
    const columnas = Object.keys(def.properties || {}).sort();
    lineas.push(`create table if not exists public.${tabla} (`);
    columnas.forEach((c, i) => {
      lineas.push(`  ${columnaSql(def, c)}${i === columnas.length - 1 ? "" : ","}`);
    });
    lineas.push(");", "");
    lineas.push(`alter table public.${tabla} enable row level security;`);
    lineas.push(`drop policy if exists "${tabla}_lectura_publica" on public.${tabla};`);
    lineas.push(`create policy "${tabla}_lectura_publica" on public.${tabla} for select using (true);`);
    lineas.push(`drop policy if exists "${tabla}_escritura_publica" on public.${tabla};`);
    lineas.push(`create policy "${tabla}_escritura_publica" on public.${tabla} for all using (true) with check (true);`, "");
    console.log(`✔ esquema: ${tabla} (${columnas.length} columnas)`);
  }

  lineas.push("-- Fin del esquema de migración.", "");
  return lineas.join("\n");
}

async function aplicarSqlAutomatico(sql) {
  const dbUrl = (process.env.DATABASE_URL_DESTINO || "").trim();
  if (!dbUrl) {
    console.log("! --auto-sql sin DATABASE_URL_DESTINO; no se aplicó por psql.");
    return;
  }
  if (process.env.PSQL_BIN && !fs.existsSync(process.env.PSQL_BIN)) {
    console.log("! PSQL_BIN apunta a un archivo inexistente; no se aplicó.");
    return;
  }
  const psql = process.env.PSQL_BIN || "psql";
  console.log("→ Aplicando esquema en destino con psql...");
  execFileSync(psql, [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
  console.log("✔ Esquema aplicado.");
}

// ---------------------------------------------------------------------------
// Copia de datos
// ---------------------------------------------------------------------------

function normalizarTabla(tabla) {
  const permitidas = tablaLinea;
  return permitidas.length === 0 || permitidas.includes(tabla) || permitidas.includes(tabla.toLowerCase());
}

async function paginarOrigen(tabla, definitions) {
  const columnas = Object.keys((definitions[tabla] || {}).properties || {});
  const orden = columnas.includes("id") ? "&order=id" : "";
  const filas = [];
  let offset = 0;
  while (true) {
    const r = await restFetch(
      origenUrl,
      origenKey,
      `/rest/v1/${tabla}?select=*&limit=${BATCH}${orden}${offset ? `&offset=${offset}` : ""}`,
      {}
    );
    const lote = Array.isArray(r.json) ? r.json : [];
    filas.push(...lote);
    if (lote.length < BATCH) break;
    offset += BATCH;
    // Evitar bucles si el orden no es estable.
    if (offset > 100_000) {
      console.warn(`⚠ ${tabla}: se detuvo en ${filas.length} filas por límite de paginación.`);
      break;
    }
  }
  return filas;
}

async function copiarDatos() {
  console.log(`\nCopiando datos de ${origenUrl} → ${destinoUrl}\n`);
  const defs = await specOrigen();
  const tablas = Object.entries(defs)
    .filter(([nombre, def]) => def?.properties && Object.keys(def.properties).length > 0)
    .filter(([nombre]) => normalizarTabla(nombre))
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (tablas.length === 0) {
    errorFatal("No hay tablas para copiar. ¿Falta MIGRAR_TABLAS?");
  }

  for (const [tabla, def] of tablas) {
    if (dryRun) {
      console.log(`DRY: ${tabla} — se leería del origen y se insertaría en destino.`);
      continue;
    }
    try {
      const filas = await paginarOrigen(tabla, defs);
      if (filas.length === 0) {
        console.log(`✔ ${tabla}: 0 filas`);
        continue;
      }
      // Insertar por lotes; ignore-duplicates evita romper si ya hay filas.
      let insertados = 0;
      for (let i = 0; i < filas.length; i += BATCH) {
        const lote = filas.slice(i, i + BATCH);
        const r = await restFetch(destinoUrl, destinoKey, `/rest/v1/${tabla}`, {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify(lote),
        });
        insertados += lote.length;
        console.log(`   ${tabla}: ${insertados}/${filas.length} (HTTP ${r.status})`);
      }
      console.log(`✔ ${tabla}: ${filas.length} filas copiadas`);
    } catch (e) {
      console.error(`✘ ${tabla}: ${e?.message || e}`);
      if (process.env.MIGRAR_TABLAS) errorFatal("Abortando: falló una tabla indicada explícitamente.");
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const defs = await specOrigen();
  const tablas = Object.entries(defs).filter(([n, d]) => d?.properties && Object.keys(d.properties).length > 0);
  console.log(`Origen detectado: ${origenUrl} · ${tablas.length} tablas`);

  if (modoSchema) {
    const sql = generarSqlEsquema(defs);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(SALIDA_ESQUEMA), { recursive: true });
      fs.writeFileSync(SALIDA_ESQUEMA, sql, "utf8");
      console.log(`\nEsquema guardado en ${path.relative(raiz, SALIDA_ESQUEMA)}`);
      if (autoSql) await aplicarSqlAutomatico(sql);
    } else {
      console.log("\nDRY: esquema generado pero no se escribió.");
    }
  }

  if (modoDatos) await copiarDatos();
}

main().catch((e) => {
  console.error("Error:", e?.message || e);
  process.exit(1);
});
