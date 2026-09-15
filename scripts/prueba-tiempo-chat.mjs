#!/usr/bin/env node
/**
 * Pruebas de src/lib/tiempo-chat.ts
 *
 *   · Ventana de 24 h de WhatsApp API (Meta): se cuenta desde el último
 *     mensaje del CLIENTE y avisa cuando está por cerrarse o ya cerró.
 *   · Marcas de fecha del historial: "Hoy", "Ayer", "Lunes", "15 de septiembre".
 *   · Traspaso a la etapa Vencidos: se mueven solo los chats del WhatsApp API
 *     con la ventana cerrada, y regresan a su etapa si el cliente escribe otra
 *     vez por el API.
 *
 * Uso:  npm run test:tiempo
 *
 * El archivo es TypeScript, así que se transpila al vuelo con la versión de
 * `typescript` del proyecto (no hace falta compilar).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origen = path.join(raiz, "src", "lib", "tiempo-chat.ts");
const js = ts.transpileModule(fs.readFileSync(origen, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const {
  VENTANA_WHATSAPP_MS,
  calcularVentana,
  claveDia,
  decidirTraspasoVencidos,
  duracionCorta,
  esChatWhatsAppApi,
  esClaveVencidos,
  etiquetaDia,
  fechaCompletaDia,
  horaCorta,
  tieneChatApi,
  ultimoEntranteApiDeConversacion,
  ultimoEntranteDeMensajes,
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

const HORA = 60 * 60 * 1000;
const DIA = VENTANA_WHATSAPP_MS;
const ahora = Date.parse("2026-09-15T14:30:00.000Z");
const fechaDentro = (ms) => new Date(ahora - ms).toISOString();

// ---------------------------------------------------------------------------
// 1. Duración legible
// ---------------------------------------------------------------------------
console.log("\n— Duraciones —");
probar("30 s", duracionCorta(30_000), "menos de 1 min");
probar("45 min", duracionCorta(45 * 60_000), "45 min");
probar("3 h 12 min", duracionCorta(3 * HORA + 12 * 60_000), "3 h 12 min");
probar("2 h exactas", duracionCorta(2 * HORA), "2 h");
probar("1 día 2 h", duracionCorta(DIA + 2 * HORA), "1 día 2 h");
probar("3 días", duracionCorta(3 * DIA), "3 días");
probar("negativo → 0", duracionCorta(-5), "menos de 1 min");

// ---------------------------------------------------------------------------
// 2. Ventana de 24 h desde el último mensaje del cliente
// ---------------------------------------------------------------------------
console.log("\n— Ventana de 24 h —");
probar("sin mensajes del cliente", calcularVentana(null, ahora).hayDato, false);
probar("sin mensajes: no muestra nada", calcularVentana(undefined, ahora).abierta, false);

const holgada = calcularVentana(fechaDentro(1 * HORA), ahora);
probar("hace 1 h → quedan 23 h", holgada.corto, "23 h");
probar("hace 1 h → verde", holgada.tono, "ok");
probar("hace 1 h → abierta", holgada.abierta, true);

const atencion = calcularVentana(fechaDentro(20 * HORA), ahora);
probar("hace 20 h → quedan 4 h", atencion.corto, "4 h");
probar("hace 20 h → ámbar", atencion.tono, "atencion");
probar("hace 20 h → explica el cierre", atencion.detalle.includes("plantillas aprobadas"), true);

const urgente = calcularVentana(fechaDentro(23.5 * HORA), ahora);
probar("hace 23 h 30 min → 30 min", urgente.corto, "30 min");
probar("hace 23 h 30 min → rojo/naranja", urgente.tono, "urgente");

const cerrada = calcularVentana(fechaDentro(27 * HORA), ahora);
probar("hace 27 h → cerrada hace 3 h", cerrada.corto, "cerrada hace 3 h");
probar("hace 27 h → texto de cabecera", cerrada.largo, "Ventana cerrada hace 3 h");
probar("hace 27 h → tono cerrada", cerrada.tono, "cerrada");
probar("hace 27 h → no queda nada", cerrada.restanteMs, 0);

// ---------------------------------------------------------------------------
// 3. Último mensaje entrante (lo que envió el cliente)
// ---------------------------------------------------------------------------
console.log("\n— Último mensaje del cliente —");
const mensajes = [
  { tipo: "recibido", creado_en: "2026-09-15T10:00:00.000Z" },
  { tipo: "enviado", creado_en: "2026-09-15T12:00:00.000Z" }, // respuesta nuestra: NO cuenta
  { tipo: "recibido", creado_en: "2026-09-15T11:30:00.000Z" },
];
probar("ignora los enviados", ultimoEntranteDeMensajes(mensajes), "2026-09-15T11:30:00.000Z");
probar("lista vacía → null", ultimoEntranteDeMensajes([]), null);
probar("solo enviados → null", ultimoEntranteDeMensajes([{ tipo: "enviado", creado_en: "2026-09-15T12:00:00.000Z" }]), null);

// ---------------------------------------------------------------------------
// 4. Chats del WhatsApp API vs WhatsApp Personal
// ---------------------------------------------------------------------------
console.log("\n— Canal —");
probar("fuente meta_business", esChatWhatsAppApi({ fuente: "meta_business" }), true);
probar("fuente evolution (Personal)", esChatWhatsAppApi({ fuente: "evolution" }), false);
probar("sin conversación", esChatWhatsAppApi(null), false);

// ---------------------------------------------------------------------------
// 5. Divisores de fecha del historial
// ---------------------------------------------------------------------------
console.log("\n— Marcas de fecha —");
// Las marcas de fecha se calculan en la hora LOCAL del teléfono (que es la del
// operador), así que las pruebas se construyen también con la hora local.
const ref = new Date(2026, 8, 15, 14, 30); // 15 sep 2026, 14:30 local
const hoyTemprano = new Date(2026, 8, 15, 9, 0);
const ayerNoche = new Date(2026, 8, 14, 20, 0);
const hace3Dias = new Date(2026, 8, 12, 10, 0);
const mismoAnio = new Date(2026, 6, 17, 10, 0);
const anioPasado = new Date(2025, 11, 20, 10, 0);

probar("mismo día", etiquetaDia(hoyTemprano.toISOString(), ref), "Hoy");
probar("día anterior", etiquetaDia(ayerNoche.toISOString(), ref), "Ayer");
probar(
  "hace 3 días → día de la semana",
  etiquetaDia(hace3Dias.toISOString(), ref),
  capitalizar(new Intl.DateTimeFormat("es-CO", { weekday: "long" }).format(hace3Dias)),
);
probar("mismo año → día y mes", etiquetaDia(mismoAnio.toISOString(), ref), "17 de julio");
probar("otro año → con año", etiquetaDia(anioPasado.toISOString(), ref), "20 de diciembre de 2025");
probar("fecha sin hora (YYYY-MM-DD)", etiquetaDia("2026-09-15", ref), "Hoy");
probar("fecha inválida → vacío", etiquetaDia("no-es-fecha", ref), "");

probar(
  "clave de día: misma fecha con horas distintas",
  claveDia(new Date(2026, 8, 15, 1, 0).toISOString()) === claveDia(new Date(2026, 8, 15, 23, 0).toISOString()),
  true,
);
probar(
  "clave de día: cambia al pasar la medianoche",
  claveDia(new Date(2026, 8, 15, 23, 0).toISOString()) === claveDia(new Date(2026, 8, 16, 0, 30).toISOString()),
  false,
);

probar("fecha larga para el tooltip", fechaCompletaDia(anioPasado.toISOString()), "sábado, 20 de diciembre de 2025");
probar("hora corta", horaCorta(new Date(2026, 8, 15, 14, 5).toISOString()), "14:05");

// ---------------------------------------------------------------------------
// 6. Coherencia del cálculo (mismo resultado con la marca de la BD que con los mensajes)
// ---------------------------------------------------------------------------
console.log("\n— Coherencia DB ↔ mensajes —");
const marca = ultimoEntranteDeMensajes(mensajes);
probar(
  "ultimo_entrante_en y último mensaje del cliente dan la misma ventana",
  calcularVentana(marca, ahora).corto,
  calcularVentana("2026-09-15T11:30:00.000Z", ahora).corto,
);

// ---------------------------------------------------------------------------
// 7. Traspaso a la etapa Vencidos (WhatsApp API → WhatsApp Personal)
// ---------------------------------------------------------------------------
console.log("\n— Vencidos —");
const etapaApi = { clave: "nuevo_lead", cuenta_responsable: "meta_business" };
const etapaPersonal = { clave: "trabajo_proceso", cuenta_responsable: "evolution" };
const etapaVencidos = { clave: "vencidos", cuenta_responsable: "evolution" };
const decidir = (extra) =>
  decidirTraspasoVencidos({ ahoraMs: ahora, ...extra });

probar(
  "etapa del API + ventana vencida → mover",
  decidir({ etapaActual: etapaApi, ultimoEntranteApi: fechaDentro(30 * HORA) }),
  "mover",
);
probar(
  "etapa del API + ventana abierta → no se toca",
  decidir({ etapaActual: etapaApi, ultimoEntranteApi: fechaDentro(2 * HORA) }),
  "nada",
);
probar(
  "etapa del API + justo al vencer (24 h) → mover (sin margen)",
  decidir({ etapaActual: etapaApi, ultimoEntranteApi: fechaDentro(DIA + 60_000) }),
  "mover",
);
probar(
  "etapa del API pero el cliente nunca escribió por el API → no se toca",
  decidir({ etapaActual: etapaApi, ultimoEntranteApi: null }),
  "nada",
);
probar(
  "etapa ya del WhatsApp Personal → nunca se mueve a Vencidos",
  decidir({ etapaActual: etapaPersonal, ultimoEntranteApi: fechaDentro(40 * HORA) }),
  "nada",
);
probar(
  "ya está en Vencidos → no se vuelve a mover (sin mensaje nuevo)",
  decidir({ etapaActual: etapaVencidos, ultimoEntranteApi: fechaDentro(30 * HORA), estadoAntesVencido: "nuevo_lead" }),
  "nada",
);
probar(
  "en Vencidos y el cliente escribe otra vez por el API → volver a su etapa",
  decidir({ etapaActual: etapaVencidos, ultimoEntranteApi: fechaDentro(1 * HORA), estadoAntesVencido: "datos" }),
  "volver",
);
probar(
  "en Vencidos con la marca aproximada (falta la migración 20260918) → no regresa",
  decidir({ etapaActual: etapaVencidos, ultimoEntranteApi: fechaDentro(1 * HORA), estadoAntesVencido: "nuevo_lead", apiExacto: false }),
  "nada",
);
probar(
  "en Vencidos sin memoria de la etapa anterior → no se toca",
  decidir({ etapaActual: etapaVencidos, ultimoEntranteApi: fechaDentro(1 * HORA), estadoAntesVencido: null }),
  "nada",
);
probar(
  "sin etapa (estado desconocido) → no se toca",
  decidir({ etapaActual: null, ultimoEntranteApi: fechaDentro(30 * HORA) }),
  "nada",
);
probar(
  "una etapa sin cuenta asignada no se considera del API",
  decidir({ etapaActual: { clave: "etapa_x", cuenta_responsable: null }, ultimoEntranteApi: fechaDentro(30 * HORA) }),
  "nada",
);

console.log("\n— Detección de la etapa y del canal —");
probar("clave vencidos", esClaveVencidos("vencidos"), true);
probar("clave VENCIDOS", esClaveVencidos("VENCIDOS"), true);
probar("nombre 'Vencido' (singular) o con acentos", esClaveVencidos(" Vencído "), true);
probar("otra etapa", esClaveVencidos("trabajo_proceso"), false);

probar(
  "chat del API (fuente meta_business) → tiene ventana",
  tieneChatApi({ fuente: "meta_business" }),
  true,
);
probar(
  "chat unificado con Personal pero con conversación del API → tiene ventana",
  tieneChatApi({ fuente: "evolution", chatwoot_conversation_ids: ["1", "2"] }),
  true,
);
probar(
  "chat solo de WhatsApp Personal → sin ventana",
  tieneChatApi({ fuente: "evolution", chatwoot_conversation_ids: ["1"] }),
  false,
);
probar(
  "la marca del API manda sobre la genérica",
  ultimoEntranteApiDeConversacion({
    fuente: "evolution",
    ultimo_entrante_en: "2026-09-15T10:00:00.000Z",
    ultimo_entrante_api_en: "2026-09-14T08:00:00.000Z",
  }),
  "2026-09-14T08:00:00.000Z",
);
probar(
  "chat del API sin columna nueva: usa la marca genérica",
  ultimoEntranteApiDeConversacion({ fuente: "meta_business", ultimo_entrante_en: "2026-09-15T10:00:00.000Z" }),
  "2026-09-15T10:00:00.000Z",
);
probar(
  "chat solo Personal: sin marca del API",
  ultimoEntranteApiDeConversacion({ fuente: "evolution", chatwoot_conversation_ids: ["1"], ultimo_entrante_en: "2026-09-15T10:00:00.000Z" }),
  null,
);

function capitalizar(texto) {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

console.log(`\n${pruebas - fallos}/${pruebas} pruebas correctas`);
if (fallos > 0) {
  console.log(`❌ ${fallos} prueba(s) con fallos\n`);
  process.exit(1);
}
console.log("✅ Ventana de 24 h, marcas de fecha y traspaso a Vencidos verificados\n");
