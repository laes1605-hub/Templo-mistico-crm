/**
 * Prueba del flujo WEB de «Guardar en teléfono» (src/lib/contacts.ts).
 *
 * Simula el navegador de un teléfono con jsdom (sin puente nativo de
 * Capacitor), así que el módulo toma el camino web: entrega la ficha .vcf a
 * la hoja de compartir del sistema (Chrome Android) para que Contactos cree
 * el contacto directamente, y sólo descarga el archivo cuando el navegador
 * no puede compartir archivos (p. ej. Safari de iPhone).
 *
 * Se corre con: npm run test:contactos-web
 */
/* eslint-disable @typescript-eslint/no-var-requires */

import { JSDOM } from "jsdom";

// El entorno web falso debe existir ANTES de importar el módulo de contactos.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://templo-mistico-crm.vercel.app/",
});
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.localStorage = dom.window.localStorage;

// Rastreo de descargas: jsdom no implementa createObjectURL y los anchors de
// descarga no navegan, así que se espían ambas cosas.
let descargasCreadas = 0;
g.URL.createObjectURL = () => {
  descargasCreadas += 1;
  return "blob:descarga-falsa";
};
g.URL.revokeObjectURL = () => {};
let clicksDeDescarga = 0;
dom.window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  if (this.download) clicksDeDescarga += 1;
};

// Hoja de compartir del navegador (Web Share API con archivos).
interface Compartido {
  files: File[];
  title?: string;
}
let compartidos: Compartido[] = [];
let fallarShare: "ninguno" | "abort" = "ninguno";
const nav = (typeof navigator !== "undefined" ? navigator : dom.window.navigator) as any;
const puedeCompartirArchivos = (datos: { files?: File[] }) => Array.isArray(datos?.files) && datos.files.length > 0;
Object.defineProperty(nav, "canShare", { value: puedeCompartirArchivos, configurable: true, writable: true });
Object.defineProperty(nav, "share", {
  value: async (datos: Compartido) => {
    if (fallarShare === "abort") {
      throw Object.assign(new Error("Share canceled"), { name: "AbortError" });
    }
    compartidos.push(datos);
  },
  configurable: true,
  writable: true,
});

const { guardarContactoEnTelefono } = require("../src/lib/contacts.ts");

// ------------------------------------------------------------------ aserciones
let fallos = 0;
function ok(condicion: boolean, mensaje: string) {
  if (condicion) console.log("  ✅ " + mensaje);
  else {
    fallos += 1;
    console.log("  ❌ " + mensaje);
  }
}

async function main() {
  console.log("Guardar contacto desde el NAVEGADOR del teléfono (flujo web)\n");

  // 1) Chrome Android: hay hoja de compartir con archivos → se entrega la
  //    ficha .vcf al sistema para que Contactos cree el contacto. No se
  //    descarga nada.
  console.log("· Chrome Android (hoja de compartir con archivos) → entrega la ficha a Contactos, sin descargar");
  let r = await guardarContactoEnTelefono("Marta López", "+56911111111");
  ok(r.native === false, "no es guardado nativo (native=false)");
  ok(r.metodo === "compartir_web", `el método es la hoja de compartir web (${r.metodo})`);
  ok(compartidos.length === 1, "se llamó a navigator.share una vez");
  ok(clicksDeDescarga === 0 && descargasCreadas === 0, "NO se descargó ningún archivo .vcf");
  const archivo = compartidos[0]?.files?.[0];
  ok(!!archivo && archivo.name === "Marta_Lopez.vcf", `el archivo entregado es «${archivo?.name}»`);
  ok(archivo?.type === "text/vcard", `el archivo es text/vcard (${archivo?.type})`);
  const vcf = archivo ? await archivo.text() : "";
  ok(
    vcf.includes("BEGIN:VCARD") &&
      vcf.includes("FN:Marta López") &&
      vcf.includes("TEL;TYPE=CELL,VOICE:+56911111111") &&
      vcf.includes("END:VCARD"),
    "la ficha vCard lleva el nombre y el teléfono del cliente"
  );
  ok(r.nombreGuardado === "Marta López" && r.verificadoEnAgenda === false, "informa el nombre y que no pudo verificar la agenda (web)");

  // 2) El usuario cierra la hoja de compartir → se marca como cancelado, sin
  //    error ni descarga.
  console.log("\n· El usuario cierra la hoja de compartir → se marca como cancelado");
  compartidos = [];
  fallarShare = "abort";
  r = await guardarContactoEnTelefono("Marta López", "+56922222222");
  ok(r.metodo === "compartir_web" && r.cancelado === true, `se marca cancelado (metodo=${r.metodo}, cancelado=${r.cancelado})`);
  ok(clicksDeDescarga === 0 && descargasCreadas === 0, "tampoco se descarga nada al cancelar");
  fallarShare = "ninguno";

  // 3) Navegador sin hoja de compartir con archivos (Safari iPhone) → último
  //    respaldo: descarga el .vcf para abrirlo en Contactos.
  console.log("\n· Navegador sin hoja de compartir con archivos (Safari iPhone) → descarga el .vcf como respaldo");
  Object.defineProperty(nav, "canShare", { value: undefined, configurable: true, writable: true });
  const descargasAntes = clicksDeDescarga;
  r = await guardarContactoEnTelefono("Marta López", "+56933333333");
  ok(r.metodo === "descarga", `el método es la descarga de respaldo (${r.metodo})`);
  ok(r.fileName === "Marta_Lopez.vcf", `se descarga «${r.fileName}»`);
  ok(clicksDeDescarga === descargasAntes + 1, "se ejecutó la descarga del archivo una vez");
  Object.defineProperty(nav, "canShare", { value: puedeCompartirArchivos, configurable: true, writable: true });

  // 4) Sin teléfono válido → error claro (igual que en la APK).
  console.log("\n· Sin número de teléfono → error claro");
  let error4: any = null;
  try { await guardarContactoEnTelefono("Marta López", "   "); } catch (e) { error4 = e; }
  ok(error4 !== null && /teléfono válido/.test(String(error4?.message)), "pide un número de teléfono válido");

  console.log("\n" + (fallos === 0 ? "✅ TODO OK" : `❌ ${fallos} comprobaciones fallaron`));
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("💥 La prueba lanzó un error:", error);
  process.exit(1);
});
