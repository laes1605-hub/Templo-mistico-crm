"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { Contacts, PhoneType, type ContactPayload } from "@capacitor-community/contacts";

const WEB_CONTACT_NAMES_KEY = "tm_contact_names_v1";

type ContactSaverPlugin = {
  createContact(options: {
    givenName: string;
    familyName: string;
    phoneNumber: string;
  }): Promise<{
    contactId: string;
    /** La APK confirmó que el número ya se puede resolver en la agenda. */
    verificado?: boolean;
    /** El número ya estaba en la agenda: la APK no creó nada. */
    yaExistia?: boolean;
    /** Nombre visible del contacto que ya tenía ese número. */
    nombreExistente?: string;
  }>;
  /** PhoneLookup de Android: resuelve un número esté como esté escrito. */
  findByPhone(options: { phoneNumber: string }): Promise<{
    found: boolean;
    /** false si la APK no tenía permiso de Contactos: la búsqueda no prueba nada. */
    permitted?: boolean;
    contactId?: string;
    displayName?: string;
    accountType?: string;
    accountName?: string;
  }>;
};

const ContactSaver = registerPlugin<ContactSaverPlugin>("ContactSaver");

export interface GuardarContactoResult {
  /** true cuando se creó directamente en la agenda nativa del teléfono. */
  native: boolean;
  contactId?: string;
  fileName?: string;
  /** Nombre que quedó visible en la agenda (o el del vCard generado). */
  nombreGuardado: string;
  /** true si la agenda no muestra el nombre que pidió el CRM. */
  nombreAjustado: boolean;
  /** true cuando se releyó la agenda después de escribir y el número está. */
  verificadoEnAgenda: boolean;
  /** Método de respaldo cuando la agenda Android no acepta la inserción directa. */
  metodo?: ViaGuardadoGoogle;
  /** Ese número ya estaba en la agenda: no se creó ningún contacto nuevo. */
  yaExistia?: boolean;
  /** Nombre que pidió el CRM cuando la agenda muestra otro distinto. */
  nombreSolicitado?: string;
  /** Android denegó el permiso de Contactos: el guardado directo necesita activarlo. */
  sinPermiso?: boolean;
  /** Sólo web: el usuario cerró la hoja de compartir sin elegir Contactos. */
  cancelado?: boolean;
}

/** Qué encontró la agenda al buscar un número de teléfono. */
export interface BusquedaTelefono {
  encontrado: boolean;
  contactId?: string;
  /** Nombre visible del contacto que ya tiene ese número. */
  nombre?: string;
  /** false si la agenda no se pudo leer: la respuesta no demuestra nada. */
  agendaLeida: boolean;
}

/** Cómo terminó el envío del contacto hacia la cuenta de Google. */
export type ViaGuardadoGoogle = "compartir_nativo" | "compartir_web" | "descarga";

export interface GuardarContactoGoogleResult {
  /** compartir_nativo = menú de Android · compartir_web = hoja del navegador · descarga = .vcf */
  metodo: ViaGuardadoGoogle;
  fileName: string;
  nombreGuardado: string;
  telefono: string;
}

function esPlataformaNativa(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** La APK lleva compilado el plugin propio ContactSaver (búsqueda e inserción). */
function esContactSaverDisponible(): boolean {
  try {
    return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ContactSaver");
  } catch {
    return false;
  }
}

/** Se exporta para que la UI pueda explicar por qué una función es solo APK. */
export function esAgendaNativaDisponible(): boolean {
  return esPlataformaNativa();
}

function separarNombre(nombre: string): { dado: string; familia: string | null } {
  const palabras = nombre.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (palabras.length <= 1) return { dado: palabras[0] || "Cliente", familia: null };
  return { dado: palabras[0], familia: palabras.slice(1).join(" ") };
}

function escaparVCard(valor: string): string {
  return valor
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function nombreArchivo(nombre: string, telefono: string): string {
  const base = (nombre || telefono || "contacto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._+-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${base || "contacto"}.vcf`;
}

/**
 * Ficha vCard 3.0 del contacto. Es el formato que entienden Contactos de
 * Android, Google Contacts, iPhone y Outlook, así que sirve tanto para la
 * descarga en web/PWA como para compartirla y guardarla en la cuenta Google.
 */
function construirVCard(nombre: string, telefono: string): { vcard: string; nombreArchivo: string } {
  const { dado, familia } = separarNombre(nombre.trim() || telefono.trim() || "Cliente");
  const vcard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escaparVCard(familia || "")};${escaparVCard(dado)};;;`,
    `FN:${escaparVCard(nombre.trim() || telefono.trim() || "Cliente")}`,
    `TEL;TYPE=CELL,VOICE:${escaparVCard(telefono.trim())}`,
    "END:VCARD",
    "",
  ].join("\r\n");
  return { vcard, nombreArchivo: nombreArchivo(nombre, telefono) };
}

/** base64 de un texto UTF-8 (lo que espera Filesystem.writeFile para un archivo). */
function textoABase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

/** Descarga clásica del .vcf (navegador sin hoja de compartir). */
function descargarVCard(vcard: string, fileName: string) {
  const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}

function normalizarNombre(nombre: string): string {
  return String(nombre || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nombreVisibleContacto(contacto: ContactPayload): string {
  const nombre = contacto?.name;
  const porPartes = [nombre?.given, nombre?.middle, nombre?.family].filter(Boolean).join(" ").trim();
  return String(nombre?.display || porPartes || "").trim();
}

/**
 * Conserva el nombre elegido cuando no existe y, si ya existe, añade un
 * consecutivo: "Pedro y María", "Pedro y María 2", "Pedro y María 3"…
 *
 * No reutilizamos un número que ya existió: si hay 2 y 4, el siguiente será 5.
 * Así el nombre sigue siendo inequívoco aunque alguien borre un contacto luego.
 *
 * Exportada para las pruebas (scripts/prueba-contacto-telefono.ts).
 */
export function crearNombreUnico(
  nombreBase: string,
  nombresExistentes: string[]
): { nombre: string; ajustado: boolean } {
  const baseVisible = nombreBase.trim().replace(/\s+/g, " ") || "Cliente";
  const base = normalizarNombre(baseVisible);
  const consecutivo = new RegExp(`^${escaparRegex(base)}\\s+(\\d+)$`);
  let existeBase = false;
  let mayorConsecutivo = 1;

  for (const existenteRaw of nombresExistentes) {
    const existente = normalizarNombre(existenteRaw);
    if (!existente) continue;
    if (existente === base) {
      existeBase = true;
      continue;
    }
    const match = existente.match(consecutivo);
    if (match) {
      existeBase = true;
      mayorConsecutivo = Math.max(mayorConsecutivo, Number(match[1]) || 1);
    }
  }

  if (!existeBase) return { nombre: baseVisible, ajustado: false };
  return { nombre: `${baseVisible} ${mayorConsecutivo + 1}`, ajustado: true };
}

/** ¿Ese nombre visible es la base o una de sus variantes numeradas («X», «X 2», «X 3»…)? */
function nombrePerteneceALaBase(nombreVisible: string, nombreBase: string): boolean {
  const base = normalizarNombre(nombreBase);
  const candidata = normalizarNombre(nombreVisible);
  if (!candidata) return false;
  if (candidata === base) return true;
  return new RegExp(`^${escaparRegex(base)}\\s+\\d+$`).test(candidata);
}

function normalizarTelefono(telefono: string): string {
  return String(telefono || "").replace(/\D/g, "");
}

/** Compara E.164 y formatos locales sin confundir números muy cortos. */
function mismoTelefono(a: string, b: string): boolean {
  const aa = normalizarTelefono(a);
  const bb = normalizarTelefono(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  // Algunas agendas guardan el número local sin +indicativo. Ocho dígitos es
  // el mínimo para que esta tolerancia no convierta extensiones en coincidencias.
  return Math.min(aa.length, bb.length) >= 8 && (aa.endsWith(bb) || bb.endsWith(aa));
}

function estadoPermisoConcedido(estado: any): boolean {
  if (!estado) return false;
  if (estado.granted === true) return true;
  const valor = estado.contacts ?? estado.write ?? estado.read;
  return valor === "granted" || valor === "limited";
}

async function permisosContactos(solicitar: boolean): Promise<boolean> {
  const actuales = await Contacts.checkPermissions();
  const concedidos = estadoPermisoConcedido(actuales);
  if (concedidos || !solicitar) return concedidos;
  const nuevos = await Contacts.requestPermissions();
  return estadoPermisoConcedido(nuevos);
}

async function listarContactosNativos(
  solicitarPermiso: boolean
): Promise<{ contactos: ContactPayload[] | null; sinPermiso: boolean }> {
  if (!esPlataformaNativa()) return { contactos: null, sinPermiso: false };
  const concedido = await permisosContactos(solicitarPermiso).catch(() => false);
  if (!concedido) return { contactos: null, sinPermiso: true };
  try {
    const { contacts } = await Contacts.getContacts({ projection: { name: true, phones: true } });
    return { contactos: contacts || [], sinPermiso: false };
  } catch (error) {
    console.warn("La agenda Android no respondió a la consulta:", error);
    return { contactos: null, sinPermiso: false };
  }
}

function leerNombresWeb(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(WEB_CONTACT_NAMES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function recordarNombreWeb(nombre: string) {
  if (typeof window === "undefined") return;
  try {
    const previos = leerNombresWeb();
    if (!previos.some((n) => normalizarNombre(n) === normalizarNombre(nombre))) {
      localStorage.setItem(WEB_CONTACT_NAMES_KEY, JSON.stringify([...previos, nombre].slice(-500)));
    }
  } catch {}
}

/**
 * Busca un número en la agenda del teléfono, sea cual sea el nombre del
 * contacto que lo tenga (incluidas las fichas que crea WhatsApp).
 *
 * Primero usa `ContactSaver.findByPhone`: es el PhoneLookup que Android emplea
 * para resolver llamadas, así que encuentra el número aunque la agenda lo
 * guarde sin el +indicativo, y no recorre la tabla entera. Si la APK instalada
 * es anterior a ese método, se recorre la agenda con el plugin comunitario.
 *
 * Por defecto no solicita permiso (la ficha del cliente muestra el estado sin
 * abrir un diálogo); «Guardar en teléfono» sí lo pide.
 */
export async function buscarContactoPorTelefono(
  telefono: string,
  solicitarPermiso = false
): Promise<BusquedaTelefono> {
  const nada: BusquedaTelefono = { encontrado: false, agendaLeida: false };
  if (!esPlataformaNativa()) return nada;

  const telefonoLimpio = String(telefono || "").trim();
  if (!telefonoLimpio) return nada;

  const concedido = await permisosContactos(solicitarPermiso).catch(() => false);
  if (!concedido) return nada;

  if (esContactSaverDisponible()) {
    try {
      const encontrado = await ContactSaver.findByPhone({ phoneNumber: telefonoLimpio });
      if (encontrado?.found) {
        return {
          encontrado: true,
          contactId: encontrado.contactId,
          nombre: String(encontrado.displayName || "").trim() || undefined,
          agendaLeida: true,
        };
      }
      // Sin permiso la APK contesta found=false sin haber buscado: eso no
      // demuestra que el número no esté en la agenda.
      if (encontrado && encontrado.permitted === false) {
        return { encontrado: false, agendaLeida: false };
      }
      return { encontrado: false, agendaLeida: true };
    } catch (error) {
      console.warn("ContactSaver.findByPhone no respondió, se recorre la agenda:", error);
    }
  }

  const { contactos } = await listarContactosNativos(false);
  if (!contactos) return { encontrado: false, agendaLeida: false };
  const coincidencia = contactos.find((contacto) =>
    (contacto.phones || []).some((p) => mismoTelefono(String(p.number || ""), telefonoLimpio))
  );
  if (!coincidencia) return { encontrado: false, agendaLeida: true };
  return {
    encontrado: true,
    contactId: coincidencia.contactId ? String(coincidencia.contactId) : undefined,
    nombre: nombreVisibleContacto(coincidencia) || undefined,
    agendaLeida: true,
  };
}

/**
 * Comprueba si ese número está realmente guardado en la agenda del dispositivo.
 * Nunca solicita permiso de forma inesperada: la pantalla puede mostrar el
 * estado sin abrir un diálogo; Guardar en teléfono sí lo solicita.
 */
export async function estaContactoGuardadoEnTelefono(telefono: string): Promise<boolean> {
  const { encontrado } = await buscarContactoPorTelefono(telefono, false);
  return encontrado;
}

/**
 * Inserta el contacto en la agenda nativa.
 *
 * `agendaSinEseNumero` dice si ANTES de insertar se comprobó que ese número no
 * estaba guardado. Sólo con esa certeza un fallo del plugin puede interpretarse
 * como «se escribió igual»: sin ella, encontrar el número después significaría
 * confirmar como propio un contacto que ya era de otra persona.
 */
async function crearContactoNativo(
  dado: string,
  familia: string | null,
  telefonoLimpio: string,
  agendaSinEseNumero: boolean
): Promise<{ contactId?: string; yaExistia?: boolean; nombreExistente?: string }> {
  const errores: string[] = [];

  if (esContactSaverDisponible()) {
    try {
      const creado = await ContactSaver.createContact({
        givenName: dado,
        familyName: familia || "",
        phoneNumber: telefonoLimpio,
      });
      if (creado?.yaExistia) {
        return {
          contactId: creado.contactId,
          yaExistia: true,
          nombreExistente: creado.nombreExistente,
        };
      }
      return { contactId: creado?.contactId };
    } catch (error: any) {
      const msg = String(error?.message || error || "").trim();
      if (msg) errores.push(msg);
      console.warn("ContactSaver falló, reintentando con Contacts.createContact:", error);
    }
  }

  try {
    // IMPORTANTE: en @capacitor-community/contacts (Contacts.java línea 233),
    // pasar `isPrimary: true` ejecuta `op.withValue(Phone.IS_PRIMARY, true)` con
    // un Boolean en vez de un Integer (1). En Android ContactsProvider2 eso lanza
    // ClassCastException/NullPointerException al evaluar `getAsInteger("is_primary")`
    // y el plugin rechaza siempre con "Something went wrong.".
    // Además, `CreateContactInput.java` usa `nameObject.optString("family")`
    // cuando la clave `family` existe, convirtiendo `family: null` en la cadena
    // literal `"null"`. Por eso omitimos `isPrimary` y sólo enviamos `family`
    // cuando tiene texto.
    const namePayload: { given: string; family?: string } = { given: dado };
    if (familia) namePayload.family = familia;

    return await Contacts.createContact({
      contact: {
        name: namePayload,
        phones: [{ type: PhoneType.Mobile, number: telefonoLimpio }],
      },
    });
  } catch (error: any) {
    // En algunas agendas Android el contacto sí se inserta en RawContacts, pero
    // `getContactIdByRawId` devuelve null unos milisegundos antes de que termine
    // la agregación y el plugin lanza "Something went wrong.". Sólo se da por
    // bueno si antes se comprobó que el número NO estaba en la agenda.
    if (agendaSinEseNumero) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const comprobacion = await buscarContactoPorTelefono(telefonoLimpio, false);
        if (comprobacion.encontrado) {
          return { contactId: comprobacion.contactId };
        }
      } catch {}
    }

    const msg = String(error?.message || error || "").trim();
    if (msg && !errores.includes(msg)) errores.push(msg);
    throw new Error(errores[0] || "CONTACT_SAVE_FAILED");
  }
}

/**
 * Respuesta cuando el número ya estaba en la agenda: no se crea nada y se
 * informa con el nombre real de la ficha que ya existía.
 */
function contactoYaExistente(existente: BusquedaTelefono, nombreSolicitado: string): GuardarContactoResult {
  const nombreAgenda = (existente.nombre || "").trim() || nombreSolicitado;
  // «Marta López 2» sigue siendo la Marta López del CRM: no se cuenta como otro
  // nombre, sólo es el consecutivo que la propia agenda necesitó.
  const distinto =
    normalizarNombre(nombreAgenda) !== normalizarNombre(nombreSolicitado) &&
    !nombrePerteneceALaBase(nombreAgenda, nombreSolicitado);
  return {
    native: true,
    contactId: existente.contactId,
    nombreGuardado: nombreAgenda,
    nombreAjustado: distinto,
    verificadoEnAgenda: true,
    yaExistia: true,
    nombreSolicitado: distinto ? nombreSolicitado : undefined,
  };
}

/**
 * Guarda el contacto directamente en la agenda cuando se ejecuta dentro de la
 * APK Capacitor:
 *
 *   · el número ya está en la agenda (con cualquier nombre) → no se crea nada;
 *     Android fusiona los contactos que comparten número, así que una segunda
 *     ficha no llegaría a verse. Se informa con el nombre que ya existía.
 *   · número libre y nombre nuevo → se guarda tal cual («Marta López»).
 *   · número libre y nombre repetido → consecutivo («Marta López 2»,
 *     «Marta López 3»… según el más alto que ya exista).
 *
 * Después de escribir vuelve a leer la agenda: sólo si el número aparece se
 * informa «guardado». Así un fallo de Android no se cuenta como éxito.
 */
export async function guardarContactoEnTelefono(nombre: string, telefono: string): Promise<GuardarContactoResult> {
  const nombreLimpio = nombre.trim() || telefono.trim() || "Cliente";
  const telefonoLimpio = telefono.trim();
  if (!telefonoLimpio) throw new Error("El cliente no tiene un número de teléfono válido.");

  if (esPlataformaNativa()) {
    const concedido = await permisosContactos(true).catch(() => false);
    if (!concedido) {
      throw new Error(
        "Para guardar el contacto directo en el teléfono, activa el permiso de Contactos: Ajustes › Aplicaciones › Templo Místico CRM › Permisos › Contactos."
      );
    }

    // 1) ¿Ese número ya está guardado? Se comprueba por NÚMERO (no por nombre):
    //    es lo que identifica a la persona en la agenda y lo que usa Android
    //    para fusionar fichas. Cubre el caso típico del número que ya llegó con
    //    WhatsApp o que otro operador guardó con otro nombre.
    const existente = await buscarContactoPorTelefono(telefonoLimpio, false);
    if (existente.encontrado) {
      return contactoYaExistente(existente, nombreLimpio);
    }

    // 2) Nombre: la agenda completa sólo hace falta para el consecutivo. Si esa
    //    lectura falla (contacto corrupto, cursor grande) seguimos sin lista.
    const { contactos } = await listarContactosNativos(false);
    const listaContactos = contactos ?? [];

    const nombreUnico = crearNombreUnico(nombreLimpio, listaContactos.map(nombreVisibleContacto));
    const { dado, familia } = separarNombre(nombreUnico.nombre);

    let creado: { contactId?: string; yaExistia?: boolean; nombreExistente?: string };
    try {
      creado = await crearContactoNativo(dado, familia, telefonoLimpio, existente.agendaLeida);
    } catch (error) {
      console.warn("No se pudo crear el contacto en la agenda:", error);
      const detalle = String((error as any)?.message || "").trim();
      throw new Error(
        `No se pudo guardar ${nombreUnico.nombre} en la agenda del teléfono${detalle ? ` (${detalle})` : ""}.`
      );
    }

    if (creado.yaExistia) {
      return contactoYaExistente(
        { encontrado: true, contactId: creado.contactId, nombre: creado.nombreExistente, agendaLeida: true },
        nombreLimpio
      );
    }

    // 3) Verificación: releer la agenda. Sin este paso la app decía «contacto
    //    guardado» aunque Android hubiera descartado la ficha.
    const comprobacion = await buscarContactoPorTelefono(telefonoLimpio, false);
    if (!comprobacion.encontrado) {
      throw new Error(
        comprobacion.agendaLeida
          ? `Android aceptó la inserción, pero ${nombreUnico.nombre} (${telefonoLimpio}) no aparece en la agenda. Abre la app Contactos para forzar su carga e inténtalo otra vez.`
          : `No se pudo comprobar que ${nombreUnico.nombre} quedara en la agenda porque Android no dejó leer Contactos. Revisa el permiso de Contactos e inténtalo otra vez.`
      );
    }

    const nombreReal = (comprobacion.nombre || "").trim() || nombreUnico.nombre;
    const difiere =
      normalizarNombre(nombreReal) !== normalizarNombre(nombreUnico.nombre) &&
      !nombrePerteneceALaBase(nombreReal, nombreUnico.nombre);
    return {
      native: true,
      contactId: creado.contactId ?? comprobacion.contactId,
      nombreGuardado: nombreReal,
      nombreAjustado: nombreUnico.ajustado || difiere,
      verificadoEnAgenda: true,
      nombreSolicitado: difiere ? nombreUnico.nombre : undefined,
    };
  }

  if (typeof window === "undefined" || typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("No se puede crear un contacto desde esta plataforma.");
  }

  // Navegador (web/PWA): los navegadores no pueden escribir en la agenda, pero
  // en Chrome Android la hoja de compartir entrega la ficha .vcf al sistema y
  // al elegir Contactos el contacto se crea directamente, sin descargar nada.
  // La descarga del archivo queda sólo como último respaldo (navegadores sin
  // hoja de compartir con archivos, p. ej. Safari de iPhone).
  const { vcard, nombreArchivo: fileName } = construirVCard(nombreLimpio, telefonoLimpio);
  const compartido = await compartirVCardWeb(vcard, fileName, `Contacto: ${nombreLimpio}`);
  if (compartido !== "no_disponible") {
    return {
      native: false,
      metodo: "compartir_web",
      fileName,
      nombreGuardado: nombreLimpio,
      nombreAjustado: false,
      verificadoEnAgenda: false,
      cancelado: compartido === "cancelado",
    };
  }
  descargarVCard(vcard, fileName);
  return {
    native: false,
    metodo: "descarga",
    fileName,
    nombreGuardado: nombreLimpio,
    nombreAjustado: false,
    verificadoEnAgenda: false,
  };
}

/**
 * Abre la hoja de compartir del navegador con el .vcf. Devuelve "no_disponible"
 * si el navegador no puede compartir archivos (entonces se usa la descarga).
 */
async function compartirVCardWeb(
  vcard: string,
  fileName: string,
  titulo: string
): Promise<"compartido" | "cancelado" | "no_disponible"> {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof File === "undefined") {
    return "no_disponible";
  }
  try {
    const file = new File([new Blob([vcard], { type: "text/vcard" })], fileName, { type: "text/vcard" });
    if (!navigator.canShare({ files: [file] })) return "no_disponible";
    await navigator.share({ files: [file], title: titulo });
    return "compartido";
  } catch (e: any) {
    if (esCancelacion(e)) return "cancelado";
    console.warn("La hoja de compartir del navegador falló:", e);
    return "no_disponible";
  }
}

/**
 * Guarda el contacto en la CUENTA DE GOOGLE del teléfono (Google Contacts).
 *
 * No se puede escribir en otra cuenta desde el plugin de contactos sin
 * permisos extra (la APK crea el contacto en la agenda general), así que el
 * camino corto y sin configuración es entregar la ficha .vcf al sistema:
 *
 *   · APK Android → se escribe el .vcf y se abre el menú de compartir; al
 *     elegir Contactos/Google Contacts, el contacto se importa en la cuenta
 *     Google y queda sincronizado (también aparece en el teléfono).
 *   · Navegador con hoja de compartir (Chrome Android) → igual, pero con la
 *     hoja del propio navegador.
 *   · Sin hoja de compartir → se descarga el .vcf para abrirlo y elegir la
 *     cuenta Google en el teléfono.
 *
 * El nombre NO lleva consecutivo aquí: Google Contacts resuelve los repetidos
 * por su cuenta y así no se crean "Pedro 2" innecesarios en la nube.
 */
export async function guardarContactoEnGoogle(nombre: string, telefono: string): Promise<GuardarContactoGoogleResult> {
  const nombreLimpio = (nombre || telefono || "Cliente").trim();
  const telefonoLimpio = (telefono || "").trim();
  if (!telefonoLimpio) throw new Error("El cliente no tiene un número de teléfono válido.");

  const { vcard, nombreArchivo: fileName } = construirVCard(nombreLimpio, telefonoLimpio);
  const titulo = `Contacto: ${nombreLimpio}`;

  // 1) APK Android: archivo + menú de compartir nativo.
  if (esPlataformaNativa()) {
    try {
      const { Filesystem, FilesystemDirectory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");
      // Un archivo por contacto (se sobrescribe al repetir): queda también en
      // Documentos › contactos por si hay que abrirlo desde Archivos.
      const { uri } = await Filesystem.writeFile({
        path: `contactos/${fileName}`,
        data: textoABase64(vcard),
        directory: FilesystemDirectory.Documents,
      });
      await Share.share({
        files: [uri],
        title: titulo,
        dialogTitle: "Guardar contacto en…",
      });
      return { metodo: "compartir_nativo", fileName, nombreGuardado: nombreLimpio, telefono: telefonoLimpio };
    } catch (e: any) {
      // Si el usuario cierra el menú de compartir no es un error: no reintentar.
      if (esCancelacion(e)) {
        return { metodo: "compartir_nativo", fileName, nombreGuardado: nombreLimpio, telefono: telefonoLimpio };
      }
      console.warn("No se pudo compartir el vCard, se intenta la descarga:", e);
    }
  }

  // 2) Navegador con hoja de compartir (permite elegir Contactos/Google).
  const compartido = await compartirVCardWeb(vcard, fileName, titulo);
  if (compartido !== "no_disponible") {
    return { metodo: "compartir_web", fileName, nombreGuardado: nombreLimpio, telefono: telefonoLimpio };
  }

  // 3) Respaldo: descarga del .vcf.
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("No se puede exportar el contacto desde esta plataforma.");
  }
  descargarVCard(vcard, fileName);
  return { metodo: "descarga", fileName, nombreGuardado: nombreLimpio, telefono: telefonoLimpio };
}

function esCancelacion(error: any): boolean {
  const nombre = String(error?.name || error?.message || "").toLowerCase();
  return nombre.includes("abort") || nombre.includes("cancel");
}
