/**
 * Prueba local (sin desplegar ni tocar Supabase) de la migración de las
 * respuestas rápidas a Storage:
 *
 *   1. md5Hex() coincide byte a byte con md5() de Postgres y de node:crypto
 *      (es la huella que comparten el teléfono, el endpoint de migración y la
 *      migración SQL, así que tienen que dar el mismo valor).
 *   2. Al sincronizar, el audio se sube al bucket y en la tabla queda la URL
 *      con su hash — nunca el base64.
 *   3. Dos teléfonos con el MISMO audio publican una sola respuesta (la URL ya
 *      no sirve para deduplicar; lo hace la huella).
 *   4. El teléfono que aún tiene el base64 reconoce la copia publicada en la
 *      nube y deja de mandarla (ya no pesa en la caché ni en el Egress).
 *   5. adjuntoParaEnviar() manda sólo la URL cuando el archivo está en Storage.
 *   6. Si la subida falla, la respuesta no se pierde: se publica el base64 y la
 *      migración de Ajustes lo pasa a Storage después.
 *   7. Borrar libera el objeto del bucket sólo si ningún chat lo está usando.
 *
 * Corre:  node --conditions=import scripts/prueba-respuestas-rapidas-storage.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * No hay bundler en el repo (Next trae el suyo interno), así que la prueba
 * transpila los módulos con sucrase — el mismo que usa `npm run test:eliminar` —
 * a una carpeta temporal DENTRO del repo, para que los imports de
 * `@capacitor/core` (que arrastra download-media.ts) resuelvan en node_modules.
 */
let sucrase;
try {
  sucrase = await import("sucrase");
} catch {
  console.log("sucrase no disponible: prueba saltada (corre `npm install` primero).");
  process.exit(0);
}

const TMP = join(process.cwd(), ".tmp-prueba-rr");
const MODULOS = ["respuestas-rapidas", "webm-to-ogg", "audio-download", "download-media", "media-format", "md5"];

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const terminar = (codigo) => {
  rmSync(TMP, { recursive: true, force: true });
  process.exit(codigo);
};

for (const nombre of MODULOS) {
  const origen = join(process.cwd(), "src/lib", `${nombre}.ts`);
  const { code } = sucrase.transform(readFileSync(origen, "utf8"), {
    transforms: ["typescript"],
    filePath: `${nombre}.ts`,
  });
  // Node ESM exige la extensión en los imports relativos.
  const conExtension = code.replace(/(from\s+")(.\/[^"]+)(")/g, (_t, a, spec, c) => `${a}${spec}.mjs${c}`);
  writeFileSync(join(TMP, `${nombre}.mjs`), conExtension);
}

// El cliente real de Supabase se sustituye por el backend simulado de abajo.
writeFileSync(
  join(TMP, "supabase.mjs"),
  `// Se resuelve en cada llamada: el backend simulado se monta despues del import.
   export const supabase = {
     from: (tabla) => globalThis.__SB__.from(tabla),
     storage: { from: (bucket) => globalThis.__SB__.storage.from(bucket) },
   };
   export const supabaseAdmin = supabase;
   export const usingServiceRole = false;`
);

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------
const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");
const dataUriDe = (bytes, mime = "audio/ogg") =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

const mod = await import(join(TMP, "respuestas-rapidas.mjs"));

// ---------------------------------------------------------------------------
// Postgres + Storage simulados
// ---------------------------------------------------------------------------
function crearBackend({ sinColumnaHash = false, fallarSubida = false } = {}) {
  const db = {
    respuestas_rapidas: [],
    mensajes: [],
    subidas: [],
    borrados: [],
    secuencia: 0,
  };

  const colsPedidas = (cols) => String(cols || "").split(",").map((c) => c.trim()).filter(Boolean);

  const proyectar = (fila, cols) => {
    if (!cols || !cols.length) return { ...fila };
    const out = {};
    for (const c of cols) if (c in fila) out[c] = fila[c];
    return out;
  };

  /** El trigger de la migración 20260915/20260917: huella sobre el hash si existe. */
  const calcularHuella = (fila) => md5(Buffer.from(`${fila.tipo}\u001f${fila.hash_bytes || fila.contenido}`, "utf8"));

  const crearConsulta = (tabla, modo = "select") => {
    const filtros = [];
    const q = {
      select(cols, opts) {
        q._cols = cols;
        q._head = Boolean(opts?.head);
        q._count = opts?.count;
        return q;
      },
      order(col, opts) {
        q._order = [col, opts?.ascending !== false];
        return q;
      },
      limit(n) {
        q._limit = n;
        return q;
      },
      eq: (k, v) => (filtros.push(["eq", k, v]), q),
      neq: (k, v) => (filtros.push(["neq", k, v]), q),
      in: (k, v) => (filtros.push(["in", k, v]), q),
      like: (k, v) => (filtros.push(["like", k, v]), q),
      insert(payload) {
        q._op = "insert";
        q._payload = payload;
        return q;
      },
      delete() {
        q._op = "delete";
        return q;
      },
      maybeSingle() {
        q._single = true;
        return q;
      },
      then(resolver, rechazar) {
        try {
          resolver(ejecutar());
        } catch (e) {
          rechazar(e);
        }
      },
    };

    const coincide = (fila, [tipo, k, v]) => {
      if (tipo === "eq") return String(fila[k]) === String(v);
      if (tipo === "neq") return String(fila[k]) !== String(v);
      if (tipo === "in") return v.some((x) => String(fila[k]) === String(x));
      if (tipo === "like") {
        const re = new RegExp("^" + String(v).split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
        return re.test(String(fila[k] ?? ""));
      }
      return true;
    };

    const ejecutar = () => {
      const operacion = q._op || modo;
      if (operacion === "insert") {
        const cols = colsPedidas(q._cols);
        if (sinColumnaHash && "hash_bytes" in q._payload) {
          return { data: null, error: { code: "42703", message: `column "hash_bytes" of relation "respuestas_rapidas" does not exist` } };
        }
        const fila = {
          id: q._payload.id || `fila-${++db.secuencia}`,
          tipo: q._payload.tipo,
          titulo: q._payload.titulo ?? "",
          contenido: q._payload.contenido,
          creado_en: q._payload.creado_en,
          hash_bytes: q._payload.hash_bytes ?? null,
        };
        fila.huella = calcularHuella(fila);
        const choque = db.respuestas_rapidas.find(
          (r) => r.tipo === fila.tipo && r.huella === fila.huella
        );
        if (choque) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique index respuestas_rapidas_tipo_huella_unica_idx" } };
        }
        db[tabla].push(fila);
        return { data: q._single ? proyectar(fila, cols) : [proyectar(fila, cols)], error: null };
      }

      if (operacion === "delete") {
        const antes = db[tabla].length;
        db[tabla] = db[tabla].filter((fila) => !filtros.every((f) => coincide(fila, f)));
        return { data: null, error: null, borradas: antes - db[tabla].length };
      }

      let filas = db[tabla].filter((fila) => filtros.every((f) => coincide(fila, f)));
      if (q._order) {
        const [col, asc] = q._order;
        filas = [...filas].sort((a, b) => (String(a[col]) > String(b[col]) ? 1 : -1) * (asc ? 1 : -1));
      }
      if (q._limit) filas = filas.slice(0, q._limit);
      if (q._count === "exact" && q._head) return { count: filas.length, error: null };
      const cols = colsPedidas(q._cols);
      if (sinColumnaHash && cols.includes("hash_bytes")) {
        return { data: null, error: { code: "42703", message: `column "hash_bytes" does not exist` } };
      }
      const datos = filas.map((f) => proyectar(f, cols));
      return { data: q._single ? datos[0] ?? null : datos, error: null };
    };

    return q;
  };

  const cliente = {
    from: (tabla) => crearConsulta(tabla),
    storage: {
      from(bucket) {
        return {
          async upload(ruta, bytes, opciones) {
            if (fallarSubida) return { data: null, error: { message: "El bucket está lleno." } };
            const limpio = new Uint8Array(bytes);
            db.subidas.push({ bucket, ruta, bytes: limpio, upsert: opciones?.upsert, contentType: opciones?.contentType });
            // El índice único del bucket: misma ruta → misma URL (upsert).
            return { data: { path: ruta }, error: null };
          },
          getPublicUrl(ruta) {
            return { data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/${bucket}/${ruta}` } };
          },
          async remove(rutas) {
            db.borrados.push(...rutas);
            return { data: rutas, error: null };
          },
        };
      },
    },
  };
  return { cliente, db };
}

// localStorage simulado (por dispositivo, como en el teléfono real).
function crearAlmacen() {
  const mapa = new Map();
  const store = {
    getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => mapa.set(k, String(v)),
    removeItem: (k) => mapa.delete(k),
  };
  return { store, mapa };
}

let fallos = 0;
const check = (nombre, cond, detalle = "") => {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${cond ? "" : " — " + detalle}`);
  if (!cond) fallos++;
};

// ---------------------------------------------------------------------------
// 1) Huella de referencia para el audio de prueba
// ---------------------------------------------------------------------------
const audio = new Uint8Array(3000);
for (let i = 0; i < audio.length; i++) audio[i] = (i * 37 + 11) & 0xff;
const hashEsperado = md5(Buffer.from(audio));

const usar = ({ almacen, backend }) => {
  globalThis.window = { localStorage: almacen.store };
  globalThis.localStorage = almacen.store;
  globalThis.__SB__ = backend.cliente;
};

// ---------------------------------------------------------------------------
// 2) Publicar un audio → Storage + URL en la tabla (no base64)
// ---------------------------------------------------------------------------
const almacenA2 = crearAlmacen();
const backendA2 = crearBackend();
usar({ almacen: almacenA2, backend: backendA2 });

const guardada = await mod.guardarRespuestaRapida({
  tipo: "audio",
  titulo: "Nota de bienvenida",
  contenido: dataUriDe(audio),
});
check("guardar respuesta rápida calcula la huella del audio", guardada.hash === hashEsperado, `${guardada.hash} vs ${hashEsperado}`);
check("y la deja pendiente en el teléfono (base64 local)", backendA2.db.respuestas_rapidas.length === 0 && guardada.sincronizada === false);

const sinc = await mod.sincronizarRespuestasRapidas();
const filaPublicada = backendA2.db.respuestas_rapidas[0];
check("sincronizar sube el archivo al bucket de media", backendA2.db.subidas.length === 1 && backendA2.db.subidas[0].bucket === "media-mensajes", JSON.stringify(backendA2.db.subidas.map((s) => s.ruta)));
check(
  "el objeto vive en la carpeta de respuestas rápidas y se llama como su huella",
  /^respuestas-rapidas\/\d{4}-\d{2}\//.test(backendA2.db.subidas[0]?.ruta || "") && String(backendA2.db.subidas[0]?.ruta).includes(`${hashEsperado}.ogg`),
  backendA2.db.subidas[0]?.ruta
);
check("en la tabla queda la URL, no el base64", !String(filaPublicada?.contenido || "").startsWith("data:") && /\/storage\/v1\/object\/public\//.test(filaPublicada?.contenido || ""), filaPublicada?.contenido);
check("la tabla guarda la huella de los bytes", filaPublicada?.hash_bytes === hashEsperado, String(filaPublicada?.hash_bytes));
check("los bytes subidos son idénticos a los del audio original", Buffer.compare(Buffer.from(backendA2.db.subidas[0]?.bytes || []), Buffer.from(audio)) === 0);
check("la caché local ya no arrastra el base64", cacheSinBase64(almacenA2), String((almacenA2.mapa.get("templo-crm:respuestas-rapidas:v1") || "").length));
function cacheSinBase64(almacen) {
  const bruto = almacen.store.getItem("templo-crm:respuestas-rapidas:v1") || "[]";
  return !bruto.includes("data:audio") && bruto.length < 2000;
}
check("reporta 1 subida y 0 pendientes", sinc.subidas === 1 && sinc.pendientes === 0, JSON.stringify({ subidas: sinc.subidas, pendientes: sinc.pendientes, error: sinc.error }));

// ---------------------------------------------------------------------------
// 3) y 4) otro teléfono con el mismo archivo, y el que lo tiene en base64
// ---------------------------------------------------------------------------
const almacenB = crearAlmacen();
const backendB = crearBackend();
backendB.db.respuestas_rapidas.push({ ...filaPublicada }); // misma nube, vista desde B
usar({ almacen: almacenB, backend: backendB });

// B tiene el mismo audio (bytes idénticos) con otro título y otro id local.
const duplicada = await mod.guardarRespuestaRapida({
  tipo: "audio",
  titulo: "bienvenida (copia mia)",
  contenido: dataUriDe(audio, "audio/opus"), // mismo audio, otro MIME escrito
});
check("la huella no depende del MIME: es la misma", duplicada.hash === hashEsperado, String(duplicada.hash));
const sincB = await mod.sincronizarRespuestasRapidas();
check("otro teléfono con el mismo audio NO crea una segunda fila", backendB.db.respuestas_rapidas.length === 1, JSON.stringify(backendB.db.respuestas_rapidas.map((r) => r.titulo)));
check("y la biblioteca que ve B ya es la copia de la nube (URL)", sincB.respuestas.length === 1 && sincB.respuestas[0].sincronizada === true && !sincB.respuestas[0].contenido.startsWith("data:"));

// ---------------------------------------------------------------------------
// 5) enviar la respuesta: sólo la URL viaja desde el teléfono
// ---------------------------------------------------------------------------
const url = backendB.db.respuestas_rapidas[0].contenido;
const adjunto = mod.adjuntoParaEnviar({ id: "x", tipo: "audio", titulo: "Nota de bienvenida", contenido: url, creado_en: new Date().toISOString(), hash: hashEsperado });
check("respuesta en Storage → se envía la URL y nada de base64", adjunto.fileUrl === url && adjunto.fileBase64 === null, JSON.stringify(adjunto));
check("el MIME y el nombre salen de la URL", adjunto.fileMime === "audio/ogg" && /\.ogg$/.test(adjunto.fileName), JSON.stringify({ m: adjunto.fileMime, n: adjunto.fileName }));

const adjuntoLocal = mod.adjuntoParaEnviar({ id: "y", tipo: "audio", titulo: "pendiente", contenido: dataUriDe(audio), creado_en: new Date().toISOString() });
check("respuesta pendiente (base64) → sigue viajando incrustada", adjuntoLocal.fileBase64 === dataUriDe(audio) && adjuntoLocal.fileUrl === null);
check("texto → sin adjunto", mod.adjuntoParaEnviar({ id: "z", tipo: "texto", titulo: "hola", contenido: "hola", creado_en: new Date().toISOString() }) === null);

// ---------------------------------------------------------------------------
// 6) si la subida falla no se pierde la respuesta (plan B)
// ---------------------------------------------------------------------------
const almacenC = crearAlmacen();
const backendC = crearBackend({ fallarSubida: true });
usar({ almacen: almacenC, backend: backendC });
const audioDistinto = new Uint8Array(500).fill(7);
await mod.guardarRespuestaRapida({ tipo: "audio", titulo: "sin storage", contenido: dataUriDe(audioDistinto, "audio/webm") });
const sincC = await mod.sincronizarRespuestasRapidas();
const filaC = backendC.db.respuestas_rapidas[0];
check("subida fallida: la respuesta igual se comparte (base64) y no se pierde", Boolean(filaC) && filaC.contenido.startsWith("data:") && sincC.subidas === 1, JSON.stringify({ subidas: sincC.subidas, error: sincC.error }));
check("subida fallida: igual se guarda la huella, para que Ajustes la migre después", filaC?.hash_bytes === md5(Buffer.from(audioDistinto)), String(filaC?.hash_bytes));

// ---------------------------------------------------------------------------
// 7) borrar libera el objeto sólo si está huérfano
// ---------------------------------------------------------------------------
const almacenD = crearAlmacen();
const backendD = crearBackend();
usar({ almacen: almacenD, backend: backendD });
const filaD = { id: "fila-d", tipo: "audio", titulo: "t", contenido: url, creado_en: new Date().toISOString(), hash_bytes: hashEsperado, huella: "h" };
backendD.db.respuestas_rapidas.push(filaD);
await mod.actualizarRespuestasRapidas();
await mod.eliminarRespuestaRapida("fila-d");
check("borrar la respuesta borra su objeto de Storage", backendD.db.borrados.length === 1 && /respuestas-rapidas\//.test(backendD.db.borrados[0]), JSON.stringify(backendD.db.borrados));

const almacenE = crearAlmacen();
const backendE = crearBackend();
usar({ almacen: almacenE, backend: backendE });
backendE.db.respuestas_rapidas.push({ ...filaD, id: "fila-e" });
backendE.db.mensajes.push({ id: "m-1", url_archivo: url });
await mod.actualizarRespuestasRapidas();
await mod.eliminarRespuestaRapida("fila-e");
check("pero NO lo borra si un chat del CRM lo está usando", backendE.db.borrados.length === 0 && backendE.db.respuestas_rapidas.length === 0, JSON.stringify(backendE.db.borrados));

// ---------------------------------------------------------------------------
// 8) tabla sin la columna hash_bytes (migración SQL aún no aplicada)
// ---------------------------------------------------------------------------
const almacenF = crearAlmacen();
const backendF = crearBackend({ sinColumnaHash: true });
usar({ almacen: almacenF, backend: backendF });
await mod.guardarRespuestaRapida({ tipo: "audio", titulo: "sin migrar", contenido: dataUriDe(new Uint8Array(120).fill(3)) });
const sincF = await mod.sincronizarRespuestasRapidas();
check(
  "sin la migración SQL aplicada la sincronización no se rompe",
  sincF.error === undefined && sincF.subidas === 1 && backendF.db.respuestas_rapidas.length === 1,
  JSON.stringify({ subidas: sincF.subidas, error: sincF.error, filas: backendF.db.respuestas_rapidas.length })
);

// ---------------------------------------------------------------------------
// 9) md5Hex: vectores del RFC 1321 y comparación con node:crypto
// ---------------------------------------------------------------------------
const { md5Hex: md5Fn } = await import(join(TMP, "md5.mjs"));
const vectores = [
  ["", "d41d8cd98f00b204e9800998ecf8427e"],
  ["a", "0cc175b9c0f1b6a831c399e269772661"],
  ["abc", "900150983cd24fb0d6963f7d28e17f72"],
  ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
  ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
  ["The quick brown fox jumps over the lazy dog", "9e107d9d372bb6826bd81d3542a419d6"],
];
for (const [texto, esperado] of vectores) {
  const obtenido = md5Fn(new TextEncoder().encode(texto));
  check(`md5Hex("${texto.slice(0, 24)}${texto.length > 24 ? "…" : ""}")`, obtenido === esperado, `${obtenido} ≠ ${esperado}`);
}
let aleatoriosOk = true;
for (let i = 0; i < 40; i++) {
  const n = 1 + Math.floor(Math.random() * 9000);
  const bytes = new Uint8Array(n);
  for (let j = 0; j < n; j++) bytes[j] = Math.floor(Math.random() * 256);
  if (md5Fn(bytes) !== createHash("md5").update(bytes).digest("hex")) {
    aleatoriosOk = false;
    console.log(`   (diferencia en ${n} bytes)`);
    break;
  }
}
check("md5Hex coincide con node:crypto en 40 buffers aleatorios (multi-bloque)", aleatoriosOk);


// ---------------------------------------------------------------------------
// 10) Helpers de formato: lo que comparten el teléfono, la ruta y la migración SQL
// ---------------------------------------------------------------------------
const formato = await import(join(TMP, "media-format.mjs"));
// La guarda del UPDATE de 20260917: si un data-URI no la pasa, la fila NO se
// migra en SQL (quedaría en base64 para siempre), así que tiene que aceptar
// exactamente lo que produce la app.
const esBase64Sql = (payload) => payload.length % 4 === 0 && /^[a-z0-9+/]+={0,2}$/i.test(payload);

let formatoOk = true;
let casos = 0;
for (const n of [1, 2, 3, 55, 56, 57, 63, 64, 65, 1000, 65537, 300000]) {
  const bytes = new Uint8Array(n);
  for (let j = 0; j < n; j++) bytes[j] = (j * 251 + n) & 0xff; // fuerza +, / y = en el base64
  for (const mime of ["audio/ogg", "image/jpeg", "audio/mp4"]) {
    const uri = formato.bytesADataUri(bytes, mime);
    casos++;
    const payload = uri.slice(uri.indexOf(",") + 1);
    const parseado = formato.parsearDataUri(uri);
    if (
      !esBase64Sql(payload) ||
      !parseado ||
      parseado.mime !== mime ||
      Buffer.compare(Buffer.from(parseado.bytes), Buffer.from(bytes)) !== 0 ||
      md5(Buffer.from(parseado.bytes)) !== md5Fn(bytes)
    ) {
      formatoOk = false;
      console.log(`   (falló ${n} bytes ${mime})`);
    }
  }
}
check(`parsearDataUri ↔ bytesADataUri y la guarda SQL del MD5 (${casos} casos)`, formatoOk);
check(
  "la URL pública se reconoce y se le extrae la ruta del bucket",
  formato.esUrlDeStorage(url) &&
    formato.rutaEnBucket(url) === url.split("/object/public/media-mensajes/")[1] &&
    !formato.esUrlDeStorage(dataUriDe(audio)) &&
    !formato.rutaEnBucket("https://otro-host.co/archivo.ogg"),
  String(formato.rutaEnBucket(url))
);
check("los textos planos no se tratan como adjunto", !formato.esDataUri("gracias 🙏") && !formato.esUrlDeStorage("gracias 🙏"));
check("mimeDesdeUrl prioriza audio/ogg en .ogg (nota de voz nativa)", formato.mimeDesdeUrl("https://x/9e10.ogg") === "audio/ogg" && formato.extensionPorMime("audio/opus") === "ogg");

console.log(fallos === 0 ? "\n🎉 TODO OK" : `\n💥 ${fallos} fallo(s)`);
terminar(fallos === 0 ? 0 : 1);
