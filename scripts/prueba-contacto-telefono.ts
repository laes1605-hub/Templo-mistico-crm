/**
 * Prueba del flujo «Guardar en teléfono» (src/lib/contacts.ts).
 *
 * Simula el puente nativo de Capacitor (la agenda Android) para ejecutar el
 * código REAL del repo sin un teléfono: los métodos de los plugins Contacts y
 * ContactSaver se resuelven contra una agenda falsa en memoria.
 *
 * Se corre con: npm run test:contactos
 */
/* eslint-disable @typescript-eslint/no-var-requires */

// El módulo de contactos decide el camino (nativo vs web) al importarse, así
// que el puente falso debe existir ANTES de requerirlo.
(globalThis as any).androidBridge = {}; // → Capacitor.getPlatform() = "android"

const { Capacitor } = require("@capacitor/core");

// ---------------------------------------------------------------- agenda falsa
interface ContactoAgenda {
  id: string;
  dado: string;
  familia: string;
  telefono: string;
}

let agenda: ContactoAgenda[] = [];
let proximoId = 1;
let permiso: string = "granted";
let errorDeContactSaver: Error | null = null;
let huboArchivo = false;

function nombreVisible(c: ContactoAgenda): string {
  return [c.dado, c.familia].filter(Boolean).join(" ");
}

function crearAgendaInicial(nombres: string[], telefonos?: string[]) {
  agenda = nombres.map((nombre, i) => {
    const palabras = nombre.trim().split(/\s+/).filter(Boolean);
    return {
      id: String(proximoId++),
      dado: palabras[0] || "",
      familia: palabras.slice(1).join(" "),
      telefono: telefonos?.[i] || `+5690000000${i}`,
    };
  });
}

// Todas las llamadas nativas (Contacts.* y ContactSaver.createContact) pasan
// por nativePromise cuando no hay puente Android real. Los PluginHeaders son
// lo que la APK inyecta de verdad: sin ellos Capacitor ni siquiera intenta
// llamar a nativo y lanza «plugin is not implemented».
(Capacitor as any).PluginHeaders = [
  {
    name: "Contacts",
    methods: [
      { name: "checkPermissions", rtype: "promise" },
      { name: "requestPermissions", rtype: "promise" },
      { name: "getContacts", rtype: "promise" },
      { name: "createContact", rtype: "promise" },
    ],
  },
  { name: "ContactSaver", methods: [{ name: "createContact", rtype: "promise" }] },
  { name: "Filesystem", methods: [{ name: "writeFile", rtype: "promise" }] },
  { name: "Share", methods: [{ name: "share", rtype: "promise" }] },
];

(Capacitor as any).nativePromise = async (plugin: string, metodo: string, args: any) => {
  if (plugin === "Contacts") {
    if (metodo === "checkPermissions") return { contacts: permiso };
    if (metodo === "requestPermissions") return { contacts: permiso };
    if (metodo === "getContacts") {
      return {
        contacts: agenda.map((c) => ({
          contactId: c.id,
          name: {
            given: c.dado,
            family: c.familia || undefined,
            display: nombreVisible(c),
          },
          phones: [{ type: "Mobile", number: c.telefono, isPrimary: true }],
        })),
      };
    }
  }
  if (plugin === "ContactSaver" && metodo === "createContact") {
    if (errorDeContactSaver) throw errorDeContactSaver;
    const id = String(proximoId++);
    agenda.push({
      id,
      dado: String(args.givenName || ""),
      familia: String(args.familyName || ""),
      telefono: String(args.phoneNumber || ""),
    });
    return { contactId: id };
  }
  // Respaldo .vcf: escribir el archivo y "compartirlo" con el sistema.
  if (plugin === "Filesystem" && metodo === "writeFile") { huboArchivo = true; return { uri: "file:///tmp/" + args.path }; }
  if (plugin === "Share" && metodo === "share") { huboArchivo = true; return {}; }
  throw new Error(`Puerto falso: ${plugin}.${metodo} no simulado`);
};
// La APK tiene el plugin propio ContactSaver compilado dentro.
(Capacitor as any).isPluginAvailable = (nombre: string) => nombre === "ContactSaver";

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

function nombresAgenda(): string[] {
  return agenda.map(nombreVisible);
}

async function escenario(titulo: string, nombresIniciales: string[], nombreCliente: string, telefono: string, telefonosIniciales?: string[]) {
  console.log("\n· " + titulo);
  crearAgendaInicial(nombresIniciales, telefonosIniciales);
  const resultado = await guardarContactoEnTelefono(nombreCliente, telefono);
  return resultado;
}

async function main() {
  console.log("Guardar contacto directamente en el teléfono (consecutivo por nombre)\n");

  // 1) Sin coincidencias: se guarda con el nombre tal cual.
  let r = await escenario("Agenda sin «Marta López» → se guarda tal cual", ["Pedro Castro"], "Marta López", "+56911111111");
  ok(r.native === true, "guardado directo en la agenda (native=true)");
  ok(r.nombreGuardado === "Marta López" && r.nombreAjustado === false, `nombre sin consecutivo (${r.nombreGuardado})`);
  ok(nombresAgenda().join("|") === "Pedro Castro|Marta López", "la agenda queda con el contacto nuevo");

  // 2) Mismo nombre → «2».
  r = await escenario("Ya existe «Marta López» (otro número) → Marta López 2", ["Marta López"], "Marta López", "+56922222222");
  ok(r.native === true, "guardado directo (native=true)");
  ok(r.nombreGuardado === "Marta López 2" && r.nombreAjustado === true, `nombre ajustado a «${r.nombreGuardado}»`);

  // 3) Ya existen «2» y «3» → «4».
  r = await escenario("Existen «…», «… 2» y «… 3» → el siguiente es «… 4»", ["Marta López", "Marta López 2", "Marta López 3"], "Marta López", "+56933333333");
  ok(r.nombreGuardado === "Marta López 4", `sigue el consecutivo (${r.nombreGuardado})`);

  // 4) Existe el 2 pero no la base: el consecutivo no se reutiliza.
  r = await escenario("Borraron «Ana Rivas» pero sigue «Ana Rivas 2» → «Ana Rivas 3»", ["Ana Rivas 2"], "Ana Rivas", "+56944444444");
  ok(r.nombreGuardado === "Ana Rivas 3", `no reutiliza el 2 (${r.nombreGuardado})`);

  // 5) Mismo nombre con tilde/mayúsculas distintas también cuenta como igual.
  r = await escenario("«MARTA LOPEZ» en la agenda y «Marta López» del CRM → consecutivo", ["MARTA LOPEZ"], "Marta López", "+56955555555");
  ok(r.nombreGuardado === "Marta López 2", `ignora mayúsculas y tildes al comparar (${r.nombreGuardado})`);

  // 6) El mismo cliente dos veces: mismo nombre Y mismo teléfono ya guardado
  //    no debe crear «Marta López 2» repetido (sería la misma persona).
  r = await escenario("Mismo nombre y mismo teléfono que ya está guardado → no duplica", ["Marta López"], "Marta López", "+56966666666", ["+56966666666"]);
  ok(r.yaExistia === true && r.native === true, `detecta que ya estaba guardado (yaExistia=${(r as any).yaExistia})`);
  ok(agenda.length === 1, "la agenda NO queda con un contacto repetido");

  // 7) Permiso de contactos denegado: avisa cómo activarlo, sin exportar archivo.
  agenda = [];
  permiso = "denied";
  errorDeContactSaver = null;
  let error7: any = null;
  try { await guardarContactoEnTelefono("Marta López", "+56977777777"); } catch (e) { error7 = e; }
  ok(error7 !== null && /permiso de Contactos/.test(String(error7?.message)), "sin permiso avisa cómo activar Contactos");
  ok(agenda.length === 0, "sin permiso no crea nada en la agenda");

  // 8) ContactSaver falla: error claro, sin respaldo .vcf.
  permiso = "granted";
  errorDeContactSaver = new Error("CONTACT_SAVE_FAILED");
  crearAgendaInicial(["Pedro Castro"], []);
  let error8: any = null;
  try { await guardarContactoEnTelefono("Marta López", "+56988888888"); } catch (e) { error8 = e; }
  ok(error8 !== null && /No se pudo guardar/.test(String(error8?.message)), "fallo de inserción muestra el motivo");
  ok(!huboArchivo, "no se genera ningún archivo .vcf");

  console.log("\n" + (fallos === 0 ? "✅ TODO OK" : `❌ ${fallos} comprobaciones fallaron`));
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("💥 La prueba lanzó un error:", error);
  process.exit(1);
});
