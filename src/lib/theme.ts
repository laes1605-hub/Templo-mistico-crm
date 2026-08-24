"use client";

// ===================== SISTEMA DE TEMAS =====================
// Modo: dark | light | system  ·  Acento: purple | blue | emerald | rose | amber | cyan

export type ThemeMode = "dark" | "light" | "system";
export type ThemeAccent = "purple" | "blue" | "emerald" | "rose" | "amber" | "cyan";

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
  if (meta) meta.setAttribute("content", isLight ? "#f3f4f7" : "#090d16");
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
