"use client";

import React, { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { supabase } from "../lib/supabase";
import VoiceNotePlayer from "../components/VoiceNotePlayer";
import CerebroPanel from "../components/CerebroPanel";
import {
  MessageSquare, Users, DollarSign, TrendingUp, Brain, Send, Bot, Phone,
  CheckCircle2, Clock, Plus, Ban, Settings, Edit2, Trash2, ArrowUp, ArrowDown,
  Wallet, Target, TrendingDown, Award, Calendar, Shield, X,
  Mic, Paperclip, ArrowLeft, Info, ListTodo, CheckSquare, Square,
  Sparkles, Play, Pause, RefreshCw, Image as ImageIcon, ChevronDown, ChevronRight,
  Archive, ArchiveRestore, Search, AlertTriangle,
  StickyNote, FileText, Coins, Globe, Percent, Save, Eye, EyeOff
} from "lucide-react";

export default function CRMApp() {
  const [tab, setTab] = useState<"chats" | "pipeline" | "cartera" | "tareas" | "ads" | "cerebro" | "archivados">("chats");
  
  const [conversaciones, setConversaciones] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any | null>(null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [clienteActual, setClienteActual] = useState<any | null>(null);
  
  const [todosPagos, setTodosPagos] = useState<any[]>([]);
  const [todosClientes, setTodosClientes] = useState<any[]>([]);
  const [todasTareas, setTodosTareas] = useState<any[]>([]);
  const [tareasCliente, setTareasCliente] = useState<any[]>([]);
  const [pagosCliente, setPagosCliente] = useState<any[]>([]);
  
  const [pipelineEtapas, setPipelineEtapas] = useState<any[]>([]);
  const [isEditingPipeline, setIsEditingPipeline] = useState(false);

  // META ADS
  const [campanas, setCampanas] = useState<any[]>([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [isLiveAds, setIsLiveAds] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState<string | null>(null);
  const [loadingAiAds, setLoadingAiAds] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [adsNote, setAdsNote] = useState("");
  const [expandedCamp, setExpandedCamp] = useState<string | null>(null);
  const [adsQuery, setAdsQuery] = useState("");
  const [adsStatusFilter, setAdsStatusFilter] = useState<"all" | "ACTIVE" | "PAUSED">("all");

  const [isEditingNombre, setIsEditingNombre] = useState(false);
  const [tempNombre, setTempNombre] = useState("");

  // NOTAS PERSONALES
  const [isEditingNotas, setIsEditingNotas] = useState(false);
  const [tempNotas, setTempNotas] = useState("");
  const [tempDetallesCaso, setTempDetallesCaso] = useState("");

  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendNotice, setSendNotice] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);
  const [filtroCanal, setFiltroCanal] = useState<"todos" | "evolution" | "meta_business" | "spam">("todos");
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  
  // ARCHIVADOS & ELIMINAR
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filtroArchivados, setFiltroArchivados] = useState<"todos" | "evolution" | "meta_business">("todos");
  const [searchArchivados, setSearchArchivados] = useState("");
  const [searchChats, setSearchChats] = useState("");

  // PAGOS Y DIVISAS
  const [tipoPago, setTipoPago] = useState<"unico" | "cuotas">("unico");
  const [montoTotal, setMontoTotal] = useState("");
  const [numeroCuotas, setNumeroCuotas] = useState("2");
  const [fechaInicial, setFechaInicial] = useState("");
  const [metodoPago, setMetodoPago] = useState("Nequi");
  const [notaPago, setNotaPago] = useState("");
  const [monedaPago, setMonedaPago] = useState<"COP" | "PYG" | "USD" | "EUR" | "BRL" | "MXN">("COP");
  const [comisionPago, setComisionPago] = useState("7");
  const [tasaCambioPago, setTasaCambioPago] = useState("1");

  // CONFIG GLOBAL DIVISAS
  const [tasaPYG, setTasaPYG] = useState(0.55);
  const [tasaUSD, setTasaUSD] = useState(4100);
  const [tasaEUR, setTasaEUR] = useState(4500);
  const [tasaBRL, setTasaBRL] = useState(800);
  const [tasaMXN, setTasaMXN] = useState(230);
  const [comisionDefault, setComisionDefault] = useState(7);
  const [showDivisaConfig, setShowDivisaConfig] = useState(false);

  const [nuevaTareaTitulo, setNuevaTareaTitulo] = useState("");
  const [nuevaTareaFecha, setNuevaTareaFecha] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [isPreparingRecording, setIsPreparingRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const warmupTimerRef = useRef<any>(null);
  const autoStopRef = useRef<any>(null);
  const recordingStartRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recordingBars, setRecordingBars] = useState<number[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const liveAudioCtxRef = useRef<AudioContext | null>(null);
  const liveBarsIntervalRef = useRef<any>(null);

  const [showAdmin, setShowAdmin] = useState(false);
  const [adminSecret, setAdminSecret] = useState("");
  const [balances, setBalances] = useState<any>(null);
  const [loadingBal, setLoadingBal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ===================== CARGA INICIAL =====================
  useEffect(() => {
    fetchConversaciones();
    fetchPipelineEtapas();
    fetchTodosPagos();
    fetchTodosClientes();
    fetchTodasTareas();
    fetchCampanasAds();
    cargarConfigDivisas();

    const convSub = supabase.channel("r-conv").on("postgres_changes", { event: "*", schema: "public", table: "conversaciones" }, fetchConversaciones).subscribe();
    const cliSub = supabase.channel("r-cli").on("postgres_changes", { event: "*", schema: "public", table: "clientes" }, () => { fetchConversaciones(); fetchTodosClientes(); }).subscribe();
    const pagSub = supabase.channel("r-pag").on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, fetchTodosPagos).subscribe();
    const tarSub = supabase.channel("r-tar").on("postgres_changes", { event: "*", schema: "public", table: "tareas" }, fetchTodasTareas).subscribe();

    return () => {
      supabase.removeChannel(convSub);
      supabase.removeChannel(cliSub);
      supabase.removeChannel(pagSub);
      supabase.removeChannel(tarSub);
    };
  }, []);

  // Cargar config divisas de localStorage y de Supabase
  async function cargarConfigDivisas() {
    // LocalStorage primero
    try {
      const saved = localStorage.getItem("config_divisas");
      if (saved) {
        const cfg = JSON.parse(saved);
        if (cfg.tasaPYG) setTasaPYG(parseFloat(cfg.tasaPYG));
        if (cfg.tasaUSD) setTasaUSD(parseFloat(cfg.tasaUSD));
        if (cfg.tasaEUR) setTasaEUR(parseFloat(cfg.tasaEUR));
        if (cfg.tasaBRL) setTasaBRL(parseFloat(cfg.tasaBRL));
        if (cfg.tasaMXN) setTasaMXN(parseFloat(cfg.tasaMXN));
        if (cfg.comisionDefault) setComisionDefault(parseFloat(cfg.comisionDefault));
      }
    } catch {}

    // Intentar cargar de Supabase config_general
    try {
      const { data } = await supabase.from("config_general").select("*");
      if (data) {
        data.forEach((row: any) => {
          if (row.clave === "tasa_pyg_cop") setTasaPYG(parseFloat(row.valor));
          if (row.clave === "tasa_usd_cop") setTasaUSD(parseFloat(row.valor));
          if (row.clave === "tasa_eur_cop") setTasaEUR(parseFloat(row.valor));
          if (row.clave === "comision_cambio_default") setComisionDefault(parseFloat(row.valor));
        });
      }
      const { data: divisas } = await supabase.from("config_divisas").select("*");
      if (divisas) {
        divisas.forEach((d: any) => {
          if (d.codigo === "PYG") setTasaPYG(parseFloat(d.tasa_a_cop));
          if (d.codigo === "USD") setTasaUSD(parseFloat(d.tasa_a_cop));
          if (d.codigo === "EUR") setTasaEUR(parseFloat(d.tasa_a_cop));
          if (d.codigo === "BRL") setTasaBRL(parseFloat(d.tasa_a_cop));
          if (d.codigo === "MXN") setTasaMXN(parseFloat(d.tasa_a_cop));
        });
      }
    } catch (e) {
      console.log("Config divisas no disponible en DB, usando local");
    }
  }

  function guardarConfigDivisas() {
    const cfg = { tasaPYG, tasaUSD, tasaEUR, tasaBRL, tasaMXN, comisionDefault };
    localStorage.setItem("config_divisas", JSON.stringify(cfg));
    // Intentar guardar en Supabase también (no bloqueante)
    supabase.from("config_general").upsert([
      { clave: "tasa_pyg_cop", valor: String(tasaPYG) },
      { clave: "tasa_usd_cop", valor: String(tasaUSD) },
      { clave: "comision_cambio_default", valor: String(comisionDefault) }
    ]).then(() => {});
    setShowDivisaConfig(false);
  }

  // Actualizar tasa de cambio automáticamente al cambiar moneda
  useEffect(() => {
    switch (monedaPago) {
      case "COP": setTasaCambioPago("1"); setComisionPago("0"); break;
      case "PYG": setTasaCambioPago(String(tasaPYG)); setComisionPago(String(comisionDefault)); break;
      case "USD": setTasaCambioPago(String(tasaUSD)); setComisionPago(String(comisionDefault)); break;
      case "EUR": setTasaCambioPago(String(tasaEUR)); setComisionPago(String(comisionDefault)); break;
      case "BRL": setTasaCambioPago(String(tasaBRL)); setComisionPago(String(comisionDefault)); break;
      case "MXN": setTasaCambioPago(String(tasaMXN)); setComisionPago(String(comisionDefault)); break;
      default: setTasaCambioPago("1");
    }
  }, [monedaPago, tasaPYG, tasaUSD, tasaEUR, tasaBRL, tasaMXN, comisionDefault]);

  function convertirACOP(monto: number, moneda: string, tasa: number, comision: number) {
    const montoNum = Number(monto) || 0;
    const tasaNum = Number(tasa) || 1;
    const comisionNum = Number(comision) || 0;
    const sinComision = montoNum * (1 - comisionNum / 100);
    return sinComision * tasaNum;
  }

  function obtenerTasaPorMoneda(moneda: string) {
    switch (moneda) {
      case "COP": return 1;
      case "PYG": return tasaPYG;
      case "USD": return tasaUSD;
      case "EUR": return tasaEUR;
      case "BRL": return tasaBRL;
      case "MXN": return tasaMXN;
      default: return 1;
    }
  }

  function formatearMoneda(monto: number, moneda: string) {
    const simbolos: any = { COP: "$", PYG: "₲", USD: "US$", EUR: "€", BRL: "R$", MXN: "$" };
    const simbolo = simbolos[moneda] || moneda;
    return `${simbolo} ${Number(monto).toLocaleString("es-CO")} ${moneda}`;
  }

  async function fetchConversaciones() {
    const { data } = await supabase.from("conversaciones").select("*, clientes(*)").order("ultimo_mensaje_en", { ascending: false });
    if (data) setConversaciones(data);
    setLoadingChats(false);
  }
  async function fetchPipelineEtapas() {
    const { data } = await supabase.from("pipeline_etapas").select("*").order("orden", { ascending: true });
    if (data) setPipelineEtapas(data);
  }
  async function fetchTodosPagos() {
    const { data } = await supabase.from("pagos").select("*");
    if (data) setTodosPagos(data);
  }
  async function fetchTodosClientes() {
    const { data } = await supabase.from("clientes").select("*");
    if (data) setTodosClientes(data);
  }
  async function fetchTodasTareas() {
    const { data } = await supabase.from("tareas").select("*, clientes(nombre)").order("fecha_vencimiento", { ascending: true });
    if (data) setTodosTareas(data);
  }

  // ===================== META ADS =====================
  async function fetchCampanasAds() {
    setLoadingAds(true);
    setAdsNote("");
    try {
      const res = await fetch("/api/ads/campaigns");
      const data = await res.json();
      if (data.campaigns) {
        setCampanas(data.campaigns);
        setIsLiveAds(!!data.live);
      }
      if (data.error || data.note) {
        setAdsNote(data.error || data.note);
      }
    } catch (e) {
      console.error("Error cargando campañas Ads:", e);
    }
    setLoadingAds(false);
  }

  async function toggleEstadoCampana(campaignId: string, currentStatus: string) {
    const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setCampanas(prev => prev.map(c => c.id === campaignId ? { ...c, status: newStatus } : c));
    try {
      await fetch("/api/ads/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, newStatus }),
      });
    } catch (e) {
      console.error("Error cambiando estado campaña:", e);
    }
  }

  async function consultarAsesorIAAds() {
    setLoadingAiAds(true);
    setShowAiModal(true);
    setAiRecommendation(null);
    try {
      const res = await fetch("/api/ads/ai-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaigns: campanas }),
      });
      const data = await res.json();
      if (data.recommendation) {
        setAiRecommendation(data.recommendation);
      } else {
        setAiRecommendation("Error: " + (data.error || "No se pudo obtener el análisis."));
      }
    } catch (e: any) {
      setAiRecommendation("Error conectando con la IA: " + e.message);
    }
    setLoadingAiAds(false);
  }

  // ===================== ARCHIVAR / ELIMINAR =====================
  async function archivarConversacion(convId: string, archivar: boolean = true) {
    setConversaciones(prev => prev.map(c => c.id === convId ? { 
      ...c, 
      archivada: archivar, 
      fecha_archivado: archivar ? new Date().toISOString() : null,
      motivo_archivado: archivar ? 'manual' : null
    } : c));
    
    if (selectedConv?.id === convId && archivar && tab === "chats") {
      setSelectedConv(null);
    }

    try {
      const { error } = await supabase.from("conversaciones").update({ 
        archivada: archivar, 
        fecha_archivado: archivar ? new Date().toISOString() : null,
        motivo_archivado: archivar ? 'manual' : null
      }).eq("id", convId);
      
      if (error) {
        console.error("Error archivando:", error);
        fetchConversaciones();
      }
    } catch (e) {
      console.error(e);
      fetchConversaciones();
    }
  }

  async function eliminarConversacionDefinitivo(convId: string) {
    setIsDeleting(true);
    try {
      await supabase.from("mensajes").delete().eq("conversacion_id", convId);
      const { error: convError } = await supabase.from("conversaciones").delete().eq("id", convId);
      if (convError) throw convError;
      setConversaciones(prev => prev.filter(c => c.id !== convId));
      if (selectedConv?.id === convId) {
        setSelectedConv(null);
        setClienteActual(null);
      }
      setShowDeleteConfirm(null);
    } catch (e: any) {
      console.error("Error eliminando conversación:", e);
      alert("Error al eliminar: " + (e.message || "desconocido"));
    }
    setIsDeleting(false);
  }

  function autoArchivarInactivos() {
    const limite = new Date();
    limite.setDate(limite.getDate() - 7);
    const paraArchivar = conversaciones.filter(c => {
      const isArchivada = (c as any).archivada === true;
      const isSpam = c.clientes?.es_spam === true;
      if (isArchivada || isSpam) return false;
      const fecha = c.ultimo_mensaje_en ? new Date(c.ultimo_mensaje_en) : new Date(0);
      return fecha < limite;
    });

    if (paraArchivar.length === 0) {
      alert("No hay conversaciones inactivas de más de 7 días. ¡Todo al día! ✅");
      return;
    }

    if (!confirm(`¿Archivar ${paraArchivar.length} conversaciones inactivas (>7 días sin actividad)?\n\nIrán a la pestaña Archivados. Podrás restaurarlas cuando quieras.`)) return;

    paraArchivar.forEach(c => archivarConversacion(c.id, true));
  }

  // ===================== SELECCIONAR CHAT =====================
  async function selectConversation(conv: any) {
    setSelectedConv(conv);
    setClienteActual(conv.clientes);
    setIsEditingNombre(false);
    setIsEditingNotas(false);
    setTempNotas(conv.clientes?.notas_personales || "");
    setTempDetallesCaso(conv.clientes?.detalles_caso || "");
    setShowMobileDetails(false);
    fetchMensajes(conv.id);
    fetchPagos(conv.cliente_id);
    fetchTareasCliente(conv.cliente_id);
  }

  async function fetchMensajes(convId: string) {
    const { data } = await supabase.from("mensajes").select("*").eq("conversacion_id", convId).order("creado_en", { ascending: true });
    if (data) setMensajes(data);
  }
  async function fetchPagos(clienteId: string) {
    if (!clienteId) return;
    const { data } = await supabase.from("pagos").select("*").eq("cliente_id", clienteId).order("fecha_vencimiento", { ascending: true });
    if (data) setPagosCliente(data);
  }
  async function fetchTareasCliente(clienteId: string) {
    if (!clienteId) return;
    const { data } = await supabase.from("tareas").select("*").eq("cliente_id", clienteId).order("fecha_vencimiento", { ascending: true });
    if (data) setTareasCliente(data);
  }

  useEffect(() => {
    if (!selectedConv) return;
    const msgSub = supabase.channel(`r-msg-${selectedConv.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: `conversacion_id=eq.${selectedConv.id}` },
        (payload) => setMensajes((prev) => {
          const nuevo = payload.new as any;
          if (prev.some((m) => m.id === nuevo.id)) return prev;
          const tNuevo = new Date(nuevo.creado_en).getTime();
          const dup = prev.some((m) => {
            const t = new Date(m.creado_en).getTime();
            const near = Math.abs(tNuevo - t) < 20000;
            const sameTipo = (m.tipo || "") === (nuevo.tipo || "");
            const sameKind = (m.tipo_contenido || "texto") === (nuevo.tipo_contenido || "texto");
            const c1 = (m.contenido || "").trim();
            const c2 = (nuevo.contenido || "").trim();
            const sameContent = c1 === c2 || (sameKind && (c1 === `[${m.tipo_contenido}]` || c2 === `[${nuevo.tipo_contenido}]`));
            return near && sameTipo && sameKind && sameContent;
          });
          if (dup) return prev;
          return [...prev, nuevo];
        })
      ).subscribe();
    return () => { supabase.removeChannel(msgSub); };
  }, [selectedConv]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  async function guardarNuevoNombre() {
    if (!clienteActual || !tempNombre.trim()) return;
    const nuevoNombre = tempNombre.trim();
    const { error } = await supabase
      .from("clientes")
      .update({ nombre: nuevoNombre, actualizado_en: new Date().toISOString() })
      .eq("id", clienteActual.id);
    if (!error) {
      setClienteActual({ ...clienteActual, nombre: nuevoNombre });
      setConversaciones(prev => prev.map(c => c.cliente_id === clienteActual.id ? { ...c, clientes: { ...c.clientes, nombre: nuevoNombre } } : c));
      setTodosClientes(prev => prev.map(c => c.id === clienteActual.id ? { ...c, nombre: nuevoNombre } : c));
      setIsEditingNombre(false);
    }
  }

  async function guardarNotasPersonales() {
    if (!clienteActual) return;
    const { error } = await supabase
      .from("clientes")
      .update({ 
        notas_personales: tempNotas.trim() || null,
        detalles_caso: tempDetallesCaso.trim() || null,
        notas_actualizado_en: new Date().toISOString(),
        actualizado_en: new Date().toISOString()
      })
      .eq("id", clienteActual.id);
    
    if (!error) {
      setClienteActual({ 
        ...clienteActual, 
        notas_personales: tempNotas.trim(),
        detalles_caso: tempDetallesCaso.trim(),
        notas_actualizado_en: new Date().toISOString()
      });
      setConversaciones(prev => prev.map(c => 
        c.cliente_id === clienteActual.id 
          ? { ...c, clientes: { ...c.clientes, notas_personales: tempNotas.trim(), detalles_caso: tempDetallesCaso.trim() } } 
          : c
      ));
      setIsEditingNotas(false);
    } else {
      console.error("Error guardando notas:", error);
      alert("Error guardando notas: " + error.message);
    }
  }

  // ===================== ENVIAR MENSAJE =====================
  async function sendToApi(texto: string, fileBase64: string | null = null, fileMime: string | null = null, fileName: string | null = null) {
    if (!selectedConv) return;
    setIsSending(true);
    setSendError("");
    setSendNotice("");
    try {
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversacionId: selectedConv.id,
          clienteId: selectedConv.cliente_id,
          numeroWhatsApp: selectedConv.numero_whatsapp,
          texto, fileBase64, fileMime, fileName
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || "No se pudo enviar el mensaje.");
      const esNotaDeVoz = Boolean(fileBase64 && ((fileMime || "").startsWith("audio/") || String(fileName || "").toLowerCase().includes("nota_de_voz")));
      if (esNotaDeVoz && result.voiceNote === false) {
        setSendNotice("La nota se envió, pero llegó como audio simple en vez de nota de voz nativa.");
      }
      if ((selectedConv as any).archivada) {
        archivarConversacion(selectedConv.id, false);
      }
    } catch (error: any) {
      const message = error.message || "No se pudo enviar el mensaje.";
      setSendError(message);
      throw error;
    } finally {
      setIsSending(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevoMensaje.trim() || isSending) return;
    const txt = nuevoMensaje;
    setNuevoMensaje("");
    try {
      await sendToApi(txt);
    } catch {
      setNuevoMensaje(txt);
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isSending) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        await sendToApi("", reader.result as string, file.type, file.name);
      } catch {}
    };
    reader.onerror = () => setSendError("No se pudo leer el archivo seleccionado.");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ===================== GRABACIÓN DE AUDIO =====================
  const MAX_GRABACION_SEG = 300;
  const MIN_DURACION_NOTA_MS = 400;

  const getPreferredAudioMime = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const ua = navigator.userAgent || "";
    const isAppleMobile = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const candidates = isAppleMobile
      ? ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"]
      : ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/aac", "audio/webm"];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  };

  const cleanupRecordingTimers = () => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    if (warmupTimerRef.current) { clearTimeout(warmupTimerRef.current); warmupTimerRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const stopStreamTracks = (stream?: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  const setupLiveWaveform = (stream: MediaStream) => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx || analyserRef.current) return;
      const ctx: AudioContext = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      liveAudioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const spectrum = new Uint8Array(analyser.frequencyBinCount);
      liveBarsIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(spectrum);
        const bars: number[] = [];
        const COUNT = 16;
        for (let i = 0; i < COUNT; i++) {
          const idx = 1 + Math.floor(((i / COUNT) * spectrum.length) / 1.6);
          bars.push(Math.max(0.08, (spectrum[Math.min(idx, spectrum.length - 1)] || 0) / 255));
        }
        setRecordingBars(bars);
      }, 90);
    } catch {}
  };

  const teardownLiveWaveform = () => {
    if (liveBarsIntervalRef.current) { clearInterval(liveBarsIntervalRef.current); liveBarsIntervalRef.current = null; }
    analyserRef.current = null;
    liveAudioCtxRef.current?.close().catch(() => {});
    liveAudioCtxRef.current = null;
    setRecordingBars([]);
  };

  const startRecording = async () => {
    if (mediaRecorderRef.current?.state === "recording" || isSending || isPreparingRecording) return;
    let stream: MediaStream | null = null;
    flushSync(() => {
      setSendError("");
      setRecordingTime(0);
      setIsRecording(false);
      setIsPreparingRecording(true);
    });
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setIsPreparingRecording(false);
        setSendError("Tu navegador no permite grabar notas de voz desde esta página.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 1 },
            sampleRate: { ideal: 48000 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      setupLiveWaveform(stream);

      const mimeType = getPreferredAudioMime();
      const options: MediaRecorderOptions = { audioBitsPerSecond: 96000, ...(mimeType ? { mimeType } : {}) };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onerror = () => {
        cleanupRecordingTimers();
        teardownLiveWaveform();
        stopStreamTracks(stream);
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setIsPreparingRecording(false);
        setSendError("La grabación falló. Intentá de nuevo manteniendo la app abierta.");
      };
      mediaRecorder.onstop = async () => {
        cleanupRecordingTimers();
        teardownLiveWaveform();
        const duracionMs = Date.now() - recordingStartRef.current;
        const usedMime = mediaRecorder.mimeType || mimeType || "audio/webm";
        const ext = usedMime.includes("ogg") ? "ogg" : usedMime.includes("mp4") ? "m4a" : usedMime.includes("aac") ? "aac" : "webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: usedMime });
        audioChunksRef.current = [];
        stopStreamTracks(stream);
        mediaRecorderRef.current = null;
        setIsPreparingRecording(false);
        if (audioBlob.size === 0) {
          setSendError("No se capturó audio. Revisá el permiso del micrófono e intentá otra vez.");
          return;
        }
        if (duracionMs < MIN_DURACION_NOTA_MS) {
          setSendError("La nota de voz es demasiado corta; mantené presionado un momento más.");
          return;
        }
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          try {
            await sendToApi("", reader.result as string, usedMime, `nota_de_voz.${ext}`);
          } catch {}
        };
        reader.onerror = () => setSendError("No se pudo leer la nota de voz grabada.");
      };
      recordingStartRef.current = Date.now();
      mediaRecorder.start();
      setIsPreparingRecording(false);
      setIsRecording(true);
      setRecordingTime(0);
      setSendError("");
      timerRef.current = setInterval(() => setRecordingTime((prev) => prev + 1), 1000);
      autoStopRef.current = setTimeout(() => stopRecording(), MAX_GRABACION_SEG * 1000);
    } catch (err: any) {
      cleanupRecordingTimers();
      teardownLiveWaveform();
      stopStreamTracks(stream || mediaRecorderRef.current?.stream);
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setIsPreparingRecording(false);
      alert("Error accediendo al micrófono.");
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      cleanupRecordingTimers();
      recorder.stop();
      setIsRecording(false);
      setIsPreparingRecording(false);
    }
  };
  const cancelRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      cleanupRecordingTimers();
      teardownLiveWaveform();
      recorder.onstop = () => {
        teardownLiveWaveform();
        stopStreamTracks(recorder.stream);
        mediaRecorderRef.current = null;
      };
      audioChunksRef.current = [];
      recorder.stop();
      setIsRecording(false);
      setIsPreparingRecording(false);
    }
  };
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // ===================== ACCIONES CLIENTE =====================
  async function toggleAgenteIA() {
    if (!selectedConv) return;
    const est = !selectedConv.agente_activo;
    await supabase.from("conversaciones").update({ agente_activo: est }).eq("id", selectedConv.id);
    setSelectedConv({ ...selectedConv, agente_activo: est });
  }

  async function toggleSpam() {
    if (!clienteActual || !selectedConv) return;
    const est = !clienteActual.es_spam;
    await supabase.from("clientes").update({ es_spam: est }).eq("id", clienteActual.id);
    if (est) {
      await supabase.from("conversaciones").update({ agente_activo: false }).eq("id", selectedConv.id);
      setSelectedConv({ ...selectedConv, agente_activo: false });
    }
    setClienteActual({ ...clienteActual, es_spam: est });
    if (est && filtroCanal !== "spam") setSelectedConv(null);
    fetchConversaciones();
  }

  async function actualizarEstadoCliente(clienteId: string, nuevoEstado: string) {
    await supabase.from("clientes").update({ estado: nuevoEstado, actualizado_en: new Date().toISOString() }).eq("id", clienteId);
    if (clienteActual?.id === clienteId) setClienteActual({ ...clienteActual, estado: nuevoEstado });
    fetchConversaciones(); fetchTodosClientes();
  }

  // ===================== TAREAS =====================
  async function agregarTarea(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteActual || !nuevaTareaTitulo) return;
    const nueva = { cliente_id: clienteActual.id, titulo: nuevaTareaTitulo, fecha_vencimiento: nuevaTareaFecha || null, completada: false };
    const { data } = await supabase.from("tareas").insert([nueva]).select();
    if (data) { setTareasCliente([...tareasCliente, data[0]]); setNuevaTareaTitulo(""); setNuevaTareaFecha(""); fetchTodasTareas(); }
  }
  async function toggleTarea(tareaId: string, actual: boolean) {
    await supabase.from("tareas").update({ completada: !actual }).eq("id", tareaId);
    setTareasCliente(tareasCliente.map((t) => (t.id === tareaId ? { ...t, completada: !actual } : t))); fetchTodasTareas();
  }
  async function eliminarTarea(tareaId: string) {
    await supabase.from("tareas").delete().eq("id", tareaId);
    setTareasCliente(tareasCliente.filter((t) => t.id !== tareaId)); fetchTodasTareas();
  }

  // ===================== PAGOS CON DIVISAS =====================
  async function agregarPagos(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteActual || !montoTotal) return;
    const t = parseFloat(montoTotal);
    const fBase = fechaInicial ? new Date(fechaInicial) : new Date();
    const comisionNum = parseFloat(comisionPago) || 0;
    const tasaNum = parseFloat(tasaCambioPago) || obtenerTasaPorMoneda(monedaPago);
    const montoConvertido = convertirACOP(t, monedaPago, tasaNum, comisionNum);

    const arr: any[] = [];
    if (tipoPago === "unico") {
      arr.push({ 
        cliente_id: clienteActual.id, 
        monto: t,
        monto_original: t,
        monto_convertido_cop: montoConvertido,
        moneda: monedaPago,
        comision_porcentaje: comisionNum,
        tasa_cambio: tasaNum,
        fecha_vencimiento: fBase.toISOString().split("T")[0], 
        estado: "pendiente", 
        metodo_pago: metodoPago, 
        notas: notaPago || `Pago único ${monedaPago}` 
      });
    } else {
      const n = parseInt(numeroCuotas);
      const mCuota = t / n;
      const mCuotaConvertida = convertirACOP(mCuota, monedaPago, tasaNum, comisionNum);
      for (let i = 0; i < n; i++) {
        const fc = new Date(fBase);
        fc.setMonth(fc.getMonth() + i);
        arr.push({ 
          cliente_id: clienteActual.id, 
          monto: mCuota,
          monto_original: mCuota,
          monto_convertido_cop: mCuotaConvertida,
          moneda: monedaPago,
          comision_porcentaje: comisionNum,
          tasa_cambio: tasaNum,
          fecha_vencimiento: fc.toISOString().split("T")[0], 
          estado: "pendiente", 
          metodo_pago: metodoPago, 
          notas: `Cuota ${i + 1}/${n} ${monedaPago}${notaPago ? " - " + notaPago : ""}` 
        });
      }
    }

    // Intentar insertar con nuevos campos, fallback a campos antiguos si falla
    let data, error;
    try {
      const result = await supabase.from("pagos").insert(arr).select();
      data = result.data;
      error = result.error;
      if (error && error.message.includes("moneda")) {
        // Fallback sin divisas
        const arrFallback = arr.map(p => ({
          cliente_id: p.cliente_id,
          monto: p.monto,
          fecha_vencimiento: p.fecha_vencimiento,
          estado: p.estado,
          metodo_pago: p.metodo_pago,
          notas: `${p.notas} [${p.moneda} com:${p.comision_porcentaje}% tasa:${p.tasa_cambio} COP:${Math.round(p.monto_convertido_cop)}]`
        }));
        const result2 = await supabase.from("pagos").insert(arrFallback).select();
        data = result2.data;
        error = result2.error;
      }
    } catch (e) {
      console.error(e);
    }

    await supabase.from("clientes").update({ total_cobro: t }).eq("id", clienteActual.id);
    if (data) { 
      setPagosCliente([...pagosCliente, ...data]); 
      setMontoTotal(""); 
      setFechaInicial(""); 
      setNotaPago(""); 
      setTipoPago("unico");
    }
    fetchTodosPagos();
  }

  async function marcarPago(id: string, est: string) {
    const nest = est === "pagado" ? "pendiente" : "pagado";
    await supabase.from("pagos").update({ estado: nest, fecha_pago: nest === "pagado" ? new Date().toISOString().split("T")[0] : null }).eq("id", id);
    setPagosCliente(pagosCliente.map((p) => (p.id === id ? { ...p, estado: nest } : p))); 
    fetchTodosPagos();
  }
  async function eliminarPago(id: string) {
    await supabase.from("pagos").delete().eq("id", id);
    setPagosCliente(pagosCliente.filter((p) => p.id !== id)); 
    fetchTodosPagos();
  }

  // ===================== PIPELINE =====================
  async function agregarEtapaPipeline() {
    const { data } = await supabase.from("pipeline_etapas").insert([{ clave: `etapa_${Date.now()}`, nombre: "Nueva Etapa", orden: pipelineEtapas.length + 1, color: "border-purple-500" }]).select();
    if (data) setPipelineEtapas([...pipelineEtapas, data[0]]);
  }
  async function actualizarNombreEtapa(id: string, nuevoNombre: string) {
    setPipelineEtapas(pipelineEtapas.map((e) => (e.id === id ? { ...e, nombre: nuevoNombre } : e)));
    await supabase.from("pipeline_etapas").update({ nombre: nuevoNombre }).eq("id", id);
  }
  async function eliminarEtapa(id: string) {
    await supabase.from("pipeline_etapas").delete().eq("id", id);
    setPipelineEtapas(pipelineEtapas.filter((e) => e.id !== id));
  }
  async function moverEtapa(index: number, direccion: -1 | 1) {
    if (index + direccion < 0 || index + direccion >= pipelineEtapas.length) return;
    const nuevas = [...pipelineEtapas];
    const temp = nuevas[index].orden; nuevas[index].orden = nuevas[index + direccion].orden; nuevas[index + direccion].orden = temp;
    nuevas.sort((a, b) => a.orden - b.orden); setPipelineEtapas(nuevas);
    for (const etapa of nuevas) await supabase.from("pipeline_etapas").update({ orden: etapa.orden }).eq("id", etapa.id);
  }

  // ===================== ADMIN SALDOS =====================
  async function cargarSaldos() {
    if (!adminSecret) { setBalances({ error: "Ingresa la clave admin" }); return; }
    setLoadingBal(true); setBalances(null);
    try {
      const res = await fetch("/api/admin/balances", { headers: { "x-admin-secret": adminSecret } });
      const data = await res.json();
      if (!res.ok) setBalances({ error: data.error || "Error al consultar" });
      else setBalances(data);
    } catch (e: any) { setBalances({ error: "No se pudo cargar: " + e.message }); }
    setLoadingBal(false);
  }

  // ===================== RENDER Y FILTROS =====================
  const conversacionesFiltradas = conversaciones.filter((c) => {
    const esSpam = c.clientes?.es_spam === true;
    const isArchivada = (c as any).archivada === true;
    if (isArchivada) return false;
    if (filtroCanal === "spam") return esSpam;
    if (esSpam) return false;
    const matchCanal = filtroCanal === "todos" || c.fuente === filtroCanal;
    const matchSearch = !searchChats || 
      (c.clientes?.nombre || "").toLowerCase().includes(searchChats.toLowerCase()) ||
      (c.numero_whatsapp || "").includes(searchChats) ||
      (c.clientes?.telefono_display || "").includes(searchChats);
    return matchCanal && matchSearch;
  });

  const conversacionesArchivadas = conversaciones.filter((c) => {
    const esSpam = c.clientes?.es_spam === true;
    const isArchivada = (c as any).archivada === true;
    if (!isArchivada || esSpam) return false;
    const matchCanal = filtroArchivados === "todos" || c.fuente === filtroArchivados;
    const q = searchArchivados.toLowerCase();
    const matchSearch = !searchArchivados ||
      (c.clientes?.nombre || "").toLowerCase().includes(q) ||
      (c.numero_whatsapp || "").includes(searchArchivados) ||
      (c.clientes?.telefono_display || "").includes(searchArchivados) ||
      (c.ultimo_mensaje || "").toLowerCase().includes(q);
    return matchCanal && matchSearch;
  });

  const ahora = new Date(); const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const clientesNoSpam = todosClientes.filter((c) => !c.es_spam);
  const totalAtendidos = clientesNoSpam.length;
  const totalConvertidos = clientesNoSpam.filter((c) => ["pago_recibido", "trabajo_proceso", "trabajo_completado"].includes(c.estado)).length;
  const efectividad = totalAtendidos > 0 ? ((totalConvertidos / totalAtendidos) * 100).toFixed(1) : "0";

  // Calculos de cartera con conversión a COP
  const pagosDelMes = todosPagos.filter((p) => p.estado === "pagado" && p.fecha_pago && new Date(p.fecha_pago) >= inicioMes);
  
  function calcularCOP(pago: any) {
    if (pago.monto_convertido_cop != null) return Number(pago.monto_convertido_cop);
    const moneda = pago.moneda || "COP";
    const comision = pago.comision_porcentaje != null ? Number(pago.comision_porcentaje) : (moneda === "COP" ? 0 : comisionDefault);
    const tasa = pago.tasa_cambio != null ? Number(pago.tasa_cambio) : obtenerTasaPorMoneda(moneda);
    return convertirACOP(Number(pago.monto), moneda, tasa, comision);
  }

  const totalCobradoMesCOP = pagosDelMes.reduce((sum, p) => sum + calcularCOP(p), 0);
  const totalCobradoHistoricoCOP = todosPagos.filter((p) => p.estado === "pagado").reduce((sum, p) => sum + calcularCOP(p), 0);
  const totalPendienteCOP = todosPagos.filter((p) => p.estado === "pendiente").reduce((sum, p) => sum + calcularCOP(p), 0);
  const totalVencidoCOP = todosPagos.filter((p) => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora).reduce((sum, p) => sum + calcularCOP(p), 0);

  // Para compatibilidad, mantener totales antiguos también
  const totalCobradoMes = totalCobradoMesCOP;
  const totalCobradoHistorico = totalCobradoHistoricoCOP;
  const totalPendiente = totalPendienteCOP;
  const totalVencido = totalVencidoCOP;

  const leadsEnConsulta = clientesNoSpam.filter((c) => ["en_consulta", "consulta_hecha"].includes(c.estado)).length;
  const leadsPerdidos = clientesNoSpam.filter((c) => c.estado === "perdido").length;
  const leadsNuevos = clientesNoSpam.filter((c) => c.estado === "nuevo_lead" || !c.estado).length;

  const adsSpend = campanas.reduce((sum, c) => sum + Number(c.spend || 0), 0);
  const adsLeads = campanas.reduce((sum, c) => sum + Number(c.leads || 0), 0);
  const adsCpl = adsLeads ? adsSpend / adsLeads : 0;
  const adsCtr = campanas.reduce((sum, c) => sum + Number(c.impressions || 0), 0) > 0
    ? campanas.reduce((sum, c) => sum + Number(c.clicks || 0), 0) / campanas.reduce((sum, c) => sum + Number(c.impressions || 0), 0) * 100 : 0;
  const campanasVisibles = campanas.filter(c =>
    (adsStatusFilter === "all" || c.status === adsStatusFilter) &&
    (c.name || "").toLowerCase().includes(adsQuery.toLowerCase())
  );
  const mejorCampana = [...campanas].filter(c => Number(c.leads || 0) > 0).sort((a, b) => Number(a.cpl || 0) - Number(b.cpl || 0))[0];

  const menuItems = [
    { id: "chats", icon: MessageSquare, label: "Chats" },
    { id: "archivados", icon: Archive, label: "Archivados" },
    { id: "pipeline", icon: Users, label: "Pipeline" },
    { id: "tareas", icon: ListTodo, label: "Tareas" },
    { id: "cartera", icon: DollarSign, label: "Cartera" },
    { id: "ads", icon: TrendingUp, label: "Ads" },
    { id: "cerebro", icon: Brain, label: "Cerebro" }
  ];

  // Preview conversión en form
  const previewMonto = parseFloat(montoTotal) || 0;
  const previewComision = parseFloat(comisionPago) || 0;
  const previewTasa = parseFloat(tasaCambioPago) || obtenerTasaPorMoneda(monedaPago);
  const previewConvertido = convertirACOP(previewMonto, monedaPago, previewTasa, previewComision);

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] w-screen bg-background text-gray-200 overflow-hidden font-sans">
      
      {/* BARRA NAVEGACIÓN */}
      <aside className="fixed bottom-0 w-full h-16 bg-surface border-t border-border flex flex-row items-center justify-around z-40 md:relative md:w-20 md:h-full md:border-r md:border-t-0 md:flex-col md:py-6 md:justify-between">
        <div className="hidden md:flex w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 items-center justify-center shadow-lg shadow-purple-900/40">
          <span className="text-xl font-bold text-white">🔮</span>
        </div>
        <nav className="flex flex-row md:flex-col gap-1 md:gap-3 w-full justify-around md:px-3 overflow-x-auto">
          {menuItems.map((item) => (
            <button key={item.id} onClick={() => { setTab(item.id as any); setSelectedConv(null); setShowMobileDetails(false); }}
              className={`p-2 md:p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all flex-1 md:flex-none relative ${tab === item.id ? "text-purple-400 md:bg-purple-600 md:text-white" : "text-gray-500 hover:text-gray-200"}`}>
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
              {item.id === "archivados" && conversaciones.filter(c => (c as any).archivada).length > 0 && (
                <span className="absolute -top-1 -right-1 md:top-1 md:right-1 bg-amber-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                  {conversaciones.filter(c => (c as any).archivada).length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="hidden md:flex flex-col items-center gap-3">
          <button onClick={() => setShowAdmin(true)} className="text-gray-500 hover:text-purple-300 p-1"><Shield className="w-4 h-4" /></button>
          <div className="flex flex-col items-center gap-1 text-[10px] text-emerald-400">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" /><span>Online</span>
          </div>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 flex overflow-hidden mb-16 md:mb-0 relative">
        
        {/* ================= CHATS ================= */}
        {tab === "chats" && (
          <>
            <section className={`w-full md:w-80 border-r border-border bg-surface/50 flex-col ${selectedConv ? "hidden md:flex" : "flex"}`}>
              <div className="p-4 border-b border-border flex flex-col gap-3 pt-6 md:pt-4">
                <div className="flex items-center justify-between">
                  <h1 className="text-lg font-bold text-gray-100">Bandeja</h1>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 font-medium">{conversacionesFiltradas.length}</span>
                    <button className="md:hidden text-gray-500" onClick={() => setShowAdmin(true)}><Shield className="w-4 h-4" /></button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input 
                    value={searchChats} 
                    onChange={e => setSearchChats(e.target.value)}
                    placeholder="Buscar nombre o número..." 
                    className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500"
                  />
                  {searchChats && (
                    <button onClick={() => setSearchChats("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex bg-background p-1 rounded-lg border border-border text-xs flex-wrap">
                  {["todos", "evolution", "meta_business", "spam"].map((f) => (
                    <button key={f} onClick={() => setFiltroCanal(f as any)} className={`flex-1 py-1.5 rounded-md transition-all capitalize ${filtroCanal === f ? (f === 'spam' ? "bg-red-900/50 text-red-400" : "bg-surfaceHover text-white font-medium") : "text-gray-500"}`}>
                      {f === "evolution" ? "Personal" : f === "meta_business" ? "Business" : f}
                    </button>
                  ))}
                </div>

                <button onClick={autoArchivarInactivos} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-amber-950/30 border border-amber-900/50 text-amber-400 hover:bg-amber-900/30 text-xs font-medium transition-colors">
                  <Archive className="w-3.5 h-3.5" /> Archivar inactivos (+7 días)
                </button>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border/50">
                {loadingChats ? <div className="p-6 text-center text-sm text-gray-500">Cargando...</div> : conversacionesFiltradas.length === 0 ? <div className="p-6 text-center text-sm text-gray-500">Bandeja vacía</div> :
                  conversacionesFiltradas.map((conv) => {
                    const cliente = conv.clientes;
                    const displayName = cliente?.nombre || cliente?.telefono_display || conv.numero_whatsapp;
                    const tieneNotas = cliente?.notas_personales || cliente?.detalles_caso;
                    return (
                      <div key={conv.id} className={`group relative w-full flex items-start gap-3 text-left hover:bg-surfaceHover transition-colors ${selectedConv?.id === conv.id ? "bg-surfaceHover border-l-4 border-purple-500" : ""}`}>
                        <button onClick={() => selectConversation(conv)} className="flex-1 p-4 flex items-start gap-3 text-left">
                          <div className="relative flex-shrink-0">
                            <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center text-purple-400 font-bold overflow-hidden">
                              {cliente?.foto_url ? <img src={cliente.foto_url} alt="" className="w-full h-full object-cover" /> : <span>{displayName?.charAt(0) || "W"}</span>}
                            </div>
                            {conv.agente_activo && !cliente?.es_spam && <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-purple-600 border-2 border-surface flex items-center justify-center"><Bot className="w-2.5 h-2.5 text-white" /></span>}
                            {tieneNotas && <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-amber-600 border-2 border-surface flex items-center justify-center"><StickyNote className="w-2.5 h-2.5 text-white" /></span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between mb-1"><h2 className="text-sm font-semibold text-gray-200 truncate flex items-center gap-1">{displayName}{tieneNotas && <StickyNote className="w-3 h-3 text-amber-400" />}</h2><span className="text-[10px] text-gray-500">{new Date(conv.ultimo_mensaje_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
                            <p className="text-xs text-gray-400 truncate flex items-center gap-1">{(conv.ultimo_mensaje === "[audio]" || conv.ultimo_mensaje === "[nota_de_voz]" || (conv.ultimo_mensaje && /\[audio\]|nota_de_voz|Nota de voz/i.test(conv.ultimo_mensaje))) ? (<><Mic className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" /><span>Nota de voz</span></>) : (conv.ultimo_mensaje || "Sin mensajes")}</p>
                          </div>
                        </button>
                        <div className="absolute right-2 top-2 hidden group-hover:flex items-center gap-1 bg-surface border border-border rounded-lg p-1 shadow-lg">
                          <button onClick={(e) => { e.stopPropagation(); archivarConversacion(conv.id, true); }} className="p-1.5 text-amber-400 hover:bg-amber-950/50 rounded-md transition-colors" title="Archivar"><Archive className="w-3.5 h-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(conv.id); }} className="p-1.5 text-red-400 hover:bg-red-950/50 rounded-md transition-colors" title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            </section>

            {selectedConv && clienteActual ? (
              <div className="flex-1 flex w-full h-full absolute inset-0 md:relative bg-background z-20">
                <section className={`flex-1 flex flex-col h-full ${showMobileDetails ? "hidden md:flex" : "flex"}`}>
                  <header className="h-16 px-4 md:px-6 border-b border-border bg-surface/80 backdrop-blur-md flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                      <button onClick={() => setSelectedConv(null)} className="md:hidden p-2 -ml-2 text-gray-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></button>
                      <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-purple-400 font-bold overflow-hidden">
                        {clienteActual.foto_url ? <img src={clienteActual.foto_url} className="w-full h-full object-cover" alt="" /> : <span>{clienteActual.nombre?.charAt(0) || "W"}</span>}
                      </div>
                      <div className="flex flex-col cursor-pointer" onClick={() => setShowMobileDetails(true)}>
                        <h2 className="text-sm font-bold text-gray-100 flex items-center gap-1">{clienteActual.nombre || "Sin nombre"}{clienteActual.notas_personales && <StickyNote className="w-3 h-3 text-amber-400" />}</h2>
                        <span className="text-[10px] text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" /> {clienteActual.telefono_display || clienteActual.telefono}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!clienteActual.es_spam && (
                        <button onClick={toggleAgenteIA} className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${selectedConv.agente_activo ? "bg-purple-950/50 border-purple-700 text-purple-300" : "bg-surfaceHover border-border text-gray-400"}`}>
                          <Bot className="w-3.5 h-3.5" /><span>{selectedConv.agente_activo ? "Agente Luna: ON" : "Agente Pausado"}</span>
                        </button>
                      )}
                      <button onClick={() => archivarConversacion(selectedConv.id, true)} className="p-2 text-amber-400 hover:bg-amber-950/30 rounded-lg border border-amber-900/30 transition-colors" title="Archivar"><Archive className="w-4 h-4" /></button>
                      <button onClick={() => setShowDeleteConfirm(selectedConv.id)} className="p-2 text-red-400 hover:bg-red-950/30 rounded-lg border border-red-900/30 transition-colors" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                      <button onClick={() => setShowMobileDetails(true)} className="md:hidden p-2 text-gray-400"><Info className="w-5 h-5" /></button>
                    </div>
                  </header>

                  <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                    {mensajes.map((msg) => {
                      const isMe = msg.tipo === "enviado";
                      return (
                        <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm ${isMe ? "bg-purple-600 text-white rounded-br-none" : "bg-surface border border-border text-gray-200 rounded-bl-none"}`}>
                            {(() => {
                              const isAudioMsg = msg.tipo_contenido === "audio" || msg.contenido === "[audio]" || msg.contenido === "[nota_de_voz]" || (msg.url_archivo && (msg.url_archivo.startsWith("data:audio/") || /\.(ogg|opus|webm|mp3|wav|m4a|aac)($|\?)/i.test(msg.url_archivo)));
                              if (isAudioMsg && msg.url_archivo) {
                                return <VoiceNotePlayer src={msg.url_archivo} isMe={isMe} />;
                              }
                              if (msg.tipo_contenido === "imagen" && msg.url_archivo) {
                                return <img src={msg.url_archivo} alt="" className="rounded-lg max-h-60 object-cover" />;
                              }
                              return <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.contenido}</p>;
                            })()}
                            <span className={`block text-[9px] mt-1 ${isMe ? "text-purple-200 text-right" : "text-gray-500"}`}>{new Date(msg.creado_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="p-3 border-t border-border bg-surface/80 backdrop-blur-md flex items-center gap-2 flex-shrink-0">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" />
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={clienteActual.es_spam || isRecording} className="p-2.5 text-gray-400 hover:text-purple-400 hover:bg-surfaceHover rounded-full transition-colors disabled:opacity-40"><Paperclip className="w-5 h-5" /></button>
                    {(isRecording || isPreparingRecording) ? (
                      <div className="flex-1 bg-red-950/30 border border-red-900/50 rounded-full px-4 py-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-red-400 text-sm font-medium flex-shrink-0"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><Mic className="w-4 h-4" /> {isPreparingRecording ? "Preparando micrófono..." : formatTime(recordingTime)}</div>
                        {!isPreparingRecording && (
                          <div className="flex-1 flex items-center justify-center gap-[3px] h-6 px-1 overflow-hidden" aria-hidden="true">
                            {(recordingBars.length ? recordingBars : [0.1, 0.14, 0.2, 0.16, 0.12, 0.18, 0.22, 0.15, 0.1, 0.16, 0.2, 0.14, 0.12, 0.18, 0.16, 0.1]).map((v, i) => (
                              <span key={i} style={{ height: `${Math.max(2, Math.min(1, v) * 22)}px` }} className="w-[3px] rounded-full bg-red-400/90 transition-[height] duration-100" />
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={cancelRecording} disabled={!isRecording} className="p-1.5 text-gray-400 hover:text-white rounded-full disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                          <button onClick={stopRecording} disabled={isPreparingRecording || !isRecording} className="p-1.5 text-white bg-red-600 hover:bg-red-500 rounded-full shadow-lg disabled:opacity-40"><Send className="w-4 h-4 ml-0.5" /></button>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleSendMessage} className="flex-1 flex flex-wrap items-center gap-2">
                        <input type="text" value={nuevoMensaje} onChange={(e) => setNuevoMensaje(e.target.value)} placeholder="Escribe un mensaje..." disabled={clienteActual.es_spam || isSending} className="flex-1 bg-background border border-border rounded-full px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50" />
                        {nuevoMensaje.trim() ? (
                          <button type="submit" disabled={isSending} className="bg-purple-600 hover:bg-purple-700 text-white p-2.5 rounded-full transition-colors disabled:opacity-50"><Send className="w-5 h-5" /></button>
                        ) : (
                          <button type="button" onClick={startRecording} disabled={clienteActual.es_spam || isSending || isPreparingRecording} className="bg-surface border border-border text-purple-400 hover:bg-purple-600 hover:text-white hover:border-purple-600 p-2.5 rounded-full transition-colors disabled:opacity-50"><Mic className="w-5 h-5" /></button>
                        )}
                        {sendNotice && <p className="w-full text-xs text-amber-400 px-2">{sendNotice}</p>}
                        {sendError && <p className="w-full text-xs text-red-400 px-2">{sendError}</p>}
                      </form>
                    )}
                  </div>
                </section>

                <aside className={`w-full md:w-80 lg:w-96 border-l border-border bg-surface/95 overflow-y-auto absolute inset-0 z-30 md:relative flex flex-col ${!showMobileDetails ? "hidden md:flex" : "flex"}`}>
                  <header className="md:hidden flex items-center p-4 border-b border-border bg-background sticky top-0 z-10">
                    <button onClick={() => setShowMobileDetails(false)} className="p-2 -ml-2 text-gray-400"><ArrowLeft className="w-5 h-5" /></button>
                    <h2 className="font-bold ml-2">Ficha del Cliente</h2>
                  </header>
                  <div className="p-5 space-y-5">
                    <div className="text-center">
                      <div className="w-20 h-20 mx-auto rounded-full bg-surface border-2 border-purple-500 flex items-center justify-center text-2xl font-bold text-purple-300 mb-3 overflow-hidden shadow-lg shadow-purple-900/20">
                        {clienteActual.foto_url ? <img src={clienteActual.foto_url} alt="" className="w-full h-full object-cover" /> : <span>{clienteActual.nombre?.charAt(0) || "W"}</span>}
                      </div>
                      {isEditingNombre ? (
                        <div className="flex items-center justify-center gap-1.5 px-2">
                          <input type="text" value={tempNombre} onChange={(e) => setTempNombre(e.target.value)} className="bg-background border border-purple-500 rounded-lg px-2.5 py-1 text-sm text-gray-100 focus:outline-none w-full text-center" autoFocus onKeyDown={(e) => { if (e.key === "Enter") guardarNuevoNombre(); }} />
                          <button onClick={guardarNuevoNombre} className="p-1.5 text-emerald-400 hover:text-emerald-300"><CheckCircle2 className="w-4 h-4" /></button>
                          <button onClick={() => setIsEditingNombre(false)} className="p-1.5 text-gray-400 hover:text-red-400"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2 group">
                          <h3 className="text-base font-bold text-gray-100">{clienteActual.nombre || "Sin Nombre"}</h3>
                          <button onClick={() => { setTempNombre(clienteActual.nombre || ""); setIsEditingNombre(true); }} className="text-gray-500 hover:text-purple-300 transition-colors" title="Editar nombre"><Edit2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">{clienteActual.telefono_display || clienteActual.telefono}</p>
                    </div>

                    <div className="flex gap-2">
                      <button onClick={toggleSpam} className={`flex-1 flex justify-center items-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-all ${clienteActual.es_spam ? "bg-red-950 border-red-700 text-red-400" : "bg-background border-border text-gray-400 hover:text-red-400"}`}>
                        <Ban className="w-3.5 h-3.5" />{clienteActual.es_spam ? "Quitar Spam" : "Spam"}
                      </button>
                      <button onClick={toggleAgenteIA} className={`flex-1 flex justify-center items-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-all ${selectedConv.agente_activo ? "bg-purple-900 border-purple-600 text-purple-200" : "bg-background border-border text-gray-400"}`}>
                        <Bot className="w-3.5 h-3.5" />{selectedConv.agente_activo ? "IA Activa" : "IA Pausa"}
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <button onClick={() => archivarConversacion(selectedConv.id, true)} className="flex-1 flex justify-center items-center gap-1.5 py-2 rounded-lg bg-amber-950/30 border border-amber-800/50 text-amber-400 hover:bg-amber-900/30 text-xs font-medium transition-all">
                        <Archive className="w-3.5 h-3.5" /> Archivar
                      </button>
                      <button onClick={() => setShowDeleteConfirm(selectedConv.id)} className="flex-1 flex justify-center items-center gap-1.5 py-2 rounded-lg bg-red-950/30 border border-red-800/50 text-red-400 hover:bg-red-900/30 text-xs font-medium transition-all">
                        <Trash2 className="w-3.5 h-3.5" /> Eliminar
                      </button>
                    </div>

                    {/* NOTAS PERSONALES - NUEVO */}
                    <div className="bg-background p-4 rounded-xl border border-amber-900/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5" /> Notas Personales</h4>
                        {!isEditingNotas ? (
                          <button onClick={() => { setIsEditingNotas(true); setTempNotas(clienteActual.notas_personales || ""); setTempDetallesCaso(clienteActual.detalles_caso || ""); }} className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
                            <Edit2 className="w-3 h-3" /> Editar
                          </button>
                        ) : (
                          <div className="flex gap-1">
                            <button onClick={guardarNotasPersonales} className="text-[10px] bg-purple-600 text-white px-2 py-1 rounded flex items-center gap-1"><Save className="w-3 h-3" /> Guardar</button>
                            <button onClick={() => setIsEditingNotas(false)} className="text-[10px] bg-surface border border-border px-2 py-1 rounded">Cancelar</button>
                          </div>
                        )}
                      </div>
                      
                      {isEditingNotas ? (
                        <div className="space-y-3">
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Detalles del caso</label>
                            <textarea value={tempDetallesCaso} onChange={(e) => setTempDetallesCaso(e.target.value)} placeholder="Ej: Amarre para pareja, lleva 3 meses separado, menciona tercera persona, urgente..." className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-600 min-h-[60px] resize-none" />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Notas privadas</label>
                            <textarea value={tempNotas} onChange={(e) => setTempNotas(e.target.value)} placeholder="Notas internas: comportamiento, objeciones, datos sensibles, seguimiento..." className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-600 min-h-[80px] resize-none" />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {clienteActual.detalles_caso ? (
                            <div className="bg-surface p-2.5 rounded-lg border border-border">
                              <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Caso:</p>
                              <p className="text-xs text-gray-300 whitespace-pre-wrap">{clienteActual.detalles_caso}</p>
                            </div>
                          ) : null}
                          {clienteActual.notas_personales ? (
                            <div className="bg-amber-950/20 p-2.5 rounded-lg border border-amber-900/20">
                              <p className="text-[10px] text-amber-500/70 uppercase font-bold mb-1">Notas:</p>
                              <p className="text-xs text-gray-300 whitespace-pre-wrap">{clienteActual.notas_personales}</p>
                            </div>
                          ) : null}
                          {!clienteActual.notas_personales && !clienteActual.detalles_caso && (
                            <p className="text-[11px] text-gray-600 italic">Sin notas. Click en Editar para agregar detalles del caso.</p>
                          )}
                          {clienteActual.notas_actualizado_en && (
                            <p className="text-[9px] text-gray-600">Actualizado: {new Date(clienteActual.notas_actualizado_en).toLocaleString()}</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="bg-background p-4 rounded-xl border border-border space-y-2">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Estado Pipeline</label>
                      <select value={clienteActual.estado || "nuevo_lead"} onChange={(e) => actualizarEstadoCliente(clienteActual.id, e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500">
                        {pipelineEtapas.map((etapa) => <option key={etapa.clave} value={etapa.clave}>{etapa.nombre}</option>)}
                      </select>
                    </div>

                    <div className="bg-background p-4 rounded-xl border border-border space-y-3">
                      <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Fotos Recibidas</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {clienteActual.foto_url ? (
                          <a href={clienteActual.foto_url} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-surface border border-border overflow-hidden group relative"><img src={clienteActual.foto_url} alt="Cliente" className="w-full h-full object-cover" /><span className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-semibold transition-opacity">Cliente</span></a>
                        ) : (<div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600"><span>Foto</span><span>Cliente</span></div>)}
                        {clienteActual.foto_otra_persona ? (
                          <a href={clienteActual.foto_otra_persona} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-surface border border-border overflow-hidden group relative"><img src={clienteActual.foto_otra_persona} alt="Pareja" className="w-full h-full object-cover" /><span className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-semibold transition-opacity">Pareja</span></a>
                        ) : (<div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600"><span>Foto</span><span>Pareja</span></div>)}
                        {clienteActual.foto_mano ? (
                          <a href={clienteActual.foto_mano} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-surface border border-border overflow-hidden group relative"><img src={clienteActual.foto_mano} alt="Palma Mano" className="w-full h-full object-cover" /><span className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-semibold transition-opacity">Palma</span></a>
                        ) : (<div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600"><span>Foto</span><span>Mano</span></div>)}
                      </div>
                    </div>

                    <div className="bg-background p-4 rounded-xl border border-border space-y-3">
                      <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><CheckSquare className="w-3.5 h-3.5" /> Checklist y Tareas</h4>
                      <div className="space-y-1.5">
                        {tareasCliente.map((t) => (
                          <div key={t.id} className="flex items-start gap-2 bg-surface p-2 rounded-lg border border-border group">
                            <button onClick={() => toggleTarea(t.id, t.completada)} className="mt-0.5 flex-shrink-0 text-purple-400">{t.completada ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-gray-500" />}</button>
                            <div className="flex-1 min-w-0"><p className={`text-xs ${t.completada ? "line-through text-gray-500" : "text-gray-200"}`}>{t.titulo}</p>{t.fecha_vencimiento && <p className="text-[9px] text-amber-400/80 mt-0.5">{t.fecha_vencimiento}</p>}</div>
                            <button onClick={() => eliminarTarea(t.id)} className="text-gray-600 hover:text-red-400 md:opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        {tareasCliente.length === 0 && <p className="text-[11px] text-gray-600 italic">Sin tareas</p>}
                      </div>
                      <form onSubmit={agregarTarea} className="pt-2 border-t border-border/50 flex flex-col gap-2">
                        <input type="text" placeholder="Nueva tarea..." value={nuevaTareaTitulo} onChange={(e) => setNuevaTareaTitulo(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-purple-500" required />
                        <div className="flex gap-2"><input type="date" value={nuevaTareaFecha} onChange={(e) => setNuevaTareaFecha(e.target.value)} className="flex-1 bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none" /><button type="submit" className="bg-surface border border-border hover:bg-purple-600 hover:text-white px-3 rounded-lg transition-colors"><Plus className="w-4 h-4" /></button></div>
                      </form>
                    </div>

                    <div className="bg-background p-4 rounded-xl border border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Cobros</h4>
                        <span className="text-[10px] text-emerald-400 font-bold border border-emerald-900/50 bg-emerald-950/30 px-1.5 py-0.5 rounded">
                          ${pagosCliente.reduce((acc, p) => acc + (p.estado === "pagado" ? calcularCOP(p) : 0), 0).toLocaleString()} COP / ${pagosCliente.reduce((acc, p) => acc + calcularCOP(p), 0).toLocaleString()} COP
                        </span>
                      </div>
                      {pagosCliente.length > 0 && (
                        <div className="space-y-1.5">
                          {pagosCliente.map((pago) => {
                            const moneda = pago.moneda || "COP";
                            const cop = calcularCOP(pago);
                            return (
                              <div key={pago.id} className={`flex items-center justify-between p-2 rounded-lg border text-xs ${pago.estado === "pagado" ? "bg-emerald-950/20 border-emerald-900/40" : "bg-surface border-border"}`}>
                                <button onClick={() => marcarPago(pago.id, pago.estado)} className="mr-2 flex-shrink-0">{pago.estado === "pagado" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4 text-amber-500" />}</button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className={pago.estado === "pagado" ? "line-through text-gray-500" : "text-gray-200"}>{formatearMoneda(pago.monto, moneda)}</span>
                                    {moneda !== "COP" && <span className="text-[9px] text-emerald-400">→ ${Math.round(cop).toLocaleString()} COP</span>}
                                    <span className={`text-[8px] px-1 py-0.5 rounded font-bold ${moneda === "PYG" ? "bg-amber-900/30 text-amber-400" : moneda === "USD" ? "bg-green-900/30 text-green-400" : "bg-gray-800 text-gray-400"}`}>{moneda}</span>
                                  </div>
                                  <div className="text-[9px] text-gray-500 truncate">{pago.notas} • {pago.fecha_vencimiento} {pago.comision_porcentaje ? `• com ${pago.comision_porcentaje}%` : ""}</div>
                                </div>
                                <button onClick={() => eliminarPago(pago.id)} className="text-gray-600 hover:text-red-400 ml-1"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <form onSubmit={agregarPagos} className="pt-2 border-t border-border/50 flex flex-col gap-2">
                        <div className="flex bg-surface p-0.5 rounded-lg text-[10px]">
                          <button type="button" onClick={() => setTipoPago("unico")} className={`flex-1 py-1.5 rounded-md transition-all ${tipoPago === "unico" ? "bg-purple-600 text-white" : "text-gray-400"}`}>Único</button>
                          <button type="button" onClick={() => setTipoPago("cuotas")} className={`flex-1 py-1.5 rounded-md transition-all ${tipoPago === "cuotas" ? "bg-purple-600 text-white" : "text-gray-400"}`}>Cuotas</button>
                        </div>

                        {/* DIVISA Y COMISION */}
                        <div className="grid grid-cols-3 gap-2">
                          <select value={monedaPago} onChange={(e) => setMonedaPago(e.target.value as any)} className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500">
                            <option value="COP">COP 🇨🇴</option>
                            <option value="PYG">PYG 🇵🇾</option>
                            <option value="USD">USD 🇺🇸</option>
                            <option value="EUR">EUR 🇪🇺</option>
                            <option value="BRL">BRL 🇧🇷</option>
                            <option value="MXN">MXN 🇲🇽</option>
                          </select>
                          <div className="relative">
                            <input type="number" step="0.01" placeholder="Comisión %" value={comisionPago} onChange={(e) => setComisionPago(e.target.value)} className="w-full bg-surface border border-border rounded-lg pl-6 pr-2 py-1.5 text-xs focus:outline-none focus:border-purple-500" />
                            <Percent className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                          </div>
                          <input type="number" step="0.0001" placeholder="Tasa" value={tasaCambioPago} onChange={(e) => setTasaCambioPago(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-purple-500" title="Tasa de cambio a COP" />
                        </div>

                        {previewMonto > 0 && (
                          <div className="bg-purple-950/20 border border-purple-900/30 rounded-lg p-2 text-[10px] text-gray-300 space-y-1">
                            <div className="flex justify-between"><span>{formatearMoneda(previewMonto, monedaPago)}</span><span>- {previewComision}% com</span></div>
                            <div className="flex justify-between text-purple-300"><span>= {formatearMoneda(previewMonto * (1 - previewComision/100), monedaPago)}</span><span>× {previewTasa}</span></div>
                            <div className="flex justify-between font-bold text-emerald-400 border-t border-purple-900/20 pt-1"><span>Total COP:</span><span>${Math.round(previewConvertido).toLocaleString()} COP</span></div>
                          </div>
                        )}

                        <input type="number" placeholder="Monto total" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-500" required />
                        {tipoPago === "cuotas" && (
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>Dividir en</span>
                            <input type="number" min="2" max="12" value={numeroCuotas} onChange={(e) => setNumeroCuotas(e.target.value)} className="w-14 bg-surface border border-border rounded-lg px-2 py-1 text-center text-xs focus:outline-none" />
                            <span>cuotas</span>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input type="date" value={fechaInicial} onChange={(e) => setFechaInicial(e.target.value)} className="flex-1 bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none" />
                          <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="flex-1 bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none">
                            <option value="Nequi">Nequi</option>
                            <option value="Daviplata">Daviplata</option>
                            <option value="Bancolombia">Bancolombia</option>
                            <option value="Efectivo">Efectivo</option>
                            <option value="Transferencia">Transferencia</option>
                            <option value="Otro">Otro</option>
                          </select>
                        </div>
                        <input type="text" placeholder="Nota: amarre, limpieza..." value={notaPago} onChange={(e) => setNotaPago(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-500" />
                        <button type="submit" className="w-full bg-surface border border-border hover:bg-purple-600 text-gray-300 hover:text-white py-1.5 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5" /> Agregar Cobro</button>
                      </form>
                    </div>
                  </div>
                </aside>
              </div>
            ) : (
              <div className="hidden md:flex flex-1 flex-col items-center justify-center text-gray-500 bg-background">
                <MessageSquare className="w-12 h-12 mb-2 stroke-[1.5]" />
                <p className="text-sm">Selecciona una conversación</p>
                <p className="text-xs mt-2 text-gray-600 max-w-xs text-center">Archiva a los que no contestan con el botón 📦 para mantener tu bandeja limpia</p>
              </div>
            )}
          </>
        )}

        {/* ================= ARCHIVADOS ================= */}
        {tab === "archivados" && (
          <>
            <section className={`w-full md:w-96 border-r border-border bg-surface/50 flex-col ${selectedConv ? "hidden md:flex" : "flex"}`}>
              <div className="p-4 border-b border-border flex flex-col gap-3 pt-6 md:pt-4">
                <div className="flex items-center justify-between">
                  <h1 className="text-lg font-bold text-gray-100 flex items-center gap-2"><Archive className="w-5 h-5 text-amber-400" /> Archivados</h1>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber-900/30 text-amber-300 font-medium border border-amber-800/50">{conversacionesArchivadas.length}</span>
                </div>
                <p className="text-[11px] text-gray-400 bg-background/50 p-2.5 rounded-lg border border-border">Personas que no volvieron a contestar. Se archivan automáticamente después de 7 días sin actividad o manualmente.</p>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input value={searchArchivados} onChange={e => setSearchArchivados(e.target.value)} placeholder="Buscar en archivados..." className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-600" />
                  {searchArchivados && <button onClick={() => setSearchArchivados("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
                </div>
                <div className="flex bg-background p-1 rounded-lg border border-border text-xs">
                  {["todos", "evolution", "meta_business"].map((f) => (
                    <button key={f} onClick={() => setFiltroArchivados(f as any)} className={`flex-1 py-1.5 rounded-md transition-all capitalize ${filtroArchivados === f ? "bg-amber-900/40 text-amber-300 font-medium" : "text-gray-500"}`}>{f === "evolution" ? "Personal" : f === "meta_business" ? "Business" : f}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border/50">
                {conversacionesArchivadas.length === 0 ? (
                  <div className="p-8 text-center"><Archive className="w-12 h-12 mx-auto text-gray-600 mb-3" /><p className="text-sm text-gray-400 font-medium">No hay archivados</p><p className="text-xs text-gray-500 mt-1">Las conversaciones inactivas aparecerán aquí</p></div>
                ) : (
                  conversacionesArchivadas.map((conv) => {
                    const cliente = conv.clientes;
                    const displayName = cliente?.nombre || cliente?.telefono_display || conv.numero_whatsapp;
                    const diasArchivado = conv.fecha_archivado ? Math.floor((Date.now() - new Date(conv.fecha_archivado).getTime()) / (1000*60*60*24)) : Math.floor((Date.now() - new Date(conv.ultimo_mensaje_en).getTime()) / (1000*60*60*24));
                    return (
                      <div key={conv.id} className={`group relative w-full flex items-start gap-3 text-left hover:bg-surfaceHover transition-colors ${selectedConv?.id === conv.id ? "bg-amber-950/20 border-l-4 border-amber-600" : ""}`}>
                        <button onClick={() => selectConversation(conv)} className="flex-1 p-4 flex items-start gap-3 text-left">
                          <div className="relative flex-shrink-0"><div className="w-11 h-11 rounded-full bg-surface border border-amber-900/30 flex items-center justify-center text-amber-400 font-bold overflow-hidden opacity-80">{cliente?.foto_url ? <img src={cliente.foto_url} alt="" className="w-full h-full object-cover grayscale" /> : <span>{displayName?.charAt(0) || "W"}</span>}</div><span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-amber-900 border-2 border-surface flex items-center justify-center"><Archive className="w-2.5 h-2.5 text-amber-300" /></span></div>
                          <div className="flex-1 min-w-0"><div className="flex justify-between mb-1"><h2 className="text-sm font-medium text-gray-300 truncate">{displayName}</h2><span className="text-[10px] text-amber-500/70">{diasArchivado}d</span></div><p className="text-xs text-gray-500 truncate">{conv.ultimo_mensaje || "Sin mensajes"}</p><p className="text-[10px] text-gray-600 mt-1">{new Date(conv.ultimo_mensaje_en).toLocaleDateString()}</p></div>
                        </button>
                        <div className="absolute right-2 top-2 hidden group-hover:flex items-center gap-1 bg-surface border border-border rounded-lg p-1 shadow-lg">
                          <button onClick={(e) => { e.stopPropagation(); archivarConversacion(conv.id, false); }} className="p-1.5 text-emerald-400 hover:bg-emerald-950/50 rounded-md transition-colors" title="Restaurar"><ArchiveRestore className="w-3.5 h-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(conv.id); }} className="p-1.5 text-red-400 hover:bg-red-950/50 rounded-md transition-colors" title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {selectedConv && clienteActual ? (
              <div className="flex-1 flex w-full h-full absolute inset-0 md:relative bg-background z-20">
                <section className={`flex-1 flex flex-col h-full ${showMobileDetails ? "hidden md:flex" : "flex"}`}>
                  <header className="h-16 px-4 md:px-6 border-b border-amber-900/30 bg-amber-950/20 backdrop-blur-md flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                      <button onClick={() => setSelectedConv(null)} className="md:hidden p-2 -ml-2 text-gray-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></button>
                      <div className="w-10 h-10 rounded-full bg-surface border border-amber-800/50 flex items-center justify-center text-amber-400 font-bold overflow-hidden">{clienteActual.foto_url ? <img src={clienteActual.foto_url} className="w-full h-full object-cover" alt="" /> : <span>{clienteActual.nombre?.charAt(0) || "W"}</span>}</div>
                      <div className="flex flex-col"><h2 className="text-sm font-bold text-gray-100 flex items-center gap-2">{clienteActual.nombre || "Sin nombre"}<span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-800/50">ARCHIVADO</span></h2><span className="text-[10px] text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" /> {clienteActual.telefono_display || clienteActual.telefono}</span></div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => archivarConversacion(selectedConv.id, false)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/30 border border-emerald-800/50 text-emerald-300 hover:bg-emerald-900/50 text-xs font-medium transition-colors"><ArchiveRestore className="w-4 h-4" /> Restaurar</button>
                      <button onClick={() => setShowDeleteConfirm(selectedConv.id)} className="p-2 text-red-400 hover:bg-red-950/30 rounded-lg border border-red-900/30 transition-colors"><Trash2 className="w-4 h-4" /></button>
                      <button onClick={() => setShowMobileDetails(true)} className="md:hidden p-2 text-gray-400"><Info className="w-5 h-5" /></button>
                    </div>
                  </header>
                  <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-background">
                    <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-200/80"><AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" /><p>Esta conversación está archivada porque no hubo respuesta en más de 7 días. Puedes restaurarla para que vuelva a la bandeja principal o enviar un mensaje y se restaurará automáticamente.</p></div>
                    {mensajes.map((msg) => {
                      const isMe = msg.tipo === "enviado";
                      return (<div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm ${isMe ? "bg-purple-600 text-white rounded-br-none opacity-90" : "bg-surface border border-border text-gray-300 rounded-bl-none opacity-80"}`}>{(() => { const isAudioMsg = msg.tipo_contenido === "audio" || msg.contenido === "[audio]" || msg.contenido === "[nota_de_voz]" || (msg.url_archivo && (msg.url_archivo.startsWith("data:audio/") || /\.(ogg|opus|webm|mp3|wav|m4a|aac)($|\?)/i.test(msg.url_archivo))); if (isAudioMsg && msg.url_archivo) { return <VoiceNotePlayer src={msg.url_archivo} isMe={isMe} />; } if (msg.tipo_contenido === "imagen" && msg.url_archivo) { return <img src={msg.url_archivo} alt="" className="rounded-lg max-h-60 object-cover" />; } return <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.contenido}</p>; })()}<span className={`block text-[9px] mt-1 ${isMe ? "text-purple-200 text-right" : "text-gray-500"}`}>{new Date(msg.creado_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div></div>);
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="p-3 border-t border-border bg-surface/80 backdrop-blur-md flex items-center gap-2 flex-shrink-0">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" />
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isRecording} className="p-2.5 text-gray-400 hover:text-purple-400 hover:bg-surfaceHover rounded-full transition-colors disabled:opacity-40"><Paperclip className="w-5 h-5" /></button>
                    {(isRecording || isPreparingRecording) ? (
                      <div className="flex-1 bg-red-950/30 border border-red-900/50 rounded-full px-4 py-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-red-400 text-sm font-medium flex-shrink-0"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><Mic className="w-4 h-4" /> {isPreparingRecording ? "Preparando..." : formatTime(recordingTime)}</div><div className="flex items-center gap-1 flex-shrink-0"><button onClick={cancelRecording} disabled={!isRecording} className="p-1.5 text-gray-400 hover:text-white rounded-full disabled:opacity-40"><Trash2 className="w-4 h-4" /></button><button onClick={stopRecording} disabled={isPreparingRecording || !isRecording} className="p-1.5 text-white bg-red-600 hover:bg-red-500 rounded-full shadow-lg disabled:opacity-40"><Send className="w-4 h-4 ml-0.5" /></button></div></div>
                    ) : (
                      <form onSubmit={handleSendMessage} className="flex-1 flex flex-wrap items-center gap-2"><input type="text" value={nuevoMensaje} onChange={(e) => setNuevoMensaje(e.target.value)} placeholder="Escribe para restaurar y responder..." disabled={isSending} className="flex-1 bg-background border border-border rounded-full px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-600 disabled:opacity-50" />{nuevoMensaje.trim() ? (<button type="submit" disabled={isSending} className="bg-amber-700 hover:bg-amber-600 text-white p-2.5 rounded-full transition-colors disabled:opacity-50"><Send className="w-5 h-5" /></button>) : (<button type="button" onClick={startRecording} disabled={isSending || isPreparingRecording} className="bg-surface border border-border text-amber-400 hover:bg-amber-600 hover:text-white hover:border-amber-600 p-2.5 rounded-full transition-colors disabled:opacity-50"><Mic className="w-5 h-5" /></button>)} {sendError && <p className="w-full text-xs text-red-400 px-2">{sendError}</p>}</form>
                    )}
                  </div>
                </section>
                <aside className={`w-full md:w-80 lg:w-96 border-l border-border bg-surface/95 overflow-y-auto absolute inset-0 z-30 md:relative flex flex-col ${!showMobileDetails ? "hidden md:flex" : "flex"}`}>
                  <header className="md:hidden flex items-center p-4 border-b border-border bg-background sticky top-0 z-10"><button onClick={() => setShowMobileDetails(false)} className="p-2 -ml-2 text-gray-400"><ArrowLeft className="w-5 h-5" /></button><h2 className="font-bold ml-2">Ficha Archivada</h2></header>
                  <div className="p-5 space-y-5">
                    <div className="text-center"><div className="w-20 h-20 mx-auto rounded-full bg-surface border-2 border-amber-700 flex items-center justify-center text-2xl font-bold text-amber-300 mb-3 overflow-hidden shadow-lg">{clienteActual.foto_url ? <img src={clienteActual.foto_url} alt="" className="w-full h-full object-cover" /> : <span>{clienteActual.nombre?.charAt(0) || "W"}</span>}</div><h3 className="text-base font-bold text-gray-100">{clienteActual.nombre || "Sin Nombre"}</h3><p className="text-xs text-gray-400 mt-0.5">{clienteActual.telefono_display || clienteActual.telefono}</p></div>
                    <button onClick={() => archivarConversacion(selectedConv.id, false)} className="w-full flex justify-center items-center gap-1.5 py-2.5 rounded-lg bg-emerald-900/30 border border-emerald-800 text-emerald-300 hover:bg-emerald-900/50 text-xs font-bold transition-all"><ArchiveRestore className="w-4 h-4" /> Restaurar a bandeja</button>
                    {/* Notas en archivados también */}
                    {(clienteActual.notas_personales || clienteActual.detalles_caso) && (
                      <div className="bg-background p-3 rounded-xl border border-amber-900/20 space-y-2">
                        <h4 className="text-[10px] font-bold text-amber-400 uppercase flex items-center gap-1"><StickyNote className="w-3 h-3" /> Notas</h4>
                        {clienteActual.detalles_caso && <p className="text-xs text-gray-300 whitespace-pre-wrap">{clienteActual.detalles_caso}</p>}
                        {clienteActual.notas_personales && <p className="text-xs text-gray-400 whitespace-pre-wrap bg-amber-950/20 p-2 rounded border border-amber-900/20">{clienteActual.notas_personales}</p>}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            ) : (
              <div className="hidden md:flex flex-1 flex-col items-center justify-center text-gray-500 bg-background"><Archive className="w-12 h-12 mb-3 text-amber-700/50" /><p className="text-sm font-medium">Selecciona un archivado</p><p className="text-xs mt-1 text-gray-600 max-w-xs text-center">Aquí van las personas que no vuelven a contestar. Puedes restaurarlas o eliminarlas.</p></div>
            )}
          </>
        )}

        {/* ==================== PIPELINE ==================== */}
        {tab === "pipeline" && (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
            <header className="p-4 md:p-6 border-b border-border flex items-center justify-between bg-surface/30">
              <div><h1 className="text-xl md:text-2xl font-bold text-gray-100">Pipeline</h1><p className="text-xs md:text-sm text-gray-400">Embudo visual de trabajos</p></div>
              <button onClick={() => setIsEditingPipeline(!isEditingPipeline)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${isEditingPipeline ? "bg-purple-600 text-white" : "bg-surface border border-border text-gray-300 hover:bg-surfaceHover"}`}><Settings className="w-4 h-4" /> {isEditingPipeline ? "Cerrar" : "Configurar"}</button>
            </header>
            <div className="flex-1 flex overflow-x-auto p-4 md:p-6 gap-4">
              {isEditingPipeline && (
                <div className="w-72 flex-shrink-0 bg-surface border border-border rounded-2xl p-4 flex flex-col gap-4 shadow-xl">
                  <h2 className="text-sm font-bold text-purple-300 flex items-center gap-2 border-b border-border pb-2"><Edit2 className="w-4 h-4" /> Editar Etapas</h2>
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {pipelineEtapas.map((etapa, idx) => (
                      <div key={etapa.id} className="flex items-center gap-2 bg-background p-2 rounded-lg border border-border">
                        <div className="flex flex-col gap-1"><button onClick={() => moverEtapa(idx, -1)} className="text-gray-500 hover:text-white"><ArrowUp className="w-3 h-3" /></button><button onClick={() => moverEtapa(idx, 1)} className="text-gray-500 hover:text-white"><ArrowDown className="w-3 h-3" /></button></div>
                        <input type="text" value={etapa.nombre} onChange={(e) => actualizarNombreEtapa(etapa.id, e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none focus:text-purple-300" />
                        <button onClick={() => eliminarEtapa(etapa.id)} className="text-red-500/70 hover:text-red-400 p-1"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={agregarEtapaPipeline} className="w-full py-2 bg-surfaceHover border border-dashed border-gray-600 rounded-lg text-xs text-gray-400 hover:text-white flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Agregar Etapa</button>
                </div>
              )}
              {pipelineEtapas.filter((e) => e.clave !== "spam").map((col) => {
                const clientesEnCol = conversaciones.filter((c) => (c.clientes?.estado || "nuevo_lead") === col.clave && !c.clientes?.es_spam && !(c as any).archivada);
                return (
                  <div key={col.id} className="w-72 flex-shrink-0 bg-surface/60 border border-border rounded-2xl p-4 flex flex-col gap-3 min-h-full">
                    <div className={`flex items-center justify-between pb-2 border-b-2 ${col.color || "border-purple-500"}`}><h2 className="text-xs font-bold text-gray-200">{col.nombre}</h2><span className="text-xs px-2 py-0.5 rounded-full bg-surfaceHover text-gray-400 font-semibold">{clientesEnCol.length}</span></div>
                    <div className="space-y-3 overflow-y-auto flex-1">{clientesEnCol.map((c) => (<div key={c.id} onClick={() => { selectConversation(c); setTab("chats"); }} className="p-3 bg-surface rounded-xl border border-border/80 hover:border-purple-500/80 cursor-pointer shadow-sm group"><h3 className="text-xs font-bold text-gray-200 group-hover:text-purple-300 truncate">{c.clientes?.nombre || c.clientes?.telefono_display || c.numero_whatsapp}</h3><p className="text-[11px] text-gray-400 mt-1 truncate">{c.clientes?.tipo_trabajo || "Sin clasificar"}{c.clientes?.notas_personales ? " • 📝" : ""}</p></div>))}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================== TAREAS GLOBALES ==================== */}
        {tab === "tareas" && (
          <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-background">
            <header className="mb-6"><h1 className="text-xl md:text-2xl font-bold text-gray-100 flex items-center gap-2"><ListTodo className="text-purple-400 w-6 h-6" /> Panel de Tareas</h1><p className="text-xs md:text-sm text-gray-400">Pendientes del día y checklist de clientes</p></header>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 items-start">
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4"><h2 className="text-sm font-bold text-amber-400 flex items-center gap-2 border-b border-border pb-2"><Clock className="w-4 h-4" /> Pendientes / Vencidas</h2><div className="space-y-2">{todasTareas.filter((t) => !t.completada && t.fecha_vencimiento && new Date(t.fecha_vencimiento) <= ahora).length === 0 && <p className="text-xs text-gray-500 italic">Todo al día ✅</p>}{todasTareas.filter((t) => !t.completada && t.fecha_vencimiento && new Date(t.fecha_vencimiento) <= ahora).map((t) => (<div key={t.id} className="bg-background border border-amber-900/30 p-3 rounded-xl"><div className="flex justify-between items-start mb-1"><span className="text-[10px] bg-amber-950/50 text-amber-500 px-1.5 rounded border border-amber-900">{t.fecha_vencimiento}</span><span className="text-[10px] text-gray-400 truncate max-w-[120px]">{t.clientes?.nombre || "Cliente"}</span></div><p className="text-xs text-gray-200 font-medium">{t.titulo}</p><button onClick={() => toggleTarea(t.id, false)} className="mt-2 text-[10px] text-purple-400 hover:text-purple-300">Marcar hecha ✓</button></div>))}</div></div>
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4"><h2 className="text-sm font-bold text-blue-400 flex items-center gap-2 border-b border-border pb-2"><Calendar className="w-4 h-4" /> Próximas / Sin fecha</h2><div className="space-y-2">{todasTareas.filter((t) => !t.completada && (!t.fecha_vencimiento || new Date(t.fecha_vencimiento) > ahora)).map((t) => (<div key={t.id} className="bg-background border border-border p-3 rounded-xl"><div className="flex justify-between items-start mb-1"><span className="text-[10px] text-blue-400">{t.fecha_vencimiento || "Sin fecha"}</span><span className="text-[10px] text-gray-400 truncate max-w-[120px]">{t.clientes?.nombre || "Cliente"}</span></div><p className="text-xs text-gray-200">{t.titulo}</p><button onClick={() => toggleTarea(t.id, false)} className="mt-2 text-[10px] text-purple-400 hover:text-purple-300">Marcar hecha ✓</button></div>))}</div></div>
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4"><h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2 border-b border-border pb-2"><CheckCircle2 className="w-4 h-4" /> Completadas</h2><div className="space-y-2">{todasTareas.filter((t) => t.completada).slice(-15).reverse().map((t) => (<div key={t.id} className="bg-background border border-border p-3 rounded-xl opacity-60"><div className="flex justify-between items-start"><span className="text-[10px] text-gray-500 line-through">{t.titulo}</span><span className="text-[10px] text-gray-600">{t.clientes?.nombre}</span></div></div>))}</div></div>
            </div>
          </div>
        )}

        {/* ==================== CARTERA CON DIVISAS ==================== */}
        {tab === "cartera" && (
          <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6 bg-background">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-100 flex items-center gap-2"><DollarSign className="text-emerald-400 w-6 h-6" /> Cartera y Métricas</h1>
                <p className="text-xs md:text-sm text-gray-400">Rendimiento, divisas y conversión a COP</p>
              </div>
              <button onClick={() => setShowDivisaConfig(!showDivisaConfig)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border text-xs font-medium hover:bg-surfaceHover">
                <Coins className="w-4 h-4 text-amber-400" /> Config Divisas
              </button>
            </header>

            {showDivisaConfig && (
              <div className="bg-surface border border-amber-900/30 rounded-2xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2"><Globe className="w-4 h-4" /> Configuración de Tasas y Comisión</h3>
                <p className="text-[11px] text-gray-400">Ajusta cuánto vale cada moneda en COP. Ej: si 1 PYG = 0.55 COP, pon 0.55. La comisión se descuenta antes de convertir.</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div><label className="text-[10px] text-gray-500 uppercase font-bold">PYG → COP</label><input type="number" step="0.01" value={tasaPYG} onChange={e => setTasaPYG(parseFloat(e.target.value) || 0)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-xs" /><p className="text-[9px] text-gray-600 mt-1">Ej: 200.000 PYG × 0.55 = 110.000 COP</p></div>
                  <div><label className="text-[10px] text-gray-500 uppercase font-bold">USD → COP</label><input type="number" step="1" value={tasaUSD} onChange={e => setTasaUSD(parseFloat(e.target.value) || 0)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-xs" /></div>
                  <div><label className="text-[10px] text-gray-500 uppercase font-bold">EUR → COP</label><input type="number" step="1" value={tasaEUR} onChange={e => setTasaEUR(parseFloat(e.target.value) || 0)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-xs" /></div>
                  <div><label className="text-[10px] text-gray-500 uppercase font-bold">BRL → COP</label><input type="number" step="1" value={tasaBRL} onChange={e => setTasaBRL(parseFloat(e.target.value) || 0)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-xs" /></div>
                  <div><label className="text-[10px] text-gray-500 uppercase font-bold">MXN → COP</label><input type="number" step="1" value={tasaMXN} onChange={e => setTasaMXN(parseFloat(e.target.value) || 0)} className="w-full mt-1 bg-background border border-border rounded-lg px-3 py-2 text-xs" /></div>
                  <div><label className="text-[10px] text-amber-500 uppercase font-bold">Comisión % default</label><div className="relative mt-1"><input type="number" step="0.1" value={comisionDefault} onChange={e => setComisionDefault(parseFloat(e.target.value) || 0)} className="w-full bg-background border border-amber-900/50 rounded-lg pl-7 pr-3 py-2 text-xs" /><Percent className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-amber-500" /></div><p className="text-[9px] text-amber-600 mt-1">Normalmente 7% para PYG</p></div>
                </div>
                <div className="flex gap-2"><button onClick={guardarConfigDivisas} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold">Guardar</button><button onClick={() => setShowDivisaConfig(false)} className="px-4 py-2 bg-surface border border-border rounded-lg text-xs">Cerrar</button></div>
              </div>
            )}

            <div>
              <h2 className="text-sm font-bold text-purple-300 mb-3 uppercase tracking-wider">Rendimiento</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><p className="text-2xl md:text-3xl font-extrabold text-gray-100">{totalAtendidos}</p><p className="text-[11px] text-gray-400 mt-1">Clientes atendidos</p></div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><p className="text-2xl md:text-3xl font-extrabold text-emerald-400">{totalConvertidos}</p><p className="text-[11px] text-gray-400 mt-1">Convertidos</p></div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><p className="text-2xl md:text-3xl font-extrabold text-purple-400">{efectividad}%</p><p className="text-[11px] text-gray-400 mt-1">Efectividad</p></div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><p className="text-2xl md:text-3xl font-extrabold text-red-400">{leadsPerdidos}</p><p className="text-[11px] text-gray-400 mt-1">Perdidos</p></div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-bold text-emerald-300 mb-3 uppercase tracking-wider flex items-center gap-2">Finanzas en COP <span className="text-[10px] bg-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-800/50">Convertido</span></h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="p-4 md:p-5 bg-gradient-to-br from-emerald-950/40 to-surface border border-emerald-900/30 rounded-2xl">
                  <p className="text-xl md:text-2xl font-extrabold text-emerald-400">${Math.round(totalCobradoMesCOP).toLocaleString("es-CO")}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Cobrado este mes <span className="text-emerald-400">en COP</span></p>
                  <p className="text-[9px] text-gray-500 mt-1">{pagosDelMes.length} pagos • todas las divisas convertidas</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-xl md:text-2xl font-extrabold text-green-400">${Math.round(totalCobradoHistoricoCOP).toLocaleString("es-CO")}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Total histórico en COP</p>
                  <p className="text-[9px] text-gray-500 mt-1">Suma de {todosPagos.filter(p => p.estado === "pagado").length} pagos</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-xl md:text-2xl font-extrabold text-amber-400">${Math.round(totalPendienteCOP).toLocaleString("es-CO")}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Por cobrar en COP</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-xl md:text-2xl font-extrabold text-red-400">${Math.round(totalVencidoCOP).toLocaleString("es-CO")}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Vencido en COP</p>
                </div>
              </div>

              {/* Desglose por divisa */}
              <div className="mt-4 bg-surface/50 border border-border rounded-2xl p-4">
                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Desglose por divisa (este mes, convertido a COP)</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                  {[
                    { codigo: "COP", label: "Pesos Colombianos" },
                    { codigo: "PYG", label: "Guaraníes" },
                    { codigo: "USD", label: "Dólares" },
                    { codigo: "EUR", label: "Euros" },
                    { codigo: "BRL", label: "Reales" },
                  ].map(div => {
                    const pagosDiv = pagosDelMes.filter(p => (p.moneda || "COP") === div.codigo);
                    const totalOriginal = pagosDiv.reduce((s, p) => s + Number(p.monto), 0);
                    const totalCOP = pagosDiv.reduce((s, p) => s + calcularCOP(p), 0);
                    const comisionProm = pagosDiv.length ? pagosDiv.reduce((s, p) => s + (Number(p.comision_porcentaje) || 0), 0) / pagosDiv.length : 0;
                    return (
                      <div key={div.codigo} className="bg-background border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between"><span className="font-bold text-gray-200">{div.codigo}</span><span className="text-[9px] px-1.5 py-0.5 rounded bg-surfaceHover text-gray-400">{pagosDiv.length}</span></div>
                        <p className="text-[11px] text-gray-400 mt-1">{div.label}</p>
                        <p className="text-sm font-bold text-gray-200 mt-2">{totalOriginal.toLocaleString()} {div.codigo}</p>
                        <p className="text-[11px] text-emerald-400">→ ${Math.round(totalCOP).toLocaleString()} COP</p>
                        {comisionProm > 0 && <p className="text-[9px] text-amber-500/70 mt-1">Com prom: {comisionProm.toFixed(1)}%</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {todosPagos.filter((p) => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora).length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-red-300 mb-3 uppercase tracking-wider">⚠️ Pagos Vencidos</h2>
                <div className="bg-surface border border-red-800/50 rounded-2xl divide-y divide-border">
                  {todosPagos.filter((p) => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora).map((pago) => {
                    const cliente = todosClientes.find((c) => c.id === pago.cliente_id);
                    const moneda = pago.moneda || "COP";
                    return (
                      <div key={pago.id} className="p-4 flex items-center justify-between">
                        <div><div className="text-sm font-medium text-gray-200 flex items-center gap-2">{cliente?.nombre || "Cliente"}<span className="text-[9px] px-1 py-0.5 rounded bg-surfaceHover text-gray-400">{moneda}</span></div><div className="text-xs text-gray-400">{pago.notas} • Vencía: {pago.fecha_vencimiento}</div></div>
                        <div className="text-right"><div className="text-sm font-bold text-red-400">{formatearMoneda(pago.monto, moneda)}</div><div className="text-[11px] text-emerald-400">${Math.round(calcularCOP(pago)).toLocaleString()} COP</div></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== META ADS ==================== */}
        {tab === "ads" && (
          <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-background space-y-6">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div><div className="flex items-center gap-2"><h1 className="text-xl md:text-2xl font-bold text-gray-100 flex items-center gap-2"><TrendingUp className="text-purple-400 w-6 h-6" /> Gestor de Meta Ads (COP)</h1><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${isLiveAds ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800' : 'bg-amber-950/60 text-amber-400 border-amber-800'}`}>{isLiveAds ? 'Meta Live API' : 'Modo Demo'}</span></div><p className="text-xs md:text-sm text-gray-400">Decisiones rápidas para proteger presupuesto y escalar lo que convierte.</p></div>
              <div className="flex items-center gap-2"><button onClick={fetchCampanasAds} disabled={loadingAds} className="bg-surface hover:bg-surfaceHover border border-border text-gray-300 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all"><RefreshCw className={`w-3.5 h-3.5 ${loadingAds ? 'animate-spin' : ''}`} /> Actualizar</button><button onClick={consultarAsesorIAAds} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-purple-900/30 flex items-center gap-2 transition-all"><Sparkles className="w-4 h-4" /> Analizar con IA</button></div>
            </header>
            {adsNote && !loadingAds && (<div className="p-3 rounded-xl border border-purple-800/40 bg-purple-950/20 text-purple-200 text-xs">{adsNote}</div>)}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Inversión Total</span><p className="text-xl md:text-2xl font-extrabold text-gray-100 mt-1">${Math.round(campanas.reduce((acc, c) => acc + Number(c.spend || 0), 0)).toLocaleString("es-CO")} COP</p></div>
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Leads de Ads</span><p className="text-xl md:text-2xl font-extrabold text-purple-400 mt-1">{campanas.reduce((acc, c) => acc + Number(c.leads || 0), 0)}</p></div>
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">CPL Promedio</span><p className="text-xl md:text-2xl font-extrabold mt-1 text-emerald-400">${campanas.reduce((acc, c) => acc + Number(c.leads || 0), 0) > 0 ? Math.round(campanas.reduce((acc, c) => acc + Number(c.spend || 0), 0) / campanas.reduce((acc, c) => acc + Number(c.leads || 0), 0)).toLocaleString("es-CO") : "0"} COP</p></div>
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Campañas Activas</span><p className="text-xl md:text-2xl font-extrabold text-emerald-400 mt-1">{campanas.filter(c => c.status === "ACTIVE").length}</p></div>
            </div>
            <div className="bg-surface/50 border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-border bg-surface/80 flex flex-col md:flex-row md:items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">Campañas</h3><p className="text-[11px] text-gray-500 mt-1">Ordena tu atención por estado y encuentra una campaña.</p></div><div className="flex items-center gap-2"><input value={adsQuery} onChange={e => setAdsQuery(e.target.value)} placeholder="Buscar campaña..." className="w-40 bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-purple-500" /><select value={adsStatusFilter} onChange={e => setAdsStatusFilter(e.target.value as any)} className="bg-background border border-border rounded-lg px-2 py-2 text-xs text-gray-300"><option value="all">Todas</option><option value="ACTIVE">Activas</option><option value="PAUSED">Pausadas</option></select></div></div>
              <div className="divide-y divide-border/40">
                {campanasVisibles.map((c) => {
                  const isActive = c.status === "ACTIVE"; const isExpanded = expandedCamp === c.id;
                  return (<div key={c.id} className="hover:bg-surface/40 transition-colors"><div className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer" onClick={() => setExpandedCamp(isExpanded ? null : c.id)}><div className="flex items-start gap-3 min-w-0"><button onClick={(e) => { e.stopPropagation(); toggleEstadoCampana(c.id, c.status); }} className={`mt-1 p-2 rounded-xl border transition-all ${isActive ? "bg-emerald-950/60 border-emerald-800 text-emerald-400" : "bg-surfaceHover border-border text-gray-500"}`} title={isActive ? "Pausar" : "Activar"}>{isActive ? <Pause className="w-4 h-4 fill-emerald-400" /> : <Play className="w-4 h-4 fill-gray-400 ml-0.5" />}</button><div><div className="flex items-center gap-2"><h4 className="text-sm font-bold text-gray-100">{c.name}</h4><span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${isActive ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-gray-800 text-gray-400'}`}>{isActive ? 'ACTIVA' : c.status === 'ARCHIVED' ? 'ARCHIVADA' : 'PAUSADA'}</span>{isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}</div><p className="text-xs text-gray-400 mt-1">Presupuesto: <span className="text-gray-200 font-medium">${Number(c.dailyBudget).toLocaleString("es-CO")} COP/día</span></p></div></div><div className="flex items-center gap-6 justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-border"><div className="text-left md:text-right"><span className="text-[10px] text-gray-500 block uppercase font-bold">Invertido</span><span className="text-sm font-bold text-gray-200">${Number(c.spend).toLocaleString("es-CO")}</span></div><div className="text-left md:text-right"><span className="text-[10px] text-gray-500 block uppercase font-bold">Leads</span><span className="text-sm font-bold text-purple-400">{c.leads}</span></div><div className="text-left md:text-right"><span className="text-[10px] text-gray-500 block uppercase font-bold">CPL</span><span className={`text-xs font-extrabold px-2 py-0.5 rounded ${c.cpl < 10000 ? 'bg-emerald-950/80 text-emerald-400' : c.cpl < 18000 ? 'bg-amber-950/80 text-amber-400' : 'bg-red-950/80 text-red-400'}`}>${Number(c.cpl).toLocaleString("es-CO")} COP</span></div></div></div></div>);
                })}
              </div>
            </div>
          </div>
        )}

        {/* ==================== CEREBRO IA ==================== */}
        {tab === "cerebro" && <CerebroPanel />}
      </main>

      {/* MODAL CONFIRMAR ELIMINAR */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-sm bg-surface border border-red-900/50 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400"><div className="w-10 h-10 rounded-full bg-red-950/50 border border-red-800 flex items-center justify-center"><Trash2 className="w-5 h-5" /></div><div><h3 className="text-base font-bold text-gray-100">¿Eliminar conversación?</h3><p className="text-xs text-gray-400">Esta acción no se puede deshacer</p></div></div>
            <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-3 text-xs text-gray-300">Se borrarán <span className="text-red-300 font-bold">todos los mensajes</span> de esta conversación de forma permanente. El cliente y sus pagos se mantendrán.</div>
            <div className="flex gap-2"><button onClick={() => setShowDeleteConfirm(null)} disabled={isDeleting} className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-gray-300 hover:bg-surfaceHover text-sm font-medium transition-colors disabled:opacity-50">Cancelar</button><button onClick={() => eliminarConversacionDefinitivo(showDeleteConfirm)} disabled={isDeleting} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">{isDeleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}{isDeleting ? "Eliminando..." : "Sí, eliminar"}</button></div>
          </div>
        </div>
      )}

      {/* MODAL IA */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-2xl bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3"><div className="flex items-center gap-2 text-purple-400"><Sparkles className="w-5 h-5" /><h3 className="text-lg font-bold text-gray-100">Auditoría IA</h3></div><button onClick={() => setShowAiModal(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button></div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">{loadingAiAds ? (<div className="p-12 text-center space-y-3"><Sparkles className="w-10 h-10 text-purple-500 animate-spin mx-auto" /><p className="text-sm text-gray-300 font-medium">Analizando métricas con OpenAI...</p></div>) : (<div className="prose prose-invert max-w-none text-xs md:text-sm leading-relaxed whitespace-pre-wrap text-gray-200 bg-background/80 p-5 rounded-xl border border-border">{aiRecommendation}</div>)}</div>
          </div>
        </div>
      )}

      {/* MODAL ADMIN */}
      {showAdmin && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Shield className="w-5 h-5 text-purple-400" /><h3 className="text-base font-bold text-gray-100">Panel Admin</h3></div><button onClick={() => { setShowAdmin(false); setBalances(null); setAdminSecret(""); }} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button></div>
            <div className="space-y-2"><label className="text-xs text-gray-400">Clave admin</label><input type="password" placeholder="Ingresa tu clave admin" value={adminSecret} onChange={(e) => setAdminSecret(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") cargarSaldos(); }} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500" /></div>
            <button onClick={cargarSaldos} disabled={loadingBal} className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium py-2.5 rounded-lg">{loadingBal ? "Consultando..." : "Ver saldos APIs"}</button>
            {balances?.error && <div className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 p-3 rounded-lg">{balances.error}</div>}
            {balances && !balances.error && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-background border border-border"><div className="flex items-center justify-between mb-1"><span className="text-gray-400 font-medium">OpenAI</span><span className={`w-2 h-2 rounded-full ${balances.openai?.ok ? "bg-emerald-500" : "bg-red-500"}`} /></div><div className="text-xl font-bold text-gray-100">{balances.openai?.balance != null ? `$${Number(balances.openai.balance).toFixed(2)}` : "—"}</div><div className="text-[10px] text-gray-500 mt-1">{balances.openai?.note}</div></div>
                <div className="p-3 rounded-xl bg-background border border-border"><div className="flex items-center justify-between mb-1"><span className="text-gray-400 font-medium">Fish Audio</span><span className={`w-2 h-2 rounded-full ${balances.fish?.ok ? "bg-emerald-500" : "bg-red-500"}`} /></div><div className="text-xl font-bold text-gray-100">{balances.fish?.balance != null ? `$${Number(balances.fish.balance).toFixed(2)}` : "—"}</div><div className="text-[10px] text-gray-500 mt-1">{balances.fish?.note}</div></div>
              </div>
            )}
            <div className="pt-3 border-t border-border space-y-2">
              <h4 className="text-[10px] font-bold text-gray-500 uppercase">Divisas Config</h4>
              <div className="text-[11px] text-gray-400 space-y-1">
                <p>PYG: {tasaPYG} • USD: {tasaUSD} • Com: {comisionDefault}%</p>
                <p className="text-[10px] text-gray-500">Editables en Cartera → Config Divisas</p>
              </div>
              <h4 className="text-[10px] font-bold text-gray-500 uppercase mt-3">APK Info</h4>
              <p className="text-[11px] text-gray-400">App ID: <span className="text-purple-300">com.templomistico.crm</span></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
