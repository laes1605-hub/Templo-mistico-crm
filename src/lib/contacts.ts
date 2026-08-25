"use client";

import { Capacitor } from "@capacitor/core";
import { Contacts, PhoneType } from "@capacitor-community/contacts";

export interface GuardarContactoResult {
  /** true cuando se creó directamente en la agenda nativa del teléfono. */
  native: boolean;
  contactId?: string;
  fileName?: string;
}

function esPlataformaNativa(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
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
 * Guarda el contacto directamente en la agenda cuando se ejecuta dentro de
 * la APK Capacitor. En navegador/PWA genera un vCard descargable como
 * respaldo, porque la web no tiene permiso para crear contactos en silencio.
 */
export async function guardarContactoEnTelefono(nombre: string, telefono: string): Promise<GuardarContactoResult> {
  const nombreLimpio = nombre.trim() || telefono.trim() || "Cliente";
  const telefonoLimpio = telefono.trim();
  if (!telefonoLimpio) throw new Error("El cliente no tiene un número de teléfono válido.");

  if (esPlataformaNativa()) {
    const permisosActuales = await Contacts.checkPermissions();
    const tienePermiso = permisosActuales.contacts === "granted" || permisosActuales.contacts === "limited";
    const permisos = tienePermiso ? permisosActuales : await Contacts.requestPermissions();
    const permisoConcedido = permisos.contacts === "granted" || permisos.contacts === "limited";

    if (!permisoConcedido) {
      throw new Error("Permiso denegado para guardar contactos. Actívalo en los ajustes del teléfono.");
    }

    const { dado, familia } = separarNombre(nombreLimpio);
    const result = await Contacts.createContact({
      contact: {
        name: { given: dado, family: familia },
        phones: [{ type: PhoneType.Mobile, number: telefonoLimpio, isPrimary: true }],
      },
    });

    return { native: true, contactId: result.contactId };
  }

  if (typeof window === "undefined" || typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("No se puede crear un contacto desde esta plataforma.");
  }

  const { dado, familia } = separarNombre(nombreLimpio);
  const vcard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escaparVCard(familia || "")};${escaparVCard(dado)};;;`,
    `FN:${escaparVCard(nombreLimpio)}`,
    `TEL;TYPE=CELL,VOICE:${escaparVCard(telefonoLimpio)}`,
    "END:VCARD",
    "",
  ].join("\r\n");
  const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const fileName = nombreArchivo(nombreLimpio, telefonoLimpio);
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);

  return { native: false, fileName };
}
