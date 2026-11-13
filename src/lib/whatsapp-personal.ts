"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { CuentaPersonal } from "./whatsapp-cuentas";

type AbrirChatResult = {
  opened: boolean;
  /** true si Android/WhatsApp expuso la acción nativa de llamada directa. */
  directCall?: boolean;
  /** Paquete de WhatsApp que se abrió realmente (WhatsApp 1 o WhatsApp 2). */
  package?: string;
};

export type AppWhatsApp = {
  package: string;
  label: string;
};

type WhatsAppPersonalPlugin = {
  /**
   * Verifica de nuevo que el número existe en la agenda y abre el chat en la
   * app oficial WhatsApp Personal. Se puede indicar el paquete cuando el
   * teléfono tiene una segunda app de WhatsApp (app dual / WhatsApp Business)
   * para el número de respaldo.
   */
  openChat(options: { phone: string; package?: string }): Promise<AbrirChatResult>;
  /** Apps instaladas que pueden abrir enlaces de WhatsApp (una o dos). */
  listarApps(): Promise<{ apps: AppWhatsApp[] }>;
};

const WhatsAppPersonal = registerPlugin<WhatsAppPersonalPlugin>("WhatsAppPersonal");

/** Dónde se guarda el paquete elegido como «segunda app» en este teléfono. */
export const CLAVE_APP_WHATSAPP_2 = "whatsapp2_app_package";

function esAndroidNativo(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function llamadasWhatsAppPersonalDisponibles(): boolean {
  try {
    return esAndroidNativo() && Capacitor.isPluginAvailable("WhatsAppPersonal");
  } catch {
    return false;
  }
}

/** Paquete configurado para el WhatsApp 2 (vacío = no configurado). */
export function getAppWhatsApp2(): string {
  try {
    return String(localStorage.getItem(CLAVE_APP_WHATSAPP_2) || "").trim();
  } catch {
    return "";
  }
}

export function setAppWhatsApp2(packageName: string): void {
  try {
    const limpio = String(packageName || "").trim();
    if (limpio) localStorage.setItem(CLAVE_APP_WHATSAPP_2, limpio);
    else localStorage.removeItem(CLAVE_APP_WHATSAPP_2);
  } catch {
    /* sin almacenamiento local: se pide de nuevo en Ajustes */
  }
}

/** Lista de apps de WhatsApp instaladas (sólo Android nativo). */
export async function listarAppsWhatsApp(): Promise<AppWhatsApp[]> {
  if (!esAndroidNativo() || !Capacitor.isPluginAvailable("WhatsAppPersonal")) return [];
  try {
    const resultado = await WhatsAppPersonal.listarApps();
    return Array.isArray(resultado?.apps) ? resultado.apps : [];
  } catch {
    return [];
  }
}

/**
 * Intenta abrir la acción de voz de WhatsApp Personal asociada al contacto.
 * Cuando Android no expone esa acción (depende de la sincronización de la
 * agenda de WhatsApp), abre su chat oficial como respaldo para que el operador
 * pulse el botón de llamada. La verificación nativa impide ambas rutas si el
 * contacto no está guardado en la agenda del teléfono.
 *
 * Con `cuenta: "personal_2"` se abre la segunda app configurada en Ajustes
 * (por ejemplo WhatsApp Business en un segundo número, o la app dual).
 */
export async function abrirLlamadaWhatsAppPersonal(
  telefono: string,
  opciones: { cuenta?: CuentaPersonal } = {},
): Promise<AbrirChatResult> {
  const phone = String(telefono || "").replace(/\D/g, "");
  if (phone.length < 8) {
    throw new Error("Este cliente no tiene un número válido para llamar por WhatsApp.");
  }
  if (!esAndroidNativo()) {
    throw new Error("La llamada por WhatsApp Personal está disponible desde la APK Android.");
  }
  if (!Capacitor.isPluginAvailable("WhatsAppPersonal")) {
    throw new Error("Actualiza la APK para usar las llamadas por WhatsApp Personal.");
  }

  let packageName: string | undefined;
  if (opciones.cuenta === "personal_2") {
    packageName = getAppWhatsApp2() || undefined;
    if (!packageName) {
      const error: any = new Error(
        "Primero elige en Ajustes → WhatsApp Personal qué app del teléfono es el WhatsApp 2 " +
          "(la app dual o WhatsApp Business del segundo número).",
      );
      error.code = "APP_WHATSAPP_2_REQUIRED";
      throw error;
    }
  }

  return WhatsAppPersonal.openChat({ phone, ...(packageName ? { package: packageName } : {}) });
}
