"use client";

import { Capacitor } from "@capacitor/core";
import { Contacts, PhoneType, type ContactPayload } from "@capacitor-community/contacts";

const WEB_CONTACT_NAMES_KEY = "tm_contact_names_v1";

export interface GuardarContactoResult {
  /** true cuando se creó directamente en la agenda nativa del teléfono. */
  native: boolean;
  contactId?: string;
  fileName?: string;
  /** Nombre exacto que se guardó o se incluyó en el vCard. */
  nombreGuardado: string;
  /** true si se añadió un número para no repetir un nombre de la agenda. */
  nombreAjustado: boolean;
  /** La agenda real solo se puede consultar desde la APK; web usa su historial local. */
  verificadoEnAgenda: boolean;
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
 */
function crearNombreUnico(nombreBase: string, nombresExistentes: string[]): {
  nombre: string;
  ajustado: boolean;
} {
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

async function permisosContactos(solicitar: boolean): Promise<boolean> {
  const actuales = await Contacts.checkPermissions();
  const concedidos = actuales.contacts === "granted" || actuales.contacts === "limited";
  if (concedidos || !solicitar) return concedidos;
  const nuevos = await Contacts.requestPermissions();
  return nuevos.contacts === "granted" || nuevos.contacts === "limited";
}

async function listarContactosNativos(solicitarPermiso: boolean): Promise<ContactPayload[] | null> {
  if (!esPlataformaNativa()) return null;
  const concedido = await permisosContactos(solicitarPermiso);
  if (!concedido) return null;
  const { contacts } = await Contacts.getContacts({ projection: { name: true, phones: true } });
  return contacts || [];
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
 * Comprueba si ese número está realmente guardado en la agenda del dispositivo.
 * Nunca solicita permiso de forma inesperada: la pantalla puede mostrar el
 * estado sin abrir un diálogo; Guardar en teléfono sí lo solicita.
 */
export async function estaContactoGuardadoEnTelefono(telefono: string): Promise<boolean> {
  const contactos = await listarContactosNativos(false);
  if (!contactos) return false;
  return contactos.some((contacto) =>
    (contacto.phones || []).some((p) => mismoTelefono(String(p.number || ""), telefono))
  );
}

/**
 * Guarda el contacto directamente en la agenda cuando se ejecuta dentro de la
 * APK Capacitor. Antes de crear el registro compara todos los nombres de la
 * agenda para no repetirlos. En navegador/PWA genera un vCard descargable como
 * respaldo; por privacidad la web no puede consultar la agenda real, por lo que
 * ahí solo evita nombres que el propio CRM haya exportado en este navegador.
 */
export async function guardarContactoEnTelefono(nombre: string, telefono: string): Promise<GuardarContactoResult> {
  const nombreLimpio = nombre.trim() || telefono.trim() || "Cliente";
  const telefonoLimpio = telefono.trim();
  if (!telefonoLimpio) throw new Error("El cliente no tiene un número de teléfono válido.");

  if (esPlataformaNativa()) {
    const contactos = await listarContactosNativos(true);
    if (!contactos) {
      throw new Error("Permiso denegado para guardar contactos. Actívalo en los ajustes del teléfono.");
    }

    const nombreUnico = crearNombreUnico(nombreLimpio, contactos.map(nombreVisibleContacto));
    const { dado, familia } = separarNombre(nombreUnico.nombre);
    const result = await Contacts.createContact({
      contact: {
        name: { given: dado, family: familia },
        phones: [{ type: PhoneType.Mobile, number: telefonoLimpio, isPrimary: true }],
      },
    });

    return {
      native: true,
      contactId: result.contactId,
      nombreGuardado: nombreUnico.nombre,
      nombreAjustado: nombreUnico.ajustado,
      verificadoEnAgenda: true,
    };
  }

  if (typeof window === "undefined" || typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("No se puede crear un contacto desde esta plataforma.");
  }

  const nombreUnico = crearNombreUnico(nombreLimpio, leerNombresWeb());
  const { vcard, nombreArchivo: fileName } = construirVCard(nombreUnico.nombre, telefonoLimpio);
  descargarVCard(vcard, fileName);
  recordarNombreWeb(nombreUnico.nombre);

  return {
    native: false,
    fileName,
    nombreGuardado: nombreUnico.nombre,
    nombreAjustado: nombreUnico.ajustado,
    verificadoEnAgenda: false,
  };
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
  if (typeof navigator !== "undefined" && typeof navigator.canShare === "function" && typeof File !== "undefined") {
    try {
      const file = new File([new Blob([vcard], { type: "text/vcard" })], fileName, { type: "text/vcard" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: titulo });
        return { metodo: "compartir_web", fileName, nombreGuardado: nombreLimpio, telefono: telefonoLimpio };
      }
    } catch (e: any) {
      if (esCancelacion(e)) {
        return { metodo: "compartir_web", fileName, nombreGuardado: nombreLimpio, telefono: telefonoLimpio };
      }
      console.warn("La hoja de compartir del navegador falló:", e);
    }
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
