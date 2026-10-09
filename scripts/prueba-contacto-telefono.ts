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
let errorDeContactsCreate: Error | null = null;
let errorDeGetContacts: Error | null = null;
let errorDeFindByPhone: Error | null = null;
let contactSaverDisponible = true;
/** Simula una APK antigua: el plugin existe pero no tiene findByPhone. */
let findByPhoneImplementado = true;
/** La APK responde sin haber buscado porque no tiene el permiso de Contactos. */
let findByPhoneSinPermiso = false;
/** El plugin responde «guardado» pero la agenda no recibe la fila (guardado fantasma). */
let insercionFantasma = false;
let llamadasFindByPhone = 0;
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
  {
    name: "ContactSaver",
    methods: [
      { name: "createContact", rtype: "promise" },
      { name: "findByPhone", rtype: "promise" },
    ],
  },
  { name: "Filesystem", methods: [{ name: "writeFile", rtype: "promise" }] },
  { name: "Share", methods: [{ name: "share", rtype: "promise" }] },
];

(Capacitor as any).nativePromise = async (plugin: string, metodo: string, args: any) => {
  if (plugin === "Contacts") {
    if (metodo === "checkPermissions") return { contacts: permiso };
    if (metodo === "requestPermissions") return { contacts: permiso };
    if (metodo === "getContacts") {
      if (errorDeGetContacts) throw errorDeGetContacts;
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
    if (metodo === "createContact") {
      if (errorDeContactsCreate) throw errorDeContactsCreate;
      const contact = args?.contact || {};
      const nameObj = contact.name || {};
      const phones = Array.isArray(contact.phones) ? contact.phones : [];
      // Reproduce el fallo real de @capacitor-community/contacts en Android:
      // 1) `isPrimary: true` escribe un Boolean en ContentValues("is_primary") y
      //    ContactsProvider2 lanza ClassCastException/NullPointerException → "Something went wrong."
      if (phones.some((p: any) => p && p.isPrimary === true)) {
        throw new Error("Something went wrong.");
      }
      // 2) `family: null` en JSON hace que nameObject.optString("family") devuelva "null"
      if ("family" in nameObj && nameObj.family === null) {
        throw new Error("FAMILY_NULL_STRING_BUG");
      }
      const id = String(proximoId++);
      agenda.push({
        id,
        dado: String(nameObj.given || ""),
        familia: String(nameObj.family || ""),
        telefono: String(phones[0]?.number || ""),
      });
      return { contactId: id };
    }
  }
  if (plugin === "ContactSaver" && metodo === "createContact") {
    if (errorDeContactSaver) throw errorDeContactSaver;
    const id = String(proximoId++);
    // Guardado fantasma: Android contesta con URI/ID pero la fila no queda en la
    // agenda (cuenta local oculta, proveedor que descarta el lote, etc.).
    if (!insercionFantasma) {
      agenda.push({
        id,
        dado: String(args.givenName || ""),
        familia: String(args.familyName || ""),
        telefono: String(args.phoneNumber || ""),
      });
    }
    return { contactId: id, verificado: !insercionFantasma };
  }
  // PhoneLookup nativo: resuelve un número aunque esté guardado en otro formato.
  if (plugin === "ContactSaver" && metodo === "findByPhone") {
    llamadasFindByPhone += 1;
    if (!findByPhoneImplementado) {
      throw new Error("ContactSaver.findByPhone is not implemented on android");
    }
    // La APK contesta sin haber buscado cuando le falta el permiso de Contactos.
    if (findByPhoneSinPermiso) {
      return { found: false, permitted: false };
    }
    if (errorDeFindByPhone) throw errorDeFindByPhone;
    const soloDigitos = (valor: string) => String(valor || "").replace(/\D/g, "");
    const buscado = soloDigitos(args?.phoneNumber || "");
    const coincide = agenda.find((c) => {
      const guardado = soloDigitos(c.telefono);
      if (!buscado || !guardado) return false;
      if (guardado === buscado) return true;
      return Math.min(guardado.length, buscado.length) >= 8 && (guardado.endsWith(buscado) || buscado.endsWith(guardado));
    });
    if (!coincide) return { found: false };
    return {
      found: true,
      contactId: coincide.id,
      displayName: nombreVisible(coincide),
      accountType: "com.google",
      accountName: "operador@gmail.com",
    };
  }
  // Respaldo .vcf: escribir el archivo y "compartirlo" con el sistema.
  if (plugin === "Filesystem" && metodo === "writeFile") { huboArchivo = true; return { uri: "file:///tmp/" + args.path }; }
  if (plugin === "Share" && metodo === "share") { huboArchivo = true; return {}; }
  throw new Error(`Puerto falso: ${plugin}.${metodo} no simulado`);
};
// La APK tiene el plugin propio ContactSaver compilado dentro.
(Capacitor as any).isPluginAvailable = (nombre: string) =>
  nombre === "ContactSaver" ? contactSaverDisponible : false;

const { guardarContactoEnTelefono, buscarContactoPorTelefono } = require("../src/lib/contacts.ts");

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

  // 8) ContactSaver y Contacts.createContact fallan: error claro, sin respaldo .vcf.
  permiso = "granted";
  errorDeContactSaver = new Error("CONTACT_SAVE_FAILED");
  errorDeContactsCreate = new Error("CONTACT_SAVE_FAILED");
  crearAgendaInicial(["Pedro Castro"], []);
  let error8: any = null;
  try { await guardarContactoEnTelefono("Marta López", "+56988888888"); } catch (e) { error8 = e; }
  ok(error8 !== null && /No se pudo guardar/.test(String(error8?.message)), "fallo de inserción muestra el motivo");
  ok(!huboArchivo, "no se genera ningún archivo .vcf");

  // 9) APK sin ContactSaver (o cuando ContactSaver falla): Contacts.createContact
  //    guarda directo sin enviar isPrimary:true ni family:null.
  console.log("\n· APK sin ContactSaver (y nombre de una sola palabra) → guarda directo sin el bug de isPrimary:true");
  contactSaverDisponible = false;
  errorDeContactSaver = null;
  errorDeContactsCreate = null;
  crearAgendaInicial(["Pedro Castro"], []);
  r = await guardarContactoEnTelefono("Marta", "+56999999991");
  ok(r.native === true && r.nombreGuardado === "Marta", `guardado directo con Contacts.createContact (${r.nombreGuardado})`);
  ok(nombresAgenda().join("|") === "Pedro Castro|Marta", "no añade 'null' al apellido ni falla por isPrimary:true");

  // 10) Si ContactSaver lanza error pero Contacts.createContact funciona, guarda igual.
  console.log("\n· ContactSaver lanza excepción → respalda con Contacts.createContact nativo");
  contactSaverDisponible = true;
  errorDeContactSaver = new Error("OEM_RAW_CONTACT_ERROR");
  errorDeContactsCreate = null;
  crearAgendaInicial(["Pedro Castro"], []);
  r = await guardarContactoEnTelefono("Marta López", "+56999999992");
  ok(r.native === true && r.nombreGuardado === "Marta López", "respaldo nativo Contacts.createContact completó el guardado");

  // 11) Si getContacts falla al leer una agenda grande/corrupta (con permiso activo),
  //     igual guarda el contacto en vez de bloquear al operador.
  console.log("\n· Fallo al listar agenda previa con permiso concedido → guarda el contacto igualmente");
  errorDeContactSaver = null;
  errorDeGetContacts = new Error("CURSOR_WINDOW_OVERFLOW");
  crearAgendaInicial([], []);
  r = await guardarContactoEnTelefono("Lucía Gómez", "+56999999993");
  ok(r.native === true && r.nombreGuardado === "Lucía Gómez", "guarda el contacto aunque getContacts haya fallado");
  errorDeGetContacts = null;

  // 12) El número YA está en la agenda con otro nombre (típico: la ficha que
  //     creó WhatsApp). No se crea nada: Android fusionaría los dos contactos
  //     por número y el nombre nuevo nunca llegaría a verse.
  console.log("\n· El número ya está guardado con OTRO nombre → no duplica y avisa con el nombre real");
  errorDeContactSaver = null;
  errorDeContactsCreate = null;
  insercionFantasma = false;
  crearAgendaInicial(["Ficha WhatsApp"], ["+56912345678"]);
  r = await guardarContactoEnTelefono("Marta López", "+56912345678");
  ok(r.yaExistia === true, `marca que ya existía (yaExistia=${(r as any).yaExistia})`);
  ok(r.nombreGuardado === "Ficha WhatsApp", `informa el nombre real de la agenda (${r.nombreGuardado})`);
  ok(agenda.length === 1, `no crea un contacto duplicado (agenda=${agenda.length})`);

  // 13) Regresión del «dice guardado pero no guardó»: la inserción falla y el
  //     número ya estaba en la agenda. Antes eso se resolvía como éxito con el
  //     nombre del CRM; debe quedarse en «ya existía» (o fallar), nunca mentir.
  console.log("\n· Inserción fallida con el número ya presente → NO celebra un guardado inexistente");
  crearAgendaInicial(["Contacto Viejo"], ["+56933334444"]);
  errorDeContactSaver = new Error("CONTACT_SAVE_FAILED");
  errorDeContactsCreate = new Error("Something went wrong.");
  let r13: any = null;
  let error13: any = null;
  try { r13 = await guardarContactoEnTelefono("Marta López", "+56933334444"); } catch (e) { error13 = e; }
  ok(
    error13 !== null || (r13?.yaExistia === true && r13?.nombreGuardado === "Contacto Viejo"),
    `no reporta «Marta López» como guardado (${error13 ? "falló: " + String(error13?.message) : `yaExistia=${r13?.yaExistia}, nombre=${r13?.nombreGuardado}`})`
  );
  ok(agenda.length === 1, "la agenda no queda con un contacto repetido");
  errorDeContactSaver = null;
  errorDeContactsCreate = null;

  // 14) Guardado fantasma: el plugin nativo responde con ID pero la fila no
  //     llega a la agenda. El CRM debe comprobarlo y dar error.
  console.log("\n· El plugin responde OK pero la agenda queda vacía → error, no «contacto guardado»");
  crearAgendaInicial([], []);
  insercionFantasma = true;
  errorDeContactsCreate = new Error("Something went wrong.");
  llamadasFindByPhone = 0;
  let error14: any = null;
  let r14: any = null;
  try { r14 = await guardarContactoEnTelefono("Marta López", "+56955556666"); } catch (e) { error14 = e; }
  ok(error14 !== null, `no se celebra un guardado que no existe (${error14 ? String(error14?.message) : `devolvió ${JSON.stringify(r14)}`})`);
  ok(agenda.length === 0, "la agenda sigue vacía (coherente con el error mostrado)");
  ok(llamadasFindByPhone >= 2, `relee la agenda después de insertar (findByPhone×${llamadasFindByPhone})`);
  insercionFantasma = false;
  errorDeContactsCreate = null;

  // 15) Guardado normal: se comprueba el número ANTES y DESPUÉS de insertar.
  console.log("\n· Guardado correcto → verifica el número antes y después de escribir");
  crearAgendaInicial(["Pedro Castro"], []);
  llamadasFindByPhone = 0;
  r = await guardarContactoEnTelefono("Marta López", "+56966667777");
  ok(r.native === true && r.nombreGuardado === "Marta López", `guardado confirmado (${r.nombreGuardado})`);
  ok(r.verificadoEnAgenda === true, "informa que el guardado se verificó en la agenda");
  ok(llamadasFindByPhone >= 2, `comprobó el número antes y después (findByPhone×${llamadasFindByPhone})`);

  // 16) APK antigua sin findByPhone: la comprobación por número se hace
  //     recorriendo la agenda con el plugin comunitario.
  console.log("\n· APK sin findByPhone → la comprobación por número usa la agenda completa");
  findByPhoneImplementado = false;
  crearAgendaInicial(["Otro Cliente"], ["+56977778888"]);
  r = await guardarContactoEnTelefono("Marta López", "+56977778888");
  ok(r.yaExistia === true && r.nombreGuardado === "Otro Cliente", `detecta el número sin findByPhone (${r.nombreGuardado})`);
  ok(agenda.length === 1, "tampoco duplica en la APK antigua");
  findByPhoneImplementado = true;

  // 17) La APK contesta «no encontrado» sin haber podido buscar (sin permiso de
  //     Contactos). Esa respuesta no prueba nada: agendaLeida=false.
  console.log("\n· La agenda responde sin permiso → la búsqueda no se da por buena");
  crearAgendaInicial(["Marta López"], ["+56911112222"]);
  findByPhoneSinPermiso = true;
  const busqueda = await buscarContactoPorTelefono("+56911112222");
  ok(busqueda.encontrado === false && busqueda.agendaLeida === false, `no afirma que el número no esté (agendaLeida=${busqueda.agendaLeida})`);
  findByPhoneSinPermiso = false;

  console.log("\n" + (fallos === 0 ? "✅ TODO OK" : `❌ ${fallos} comprobaciones fallaron`));
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("💥 La prueba lanzó un error:", error);
  process.exit(1);
});
