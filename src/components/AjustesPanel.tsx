"use client";

import React, { useEffect, useState } from "react";
import { X, Moon, Sun, MonitorSmartphone, Bell, BellOff, Check, Palette } from "lucide-react";
import {
  ACCENTS, ThemeAccent, ThemeMode,
  getSavedAccent, getSavedMode, saveTheme,
} from "../lib/theme";
import {
  getNotifPref,
  setNotifPref,
  requestNotificationPermission,
  initializeNotificationChannels,
  notificationsSupported,
  notify,
  isNative,
} from "../lib/notifications";

export default function AjustesPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [accent, setAccent] = useState<ThemeAccent>("purple");
  const [notifs, setNotifs] = useState(false);
  const [notifError, setNotifError] = useState("");

  useEffect(() => {
    setMode(getSavedMode());
    setAccent(getSavedAccent());
    setNotifs(getNotifPref());
    // En Android registra las categorías aunque aún no se hayan activado los avisos.
    void initializeNotificationChannels();
  }, []);

  function cambiarModo(m: ThemeMode) {
    setMode(m);
    saveTheme(m, accent);
  }

  function cambiarAccent(a: ThemeAccent) {
    setAccent(a);
    saveTheme(mode, a);
  }

  async function toggleNotifs() {
    setNotifError("");
    if (notifs) {
      setNotifPref(false);
      setNotifs(false);
      return;
    }
    if (!notificationsSupported()) {
      setNotifError("Este dispositivo/navegador no soporta notificaciones.");
      return;
    }
    const ok = await requestNotificationPermission();
    if (!ok) {
      setNotifError("Permiso denegado. Actívalo en los ajustes del teléfono/navegador.");
      return;
    }
    setNotifPref(true);
    setNotifs(true);
    notify("🔮 Templo Místico CRM", "Las notificaciones están activadas ✓", "test");
  }

  const modos: { id: ThemeMode; label: string; icon: any }[] = [
    { id: "dark", label: "Oscuro", icon: Moon },
    { id: "light", label: "Claro", icon: Sun },
    { id: "system", label: "Sistema", icon: MonitorSmartphone },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <Palette className="w-5 h-5 text-purple-400" /> Apariencia y avisos
          </h2>
          <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-gray-200 rounded-lg hover:bg-surfaceHover">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODO CLARO / OSCURO */}
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-2">Modo de interfaz</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {modos.map((m) => (
            <button
              key={m.id}
              onClick={() => cambiarModo(m.id)}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-all ${
                mode === m.id
                  ? "bg-purple-600 border-purple-500 text-white shadow-lg"
                  : "bg-background border-border text-gray-400 hover:border-purple-500/50 hover:text-gray-200"
              }`}
            >
              <m.icon className="w-5 h-5" />
              {m.label}
            </button>
          ))}
        </div>

        {/* COLOR DE ACENTO */}
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-2">Color de interfaz</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => cambiarAccent(a.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                accent === a.id
                  ? "border-purple-500 bg-surfaceHover text-gray-100"
                  : "border-border bg-background text-gray-400 hover:text-gray-200"
              }`}
            >
              <span
                className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ backgroundColor: a.color }}
              >
                {accent === a.id && <Check className="w-3 h-3 text-white" />}
              </span>
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>

        {/* NOTIFICACIONES */}
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-2">Notificaciones</p>
        <button
          onClick={toggleNotifs}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
            notifs
              ? "bg-purple-950/20 border-purple-800/40 text-purple-300"
              : "bg-background border-border text-gray-400 hover:text-gray-200"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            {notifs ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            Avisos en el teléfono
          </span>
          <span
            className={`w-10 rounded-full p-0.5 transition-colors ${notifs ? "bg-purple-600" : "bg-surfaceHover"}`}
            style={{ height: 22 }}
          >
            <span
              className={`block w-[18px] h-[18px] rounded-full bg-white transition-transform ${notifs ? "translate-x-[18px]" : ""}`}
            />
          </span>
        </button>
        <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
          Recibirás un aviso cuando llegue un mensaje nuevo de un cliente
          {isNative() ? " y recordatorios de tus tareas pendientes" : ""}.
          {isNative() ? " Funciona con la app abierta o en segundo plano. En Ajustes del teléfono podrás administrar por separado Mensajes de clientes, Recordatorios de tareas y Avisos del CRM." : ""}
        </p>
        {notifError && <p className="text-[11px] text-red-400 mt-2">{notifError}</p>}
      </div>
    </div>
  );
}
