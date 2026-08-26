"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

type AbrirChatResult = {
  opened: boolean;
  /** true si Android/WhatsApp expuso la acción nativa de llamada directa. */
  directCall?: boolean;
};

type WhatsAppPersonalPlugin = {
  /**
   * Verifica de nuevo que el número existe en la agenda y abre el chat en la
   * app oficial WhatsApp Personal (com.whatsapp), nunca WhatsApp Business.
   */
  openChat(options: { phone: string }): Promise<AbrirChatResult>;
};

const WhatsAppPersonal = registerPlugin<WhatsAppPersonalPlugin>("WhatsAppPersonal");

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

/**
 * Intenta abrir la acción de voz de WhatsApp Personal asociada al contacto.
 * Cuando Android no expone esa acción (depende de la sincronización de la
 * agenda de WhatsApp), abre su chat oficial como respaldo para que el operador
 * pulse el botón de llamada. La verificación nativa impide ambas rutas si el
 * contacto no está guardado en la agenda del teléfono.
 */
export async function abrirLlamadaWhatsAppPersonal(telefono: string): Promise<AbrirChatResult> {
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
  return WhatsAppPersonal.openChat({ phone });
}
