/**
 * Prueba del remuxer WebM→OGG tras refactorizarlo para que funcione también
 * en el navegador/APK (sin Buffer de Node).
 *
 * 1) Genera dos WebM/Opus sintéticos pero estructuralmente válidos:
 *    - sinLacing: un paquete Opus por block (lacing 0) — el caso real de
 *      Chrome MediaRecorder. Sirve para comparar byte a byte la
 *      implementación ORIGINAL (git HEAD) contra la NUEVA.
 *    - laced: un BlockGroup con dos frames (lacing Xiph) — expone el fix del
 *      último frame no declarado que hacía falta (ver src/lib/webm-to-ogg.ts).
 * 2) Verifica el OGG resultante con un CRC32 OGG independiente (bit a bit).
 * 3) Ejecuta la implementación NUEVA en un contexto VM sin global Buffer
 *    (simula el navegador) y confirma que produce el mismo OGG.
 *
 * Uso: node scripts/prueba-remux-ogg.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import path from "path";
import vm from "vm";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");

let fallos = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    fallos++;
    console.error(`  ✗ FALLO: ${msg}`);
  }
}

// ---------- Constructor de WebM sintético ----------
function vint(n) {
  if (n < 0x7f) return Buffer.from([0x80 | n]);
  if (n < 0x3fff) return Buffer.from([0x40 | (n >> 7), 0x80 | (n & 0x7f)]);
  if (n < 0x1fffff)
    return Buffer.from([0x20 | (n >> 14), 0x80 | ((n >> 7) & 0x7f), 0x80 | (n & 0x7f)]);
  if (n < 0xfffffff)
    return Buffer.from([0x10 | (n >> 21), 0x80 | ((n >> 14) & 0x7f), 0x80 | ((n >> 7) & 0x7f), 0x80 | (n & 0x7f)]);
  throw new Error("vint demasiado grande");
}
function elem(idBytes, body) {
  return Buffer.concat([Buffer.from(idBytes), vint(body.length), body]);
}
function str(s) {
  return Buffer.from(s, "latin1");
}

function opusHead() {
  const h = Buffer.alloc(19);
  h.write("OpusHead", 0, "latin1");
  h[8] = 1;
  h[9] = 1;
  h.writeUInt16LE(312, 10);
  h.writeUInt32LE(48000, 12);
  h.writeInt16LE(0, 16);
  h[18] = 0;
  return h;
}

const PKT_A = Buffer.from([0x98, 0x01, 0x02, 0x03]);
const PKT_B1 = Buffer.from([0xf8, 0xff, 0xfe]);
const PKT_B2 = Buffer.from([0x98, 0x05, 0x06]);
const PKT_C = Buffer.from([0x98, 0x07, 0x09, 0x0a, 0x0b]);
const PKT_D = Buffer.from([0xf8, 0xff, 0xfe, 0x10]);

function block(track, relTime, flags, payload) {
  return Buffer.concat([
    Buffer.from([0x80 | track]),
    Buffer.from([(relTime >> 8) & 0xff, relTime & 0xff]),
    Buffer.from([flags]),
    payload,
  ]);
}

function blockGroupLaced(track, relTime, frames) {
  const lacingBytes = Buffer.concat([Buffer.from([frames.length - 1]), Buffer.from([frames[0].length])]);
  const blockBody = Buffer.concat([
    Buffer.from([0x80 | track]),
    Buffer.from([(relTime >> 8) & 0xff, relTime & 0xff]),
    Buffer.from([0x80 | (1 << 1)]), // keyframe + lacing Xiph
    lacingBytes,
    ...frames,
  ]);
  return elem([0xa0], elem([0xa1], blockBody)); // BlockGroup > Block
}

function buildWebm(clusterBlocks) {
  const info = elem(
    [0x15, 0x49, 0xa9, 0x66],
    elem([0x2a, 0xd7, 0xb1], Buffer.from([0x00, 0x00, 0x30, 0x39, 0xa8])) // 1_000_000 ns
  );
  const trackEntry = elem(
    [0xae],
    Buffer.concat([
      elem([0xd7], Buffer.from([1])), // TRACK_NUMBER
      elem([0x83], Buffer.from([2])), // audio
      elem([0x73, 0xc5], Buffer.from([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07])), // UID
      elem([0x86], str("A_OPUS")),
      elem([0x63, 0xa2], opusHead()),
      elem(
        [0xe1],
        Buffer.concat([
          elem([0x9f], Buffer.from([1])), // 1 canal
          elem([0xe8, 0x64], Buffer.from([0x00, 0x00, 0x0b, 0xb8])), // 48000
        ])
      ),
    ])
  );
  const tracks = elem([0x16, 0x54, 0xae, 0x6b], trackEntry);

  const clusters = clusterBlocks.map((blks, i) =>
    elem(
      [0x1f, 0x43, 0xb6, 0x75],
      Buffer.concat([
        elem([0xe7], Buffer.from([0x00, i * 60])), // timecode del cluster (ms)
        ...blks,
      ])
    )
  );

  const ebml = elem(
    [0x1a, 0x45, 0xdf, 0xa3],
    Buffer.concat([
      elem([0x42, 0x86], Buffer.from([1])),
      elem([0x42, 0x87], Buffer.from([1])),
      elem([0x42, 0xf2], Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
      elem([0x42, 0xf3], Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff])),
      elem([0x42, 0x82], str("webm")),
    ])
  );
  const segment = elem([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks, ...clusters]));
  return Buffer.concat([ebml, segment]);
}

// Caso real de Chrome MediaRecorder: un paquete por block, lacing 0.
const webmSinLacing = buildWebm([
  [
    elem([0xa0], elem([0xa1], block(1, 0, 0x80, PKT_A))),
    elem([0xa3], block(1, 20, 0x80, PKT_C)),
  ],
  [
    elem([0xa0], elem([0xa1], block(1, 0, 0x80, PKT_D))),
  ],
]);
// Caso con lacing Xiph: dos frames en un mismo Block (B1 + B2).
const webmLaced = buildWebm([
  [
    elem([0xa0], elem([0xa1], block(1, 0, 0x80, PKT_A))),
    blockGroupLaced(1, 20, [PKT_B1, PKT_B2]),
    elem([0xa3], block(1, 40, 0x80, PKT_C)),
  ],
  [
    elem([0xa0], elem([0xa1], block(1, 0, 0x80, PKT_D))),
  ],
]);
console.log(`WebM sinLacing: ${webmSinLacing.length} bytes • WebM laced: ${webmLaced.length} bytes`);

// ---------- Cargar ambas implementaciones ----------
function cargarEnNode(tsCode, nombre) {
  const dir = mkdtempSync(path.join(tmpdir(), "remux-"));
  const f = path.join(dir, `${nombre}.cjs`);
  writeFileSync(f, transform(tsCode, { transforms: ["typescript", "imports"] }).code);
  return require(f);
}

function cargarEnVM(sinBuffer) {
  const s = {};
  for (const k of ["console", "Math", "Uint8Array", "DataView", "ArrayBuffer", "Map", "Set", "Array", "String", "Number", "Boolean", "Error", "JSON", "Object", "Date"]) {
    s[k] = globalThis[k];
  }
  if (!sinBuffer) s.Buffer = Buffer;
  const js = transform(readFileSync("src/lib/webm-to-ogg.ts", "utf8"), { transforms: ["typescript", "imports"] }).code;
  const ctx = { ...s, exports: {} };
  vm.createContext(ctx);
  vm.runInContext(js, ctx, { filename: "webm-to-ogg-vm.ts" });
  return ctx.exports.remuxWebmToOgg;
}

const modOriginal = cargarEnNode(execSync("git show HEAD:src/lib/webm-to-ogg.ts").toString(), "orig");
const modNueva = cargarEnNode(readFileSync("src/lib/webm-to-ogg.ts", "utf8"), "nueva");
const remuxOriginal = modOriginal.remuxWebmToOgg;
const remuxNueva = modNueva.remuxWebmToOgg;

// ---------- Parseo de páginas OGG ----------
function parsearPaginas(u8) {
  u8 = Buffer.from(u8); // Uint8Array plano no respeta el encoding de toString()
  const pages = [];
  let pos = 0;
  while (pos < u8.length) {
    if (u8.subarray(pos, pos + 4).toString("latin1") !== "OggS") throw new Error("cabecera OggS inválida en " + pos);
    const nseg = u8[pos + 26];
    let p = pos + 27 + nseg;
    for (let i = 0; i < nseg; i++) {
      let k = 0;
      for (;;) {
        const s = u8[pos + 27 + i + k];
        p += s;
        if (s !== 255) break;
        k++;
      }
    }
    const page = u8.subarray(pos, p);
    pages.push({ page, headerType: page[5], granule: page.readBigUInt64LE(6), nseg });
    pos = p;
  }
  return pages;
}

// CRC OGG independiente (bit a bit, polinomio 0x04c11db7, init 0, sin XOR final).
// RFC 3533: el campo CRC debe ir a CERO antes de calcular.
function crcOggIndep(u8) {
  const page = Buffer.from(u8);
  page[22] = page[23] = page[24] = page[25] = 0;
  let crc = 0;
  for (const byte of page) {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let k = 0; k < 8; k++) {
      crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
    }
  }
  return crc >>> 0;
}

// Cuantas veces aparece `needle` en `hay` (Buffer.split no existe en Node 22+)
function contarApariciones(hay, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = hay.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function compararPaginas(pagA, pagB, etiqueta) {
  if (pagA.length !== pagB.length) {
    console.error(`  ${etiqueta}: distinto número de páginas (${pagA.length} vs ${pagB.length})`);
    return false;
  }
  let ok = true;
  for (let i = 0; i < pagA.length; i++) {
    const a = Buffer.from(pagA[i].page);
    const b = Buffer.from(pagB[i].page);
    for (const pg of [a, b]) {
      pg[14] = pg[15] = pg[16] = pg[17] = 0; // serial aleatorio
      pg[22] = pg[23] = pg[24] = pg[25] = 0; // CRC (depende del serial)
    }
    if (!a.equals(b)) {
      ok = false;
      console.error(`  ${etiqueta} página ${i}: difiere (${a.length}B vs ${b.length}B)`);
    }
  }
  return ok;
}

function verificarOgg(paginas, etiqueta) {
  let crcOk = true;
  for (let i = 0; i < paginas.length; i++) {
    const stored = paginas[i].page.readUInt32LE(22);
    const calc = crcOggIndep(paginas[i].page);
    if (stored !== calc) {
      crcOk = false;
      console.error(`  ${etiqueta} página ${i}: CRC guardado ${stored.toString(16)} != calculado ${calc.toString(16)}`);
    }
  }
  assert(crcOk, `${etiqueta}: CRC OGG correcto en todas las páginas (verificación independiente)`);
  assert(paginas[0].page.subarray(27 + paginas[0].nseg).indexOf("OpusHead") === 0, `${etiqueta}: primera página contiene OpusHead`);
  assert(Buffer.from(paginas[1].page).indexOf("OpusTags") > 0, `${etiqueta}: segunda página contiene OpusTags`);
  assert((paginas[paginas.length - 1].headerType & 0x04) !== 0, `${etiqueta}: última página tiene flag EOS`);
  let granuleOk = true;
  for (let i = 1; i < paginas.length; i++) {
    if (paginas[i].granule < paginas[i - 1].granule) granuleOk = false;
  }
  assert(granuleOk, `${etiqueta}: granule positions monótonas`);
  return Buffer.concat(
    paginas.flatMap((p) => {
      const out = [];
      let off = 27 + p.nseg;
      for (let i = 0; i < p.nseg; i++) {
        let k = 0;
        let len = 0;
        for (;;) {
          const s = p.page[27 + i + k];
          len += s;
          if (s !== 255) break;
          k++;
        }
        out.push(Buffer.from(p.page.subarray(off, off + len)));
        off += len;
      }
      return out;
    })
  );
}

// ---------- 1) Fidelidad del refactor (input sin lacing, como MediaRecorder) ----------
console.log("\n— Fidelidad del refactor (WebM sin lacing) —");
const oggOriginal = remuxOriginal(new Uint8Array(webmSinLacing), { prerollMs: 0 });
const oggNueva = remuxNueva(new Uint8Array(webmSinLacing), { prerollMs: 0 });
const paginasOrig = parsearPaginas(oggOriginal);
const paginasNueva = parsearPaginas(oggNueva);
console.log(`  OGG original: ${oggOriginal.length} bytes (${paginasOrig.length} pág.) • nueva: ${oggNueva.length} bytes (${paginasNueva.length} pág.)`);
assert(compararPaginas(paginasOrig, paginasNueva, "sinLacing"), "implementación NUEVA idéntica a la ORIGINAL (salvo serial/CRC aleatorio)");
const payloadSinLacing = verificarOgg(paginasNueva, "sinLacing");
for (const [nombre, pkt] of [["A", PKT_A], ["C", PKT_C], ["D", PKT_D]]) {
  assert(payloadSinLacing.includes(pkt), `sinLacing: paquete Opus ${nombre} presente e íntegro`);
}

// ---------- 2) Lacing Xiph (fix del último frame del block) ----------
console.log("\n— Lacing Xiph (fix del último frame no declarado) —");
const oggLaced = remuxNueva(new Uint8Array(webmLaced), { prerollMs: 0 });
const paginasLaced = parsearPaginas(oggLaced);
const payloadLaced = verificarOgg(paginasLaced, "laced");
for (const [nombre, pkt] of [["A", PKT_A], ["B1", PKT_B1], ["B2 (último frame laced)", PKT_B2], ["C", PKT_C], ["D", PKT_D]]) {
  assert(payloadLaced.includes(pkt), `laced: paquete Opus ${nombre} presente e íntegro`);
}

// ---------- 3) Contexto navegador (sin global Buffer) ----------
console.log("\n— Simulación de navegador (contexto VM sin global Buffer) —");
const remuxBrowser = cargarEnVM(true);
const oggBrowser = remuxBrowser(new Uint8Array(webmLaced), { prerollMs: 0 });
const paginasBrowser = parsearPaginas(Uint8Array.from(oggBrowser));
assert(compararPaginas(paginasLaced, paginasBrowser, "browser"), "remux en contexto SIN Buffer idéntico al de Node (input laced)");

// ---------- 4) Preroll (camino de /api/send-message) ----------
console.log("\n— prerollMs=300 (camino del envío a WhatsApp) —");
const oggPreroll = remuxNueva(new Uint8Array(webmSinLacing), { prerollMs: 300 });
const pagPreroll = parsearPaginas(oggPreroll);
const payloadPreroll = verificarOgg(pagPreroll, "preroll");
const cnCount = contarApariciones(payloadPreroll, Buffer.from([0xf8, 0xff, 0xfe]));
assert(cnCount >= 10, `preroll añade ~300 ms de silencio CN (≥10 paquetes de 20 ms; hallados ${cnCount})`);

console.log(fallos === 0 ? "\n✅ PRUEBA COMPLETA: todas las verificaciones pasaron" : `\n❌ HAY ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
