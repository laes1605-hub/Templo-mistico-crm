"use client";

// ===================== NOTIFICACIONES =====================
// Capa unificada: usa Capacitor Local Notifications en el APK (Android)
// y la Notification API del navegador en la web/PWA.

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const PREF_KEY = "tm_notifs_enabled";

/**
 * IDs estables de las categorías/canales de Android. Android permite que cada
 * persona ajuste por separado el sonido, vibración y prioridad de cada canal.
 */
export const NOTIFICATION_CHANNELS = {
  MESSAGES: "crm_messages",
  TASK_REMINDERS: "crm_task_reminders",
  FOLLOW_UPS: "crm_follow_ups",
  GENERAL: "crm_general",
} as const;

/** ID fijo: al recalcular se reemplaza el único aviso diario, no se duplica. */
const FOLLOW_UP_NOTIFICATION_ID = 320001;

const ANDROID_CHANNELS = [
  {
    id: NOTIFICATION_CHANNELS.MESSAGES,
    name: "Mensajes de clientes",
    description: "Avisos cuando recibes un mensaje nuevo de un cliente.",
    importance: 4 as const,
    visibility: 0 as const,
    vibration: true,
    lights: true,
    lightColor: "#8B5CF6",
  },
  {
    id: NOTIFICATION_CHANNELS.TASK_REMINDERS,
    name: "Recordatorios de tareas",
    description: "Recordatorios de tareas pendientes y fechas de vencimiento.",
    importance: 4 as const,
    visibility: 0 as const,
    vibration: true,
    lights: true,
    lightColor: "#8B5CF6",
  },
  {
    id: NOTIFICATION_CHANNELS.FOLLOW_UPS,
    name: "Seguimientos de clientes",
    description: "Aviso diario para revisar los clientes en la etapa En seguimiento.",
    importance: 4 as const,
    visibility: 0 as const,
    vibration: true,
    lights: true,
    lightColor: "#06B6D4",
  },
  {
    id: NOTIFICATION_CHANNELS.GENERAL,
    name: "Avisos del CRM",
    description: "Confirmaciones, pruebas y avisos generales de Templo Místico CRM.",
    importance: 3 as const,
    visibility: 0 as const,
    vibration: true,
    lights: true,
    lightColor: "#8B5CF6",
  },
];

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
    // La bandeja escucha este evento para crear/cancelar el aviso diario de
    // seguimiento en el mismo instante, incluso si los clientes ya cargaron.
    window.dispatchEvent(new Event("tm-notification-pref-changed"));
  } catch {}
}

/**
 * Registra explícitamente todos los canales de esta app en Android 8+.
 * Se puede invocar más de una vez: Android conserva las elecciones que la
 * persona haya hecho para cada categoría.
 */
export async function initializeNotificationChannels(): Promise<void> {
  if (!isNative()) return;
  try {
    await Promise.all(ANDROID_CHANNELS.map((channel) => LocalNotifications.createChannel(channel)));
  } catch (error) {
    // En plataformas distintas de Android el método no está disponible.
    console.warn("No se pudieron preparar las categorías de notificación:", error);
  }
}

/** Pide permiso de notificaciones. Devuelve true si fue concedido. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (isNative()) {
      // Crea las categorías antes del diálogo de Android para que sean visibles
      // de inmediato en Ajustes > Notificaciones de Templo Místico CRM.
      await initializeNotificationChannels();
      const current = await LocalNotifications.checkPermissions();
      if (current.display === "granted") return true;
      const res = await LocalNotifications.requestPermissions();
      return res.display === "granted";
    }
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    const perm = await Notification.requestPermission();
    return perm === "granted";
  } catch (error) {
    console.warn("No se pudo solicitar el permiso de notificaciones:", error);
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
export async function notify(title: string, body: string, tag?: string, channelId: string = NOTIFICATION_CHANNELS.GENERAL) {
  if (!getNotifPref()) return;
  if (!(await hasNotificationPermission())) return;
  try {
    if (isNative()) {
      await initializeNotificationChannels();
      await LocalNotifications.schedule({
        notifications: [
          {
            id: hashId(tag || `${title}-${Date.now()}`) % 100000,
            title,
            body,
            smallIcon: "ic_stat_templo",
            channelId,
            group: channelId,
            foreground: true,
            // No necesita permiso de alarmas exactas para un aviso inmediato.
            isExactNotification: false,
            schedule: { at: new Date(Date.now() + 200), allowWhileIdle: true },
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
    await initializeNotificationChannels();
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
        smallIcon: "ic_stat_templo",
        channelId: NOTIFICATION_CHANNELS.TASK_REMINDERS,
        group: NOTIFICATION_CHANNELS.TASK_REMINDERS,
        schedule: { at, allowWhileIdle: true },
      }));
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch (e) {
    console.warn("No se pudieron programar recordatorios:", e);
  }
}

/**
 * Programa un único aviso que se repite todos los días a las 9:00 a. m. en el
 * teléfono. Se cancela antes de reprogramarlo para que el estado actual de la
 * etapa En seguimiento nunca cree avisos duplicados. Es una notificación local:
 * queda programada aunque la APK esté en segundo plano.
 */
export async function scheduleFollowUpReminders(clientesEnSeguimiento: any[]) {
  if (!isNative()) return;

  try {
    // Al quitar el último cliente de la etapa o apagar Avisos, el recordatorio
    // recurrente anterior debe desaparecer de Android de inmediato.
    await LocalNotifications.cancel({ notifications: [{ id: FOLLOW_UP_NOTIFICATION_ID }] });
  } catch {
    // Cancelar una notificación que aún no existe no es un problema.
  }

  if (!getNotifPref() || !(await hasNotificationPermission())) return;
  const cantidad = (clientesEnSeguimiento || []).filter(Boolean).length;
  if (cantidad === 0) return;

  try {
    await initializeNotificationChannels();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: FOLLOW_UP_NOTIFICATION_ID,
          title: "📌 Seguimientos pendientes",
          body: "Revisa los clientes que están en la etapa En seguimiento.",
          summaryText: `${cantidad} cliente(s) en seguimiento al programar el aviso`,
          smallIcon: "ic_stat_templo",
          channelId: NOTIFICATION_CHANNELS.FOLLOW_UPS,
          group: NOTIFICATION_CHANNELS.FOLLOW_UPS,
          foreground: true,
          // Un aviso diario no necesita abrir la pantalla de alarmas exactas.
          isExactNotification: false,
          schedule: {
            on: { hour: 9, minute: 0 },
            repeats: true,
            allowWhileIdle: true,
          },
        },
      ],
    });
  } catch (e) {
    console.warn("No se pudo programar el aviso diario de seguimiento:", e);
  }
}
