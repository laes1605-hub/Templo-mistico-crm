#!/usr/bin/env node
/**
 * Prueba local (sin desplegar y sin tocar Supabase) de la sincronización de
 * respuestas rápidas contra una base «rota» como la del 19–21/09/2026.
 *
 * El fallo real: la migración `fix_migraciones_duplicadas_idempotentes` borró el
 * trigger `respuestas_rapidas_calcular_huella`, la columna `huella` es NOT NULL y
 * nadie la calculaba, así que TODA inserción fallaba con
 *   «null value in column "huella" of relation "respuestas_rapidas"
 *    violates not-null constraint»
 * y el botón «Sincronizar» de la biblioteca compartida no hacía nada.
 *
 * Lo que se comprueba aquí:
 *   1. La huella que calcula la app es EXACTAMENTE la de Postgres
 *      (md5(tipo || chr(31) || coalesce(hash_bytes, contenido)), en UTF-8).
 *   2. Con el trigger borrado, la biblioteca se sincroniza igual (la huella
 *      viaja calculada desde el teléfono).
 *   3. Con un Supabase al que le falta `huella`, `hash_bytes` o la tabla entera,
 *      la app reintenta lo que se puede y, cuando no, dice QUÉ migración correr.
 *   4. El endpoint /api/respuestas-rapidas/sincronizar publica los pendientes,
 *      sube los data-URI al bucket y devuelve los fallos por respuesta.
 *   5. /api/respuestas-rapidas/diagnostico informa qué falta (sólo lectura).
 *
 * Corre:  npm run test:rr-sync
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

let sucrase;
try {
  sucrase = await import("sucrase");
} catch {
  console.log("sucrase no disponible: prueba saltada (corre `npm install` primero).");
  process.exit(0);
}

const TMP = join(process.cwd(), ".tmp-prueba-rr-sync");
const terminar = (codigo) => {
  rmSync(TMP, { recursive: true, force: true });
  process.exit(codigo);
};

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const md5 = (texto) => createHash("md5").update(Buffer.from(texto, "utf8")).digest("hex");
const SEP = "\u001f";

// ---------------------------------------------------------------------------
// 1) Transpilar los módulos reales (sucrase) a una carpeta temporal del repo
//    para que los imports de @capacitor/* resuelvan en node_modules.
// ---------------------------------------------------------------------------
function transpilar(origenRel, destinoRel) {
  const { code } = sucrase.transform(readFileSync(join(process.cwd(), origenRel), "utf8"), {
    transforms: ["typescript"],
    filePath: origenRel,
  });
  // Node ESM exige la extensión en los imports relativos.
  const conExtension = code
    .replace(/(from\s+")(\.\.?\/[^"]+)(")/g, (_t, a, spec, c) => `${a}${spec}.mjs${c}`)
    // Node ESM no resuelve el subpath "next/server" (Next lo publica como CJS).
    .replace(/(from\s+)"next\/server"/g, '$1"next/server.js"');
  const destino = join(TMP, destinoRel);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, conExtension);
  return destino;
}

const LIB = ["md5", "media-format", "respuestas-rapidas-fila", "respuestas-rapidas", "webm-to-ogg", "audio-download", "download-media"];
for (const nombre of LIB) transpilar(`src/lib/${nombre}.ts`, `lib/${nombre}.mjs`);

// El cliente real de Supabase se sustituye por el backend simulado de abajo:
// cada prueba monta su propia base en globalThis.__SB__.
const STUB_CLIENTE = `export const supabase = {
  from: (tabla) => globalThis.__SB__.from(tabla),
  storage: { from: (bucket) => globalThis.__SB__.bucket(bucket) },
};
export const supabaseAdmin = supabase;
export const usingServiceRole = true;`;
writeFileSync(join(TMP, "lib/supabase.mjs"), STUB_CLIENTE);
writeFileSync(join(TMP, "lib/supabase-admin.mjs"), STUB_CLIENTE);

const RUTA_SINCRONIZAR = transpilar(
  "src/app/api/respuestas-rapidas/sincronizar/route.ts",
  "app/api/respuestas-rapidas/sincronizar/route.mjs"
);
const RUTA_DIAGNOSTICO = transpilar(
  "src/app/api/respuestas-rapidas/diagnostico/route.ts",
  "app/api/respuestas-rapidas/diagnostico/route.mjs"
);

const url = (ruta) => pathToFileURL(join(TMP, ruta)).href;
const importarFresco = (ruta, generacion) => import(`${url(ruta)}?v=${generacion}`);

// ---------------------------------------------------------------------------
// 2) PostgREST simulado (con el bug de la huella reproducible)
// ---------------------------------------------------------------------------
const COLUMNAS_BASE = ["id", "tipo", "titulo", "contenido", "creado_en"];

class Consulta {
  constructor(db, tabla) {
    this.db = db;
    this.tabla = tabla;
    this.accion = "select";
    this.cols = "*";
    this.returning = "*";
    this.filtros = [];
    this.cuerpo = null;
    this.cabeceras = {};
  }
  select(cols, opciones = {}) {
    if (this.accion === "select") this.cols = cols;
    else this.returning = cols;
    this.cabeceras = { ...this.cabeceras, ...opciones };
    return this;
  }
  insert(cuerpo) {
    this.accion = "insert";
    this.cuerpo = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
    return this;
  }
  update(cuerpo) {
    this.accion = "update";
    this.cuerpo = cuerpo;
    return this;
  }
  delete() {
    this.accion = "delete";
    return this;
  }
  order() {
    return this;
  }
  limit(n) {
    this.limite = n;
    return this;
  }
  eq(col, valor) {
    this.filtros.push((fila) => String(fila[col]) === String(valor));
    return this;
  }
  neq(col, valor) {
    this.filtros.push((fila) => String(fila[col]) !== String(valor));
    return this;
  }
  in(col, valores) {
    this.filtros.push((fila) => valores.map(String).includes(String(fila[col])));
    return this;
  }
  like(col, patron) {
    const regex = new RegExp(`^${String(patron).replace(/%/g, ".*")}$`, "i");
    this.filtros.push((fila) => regex.test(String(fila[col] ?? "")));
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then(resolve, reject) {
    try {
      resolve(this.ejecutar());
    } catch (e) {
      reject(e);
    }
  }
  columnasDisponibles() {
    return [...COLUMNAS_BASE, ...(this.db.hashBytes ? ["hash_bytes"] : []), ...(this.db.huella ? ["huella"] : [])];
  }
  columnasDe(especificacion) {
    if (!especificacion || especificacion === "*") return this.columnasDisponibles();
    return especificacion.split(",").map((c) => c.trim()).filter(Boolean);
  }
  errorColumna(columna) {
    return { code: "PGRST204", message: `Could not find the '${columna}' column of 'respuestas_rapidas' in the schema cache` };
  }
  ejecutar() {
    if (this.db.sinRed) return { data: null, error: { message: "TypeError: fetch failed" } };
    if (!this.db.tabla) {
      return { data: null, error: { code: "42P01", message: 'relation "public.respuestas_rapidas" does not exist' } };
    }

    if (this.accion === "select") {
      const pedidas = this.columnasDe(this.cols);
      const faltante = pedidas.find((c) => !this.columnasDisponibles().includes(c));
      if (faltante) return { data: null, error: this.errorColumna(faltante) };

      let filas = this.db.filas.filter((fila) => this.filtros.every((f) => f(fila)));
      if (this.cabeceras.head) return { data: null, error: null, count: filas.length };
      filas = filas.map((fila) => Object.fromEntries(pedidas.map((c) => [c, fila[c] ?? null])));
      if (this.limite) filas = filas.slice(0, this.limite);
      return { data: this.single ? filas[0] ?? null : filas, error: null };
    }

    if (this.accion === "insert") {
      if (this.db.permisoDenegado) {
        return { data: null, error: { code: "42501", message: "permission denied for table respuestas_rapidas" } };
      }
      const creadas = [];
      for (const original of this.cuerpo) {
        const payload = { ...original };
        const desconocida = Object.keys(payload).find((c) => !this.columnasDisponibles().includes(c));
        if (desconocida) return { data: null, error: this.errorColumna(desconocida) };

        // La columna id es uuid: un id local (p. ej. "rr-1758...") no entra.
        if (payload.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(payload.id))) {
          return {
            data: null,
            error: { code: "22P02", message: `invalid input syntax for type uuid: "${payload.id}"` },
          };
        }

        if (this.db.huella) {
          if (this.db.trigger) {
            // Lo que hace el trigger de Postgres: pisa la huella con su fórmula.
            payload.huella = md5(`${payload.tipo}${SEP}${payload.hash_bytes ?? payload.contenido}`);
          } else if (payload.huella === undefined || payload.huella === null) {
            return {
              data: null,
              error: {
                code: "23502",
                message:
                  'null value in column "huella" of relation "respuestas_rapidas" violates not-null constraint',
              },
            };
          }
          const repetida = this.db.filas.some((f) => f.tipo === payload.tipo && f.huella === payload.huella);
          if (repetida) {
            return {
              data: null,
              error: { code: "23505", message: 'duplicate key value violates unique constraint "respuestas_rapidas_tipo_huella_unica_idx"' },
            };
          }
        }

        const fila = {
          id: payload.id ?? `id-${this.db.filas.length + 1}`,
          creado_en: payload.creado_en ?? new Date().toISOString(),
          ...payload,
        };
        this.db.filas.push(fila);
        this.db.inserts.push(fila);
        creadas.push(fila);
      }
      const devueltas = creadas.map((fila) =>
        Object.fromEntries(this.columnasDe(this.returning).map((c) => [c, fila[c] ?? null]))
      );
      return { data: this.single ? devueltas[0] ?? null : devueltas, error: null };
    }

    if (this.accion === "update") {
      let afectadas = 0;
      this.db.filas = this.db.filas.map((fila) => {
        if (!this.filtros.every((f) => f(fila))) return fila;
        afectadas += 1;
        const actualizada = { ...fila, ...this.cuerpo };
        if (this.db.huella && !this.db.trigger && !this.cuerpo?.huella) {
          actualizada.huella = md5(`${actualizada.tipo}${SEP}${actualizada.hash_bytes ?? actualizada.contenido}`);
        }
        return actualizada;
      });
      return { data: afectadas, error: null };
    }

    this.db.filas = this.db.filas.filter((fila) => !this.filtros.every((f) => f(fila)));
    return { data: null, error: null };
  }
}

class BucketSimulado {
  constructor(db, bucket) {
    this.db = db;
    this.bucket = bucket;
  }
  async upload(ruta, bytes, opciones = {}) {
    this.db.uploads.push({ ruta, bytes, contentType: opciones.contentType });
    return { data: { path: ruta }, error: null };
  }
  getPublicUrl(ruta) {
    return { data: { publicUrl: `https://storage.test/media-mensajes/${ruta}` } };
  }
  async list() {
    if (!this.db.hayBucket) return { data: null, error: { message: "Bucket not found" } };
    return { data: [], error: null };
  }
}

class BackendSimulado {
  constructor(opciones = {}) {
    this.tabla = opciones.tabla !== false;
    this.huella = opciones.huella !== false;
    this.hashBytes = opciones.hashBytes !== false;
    this.trigger = opciones.trigger === true;
    this.permisoDenegado = opciones.permisoDenegado === true;
    // Ojo: no se puede llamar `this.bucket` porque tapa el método bucket().
    this.hayBucket = opciones.bucket !== false;
    this.sinRed = opciones.sinRed === true;
    this.filas = opciones.filas || [];
    this.inserts = [];
    this.uploads = [];
    globalThis.__SB__ = this;
  }
  from(tabla) {
    return new Consulta(this, tabla);
  }
  bucket(nombre) {
    return new BucketSimulado(this, nombre);
  }
  reiniciar() {
    this.inserts = [];
    this.uploads = [];
  }
}

// ---------------------------------------------------------------------------
// 3) Pruebas
// ---------------------------------------------------------------------------
let ok = 0;
const fallos = [];
const check = (titulo, condicion, detalle = "") => {
  if (condicion) {
    ok += 1;
    console.log(`  ✓ ${titulo}`);
  } else {
    fallos.push(`${titulo}${detalle ? ` — ${detalle}` : ""}`);
    console.log(`  ✗ ${titulo}${detalle ? ` — ${detalle}` : ""}`);
  }
};

const dataUri = (texto, mime = "audio/ogg") => `data:${mime};base64,${Buffer.from(texto).toString("base64")}`;

// --- 1) La huella es la de Postgres ---------------------------------------
console.log("\n1) La huella calculada en la app es la de Postgres");
const modulo = await importarFresco("lib/respuestas-rapidas-fila.mjs", "huella");
const { huellaDeRespuestaRapida } = modulo;
const texto = "Buenas tardes, ¿en qué puedo ayudarle?";
check(
  "texto sin acentos",
  huellaDeRespuestaRapida("texto", texto) === md5(`texto${SEP}${texto}`),
  huellaDeRespuestaRapida("texto", texto)
);
const conAcentos = "Mándame la foto de la palma derecha, por favor 🙏";
check(
  "acentos y emoji (UTF-8, no code units)",
  huellaDeRespuestaRapida("texto", conAcentos) === md5(`texto${SEP}${conAcentos}`)
);
const hashBytes = md5("bytes-del-audio");
check(
  "con hash_bytes usa el hash y no la URL",
  huellaDeRespuestaRapida("audio", "https://storage.test/a.ogg", hashBytes) === md5(`audio${SEP}${hashBytes}`)
);
check(
  "sin hash usa el contenido",
  huellaDeRespuestaRapida("audio", "https://storage.test/a.ogg") === md5(`audio${SEP}https://storage.test/a.ogg`)
);

// --- 2) Biblioteca del teléfono con el trigger borrado --------------------
console.log("\n2) Sincronizar con el trigger de la huella BORRADO (el fallo real)");
let gen = 0;
const baseRota = new BackendSimulado({ tabla: true, huella: true, hashBytes: true, trigger: false });
const rr = await importarFresco("lib/respuestas-rapidas.mjs", `gen-${++gen}`);

const guardada = await rr.guardarRespuestaRapida({ tipo: "audio", titulo: "Promo luna", contenido: dataUri("audio-promo") });
check("la respuesta queda pendiente en el teléfono", guardada.sincronizada !== true);
check("el archivo se subió al bucket al guardarla", baseRota.uploads.length === 1, `${baseRota.uploads.length} subidas`);

baseRota.reiniciar();
const resultado = await rr.sincronizarRespuestasRapidas();
check("sincronizar NO falla sin el trigger", !resultado.error, resultado.error || "");
check("se sube 1 respuesta", resultado.subidas === 1, `subidas=${resultado.subidas}`);
check("ya no quedan pendientes", resultado.pendientes === 0, `pendientes=${resultado.pendientes}`);
const enBase = baseRota.filas[0];
check("la fila quedó en la biblioteca", Boolean(enBase));
check(
  "la huella guardada es md5(tipo + chr(31) + hash_bytes)",
  enBase?.huella === md5(`audio${SEP}${enBase?.hash_bytes}`),
  `huella=${enBase?.huella}`
);

// --- 3) El mismo audio desde un segundo teléfono --------------------------
console.log("\n3) Dos teléfonos con el mismo audio");
const rr2 = await importarFresco("lib/respuestas-rapidas.mjs", `gen-${++gen}`);
baseRota.reiniciar();
await rr2.guardarRespuestaRapida({ tipo: "audio", titulo: "Promo luna (copia)", contenido: dataUri("audio-promo") });
const segundo = await rr2.sincronizarRespuestasRapidas();
check("no se crea una copia en la biblioteca", baseRota.filas.length === 1, `${baseRota.filas.length} filas`);
check("el segundo teléfono no reporta error", !segundo.error, segundo.error || "");
check("no se publica una segunda subida", segundo.subidas === 0, `subidas=${segundo.subidas}`);

// --- 4) Esquemas incompletos ---------------------------------------------
console.log("\n4) Supabase a medio migrar");
const baseSinHuella = new BackendSimulado({ huella: false, hashBytes: true, trigger: false });
const rrSinHuella = await importarFresco("lib/respuestas-rapidas.mjs", `gen-${++gen}`);
await rrSinHuella.guardarRespuestaRapida({ tipo: "texto", titulo: "Horario", contenido: "Abrimos a las 9." });
const resSinHuella = await rrSinHuella.sincronizarRespuestasRapidas();
check("sin la columna huella se reintenta sin ella y se publica", resSinHuella.subidas === 1 && !resSinHuella.error, resSinHuella.error || "");
check("la fila entra sin huella", baseSinHuella.filas[0]?.huella === undefined);

const baseSinHash = new BackendSimulado({ huella: true, hashBytes: false, trigger: true });
const rrSinHash = await importarFresco("lib/respuestas-rapidas.mjs", `gen-${++gen}`);
await rrSinHash.guardarRespuestaRapida({ tipo: "imagen", titulo: "Precios", contenido: dataUri("imagen-precios", "image/png") });
const resSinHash = await rrSinHash.sincronizarRespuestasRapidas();
check("sin hash_bytes el trigger viejo calcula la huella", resSinHash.subidas === 1 && !resSinHash.error, resSinHash.error || "");
const filaSinHash = baseSinHash.filas[0];
check(
  "la huella es md5(tipo + chr(31) + contenido) (fórmula vieja)",
  filaSinHash?.huella === md5(`imagen${SEP}${filaSinHash?.contenido}`)
);

const baseSinTabla = new BackendSimulado({ tabla: false });
const rrSinTabla = await importarFresco("lib/respuestas-rapidas.mjs", `gen-${++gen}`);
await rrSinTabla.guardarRespuestaRapida({ tipo: "texto", titulo: "Sin tabla", contenido: "Hola" });
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(JSON.stringify({ error: "sin tabla", respuestas: [] }), { status: 500, headers: { "Content-Type": "application/json" } });
const resSinTabla = await rrSinTabla.sincronizarRespuestasRapidas();
globalThis.fetch = fetchOriginal;
check("sin tabla el aviso dice qué migración correr", String(resSinTabla.error || "").includes("20260913000001_respuestas_rapidas.sql"), resSinTabla.error || "(sin error)");
check("el pendiente no se pierde", resSinTabla.pendientes === 1, `pendientes=${resSinTabla.pendientes}`);

// --- 5) Endpoint /api/respuestas-rapidas/sincronizar ---------------------
console.log("\n5) POST /api/respuestas-rapidas/sincronizar");
const baseApi = new BackendSimulado({ huella: true, hashBytes: true, trigger: false });
const { POST: postSincronizar } = await importarFresco("app/api/respuestas-rapidas/sincronizar/route.mjs", `gen-${++gen}`);

const peticion = (pendientes) =>
  new Request("https://crm.test/api/respuestas-rapidas/sincronizar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendientes }),
  });

const respuesta = await postSincronizar(
  peticion([
    { id: "no-es-uuid", tipo: "audio", titulo: "Audio nuevo", contenido: dataUri("audio-api"), creado_en: new Date().toISOString() },
    { tipo: "texto", titulo: "Sin id", contenido: "Texto de prueba", creado_en: new Date().toISOString() },
    { tipo: "texto", titulo: "", contenido: "Sin título: se ignora" },
  ])
);
const json = await respuesta.json();
check("responde 200", respuesta.status === 200, `status=${respuesta.status}`);
check("publica las dos respuestas válidas", json.subidas === 2, `subidas=${json.subidas}`);
check("devuelve la biblioteca completa", json.respuestas.length === 2, `${json.respuestas.length} filas`);
check("sin errores por respuesta", Array.isArray(json.errores) && json.errores.length === 0, JSON.stringify(json.errores));
check("el data-URI se subió al bucket", baseApi.uploads.length === 1 && baseApi.uploads[0].ruta.startsWith("respuestas-rapidas/"), JSON.stringify(baseApi.uploads[0]?.ruta));
const filaAudio = baseApi.filas.find((f) => f.tipo === "audio");
check("en la tabla queda la URL, no el base64", String(filaAudio?.contenido).startsWith("https://storage.test/"), String(filaAudio?.contenido).slice(0, 40));
check("la fila lleva huella y hash_bytes", Boolean(filaAudio?.huella) && Boolean(filaAudio?.hash_bytes));
check("el id inválido no rompe la inserción", filaAudio?.id !== "no-es-uuid");

const baseRestringida = new BackendSimulado({ huella: true, hashBytes: true, trigger: false, permisoDenegado: true });
const respuestaError = await postSincronizar(
  peticion([{ tipo: "texto", titulo: "No sube", contenido: "x", creado_en: new Date().toISOString() }])
);
const jsonError = await respuestaError.json();
check("los fallos por respuesta viajan en `errores`", jsonError.errores?.[0]?.includes("No sube"), JSON.stringify(jsonError.errores));
check("no cuenta como subida", jsonError.subidas === 0, `subidas=${jsonError.subidas}`);

const baseSinTablaApi = new BackendSimulado({ tabla: false });
const respuestaSinTabla = await postSincronizar(peticion([]));
const jsonSinTabla = await respuestaSinTabla.json();
check("sin tabla responde 500 con pista", respuestaSinTabla.status === 500 && String(jsonSinTabla.error).includes("20260913000001"), jsonSinTabla.error);

// --- 6) Endpoint de diagnóstico ------------------------------------------
console.log("\n6) GET /api/respuestas-rapidas/diagnostico");
const { GET: getDiagnostico } = await importarFresco("app/api/respuestas-rapidas/diagnostico/route.mjs", `gen-${++gen}`);

new BackendSimulado({ huella: true, hashBytes: true, trigger: true });
const diagOk = await (await getDiagnostico()).json();
check("con la base completa informa ok", diagOk.ok === true, JSON.stringify(diagOk.problemas));
check("enumera los pasos comprobados", Array.isArray(diagOk.pasos) && diagOk.pasos.length >= 5, `${diagOk.pasos?.length} pasos`);

new BackendSimulado({ tabla: false });
const diagSinTabla = await (await getDiagnostico()).json();
check("sin tabla lo reporta como problema", diagSinTabla.ok === false && diagSinTabla.problemas.some((p) => p.includes("respuestas_rapidas")));
check("sugiere el .sql que la crea", diagSinTabla.sql.some((r) => r.includes("20260913000001_respuestas_rapidas.sql")), JSON.stringify(diagSinTabla.sql));

new BackendSimulado({ sinRed: true });
const diagSinRed = await (await getDiagnostico()).json();
check("sin conexión lo dice como problema de red, no de esquema", diagSinRed.problemas.some((p) => p.includes("conectarse con Supabase")), JSON.stringify(diagSinRed.problemas));
check("sin conexión no manda a correr migraciones", !diagSinRed.sql.some((r) => r.includes("20260913000001_respuestas_rapidas.sql")), JSON.stringify(diagSinRed.sql));

new BackendSimulado({ huella: true, hashBytes: false, trigger: false, bucket: false });
const diagParcial = await (await getDiagnostico()).json();
check("detecta hash_bytes ausente", diagParcial.problemas.some((p) => p.includes("hash_bytes")), JSON.stringify(diagParcial.problemas));
check("detecta el bucket ausente", diagParcial.problemas.some((p) => p.includes("bucket")), JSON.stringify(diagParcial.problemas));
check("sugiere el .sql del bucket", diagParcial.sql.some((r) => r.includes("20260916000001_media_storage.sql")), JSON.stringify(diagParcial.sql));

// ---------------------------------------------------------------------------
console.log(`\n${ok} pruebas OK${fallos.length ? `, ${fallos.length} FALLOS` : ""}`);
if (fallos.length) {
  for (const fallo of fallos) console.log(`  ✗ ${fallo}`);
  terminar(1);
}
terminar(0);
