#!/usr/bin/env node
/**
 * Pruebas de src/lib/buscador-global.ts
 *
 *   · El buscador de la bandeja busca en TODO el CRM: cualquier etapa del
 *     pipeline, Archivados, Spam y fichas de clientes sin chat. Antes solo
 *     miraba la subcategoría abierta.
 *   · El número se encuentra escrito como sea: con «+», espacios, guiones,
 *     paréntesis, sin indicativo o con el 0 / 00 de marcado.
 *   · El nombre se compara sin tildes ni mayúsculas y SOLO contra el nombre
 *     puesto a mano (el de WhatsApp nunca se muestra ni se busca).
 *   · Orden de los resultados: mejor coincidencia, luego chats activos,
 *     archivados, spam y fichas sin chat, y lo más reciente primero.
 *
 * Uso:  npm run test:buscador
 *
 * El archivo es TypeScript, así que se transpila al vuelo con la versión de
 * `typescript` del proyecto (no hace falta compilar).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origen = path.join(raiz, "src", "lib", "buscador-global.ts");
const js = ts.transpileModule(fs.readFileSync(origen, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const {
  analizarConsulta,
  buscarEnCrm,
  camposTelefonoDe,
  coincidenciaContacto,
  nombreManualDe,
  normalizarTexto,
  puntajeNombre,
  puntajeTelefono,
  soloDigitos,
  telefonosDe,
  ubicacionDeConversacion,
} = mod;

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

// ───────────────────────── Texto y dígitos ─────────────────────────
console.log("\n— Normalización —");
probar("quita tildes, mayúsculas y espacios de más", normalizarTexto("  MARÍA   José "), "maria jose");
probar("la ñ se busca también como n", normalizarTexto("Peña"), "pena");
probar("quita caracteres invisibles (ancho cero)", normalizarTexto("Zoë\u200B"), "zoe");
probar("valores vacíos no rompen", [normalizarTexto(null), normalizarTexto(undefined), normalizarTexto("")], ["", "", ""]);
probar("acepta números", normalizarTexto(305), "305");
probar("soloDigitos deja solo los dígitos", soloDigitos("+57 (305) 402-1111"), "573054021111");
probar("soloDigitos con vacío", [soloDigitos(null), soloDigitos("abc")], ["", ""]);

// ───────────────────────── Nombre y teléfonos del contacto ─────────────────────────
console.log("\n— Nombre visible y teléfonos —");
probar("nombre manual recortado", nombreManualDe({ nombre_manual: " Ana " }), "Ana");
probar("«Sin nombre» no cuenta como nombre", nombreManualDe({ nombre_manual: "Sin nombre" }), "");
probar("el nombre de WhatsApp NO es el nombre visible", nombreManualDe({ nombre: "Pedro WA", nombre_manual: null }), "");
probar("cliente nulo", nombreManualDe(null), "");
probar(
  "los tres campos de teléfono, en el orden de siempre",
  camposTelefonoDe({ telefono_display: "A", telefono: "B" }, { numero_whatsapp: "C" }),
  ["A", "B", "C"],
);
probar(
  "teléfonos sin repetir aunque estén escritos distinto",
  telefonosDe({ telefono_display: "+57 305 402 1111", telefono: "+573054021111" }, { numero_whatsapp: "573054021111" }),
  ["573054021111"],
);
probar(
  "guarda cada número distinto del contacto",
  telefonosDe({ telefono: "0985123456" }, { numero_whatsapp: "595985123456" }),
  ["0985123456", "595985123456"],
);
probar("marcador «revisar_…»: se busca por los dígitos que se ven", telefonosDe({ telefono: "revisar_8842" }), ["8842"]);
probar("sin cliente ni conversación", telefonosDe(null, null), []);

// ───────────────────────── Qué se escribió ─────────────────────────
console.log("\n— Interpretación de lo escrito —");
const resumen = (texto) => {
  const c = analizarConsulta(texto);
  return { activa: c.activa, tipo: c.tipo, variantes: c.variantesDigitos };
};
probar("campo vacío: no hay búsqueda", resumen(""), { activa: false, tipo: "vacia", variantes: [] });
probar("solo espacios: no hay búsqueda", resumen("   "), { activa: false, tipo: "vacia", variantes: [] });
probar("solo «+»: todavía no hay búsqueda", resumen("+"), { activa: false, tipo: "vacia", variantes: [] });
probar("solo signos «( ) -»: no hay búsqueda", resumen("( ) -"), { activa: false, tipo: "vacia", variantes: [] });
probar("nulo: no hay búsqueda", resumen(null), { activa: false, tipo: "vacia", variantes: [] });
probar("número con espacios", resumen("305 402 11"), { activa: true, tipo: "telefono", variantes: ["30540211"] });
probar(
  "número con +, paréntesis y guion",
  resumen("+57 (305) 402-1111"),
  { activa: true, tipo: "telefono", variantes: ["573054021111"] },
);
probar(
  "número copiado de WhatsApp (marcas invisibles y guion tipográfico)",
  resumen("\u202A+57 305\u2011402 1111\u202C"),
  { activa: true, tipo: "telefono", variantes: ["573054021111"] },
);
probar(
  "0 de marcado local: también se prueba sin el 0",
  resumen("0985 123456"),
  { activa: true, tipo: "telefono", variantes: ["0985123456", "985123456"] },
);
probar(
  "00 de marcado internacional: también se prueba sin los ceros",
  resumen("00573054021111"),
  { activa: true, tipo: "telefono", variantes: ["00573054021111", "573054021111"] },
);
probar("«05»: muy corto para quitarle el 0", resumen("05"), { activa: true, tipo: "telefono", variantes: ["05"] });
probar("«0305» también prueba «305»", resumen("0305"), { activa: true, tipo: "telefono", variantes: ["0305", "305"] });
probar("solo ceros", resumen("000"), { activa: true, tipo: "telefono", variantes: ["000"] });
probar("un nombre no se busca como teléfono", resumen("María López"), { activa: true, tipo: "texto", variantes: [] });
probar("nombre con un dígito suelto: no se busca como teléfono", resumen("marta 2"), { activa: true, tipo: "texto", variantes: [] });
probar(
  "texto con un número completo: también se busca el teléfono",
  resumen("Tel: 305 402 1111"),
  { activa: true, tipo: "texto", variantes: ["3054021111"] },
);
probar(
  "enlace de WhatsApp pegado",
  resumen("https://wa.me/573054021111"),
  { activa: true, tipo: "texto", variantes: ["573054021111"] },
);
probar("texto y palabras normalizados", (() => {
  const c = analizarConsulta("  MARÍA   López ");
  return [c.texto, c.palabras, c.digitos];
})(), ["maria lopez", ["maria", "lopez"], ""]);

// ───────────────────────── Teléfono ─────────────────────────
console.log("\n— Coincidencia por teléfono —");
const tel = (guardados, escrito) => puntajeTelefono(guardados, analizarConsulta(escrito));
const COL = ["573054021111"];
probar("número completo con indicativo", tel(COL, "573054021111"), 0);
probar("número completo con + y espacios", tel(COL, "+57 305 402 1111"), 0);
probar("número local sin indicativo = el mismo número", tel(COL, "305 402 1111"), 0);
probar("últimos 7 dígitos = el mismo número", tel(COL, "4021111"), 0);
probar("últimos 6 dígitos: coincide, pero como parte del número", tel(COL, "021111"), 7);
probar("primeros dígitos (posición 0)", tel(COL, "5730"), 1);
probar("dígitos en medio (posición 2)", tel(COL, "305"), 3);
probar("dígitos que no están", tel(COL, "999"), null);
probar("Paraguay con 0 local: 0985… encuentra +595 985…", tel(["595985123456"], "0985 123456"), 0);
probar("con 00 internacional", tel(COL, "0057 305 402 1111"), 0);
probar("escrito con indicativo y guardado sin él", tel(["3105556677"], "+57 310 555 6677"), 1);
probar("guardado demasiado corto para compararlo al revés", tel(["5556677"], "573105556677"), null);
probar("varios teléfonos: gana la mejor coincidencia", tel(["0985123456", "595985123456"], "595985"), 1);
probar("un nombre no se compara con el teléfono", tel(COL, "maría"), null);
probar("sin teléfonos", tel([], "305"), null);

// ───────────────────────── Nombre ─────────────────────────
console.log("\n— Coincidencia por nombre —");
const nom = (nombre, escrito) => puntajeNombre(normalizarTexto(nombre), analizarConsulta(escrito));
probar("nombre igual (sin tildes ni mayúsculas)", nom("María López", "maria lopez"), 0);
probar("escrito con tildes, guardado sin ellas", nom("Maria Lopez", "MARÍA LÓPEZ"), 0);
probar("empieza por lo escrito", nom("María López", "mar"), 1);
probar("apellido: inicio de una palabra", nom("María López", "lopez"), 2);
probar("palabras en otro orden", nom("María López", "lop mar"), 2);
probar("letras en medio del nombre", nom("María López", "ari"), 3);
probar("trozo seguido que cruza dos palabras", nom("María López", "ría lóp"), 3);
probar("trozos sueltos y desordenados: no coincide", nom("María López", "lop ari"), null);
probar("«paciente 0» no trae a «Paciente 10»", [nom("Paciente 01", "paciente 0"), nom("Paciente 10", "paciente 0")], [1, null]);
probar("una palabra que no está: no coincide", nom("María López", "maria gomez"), null);
probar("sin nombre no hay coincidencia", nom("", "maria"), null);
probar("nombre con número", nom("Cliente 15", "15"), 2);

// ───────────────────────── Contacto ─────────────────────────
console.log("\n— Coincidencia de un contacto —");
probar(
  "el nombre de WhatsApp nunca se busca",
  coincidenciaContacto("pedro", { nombre: "Pedro Paraguay", nombre_manual: null, telefono: "+595985123456" }),
  null,
);
probar(
  "«Sin nombre» guardado no se puede buscar",
  coincidenciaContacto("sin nombre", { nombre_manual: "Sin nombre", telefono: "+595985123456" }),
  null,
);
probar(
  "contacto sin nombre ni teléfono: se ve «Sin número» y así se encuentra",
  coincidenciaContacto("sin número", { nombre_manual: null, telefono: null }),
  { puntaje: 0, por: "nombre" },
);
probar(
  "con teléfono ya no se llama «Sin número»",
  coincidenciaContacto("sin", { nombre_manual: null, telefono: "+573054021111" }),
  null,
);
probar(
  "gana el nombre si coincide mejor que el teléfono",
  coincidenciaContacto("15", { nombre_manual: "Cliente 15", telefono: "+573001500000" }),
  { puntaje: 2, por: "nombre" },
);
probar(
  "gana el teléfono si es el número exacto",
  coincidenciaContacto("300 150 0000", { nombre_manual: "Cliente 15", telefono: "+573001500000" }),
  { puntaje: 0, por: "telefono" },
);
probar(
  "el número de la conversación también cuenta",
  coincidenciaContacto("3001112233", null, { numero_whatsapp: "573001112233" }),
  { puntaje: 0, por: "telefono" },
);
probar(
  "dígito suelto junto a un nombre: no arrastra todos los teléfonos con ese dígito",
  coincidenciaContacto("marta 2", { nombre_manual: "Marta Ruiz", telefono: "+573054022222" }),
  null,
);
probar("sin nada escrito no coincide nadie", coincidenciaContacto("+", { nombre_manual: "Ana", telefono: "+57300" }), null);
probar(
  "acepta la consulta ya analizada",
  coincidenciaContacto(analizarConsulta("ana"), { nombre_manual: "Ana" }),
  { puntaje: 0, por: "nombre" },
);

// ───────────────────────── Ubicación ─────────────────────────
console.log("\n— Dónde está un chat —");
probar("chat normal", ubicacionDeConversacion({ archivada: false, clientes: { es_spam: false } }), "activo");
probar("chat archivado", ubicacionDeConversacion({ archivada: true, clientes: {} }), "archivado");
probar("chat de spam", ubicacionDeConversacion({ clientes: { es_spam: true } }), "spam");
probar("spam archivado: se ve en Spam", ubicacionDeConversacion({ archivada: true, clientes: { es_spam: true } }), "spam");
probar("conversación sin cliente", ubicacionDeConversacion({ clientes: null }), "activo");

// ───────────────────────── Búsqueda en todo el CRM ─────────────────────────
console.log("\n— Búsqueda en todo el CRM —");

function chat(id, cliente, extra = {}) {
  return {
    id,
    cliente_id: cliente ? cliente.id : null,
    clientes: cliente,
    archivada: false,
    ultimo_mensaje: "Hola",
    ultimo_mensaje_en: "2026-11-01T10:00:00.000Z",
    ...extra,
  };
}

// Cada contacto vive en un lugar distinto del CRM.
const maria = { id: "k1", nombre: "Mary WA", nombre_manual: "María López", telefono: "+573054021111", telefono_display: "+57 305 402 1111", estado: "nuevo_lead" };
const paraguay = { id: "k2", nombre: "Pedro Paraguay", nombre_manual: null, telefono: "+595985123456", estado: "en_consulta" };
const mario = { id: "k3", nombre_manual: "Mario Gómez", telefono: "+573119998877", estado: "trabajo_proceso" };
const promo = { id: "k4", nombre_manual: "Promo Spam", telefono: "+12025550147", estado: "nuevo_lead", es_spam: true };
const porRevisar = { id: "k5", nombre_manual: null, telefono: "revisar_8842", estado: "nuevo_lead" };
const marta = { id: "k6", nombre_manual: "Marta Ruiz", telefono: "+573054022222", estado: "trabajo_completado" };
const otroSpam = { id: "k7", nombre_manual: "Otro Spam", telefono: "+573000000001", estado: "nuevo_lead", es_spam: true };
const sinIndicativo = { id: "k8", nombre_manual: null, telefono: "3105556677", estado: "datos" };
const sinChat = { id: "k9", nombre_manual: "María Cartera", telefono: "+573201112233", estado: "trabajo_proceso" };

const conversaciones = [
  chat("c1", maria, { ultimo_mensaje_en: "2026-11-10T10:00:00.000Z" }),
  chat("c2", paraguay, { ultimo_mensaje_en: "2026-11-09T10:00:00.000Z" }),
  chat("c3", mario, { archivada: true, ultimo_mensaje: "Gracias, la consulta fue muy buena", ultimo_mensaje_en: "2026-10-01T10:00:00.000Z" }),
  chat("c4", promo, { ultimo_mensaje_en: "2026-11-08T10:00:00.000Z" }),
  chat("c5", porRevisar, { ultimo_mensaje_en: "2026-11-07T10:00:00.000Z" }),
  chat("c6", marta, { ultimo_mensaje_en: "2026-11-06T10:00:00.000Z" }),
  chat("c7", otroSpam, { archivada: true, ultimo_mensaje: "Oferta de consulta gratis", ultimo_mensaje_en: "2026-09-01T10:00:00.000Z" }),
  chat("c8", sinIndicativo, { ultimo_mensaje_en: "2026-11-05T10:00:00.000Z" }),
  chat("c9", null, { numero_whatsapp: "573001112233", ultimo_mensaje_en: "2026-11-04T10:00:00.000Z" }),
];
const clientes = [maria, paraguay, mario, promo, porRevisar, marta, otroSpam, sinIndicativo, sinChat];

const buscar = (consulta, extra = {}) => buscarEnCrm({ consulta, conversaciones, clientes, ...extra });
// Identificador corto de cada resultado: id del chat o «cliente:<id>» si no tiene chat.
const ids = (resultados) => resultados.map((r) => (r.conv ? r.conv.id : `cliente:${r.cliente.id}`));
const ubicaciones = (resultados) => resultados.map((r) => r.ubicacion);

probar("sin nada escrito no hay resultados", [ids(buscar("")), ids(buscar("   ")), ids(buscar("+"))], [[], [], []]);
probar("número local (sin indicativo) de un chat en Nuevo Lead", ids(buscar("305 402 1111")), ["c1"]);
probar("número de un chat que está en OTRA etapa (En Consulta)", ids(buscar("0985 123456")), ["c2"]);
probar("contacto de la etapa Trabajo Completado, por apellido y nombre", ids(buscar("ruiz marta")), ["c6"]);
probar("chat ARCHIVADO, por nombre", [ids(buscar("gomez")), ubicaciones(buscar("gomez"))], [["c3"], ["archivado"]]);
probar("chat de SPAM, por número", [ids(buscar("202 555 0147")), ubicaciones(buscar("202 555 0147"))], [["c4"], ["spam"]]);
probar("spam archivado: se ubica en Spam", ubicaciones(buscar("otro spam")), ["spam"]);
probar("cliente SIN chat en la bandeja", [ids(buscar("320 111 2233")), ubicaciones(buscar("320 111 2233"))], [["cliente:k9"], ["sin_chat"]]);
probar("un cliente con chat no sale repetido como ficha", ids(buscar("lopez")), ["c1"]);
probar("conversación sin cliente: se encuentra por su número de WhatsApp", ids(buscar("3001112233")), ["c9"]);
probar("número guardado sin indicativo, escrito con él", ids(buscar("+57 310 555 6677")), ["c8"]);
probar("marcador «revisar_8842»: por los dígitos que muestra la pantalla", ids(buscar("8842")), ["c5"]);
probar("enlace wa.me pegado", ids(buscar("https://wa.me/573054021111")), ["c1"]);
probar("mayúsculas y tildes dan igual", ids(buscar("LÓPEZ")), ["c1"]);
probar("el nombre de WhatsApp (Pedro) no se busca", ids(buscar("pedro")), []);
probar("«marta 2» ya no trae todos los teléfonos que tengan un 2", ids(buscar("marta 2")), []);
probar("lo que no existe en el CRM no devuelve nada", ids(buscar("zzzz")), []);

probar(
  "varios números parecidos: primero el chat con actividad más reciente",
  ids(buscar("+57 305 402")),
  ["c1", "c6"],
);
probar(
  "orden por ubicación: activos (recientes primero), archivados, fichas sin chat",
  [ids(buscar("mar")), ubicaciones(buscar("mar"))],
  [["c1", "c6", "c3", "cliente:k9"], ["activo", "activo", "archivado", "sin_chat"]],
);
probar("los de spam, por actividad", ids(buscar("spam")), ["c4", "c7"]);
probar(
  "la mejor coincidencia va primero aunque sea más antigua",
  ids(buscarEnCrm({
    consulta: "ana",
    conversaciones: [
      chat("nueva", { id: "a1", nombre_manual: "Mariana Paz", telefono: "+573000000011" }, { ultimo_mensaje_en: "2026-11-10T10:00:00.000Z" }),
      chat("vieja", { id: "a2", nombre_manual: "Ana", telefono: "+573000000012" }, { ultimo_mensaje_en: "2026-01-01T10:00:00.000Z" }),
      chat("media", { id: "a3", nombre_manual: "Ana María", telefono: "+573000000013" }, { ultimo_mensaje_en: "2026-06-01T10:00:00.000Z" }),
    ],
  })),
  ["vieja", "media", "nueva"],
);

probar("el último mensaje NO se busca fuera de Archivados", ids(buscar("consulta")), []);
probar(
  "en Archivados se conserva la búsqueda por último mensaje (sin el spam)",
  buscar("consulta", { mensajeEnArchivados: true }).map((r) => [r.conv.id, r.por]),
  [["c3", "mensaje"]],
);
probar(
  "en Archivados, primero quien coincide por nombre y al final por mensaje",
  ids(buscarEnCrm({
    consulta: "gracias",
    mensajeEnArchivados: true,
    conversaciones: [
      chat("por-mensaje", { id: "g1", nombre_manual: "Luz", telefono: "+573000000021" }, { archivada: true, ultimo_mensaje: "Muchas gracias", ultimo_mensaje_en: "2026-11-10T10:00:00.000Z" }),
      chat("por-nombre", { id: "g2", nombre_manual: "Gracias Pérez", telefono: "+573000000022" }, { ultimo_mensaje_en: "2026-01-01T10:00:00.000Z" }),
    ],
  })),
  ["por-nombre", "por-mensaje"],
);

probar(
  "cada resultado dice por qué coincidió",
  buscar("mar").map((r) => [r.tipo, r.por, r.puntaje]),
  [["chat", "nombre", 1], ["chat", "nombre", 1], ["chat", "nombre", 1], ["cliente", "nombre", 1]],
);
probar("acepta la consulta ya analizada", ids(buscarEnCrm({ consulta: analizarConsulta("gomez"), conversaciones, clientes })), ["c3"]);
probar("listas vacías o nulas no rompen", [
  buscarEnCrm({ consulta: "ana", conversaciones: null }),
  buscarEnCrm({ consulta: "ana", conversaciones: [], clientes: null }),
  buscarEnCrm({ consulta: "ana", conversaciones: [null, undefined], clientes: [null, {}] }),
], [[], [], []]);
probar("no modifica las listas que recibe", (() => {
  const antes = JSON.stringify([conversaciones, clientes]);
  buscar("mar");
  buscar("305");
  return JSON.stringify([conversaciones, clientes]) === antes;
})(), true);

// Rendimiento: se ejecuta en cada tecla, así que debe ser inmediato con miles de chats.
const muchos = Array.from({ length: 5000 }, (_, i) => {
  const cliente = { id: `m${i}`, nombre_manual: i % 3 === 0 ? `Cliente Número ${i}` : null, telefono: `+57300${String(1000000 + i)}` };
  return chat(`mc${i}`, cliente, { archivada: i % 4 === 0 });
});
const inicio = performance.now();
const encontrados = buscarEnCrm({ consulta: "3001004999", conversaciones: muchos, clientes: muchos.map((c) => c.clientes) });
const milisegundos = performance.now() - inicio;
probar("entre 5.000 chats encuentra el número exacto", ids(encontrados), ["mc4999"]);
console.log(`  (5.000 chats + 5.000 clientes revisados en ${milisegundos.toFixed(1)} ms)`);

console.log(`\n${pruebas - fallos}/${pruebas} pruebas correctas`);
if (fallos > 0) {
  console.log(`❌ ${fallos} prueba(s) con fallos\n`);
  process.exit(1);
}
console.log("✅ Buscador global verificado: encuentra el número o el nombre en todo el CRM\n");
