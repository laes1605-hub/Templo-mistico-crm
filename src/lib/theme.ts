"use client";

// ===================== SISTEMA DE TEMAS =====================
// Modo: dark | light | system  ·  Acento: purple | blue | emerald | rose | amber | cyan

import { Capacitor, registerPlugin } from "@capacitor/core";

export type ThemeMode = "dark" | "light" | "system";
export type ThemeAccent = "purple" | "blue" | "emerald" | "rose" | "amber" | "cyan";

// Fondos exactos de la interfaz (deben coincidir con --tm-background en
// _colors.generated.css). Se envían a las barras del sistema para que la
// franja de hora/notificaciones se mimetice con la app.
export const BACKGROUND_DARK = "#090d16";
export const BACKGROUND_LIGHT = "#f1f3f7";

// Plugin nativo propio (android/.../StatusBarThemePlugin.java): pinta la
// barra de estado y de navegación con el color de fondo del tema y elige
// iconos claros u oscuros según corresponda.
type StatusBarThemePlugin = {
  apply(options: { color: string; lightIcons: boolean }): Promise<void>;
};
const StatusBarTheme = registerPlugin<StatusBarThemePlugin>("StatusBarTheme");

// Plugin interno de Capacitor 8: recuerda el estilo aplicado y lo vuelve a
// aplicar cuando el sistema rota la pantalla o cambia el modo del sistema.
type SystemBarsPlugin = {
  setStyle(options: { bar: "StatusBar" | "NavigationBar"; style: "LIGHT" | "DARK" }): Promise<void>;
};
const SystemBars = registerPlugin<SystemBarsPlugin>("SystemBars");

/**
 * Lleva el color de la barra de estado (y de navegación) al mismo fondo del
 * CRM. Es un no-op en navegador: sólo actúa dentro de la APK Android.
 */
function syncBarrasSistema(isLight: boolean): void {
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  } catch {
    return;
  }
  const color = isLight ? BACKGROUND_LIGHT : BACKGROUND_DARK;
  const lightIcons = !isLight;
  // Android 14 y anteriores: pinta la franja con el color exacto.
  StatusBarTheme.apply({ color, lightIcons }).catch(() => {});
  // Android 15+ (edge-to-edge): la web ya se dibuja bajo la barra; sólo
  // hay que alinear los iconos claros/oscuros con el tema activo.
  SystemBars.setStyle({ bar: "StatusBar", style: isLight ? "LIGHT" : "DARK" }).catch(() => {});
  SystemBars.setStyle({ bar: "NavigationBar", style: isLight ? "LIGHT" : "DARK" }).catch(() => {});
}

export const ACCENTS: { id: ThemeAccent; label: string; color: string }[] = [
  { id: "purple", label: "Púrpura", color: "#8b5cf6" },
  { id: "blue", label: "Azul", color: "#3b82f6" },
  { id: "emerald", label: "Esmeralda", color: "#10b981" },
  { id: "rose", label: "Rosa", color: "#f43f5e" },
  { id: "amber", label: "Dorado", color: "#f59e0b" },
  { id: "cyan", label: "Turquesa", color: "#06b6d4" },
];

const MODE_KEY = "tm_theme_mode";
const ACCENT_KEY = "tm_theme_accent";

export function getSavedMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const v = localStorage.getItem(MODE_KEY);
  return v === "light" || v === "system" ? v : "dark";
}

export function getSavedAccent(): ThemeAccent {
  if (typeof window === "undefined") return "purple";
  const v = localStorage.getItem(ACCENT_KEY) as ThemeAccent | null;
  return v && ACCENTS.some((a) => a.id === v) ? v : "purple";
}

function resolveIsLight(mode: ThemeMode): boolean {
  if (mode === "light") return true;
  if (mode === "dark") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function applyTheme(mode: ThemeMode, accent: ThemeAccent) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isLight = resolveIsLight(mode);
  root.classList.toggle("light", isLight);
  root.setAttribute("data-accent", accent);
  // Color de la barra de estado / navegador
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isLight ? BACKGROUND_LIGHT : BACKGROUND_DARK);
  // Barras del sistema en la APK (hora/notificaciones y navegación)
  syncBarrasSistema(isLight);
}

export function saveTheme(mode: ThemeMode, accent: ThemeAccent) {
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {}
  applyTheme(mode, accent);
}

/** Inicializa el tema al cargar la app y escucha cambios del sistema. Devuelve cleanup. */
export function initTheme(): () => void {
  applyTheme(getSavedMode(), getSavedAccent());
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (getSavedMode() === "system") applyTheme("system", getSavedAccent());
  };
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}
