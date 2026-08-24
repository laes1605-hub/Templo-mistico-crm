"use client";

// ===================== NOTIFICACIONES =====================
// Capa unificada: usa Capacitor Local Notifications en el APK (Android)
// y la Notification API del navegador en la web/PWA.

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const PREF_KEY = "tm_notifs_enabled";

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function notificationsSupported(): boolean {
  if (isNative()) return true;
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotifPref(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PREF_KEY) === "1";
}

export function setNotifPref(enabled: boolean) {
  try {
    localStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {}
}

/** Pide permiso de notificaciones. Devuelve true si fue concedido. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (isNative()) {
      const res = await LocalNotifications.requestPermissions();
      return res.display === "granted";
    }
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    const perm = await Notification.requestPermission();
    return perm === "granted";
  } catch {
    return false;
  }
}

export async function hasNotificationPermission(): Promise<boolean> {
  try {
    if (isNative()) {
      const res = await LocalNotifications.checkPermissions();
      return res.display === "granted";
    }
    return "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
}

// Hash simple de string → entero de 32 bits (ids de notificación en Android)
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

/** Muestra una notificación inmediata (mensaje nuevo, aviso, etc.) */
export async function notify(title: string, body: string, tag?: string) {
  if (!getNotifPref()) return;
  if (!(await hasNotificationPermission())) return;
  try {
    if (isNative()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: hashId(tag || `${title}-${Date.now()}`) % 100000,
            title,
            body,
            smallIcon: "ic_launcher_foreground",
            schedule: { at: new Date(Date.now() + 100) },
          },
        ],
      });
    } else {
      const n = new Notification(title, { body, tag, icon: "/icons/icon-192x192.png" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  } catch (e) {
    console.warn("No se pudo mostrar la notificación:", e);
  }
}

/**
 * Programa recordatorios de tareas pendientes (solo APK/Android).
 * Cada tarea con fecha futura genera una notificación a las 9:00 de ese día.
 * Usa ids estables por tarea: reprogramar no duplica.
 */
export async function scheduleTaskReminders(tareas: any[]) {
  if (!isNative() || !getNotifPref()) return;
  if (!(await hasNotificationPermission())) return;
  try {
    const ahora = Date.now();
    const notifications = (tareas || [])
      .filter((t) => t && !t.completada && t.fecha_vencimiento)
      .map((t) => {
        const d = new Date(t.fecha_vencimiento);
        d.setHours(9, 0, 0, 0);
        return { t, at: d };
      })
      .filter(({ at }) => at.getTime() > ahora)
      .slice(0, 50)
      .map(({ t, at }) => ({
        id: 200000 + (hashId(String(t.id)) % 100000),
        title: "📋 Tarea pendiente",
        body: t.titulo || "Tienes una tarea para hoy",
        smallIcon: "ic_launcher_foreground",
        schedule: { at },
      }));
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch (e) {
    console.warn("No se pudieron programar recordatorios:", e);
  }
}
