#!/usr/bin/env node
/**
 * Reconstruye una base SQL a partir del OpenAPI/PostgREST de un proyecto
 * Supabase VIVO/ACCESIBLE.
 *
 * Es el paso previo a migrar a un Supabase nuevo cuando te quedaste sin el
 * esquema base en el repo (el CRM creó las tablas core a mano y sólo versionó
 * las migraciones posteriores).
 *
 * Uso (con un proyecto ACCESIBLE, p.ej. el Supabase viejo reactivado por
 * soporte, o uno nuevo que quieras clonar):
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://abc....supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
 *   node scripts/dump-esquema-supabase.mjs
 *
 *   # Con service role se pueden leer las tablas aunque RLS las proteja:
 *   SUPABASE_URL=https://abc....supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/dump-esquema-supabase.mjs --datos
 *
 * Genera:
 *   supabase/migrations/0000_reconstruir_esquema.sql   (tablas + columnas)
 *   supabase/migrations/0000_reconstruir_datos.sql      (opcional, con --datos)
 *
 * NOTA: no reconstruye primary keys compuestas, uniqueness ni triggers con la
 * fidelidad de `pg_dump`. Cuando el proyecto original esté accesible, lo ideal
 * es además ejecutar:
 *
 *   pg_dump "$CONNECTION_STRING" --schema-only → esquema exacto
 *   pg_dump "$CONNECTION_STRING" --data-only  → datos exactos
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const SALIDA_ESQUEMA = path.join(raiz, "supabase", "migrations", "0000_reconstruir_esquema.sql");
const SALIDA_DATOS = path.join(raiz, "supabase", "migrations", "0000_reconstruir_datos.sql");

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const conDatos = process.argv.includes("--datos");

if (!url || !key) {
  console.error("Faltan SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL y una clave.");
  console.error("Ejemplo: SUPABASE_URL=https://abc.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/dump-esquema-supabase.mjs");
  process.exit(1);
}

async function api(ruta) {
  const r = await fetch(`${url}${ruta}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
  });
  if (!r.ok) {
    let texto = "";
    try { texto = await r.text(); } catch {}
    throw new Error(`HTTP ${r.status} en ${ruta} → ${texto.slice(0, 300)}`);
  }
  return r.json();
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
  if (formato === "date-time" || formato === "timestamptz") return "timestamptz";
  if (formato === "date") return "date";
  if (formato === "int" || formato === "int4") return "integer";
  if (formato === "int8") return "bigint";
  if (formato === "numeric") return "numeric";
  return p.type === "string" ? "text" : "text";
}

function columnaSql(schema, nombre) {
  const p = schema.properties?.[nombre] || {};
  const tipo = tipoSql(schema, nombre);
  const requerida = Array.isArray(schema.required) && schema.required.includes(nombre);
  // default puede venir como string (JSON). PostgREST a veces no lo expone.
  let def = p.default;
  if (def === undefined || def === null) def = null;
  const partes = [`"${nombre}" ${tipo}`];
  if (!requerida && def === null) partes.push("NULL");
  if (def !== null) partes.push(`DEFAULT ${JSON.stringify(def)}`);
  return partes.join(" ");
}

async function main() {
  const spec = await api("/");
  const definitions = spec.definitions || spec.components?.schemas || {};
  const tablas = Object.entries(definitions).filter(([nombre, def]) => def?.properties);
  tablas.sort((a, b) => a[0].localeCompare(b[0]));

  const salida = [
    "-- ============================================================================",
    "-- RECONSTRUCCIÓN BASE — generada por scripts/dump-esquema-supabase.mjs",
    `-- Generado: ${new Date().toISOString()}`,
    `-- Fuente: ${url}`,
    "--",
    "-- Esto crea las tablas/columnas que No estaban versionadas en el repo. Las",
    "-- migraciones de supabase/migrations/ se aplican DESPUÉS sobre esta base.",
    "-- ============================================================================",
    "",
    "create extension if not exists \"pgcrypto\";",
    "",
  ];

  const tablasDatos = [];
  for (const [tabla, def] of tablas) {
    const columnas = Object.keys(def.properties || {}).sort();
    if (columnas.length === 0) continue;
    salida.push(`create table if not exists public.${tabla} (`);
    columnas.forEach((c, i) => {
      salida.push(`  ${columnaSql(def, c)}${i === columnas.length - 1 ? "" : ","}`);
    });
    salida.push(");", "");

    // RLS mínima y política pública (el CRM usaba anon + service role).
    salida.push(`alter table public.${tabla} enable row level security;`);
    salida.push(`drop policy if exists "${tabla}_lectura_publica" on public.${tabla};`);
    salida.push(`create policy "${tabla}_lectura_publica" on public.${tabla} for select using (true);`);
    salida.push(`drop policy if exists "${tabla}_escritura_publica" on public.${tabla};`);
    salida.push(`create policy "${tabla}_escritura_publica" on public.${tabla} for all using (true) with check (true);`, "");
    tablasDatos.push(tabla);
    console.log(`✔ ${tabla} (${columnas.length} columnas)`);
  }

  fs.mkdirSync(path.dirname(SALIDA_ESQUEMA), { recursive: true });
  fs.writeFileSync(SALIDA_ESQUEMA, salida.join("\n"), "utf8");
  console.log(`\nEsquema escrito en ${path.relative(raiz, SALIDA_ESQUEMA)}`);

  if (conDatos) {
    // Conteo y volcado trivial (sin FK): suficiente para una base de recreación.
    const lineasDatos = [
      "-- Datos básicos por tabla (INSERT con valores por columna conocida).",
      "-- Si puedes ejecutar pg_dump, es preferible.",
      "",
    ];
    for (const tabla of tablasDatos) {
      try {
        const resp = await fetch(`${url}/rest/v1/${tabla}?select=*&limit=500`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (!resp.ok) continue;
        const rows = await resp.json();
        if (!Array.isArray(rows) || rows.length === 0) continue;
        if (rows.length >= 500) {
          lineasDatos.push(`-- ${tabla}: ${rows.length}+ filas (volcado parcial, usar pg_dump)`);
        } else {
          lineasDatos.push(`-- ${tabla}: ${rows.length} filas`);
        }
        for (const row of rows.slice(0, 200)) {
          const cols = Object.keys(row);
          const vals = cols.map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return "null";
            if (typeof v === "number" || typeof v === "boolean") return String(v);
            return JSON.stringify(String(v));
          });
          lineasDatos.push(`insert into public.${tabla} (${cols.map((c) => `"${c}"`).join(", ")}) values (${vals.join(", ")}) on conflict do nothing;`);
        }
        console.log(`✔ ${tabla}: ${rows.length} filas`);
      } catch (e) {
        console.warn(`⚠ ${tabla}: ${e?.message || e}`);
      }
    }
    fs.writeFileSync(SALIDA_DATOS, lineasDatos.join("\n"), "utf8");
    console.log(`\nDatos escritos en ${path.relative(raiz, SALIDA_DATOS)}`);
  }

  console.log("\nRecordá: después aplicar en este orden:");
  console.log("  1) 0000_reconstruir_esquema.sql");
  console.log("  2) supabase/migrations/*.sql (en orden de fecha)");
  console.log("  3) crear el bucket media-mensajes en Storage.");
}

main().catch((e) => {
  console.error("Error:", e?.message || e);
  process.exit(1);
});
