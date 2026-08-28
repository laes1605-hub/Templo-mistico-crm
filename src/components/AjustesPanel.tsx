"use client";

import React, { useEffect, useState } from "react";
import { X, Moon, Sun, MonitorSmartphone, Bell, BellOff, Check, Palette, Mic, Save } from "lucide-react";
import { supabase } from "../lib/supabase";
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
  // Notas de voz nativas por WhatsApp API: credenciales del canal WhatsApp Cloud.
  const [metaToken, setMetaToken] = useState("");
  const [metaPhoneId, setMetaPhoneId] = useState("");
  const [metaGuardando, setMetaGuardando] = useState(false);
  const [metaMsg, setMetaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [metaVerToken, setMetaVerToken] = useState(false);

  useEffect(() => {
    setMode(getSavedMode());
    setAccent(getSavedAccent());
    setNotifs(getNotifPref());
    // En Android registra las categorías aunque aún no se hayan activado los avisos.
    void initializeNotificationChannels();
    (async () => {
      try {
        const { data } = await supabase
          .from("config_general")
          .select("clave, valor")
          .in("clave", ["meta_voice_token", "meta_voice_phone_number_id"]);
        (data || []).forEach((row: any) => {
          if (row.clave === "meta_voice_token") setMetaToken(String(row.valor || ""));
          if (row.clave === "meta_voice_phone_number_id") setMetaPhoneId(String(row.valor || ""));
        });
      } catch {
        /* config_general no disponible: se puede escribir igual al guardar */
      }
    })();
  }, []);

  async function guardarCredencialesMeta() {
    setMetaMsg(null);
    setMetaGuardando(true);
    try {
      const token = metaToken.trim();
      const phoneId = metaPhoneId.trim();
      const filas: { clave: string; valor: string }[] = [];
      if (token || phoneId) {
        const { data } = await supabase
          .from("config_general")
          .select("clave")
          .in("clave", ["meta_voice_token", "meta_voice_phone_number_id"]);
        const existentes = new Set((data || []).map((r: any) => r.clave));
        for (const [clave, valor] of [
          ["meta_voice_token", token],
          ["meta_voice_phone_number_id", phoneId],
        ] as const) {
          if (valor) filas.push({ clave, valor });
          else if (existentes.has(clave)) {
            // valor vacío = borrar la credencial guardada
            filas.push({ clave, valor: "" });
          }
        }
      }
      if (filas.length) {
        const { error } = await supabase.from("config_general").upsert(filas);
        if (error) throw new Error(error.message);
      }
      setMetaMsg({ ok: true, text: "Guardado. La próxima nota de voz se intentará enviar como nativa." });
    } catch (e: any) {
      setMetaMsg({ ok: false, text: "No se pudo guardar: " + (e?.message || "error desconocido") });
    } finally {
      setMetaGuardando(false);
    }
  }

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
    <div className="fixed inset-0 bg-scrim backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
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
            className={`w-10 rounded-full p-0.5 transition-colors ${notifs ? "bg-purple-600" : "bg-gray-700"}`}
            style={{ height: 22 }}
          >
            <span
              className={`block w-[18px] h-[18px] rounded-full bg-white shadow ring-1 ring-gray-950/10 transition-transform ${notifs ? "translate-x-[18px]" : ""}`}
            />
          </span>
        </button>
        <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
          Recibirás un aviso cuando llegue un mensaje nuevo de un cliente
          {isNative() ? ", recordatorios de tus tareas y el aviso diario de En seguimiento" : ""}.
          {isNative() ? " Funciona con la app abierta o en segundo plano. En Ajustes del teléfono podrás administrar por separado Mensajes de clientes, Recordatorios de tareas, Seguimientos de clientes y Avisos del CRM." : ""}
        </p>
        {notifError && <p className="text-[11px] text-red-400 mt-2">{notifError}</p>}

        {/* NOTAS DE VOZ NATIVAS (WhatsApp API) */}
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-2 mt-5">
          Notas de voz · WhatsApp API
        </p>
        <div className="space-y-2">
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Access Token del canal WhatsApp Cloud</label>
            <div className="relative">
              <input
                type={metaVerToken ? "text" : "password"}
                value={metaToken}
                onChange={(e) => setMetaToken(e.target.value)}
                placeholder="EAAG… (token de la cuenta WhatsApp Business)"
                autoComplete="off"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 pr-16 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={() => setMetaVerToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-gray-500 hover:text-gray-200"
              >
                {metaVerToken ? "Ocultar" : "Ver"}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Phone Number ID</label>
            <input
              type="text"
              value={metaPhoneId}
              onChange={(e) => setMetaPhoneId(e.target.value)}
              placeholder="1234567890 (ID del número de teléfono)"
              autoComplete="off"
              inputMode="numeric"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
            />
          </div>
          <button
            type="button"
            onClick={guardarCredencialesMeta}
            disabled={metaGuardando}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
          >
            <Save className="w-4 h-4" />
            {metaGuardando ? "Guardando..." : "Guardar credenciales"}
          </button>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Con estas credenciales la app envía las notas de voz <strong>directo a Meta</strong>{" "}
            (<code className="text-gray-400">voice: true</code>) y llegan como burbuja de nota de voz
            nativa, sin depender del rol del token de Chatwoot. Se consiguen en{" "}
            <strong>Chatwoot → Inboxes → WhatsApp Cloud</strong> (el campo "API Key" es el token) y el{" "}
            Phone Number ID en <strong>Meta Business Manager → API Setup → WhatsApp</strong>.
            Si el token de Chatwoot es administrador, esta sección puede quedarse vacía.
          </p>
          {metaMsg && (
            <p className={`text-[11px] mt-1 ${metaMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
              <Mic className="w-3 h-3 inline mr-1" />
              {metaMsg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
