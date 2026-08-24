"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";
import {
  Brain, Sparkles, RefreshCw, CheckCircle2, X, Archive, Trash2, Edit2,
  Zap, Clock, TrendingUp, AlertTriangle, Copy, Check, ChevronDown, ChevronRight,
  Quote, ShieldCheck, Info, Search, Plus, RotateCcw,
} from "lucide-react";

const CATEGORIA_LABEL: Record<string, string> = {
  cierre: "Cierre", objecion: "Objeción", precio: "Precio", urgencia: "Urgencia",
  empatia: "Empatía", agendamiento: "Agendamiento", seguimiento: "Seguimiento",
  confianza: "Confianza", descubrimiento: "Descubrimiento", otro: "Otro",
};

const CATEGORIA_COLOR: Record<string, string> = {
  cierre: "bg-emerald-950/70 text-emerald-300 border-emerald-800/70",
  objecion: "bg-amber-950/70 text-amber-300 border-amber-800/70",
  precio: "bg-cyan-950/70 text-cyan-300 border-cyan-800/70",
  urgencia: "bg-red-950/70 text-red-300 border-red-800/70",
  empatia: "bg-pink-950/70 text-pink-300 border-pink-800/70",
  agendamiento: "bg-indigo-950/70 text-indigo-300 border-indigo-800/70",
  seguimiento: "bg-blue-950/70 text-blue-300 border-blue-800/70",
  confianza: "bg-violet-950/70 text-violet-300 border-violet-800/70",
  descubrimiento: "bg-teal-950/70 text-teal-300 border-teal-800/70",
  otro: "bg-gray-800/70 text-gray-300 border-gray-700",
};

type Filtro = "pendiente" | "aprobada" | "rechazada" | "archivada" | "todos";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "pendiente", label: "Por aprobar" },
  { id: "aprobada", label: "En memoria" },
  { id: "rechazada", label: "Rechazadas" },
  { id: "archivada", label: "Archivadas" },
  { id: "todos", label: "Todas" },
];

function tiempoRelativo(iso?: string | null) {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "hace un momento";
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`;
  if (d < 86400) return `hace ${Math.floor(d / 3600)} h`;
  if (d < 2592000) return `hace ${Math.floor(d / 86400)} d`;
  return new Date(iso).toLocaleDateString("es-CO");
}

export default function CerebroPanel() {
  const [reglas, setReglas] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [ultimaEjecucion, setUltimaEjecucion] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string>("");
  const [needsMigration, setNeedsMigration] = useState(false);

  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const [busqueda, setBusqueda] = useState("");
  const [procesando, setProcesando] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);

  const [entrenando, setEntrenando] = useState(false);
  const [avisoEntrenamiento, setAvisoEntrenamiento] = useState<string>("");

  const [editando, setEditando] = useState<string | null>(null);
  const [borrTitulo, setBorrTitulo] = useState("");
  const [borrRegla, setBorrRegla] = useState("");

  const [showMemoria, setShowMemoria] = useState(false);
  const [memoria, setMemoria] = useState<{ prompt: string; total: number } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const [showNueva, setShowNueva] = useState(false);
  const [nuevaTitulo, setNuevaTitulo] = useState("");
  const [nuevaRegla, setNuevaRegla] = useState("");
  const [nuevaCategoria, setNuevaCategoria] = useState("cierre");
  const [nuevaEjemplo, setNuevaEjemplo] = useState("");
  const [guardandoNueva, setGuardandoNueva] = useState(false);

  // ------------------------------------------------------------------ carga
  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/cerebro?limit=300", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudieron cargar las reglas.");
        setNeedsMigration(Boolean(data.needsMigration));
        setReglas([]);
      } else {
        setReglas(data.reglas || []);
        setStats(data.stats || null);
        setUltimaEjecucion(data.ultimaEjecucion || null);
        setNeedsMigration(false);
      }
    } catch (e: any) {
      setError("No se pudo conectar con el Cerebro: " + e.message);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
    const sub = supabase
      .channel("r-cerebro")
      .on("postgres_changes", { event: "*", schema: "public", table: "cerebro_reglas" }, () => cargar(true))
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [cargar]);

  // ------------------------------------------------------------- acciones
  async function accionar(id: string, accion: string, extra: Record<string, any> = {}) {
    setProcesando(id);
    // Optimista
    const estadoNuevo =
      accion === "aprobar" ? "aprobada" :
      accion === "rechazar" ? "rechazada" :
      accion === "archivar" ? "archivada" :
      accion === "reabrir" ? "pendiente" : null;
    if (estadoNuevo) {
      setReglas((prev) => prev.map((r) => (r.id === id ? { ...r, estado: estadoNuevo } : r)));
    }
    try {
      const res = await fetch("/api/cerebro", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, accion, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "No se pudo actualizar."); await cargar(true); }
      else { setError(""); await cargar(true); }
    } catch (e: any) {
      setError("Error de red: " + e.message);
      await cargar(true);
    }
    setProcesando(null);
  }

  async function eliminar(id: string) {
    if (!confirm("¿Borrar esta lección definitivamente? No se puede deshacer.")) return;
    setProcesando(id);
    setReglas((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/cerebro?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await cargar(true);
    } catch { await cargar(true); }
    setProcesando(null);
  }

  async function guardarEdicion(id: string) {
    if (!borrTitulo.trim() || !borrRegla.trim()) return;
    setProcesando(id);
    try {
      await fetch("/api/cerebro", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, titulo: borrTitulo, regla: borrRegla }),
      });
      setEditando(null);
      await cargar(true);
    } catch (e: any) { setError(e.message); }
    setProcesando(null);
  }

  async function entrenar() {
    setEntrenando(true);
    setAvisoEntrenamiento("");
    setError("");
    try {
      const res = await fetch("/api/cerebro/extraer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dias: 30, maxConversaciones: 12, maxReglas: 6, origen: "crm_manual" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "El extractor falló.");
        setNeedsMigration(Boolean(data.needsMigration));
      } else if (data.nota) {
        setAvisoEntrenamiento(data.nota);
      } else {
        setAvisoEntrenamiento(
          `Analicé ${data.analizadas} conversación(es) ganada(s) y ${data.mensajes} mensajes. ` +
          `${data.nuevas} lección(es) nueva(s) esperan tu aprobación` +
          (data.duplicadas ? ` (${data.duplicadas} ya las conocía).` : ".")
        );
        setFiltro("pendiente");
      }
      await cargar(true);
    } catch (e: any) {
      setError("No se pudo entrenar: " + e.message);
    }
    setEntrenando(false);
  }

  async function verMemoria() {
    setShowMemoria(true);
    setMemoria(null);
    try {
      const res = await fetch("/api/cerebro/memoria?limit=100", { cache: "no-store" });
      const data = await res.json();
      setMemoria({ prompt: data.prompt || "(La memoria está vacía: aprobá al menos una lección.)", total: data.total || 0 });
    } catch (e: any) {
      setMemoria({ prompt: "Error: " + e.message, total: 0 });
    }
  }

  async function crearManual() {
    if (!nuevaTitulo.trim() || nuevaRegla.trim().length < 12) return;
    setGuardandoNueva(true);
    try {
      const res = await fetch("/api/cerebro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origen: "crm_manual",
          regla: {
            titulo: nuevaTitulo, regla: nuevaRegla, categoria: nuevaCategoria,
            ejemplo: nuevaEjemplo || null, estado: "aprobada", confianza: 1, prioridad: 15,
            justificacion: "Creada manualmente por el administrador.",
            impacto_estimado: "alto",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "No se pudo crear la lección.");
      else {
        setShowNueva(false);
        setNuevaTitulo(""); setNuevaRegla(""); setNuevaEjemplo(""); setNuevaCategoria("cierre");
        setFiltro("aprobada");
      }
      await cargar(true);
    } catch (e: any) { setError(e.message); }
    setGuardandoNueva(false);
  }

  // ------------------------------------------------------------------ vista
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return reglas
      .filter((r) => (filtro === "todos" ? r.estado !== "archivada" || true : r.estado === filtro))
      .filter((r) => !q || `${r.titulo} ${r.regla} ${r.ejemplo || ""}`.toLowerCase().includes(q));
  }, [reglas, filtro, busqueda]);

  const conteo = useMemo(() => ({
    pendiente: reglas.filter((r) => r.estado === "pendiente").length,
    aprobada: reglas.filter((r) => r.estado === "aprobada").length,
    rechazada: reglas.filter((r) => r.estado === "rechazada").length,
    archivada: reglas.filter((r) => r.estado === "archivada").length,
    todos: reglas.length,
  }), [reglas]);

  const poderCierre = Math.min(100, Math.round(conteo.aprobada * 8 + (stats?.confianzaPromedio || 0) * 20));

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-background space-y-6">
      {/* ---------------------------------------------------------- HEADER */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl md:text-2xl font-bold text-gray-100 flex items-center gap-2">
              <Brain className="text-purple-400 w-6 h-6" /> Cerebro de Luna
            </h1>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${conteo.aprobada > 0 ? "bg-emerald-950/60 text-emerald-400 border-emerald-800" : "bg-amber-950/60 text-amber-400 border-amber-800"}`}>
              {conteo.aprobada > 0 ? `${conteo.aprobada} lecciones activas` : "Memoria vacía"}
            </span>
          </div>
          <p className="text-xs md:text-sm text-gray-400 mt-1 max-w-2xl">
            Luna analiza las conversaciones donde el cliente <span className="text-emerald-400 font-medium">pagó o agendó</span> y
            extrae las técnicas que cerraron la venta. Aprobá una lección y entra en su memoria al instante.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => cargar()} disabled={cargando}
            className="bg-surface hover:bg-surfaceHover border border-border text-gray-300 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all">
            <RefreshCw className={`w-3.5 h-3.5 ${cargando ? "animate-spin" : ""}`} /> Actualizar
          </button>
          <button onClick={verMemoria}
            className="bg-surface hover:bg-surfaceHover border border-border text-gray-300 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Ver memoria
          </button>
          <button onClick={() => setShowNueva(true)}
            className="bg-surface hover:bg-surfaceHover border border-border text-gray-300 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all">
            <Plus className="w-3.5 h-3.5" /> Lección manual
          </button>
          <button onClick={entrenar} disabled={entrenando}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-purple-900/30 flex items-center gap-2 transition-all">
            <Sparkles className={`w-4 h-4 ${entrenando ? "animate-spin" : ""}`} />
            {entrenando ? "Analizando ventas..." : "Entrenar ahora"}
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------- AVISOS */}
      {needsMigration && (
        <div className="p-4 rounded-xl border border-amber-800/50 bg-amber-950/20 text-amber-200 text-xs flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-bold mb-1">Falta crear la tabla en Supabase</p>
            <p className="text-amber-300/80">
              Abrí Supabase → SQL Editor y ejecutá el archivo
              <code className="mx-1 px-1.5 py-0.5 rounded bg-black/40 font-mono text-[10px]">supabase/migrations/20260824_fase3_cerebro_ia.sql</code>
              del repositorio. Después tocá “Actualizar”.
            </p>
          </div>
        </div>
      )}
      {error && !needsMigration && (
        <div className="p-3 rounded-xl border border-red-800/50 bg-red-950/20 text-red-300 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{error}</span>
        </div>
      )}
      {avisoEntrenamiento && (
        <div className="p-3 rounded-xl border border-purple-800/40 bg-purple-950/20 text-purple-200 text-xs flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{avisoEntrenamiento}</span>
        </div>
      )}

      {/* --------------------------------------------------------- MÉTRICAS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Por aprobar</span>
          <p className="text-xl md:text-2xl font-extrabold text-amber-400 mt-1">{conteo.pendiente}</p>
        </div>
        <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">En memoria</span>
          <p className="text-xl md:text-2xl font-extrabold text-emerald-400 mt-1">{conteo.aprobada}</p>
        </div>
        <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Confianza IA</span>
          <p className="text-xl md:text-2xl font-extrabold text-purple-400 mt-1">
            {stats ? Math.round((stats.confianzaPromedio || 0) * 100) : 0}%
          </p>
        </div>
        <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Poder de cierre</span>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-2 rounded-full bg-background overflow-hidden border border-border">
              <div className="h-full bg-gradient-to-r from-purple-500 to-emerald-400 transition-all duration-700" style={{ width: `${poderCierre}%` }} />
            </div>
            <span className="text-sm font-extrabold text-gray-100">{poderCierre}%</span>
          </div>
        </div>
      </div>

      {ultimaEjecucion && (
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          Último entrenamiento {tiempoRelativo(ultimaEjecucion.creado_en)} · analizó{" "}
          {ultimaEjecucion.conversaciones_analizadas} conversación(es) y sugirió {ultimaEjecucion.reglas_nuevas} lección(es) nueva(s)
          {ultimaEjecucion.estado === "error" && <span className="text-red-400"> · terminó con error</span>}
        </p>
      )}

      {/* ---------------------------------------------------------- FILTROS */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filtro === f.id ? "bg-purple-600 border-purple-500 text-white" : "bg-surface border-border text-gray-400 hover:text-gray-200"}`}>
              {f.label}
              <span className={`ml-1.5 text-[10px] ${filtro === f.id ? "text-purple-200" : "text-gray-600"}`}>{(conteo as any)[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 md:max-w-xs">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar lección..."
            className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500" />
        </div>
      </div>

      {/* ---------------------------------------------------------- TARJETAS */}
      {cargando ? (
        <div className="py-20 text-center space-y-3">
          <Brain className="w-10 h-10 text-purple-500 animate-pulse mx-auto" />
          <p className="text-sm text-gray-400">Consultando el cerebro de Luna...</p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="py-16 text-center space-y-4 border border-dashed border-border rounded-2xl bg-surface/30">
          <Brain className="w-12 h-12 text-gray-700 mx-auto stroke-[1.5]" />
          <div>
            <p className="text-sm font-bold text-gray-300">
              {filtro === "pendiente" ? "No hay lecciones esperando aprobación" : "Sin lecciones en esta vista"}
            </p>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              {filtro === "pendiente"
                ? "Tocá “Entrenar ahora” para que Luna analice tus ventas cerradas de los últimos 30 días y proponga nuevas técnicas."
                : "Cambiá de filtro o entrená al cerebro para generar lecciones."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {visibles.map((r) => {
            const cat = String(r.categoria || "otro");
            const abierta = expandida === r.id;
            const esPendiente = r.estado === "pendiente";
            const esAprobada = r.estado === "aprobada";
            const enEdicion = editando === r.id;

            return (
              <article key={r.id}
                className={`bg-surface border rounded-2xl overflow-hidden transition-all ${
                  esAprobada ? "border-emerald-900/60 shadow-lg shadow-emerald-950/10"
                  : esPendiente ? "border-purple-900/50"
                  : "border-border opacity-70"}`}>

                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border ${CATEGORIA_COLOR[cat] || CATEGORIA_COLOR.otro}`}>
                        {CATEGORIA_LABEL[cat] || cat}
                      </span>
                      {esAprobada && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5" /> EN MEMORIA
                        </span>
                      )}
                      {r.estado === "rechazada" && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-red-950/60 text-red-400 border border-red-900">RECHAZADA</span>
                      )}
                      {r.estado === "archivada" && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-gray-800 text-gray-400 border border-gray-700">ARCHIVADA</span>
                      )}
                      {r.impacto_estimado === "alto" && esPendiente && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-amber-950/60 text-amber-300 border border-amber-800/60 flex items-center gap-1">
                          <TrendingUp className="w-2.5 h-2.5" /> ALTO IMPACTO
                        </span>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-[9px] text-gray-500 uppercase font-bold block">Confianza</span>
                      <span className={`text-sm font-extrabold ${Number(r.confianza) >= 0.8 ? "text-emerald-400" : Number(r.confianza) >= 0.6 ? "text-amber-400" : "text-gray-400"}`}>
                        {Math.round(Number(r.confianza || 0) * 100)}%
                      </span>
                    </div>
                  </div>

                  {enEdicion ? (
                    <div className="space-y-2">
                      <input value={borrTitulo} onChange={(e) => setBorrTitulo(e.target.value)}
                        className="w-full bg-background border border-purple-600 rounded-lg px-3 py-2 text-sm font-bold text-gray-100 focus:outline-none" />
                      <textarea value={borrRegla} onChange={(e) => setBorrRegla(e.target.value)} rows={4}
                        className="w-full bg-background border border-purple-600 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none resize-none" />
                      <div className="flex gap-2">
                        <button onClick={() => guardarEdicion(r.id)} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-2 rounded-lg">Guardar</button>
                        <button onClick={() => setEditando(null)} className="px-4 bg-surfaceHover border border-border text-gray-300 text-xs py-2 rounded-lg">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-base font-bold text-gray-100 leading-snug">{r.titulo}</h3>
                      <p className="text-xs text-gray-300 leading-relaxed">{r.regla}</p>
                    </>
                  )}

                  {r.ejemplo && !enEdicion && (
                    <div className="bg-background/80 border-l-2 border-purple-600 rounded-r-lg px-3 py-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Quote className="w-3 h-3 text-purple-400" />
                        <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">Frase real que funcionó</span>
                      </div>
                      <p className="text-[11px] text-gray-400 italic leading-relaxed">“{r.ejemplo}”</p>
                    </div>
                  )}

                  {/* Acciones de 1 clic */}
                  {!enEdicion && (
                    <div className="flex items-center gap-2 pt-1">
                      {esPendiente ? (
                        <>
                          <button onClick={() => accionar(r.id, "aprobar")} disabled={procesando === r.id}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-emerald-950/30">
                            <CheckCircle2 className="w-4 h-4" /> Aprobar y enseñar a Luna
                          </button>
                          <button onClick={() => accionar(r.id, "rechazar")} disabled={procesando === r.id} title="Rechazar"
                            className="p-2.5 bg-surfaceHover hover:bg-red-950/60 border border-border hover:border-red-800 text-gray-400 hover:text-red-400 rounded-xl transition-all">
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : esAprobada ? (
                        <>
                          <div className="flex-1 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                            <Zap className="w-3.5 h-3.5" /> Activa en el prompt de Luna
                            {r.veces_usada > 0 && <span className="text-gray-500">· usada {r.veces_usada}×</span>}
                          </div>
                          <button onClick={() => accionar(r.id, "archivar")} title="Sacar de la memoria"
                            className="p-2 bg-surfaceHover hover:bg-amber-950/50 border border-border text-gray-400 hover:text-amber-400 rounded-lg transition-all">
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => accionar(r.id, "aprobar")}
                            className="flex-1 bg-surfaceHover hover:bg-emerald-950/50 border border-border hover:border-emerald-800 text-gray-300 hover:text-emerald-400 text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Aprobar igual
                          </button>
                          <button onClick={() => accionar(r.id, "reabrir")} title="Volver a pendiente"
                            className="p-2 bg-surfaceHover border border-border text-gray-400 hover:text-purple-400 rounded-lg transition-all">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button onClick={() => { setEditando(r.id); setBorrTitulo(r.titulo); setBorrRegla(r.regla); }} title="Editar"
                        className="p-2 bg-surfaceHover border border-border text-gray-400 hover:text-purple-400 rounded-lg transition-all">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => eliminar(r.id)} title="Borrar"
                        className="p-2 bg-surfaceHover border border-border text-gray-500 hover:text-red-400 rounded-lg transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Detalle */}
                <button onClick={() => setExpandida(abierta ? null : r.id)}
                  className="w-full px-5 py-2 border-t border-border/60 bg-background/40 flex items-center justify-between text-[10px] text-gray-500 hover:text-gray-300 transition-colors">
                  <span className="flex items-center gap-1.5">
                    {abierta ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    Ver evidencia y origen
                  </span>
                  <span>{tiempoRelativo(r.creado_en)}</span>
                </button>

                {abierta && (
                  <div className="px-5 py-4 bg-background/60 border-t border-border/40 space-y-3 text-[11px]">
                    {r.justificacion && (
                      <div>
                        <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Por qué funciona</span>
                        <p className="text-gray-400 leading-relaxed">{r.justificacion}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-[9px] font-bold text-gray-500 uppercase block">Origen</span>
                        <p className="text-gray-300">{r.origen === "crm_manual" ? "Creada por vos" : r.origen === "seed" ? "Ejemplo inicial" : "Extractor automático"}</p>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold text-gray-500 uppercase block">Prioridad</span>
                        <p className="text-gray-300">{r.prioridad}</p>
                      </div>
                      {r.evidencia?.conversaciones_analizadas != null && (
                        <div>
                          <span className="text-[9px] font-bold text-gray-500 uppercase block">Conversaciones base</span>
                          <p className="text-gray-300">{r.evidencia.conversaciones_analizadas} ganadas</p>
                        </div>
                      )}
                      {r.evidencia?.ventana_dias != null && (
                        <div>
                          <span className="text-[9px] font-bold text-gray-500 uppercase block">Ventana</span>
                          <p className="text-gray-300">Últimos {r.evidencia.ventana_dias} días</p>
                        </div>
                      )}
                      {r.revisado_en && (
                        <div>
                          <span className="text-[9px] font-bold text-gray-500 uppercase block">Revisada</span>
                          <p className="text-gray-300">{tiempoRelativo(r.revisado_en)}</p>
                        </div>
                      )}
                      {r.ultima_inyeccion_en && (
                        <div>
                          <span className="text-[9px] font-bold text-gray-500 uppercase block">Última inyección</span>
                          <p className="text-gray-300">{tiempoRelativo(r.ultima_inyeccion_en)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------- MODAL: MEMORIA */}
      {showMemoria && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-3xl bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="text-lg font-bold text-gray-100">Memoria activa de Luna</h3>
                {memoria && <span className="text-[10px] bg-emerald-950 border border-emerald-800 text-emerald-400 px-2 py-0.5 rounded-full font-bold">{memoria.total} reglas</span>}
              </div>
              <button onClick={() => setShowMemoria(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[11px] text-gray-400">
              Esto es exactamente lo que n8n inyecta en el System Prompt de Luna desde
              <code className="mx-1 px-1.5 py-0.5 rounded bg-background font-mono text-[10px] text-purple-300">GET /api/cerebro/memoria</code>
            </p>
            <div className="flex-1 overflow-y-auto">
              {!memoria ? (
                <div className="p-12 text-center"><Brain className="w-10 h-10 text-purple-500 animate-pulse mx-auto" /></div>
              ) : (
                <pre className="text-[11px] leading-relaxed whitespace-pre-wrap text-gray-300 bg-background/80 p-5 rounded-xl border border-border font-mono">{memoria.prompt}</pre>
              )}
            </div>
            {memoria && (
              <button onClick={() => { navigator.clipboard?.writeText(memoria.prompt); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-2">
                {copiado ? <><Check className="w-4 h-4" /> Copiado</> : <><Copy className="w-4 h-4" /> Copiar memoria</>}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------ MODAL: LECCIÓN MANUAL */}
      {showNueva && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-lg bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-purple-400"><Plus className="w-5 h-5" /><h3 className="text-lg font-bold text-gray-100">Enseñarle algo a Luna</h3></div>
              <button onClick={() => setShowNueva(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Título corto</label>
                <input value={nuevaTitulo} onChange={(e) => setNuevaTitulo(e.target.value)} placeholder="Ej: Nunca dar el precio sin diagnóstico"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Instrucción para Luna</label>
                <textarea value={nuevaRegla} onChange={(e) => setNuevaRegla(e.target.value)} rows={4} placeholder="Escribile la orden tal como querés que la aplique en el chat..."
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Categoría</label>
                <select value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500">
                  {Object.entries(CATEGORIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">Frase de ejemplo (opcional)</label>
                <textarea value={nuevaEjemplo} onChange={(e) => setNuevaEjemplo(e.target.value)} rows={2}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-none" />
              </div>
            </div>
            <button onClick={crearManual} disabled={guardandoNueva || !nuevaTitulo.trim() || nuevaRegla.trim().length < 12}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {guardandoNueva ? "Guardando..." : "Guardar y activar en la memoria"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
