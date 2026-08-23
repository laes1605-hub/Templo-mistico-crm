"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  MessageSquare, Users, DollarSign, TrendingUp, Brain, Send, Bot, Phone,
  CheckCircle2, Clock, Plus, Ban, Settings, Edit2, Trash2, ArrowUp, ArrowDown,
  Wallet, Target, TrendingDown, Award, Calendar, Shield, X,
  Mic, Paperclip, ArrowLeft, Info, ListTodo, CheckSquare, Square,
  Sparkles, Play, Pause, RefreshCw, Image as ImageIcon, ChevronDown, ChevronRight
} from "lucide-react";

export default function CRMApp() {
  const [tab, setTab] = useState<"chats" | "pipeline" | "cartera" | "tareas" | "ads" | "cerebro">("chats");
  
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

  const [isEditingNombre, setIsEditingNombre] = useState(false);
  const [tempNombre, setTempNombre] = useState("");

  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);
  const [filtroCanal, setFiltroCanal] = useState<"todos" | "evolution" | "meta_business" | "spam">("todos");
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  
  const [tipoPago, setTipoPago] = useState<"unico" | "cuotas">("unico");
  const [montoTotal, setMontoTotal] = useState("");
  const [numeroCuotas, setNumeroCuotas] = useState("2");
  const [fechaInicial, setFechaInicial] = useState("");
  const [metodoPago, setMetodoPago] = useState("Nequi");
  const [notaPago, setNotaPago] = useState("");
  const [nuevaTareaTitulo, setNuevaTareaTitulo] = useState("");
  const [nuevaTareaFecha, setNuevaTareaFecha] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ===================== SELECCIONAR CHAT =====================
  async function selectConversation(conv: any) {
    setSelectedConv(conv);
    setClienteActual(conv.clientes);
    setIsEditingNombre(false);
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

  // ===================== ENVIAR MENSAJE =====================
  async function sendToApi(texto: string, fileBase64: string | null = null, fileMime: string | null = null, fileName: string | null = null) {
    if (!selectedConv) return;
    setIsSending(true);
    setSendError("");
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
      } catch {
        // sendToApi already exposes the provider error in the conversation UI.
      }
    };
    reader.onerror = () => setSendError("No se pudo leer el archivo seleccionado.");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ===================== GRABACIÓN DE AUDIO =====================
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
      });
      let mimeType = "";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
        else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) mimeType = "audio/ogg;codecs=opus";
        else if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
        else if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
      }
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        const usedMime = mediaRecorder.mimeType || mimeType || "audio/webm";
        const ext = usedMime.includes("ogg") ? "ogg" : usedMime.includes("mp4") ? "mp4" : "webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: usedMime });
        if (audioBlob.size === 0) return;
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          try {
            await sendToApi("", reader.result as string, usedMime, `nota_de_voz.${ext}`);
          } catch {
            // The error is displayed below the message composer.
          }
        };
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((prev) => prev + 1), 1000);
    } catch (err: any) {
      alert("Error accediendo al micrófono.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };
  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      audioChunksRef.current = [];
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

  // ===================== PAGOS =====================
  async function agregarPagos(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteActual || !montoTotal) return;
    const t = parseFloat(montoTotal); const fBase = fechaInicial ? new Date(fechaInicial) : new Date();
    const arr: any[] = [];
    if (tipoPago === "unico") {
      arr.push({ cliente_id: clienteActual.id, monto: t, fecha_vencimiento: fBase.toISOString().split("T")[0], estado: "pendiente", metodo_pago: metodoPago, notas: notaPago || "Pago único" });
    } else {
      const n = parseInt(numeroCuotas); const mCuota = t / n;
      for (let i = 0; i < n; i++) {
        const fc = new Date(fBase); fc.setMonth(fc.getMonth() + i);
        arr.push({ cliente_id: clienteActual.id, monto: mCuota, fecha_vencimiento: fc.toISOString().split("T")[0], estado: "pendiente", metodo_pago: metodoPago, notas: `Cuota ${i + 1}/${n}${notaPago ? " - " + notaPago : ""}` });
      }
    }
    await supabase.from("clientes").update({ total_cobro: t }).eq("id", clienteActual.id);
    const { data } = await supabase.from("pagos").insert(arr).select();
    if (data) { setPagosCliente([...pagosCliente, ...data]); setMontoTotal(""); setFechaInicial(""); setNotaPago(""); setTipoPago("unico"); }
  }
  async function marcarPago(id: string, est: string) {
    const nest = est === "pagado" ? "pendiente" : "pagado";
    await supabase.from("pagos").update({ estado: nest, fecha_pago: nest === "pagado" ? new Date().toISOString().split("T")[0] : null }).eq("id", id);
    setPagosCliente(pagosCliente.map((p) => (p.id === id ? { ...p, estado: nest } : p))); fetchTodosPagos();
  }
  async function eliminarPago(id: string) {
    await supabase.from("pagos").delete().eq("id", id);
    setPagosCliente(pagosCliente.filter((p) => p.id !== id)); fetchTodosPagos();
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
    if (filtroCanal === "spam") return esSpam;
    if (esSpam) return false;
    if (filtroCanal === "todos") return true;
    return c.fuente === filtroCanal;
  });

  const ahora = new Date(); const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const clientesNoSpam = todosClientes.filter((c) => !c.es_spam);
  const totalAtendidos = clientesNoSpam.length;
  const totalConvertidos = clientesNoSpam.filter((c) => ["pago_recibido", "trabajo_proceso", "trabajo_completado"].includes(c.estado)).length;
  const efectividad = totalAtendidos > 0 ? ((totalConvertidos / totalAtendidos) * 100).toFixed(1) : "0";
  const totalCobradoMes = todosPagos.filter((p) => p.estado === "pagado" && p.fecha_pago && new Date(p.fecha_pago) >= inicioMes).reduce((sum, p) => sum + Number(p.monto), 0);
  const totalCobradoHistorico = todosPagos.filter((p) => p.estado === "pagado").reduce((sum, p) => sum + Number(p.monto), 0);
  const totalPendiente = todosPagos.filter((p) => p.estado === "pendiente").reduce((sum, p) => sum + Number(p.monto), 0);
  const totalVencido = todosPagos.filter((p) => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora).reduce((sum, p) => sum + Number(p.monto), 0);
  const leadsEnConsulta = clientesNoSpam.filter((c) => ["en_consulta", "consulta_hecha"].includes(c.estado)).length;
  const leadsPerdidos = clientesNoSpam.filter((c) => c.estado === "perdido").length;
  const leadsNuevos = clientesNoSpam.filter((c) => c.estado === "nuevo_lead" || !c.estado).length;

  const menuItems = [
    { id: "chats", icon: MessageSquare, label: "Chats" },
    { id: "pipeline", icon: Users, label: "Pipeline" },
    { id: "tareas", icon: ListTodo, label: "Tareas" },
    { id: "cartera", icon: DollarSign, label: "Cartera" },
    { id: "ads", icon: TrendingUp, label: "Ads" },
    { id: "cerebro", icon: Brain, label: "Cerebro" }
  ];

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] w-screen bg-background text-gray-200 overflow-hidden font-sans">
      
      {/* BARRA NAVEGACIÓN */}
      <aside className="fixed bottom-0 w-full h-16 bg-surface border-t border-border flex flex-row items-center justify-around z-40 md:relative md:w-20 md:h-full md:border-r md:border-t-0 md:flex-col md:py-6 md:justify-between">
        <div className="hidden md:flex w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 items-center justify-center shadow-lg shadow-purple-900/40">
          <span className="text-xl font-bold text-white">🔮</span>
        </div>
        <nav className="flex flex-row md:flex-col gap-1 md:gap-3 w-full justify-around md:px-3">
          {menuItems.map((item) => (
            <button key={item.id} onClick={() => { setTab(item.id as any); setSelectedConv(null); setShowMobileDetails(false); }}
              className={`p-2 md:p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all flex-1 md:flex-none ${tab === item.id ? "text-purple-400 md:bg-purple-600 md:text-white" : "text-gray-500 hover:text-gray-200"}`}>
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
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
                <div className="flex bg-background p-1 rounded-lg border border-border text-xs flex-wrap">
                  {["todos", "evolution", "meta_business", "spam"].map((f) => (
                    <button key={f} onClick={() => setFiltroCanal(f as any)} className={`flex-1 py-1.5 rounded-md transition-all capitalize ${filtroCanal === f ? (f === 'spam' ? "bg-red-900/50 text-red-400" : "bg-surfaceHover text-white font-medium") : "text-gray-500"}`}>
                      {f === "evolution" ? "Personal" : f === "meta_business" ? "Business" : f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border/50">
                {loadingChats ? <div className="p-6 text-center text-sm text-gray-500">Cargando...</div> : conversacionesFiltradas.length === 0 ? <div className="p-6 text-center text-sm text-gray-500">Bandeja vacía</div> :
                  conversacionesFiltradas.map((conv) => {
                    const cliente = conv.clientes;
                    const displayName = cliente?.nombre || cliente?.telefono_display || conv.numero_whatsapp;
                    return (
                      <button key={conv.id} onClick={() => selectConversation(conv)} className={`w-full p-4 flex items-start gap-3 text-left hover:bg-surfaceHover transition-colors ${selectedConv?.id === conv.id ? "bg-surfaceHover border-l-4 border-purple-500" : ""}`}>
                        <div className="relative flex-shrink-0">
                          <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center text-purple-400 font-bold overflow-hidden">
                            {cliente?.foto_url ? <img src={cliente.foto_url} alt="" className="w-full h-full object-cover" /> : <span>{displayName?.charAt(0) || "W"}</span>}
                          </div>
                          {conv.agente_activo && !cliente?.es_spam && <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-purple-600 border-2 border-surface flex items-center justify-center"><Bot className="w-2.5 h-2.5 text-white" /></span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between mb-1"><h2 className="text-sm font-semibold text-gray-200 truncate">{displayName}</h2><span className="text-[10px] text-gray-500">{new Date(conv.ultimo_mensaje_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
                          <p className="text-xs text-gray-400 truncate">{conv.ultimo_mensaje || "Sin mensajes"}</p>
                        </div>
                      </button>
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
                        <h2 className="text-sm font-bold text-gray-100">{clienteActual.nombre || "Sin nombre"}</h2>
                        <span className="text-[10px] text-gray-400 flex items-center gap-1"><Phone className="w-3 h-3" /> {clienteActual.telefono_display || clienteActual.telefono}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!clienteActual.es_spam && (
                        <button onClick={toggleAgenteIA} className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${selectedConv.agente_activo ? "bg-purple-950/50 border-purple-700 text-purple-300" : "bg-surfaceHover border-border text-gray-400"}`}>
                          <Bot className="w-3.5 h-3.5" /><span>{selectedConv.agente_activo ? "Agente Luna: ON" : "Agente Pausado"}</span>
                        </button>
                      )}
                      <button onClick={() => setShowMobileDetails(true)} className="md:hidden p-2 text-gray-400"><Info className="w-5 h-5" /></button>
                    </div>
                  </header>

                  <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                    {mensajes.map((msg) => {
                      const isMe = msg.tipo === "enviado";
                      return (
                        <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm ${isMe ? "bg-purple-600 text-white rounded-br-none" : "bg-surface border border-border text-gray-200 rounded-bl-none"}`}>
                            {msg.tipo_contenido === "audio" && msg.url_archivo ? <audio controls src={msg.url_archivo} className="max-w-[220px] h-10" /> : msg.tipo_contenido === "imagen" && msg.url_archivo ? <img src={msg.url_archivo} alt="" className="rounded-lg max-h-60 object-cover" /> : <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.contenido}</p>}
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
                    {isRecording ? (
                      <div className="flex-1 bg-red-950/30 border border-red-900/50 rounded-full px-4 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-red-400 text-sm font-medium"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /><Mic className="w-4 h-4" /> {formatTime(recordingTime)}</div>
                        <div className="flex items-center gap-1">
                          <button onClick={cancelRecording} className="p-1.5 text-gray-400 hover:text-white rounded-full"><Trash2 className="w-4 h-4" /></button>
                          <button onClick={stopRecording} className="p-1.5 text-white bg-red-600 hover:bg-red-500 rounded-full shadow-lg"><Send className="w-4 h-4 ml-0.5" /></button>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleSendMessage} className="flex-1 flex flex-wrap items-center gap-2">
                        <input type="text" value={nuevoMensaje} onChange={(e) => setNuevoMensaje(e.target.value)} placeholder="Escribe un mensaje..." disabled={clienteActual.es_spam || isSending} className="flex-1 bg-background border border-border rounded-full px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50" />
                        {nuevoMensaje.trim() ? (
                          <button type="submit" disabled={isSending} className="bg-purple-600 hover:bg-purple-700 text-white p-2.5 rounded-full transition-colors disabled:opacity-50"><Send className="w-5 h-5" /></button>
                        ) : (
                          <button type="button" onClick={startRecording} disabled={clienteActual.es_spam || isSending} className="bg-surface border border-border text-purple-400 hover:bg-purple-600 hover:text-white hover:border-purple-600 p-2.5 rounded-full transition-colors disabled:opacity-50"><Mic className="w-5 h-5" /></button>
                        )}
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

                    <div className="bg-background p-4 rounded-xl border border-border space-y-2">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Estado Pipeline</label>
                      <select value={clienteActual.estado || "nuevo_lead"} onChange={(e) => actualizarEstadoCliente(clienteActual.id, e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500">
                        {pipelineEtapas.map((etapa) => <option key={etapa.clave} value={etapa.clave}>{etapa.nombre}</option>)}
                      </select>
                    </div>

                    <div className="bg-background p-4 rounded-xl border border-border space-y-3">
                      <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5" /> Fotos Recibidas (Checklist)
                      </h4>
                      <div className="grid grid-cols-3 gap-2">
                        {clienteActual.foto_url ? (
                          <a href={clienteActual.foto_url} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-surface border border-border overflow-hidden group relative">
                            <img src={clienteActual.foto_url} alt="Cliente" className="w-full h-full object-cover" />
                            <span className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-semibold transition-opacity">Cliente</span>
                          </a>
                        ) : (
                          <div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600">
                            <span>Foto</span><span>Cliente</span>
                          </div>
                        )}
                        {clienteActual.foto_otra_persona ? (
                          <a href={clienteActual.foto_otra_persona} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-surface border border-border overflow-hidden group relative">
                            <img src={clienteActual.foto_otra_persona} alt="Pareja" className="w-full h-full object-cover" />
                            <span className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-semibold transition-opacity">Pareja</span>
                          </a>
                        ) : (
                          <div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600">
                            <span>Foto</span><span>Pareja</span>
                          </div>
                        )}
                        {clienteActual.foto_mano ? (
                          <a href={clienteActual.foto_mano} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-surface border border-border overflow-hidden group relative">
                            <img src={clienteActual.foto_mano} alt="Palma Mano" className="w-full h-full object-cover" />
                            <span className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-semibold transition-opacity">Palma</span>
                          </a>
                        ) : (
                          <div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600">
                            <span>Foto</span><span>Mano</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-background p-4 rounded-xl border border-border space-y-3">
                      <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><CheckSquare className="w-3.5 h-3.5" /> Checklist y Tareas</h4>
                      <div className="space-y-1.5">
                        {tareasCliente.map((t) => (
                          <div key={t.id} className="flex items-start gap-2 bg-surface p-2 rounded-lg border border-border group">
                            <button onClick={() => toggleTarea(t.id, t.completada)} className="mt-0.5 flex-shrink-0 text-purple-400">{t.completada ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-gray-500" />}</button>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs ${t.completada ? "line-through text-gray-500" : "text-gray-200"}`}>{t.titulo}</p>
                              {t.fecha_vencimiento && <p className="text-[9px] text-amber-400/80 mt-0.5">{t.fecha_vencimiento}</p>}
                            </div>
                            <button onClick={() => eliminarTarea(t.id)} className="text-gray-600 hover:text-red-400 md:opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        ))}
                        {tareasCliente.length === 0 && <p className="text-[11px] text-gray-600 italic">Sin tareas</p>}
                      </div>
                      <form onSubmit={agregarTarea} className="pt-2 border-t border-border/50 flex flex-col gap-2">
                        <input type="text" placeholder="Nueva tarea..." value={nuevaTareaTitulo} onChange={(e) => setNuevaTareaTitulo(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-purple-500" required />
                        <div className="flex gap-2">
                          <input type="date" value={nuevaTareaFecha} onChange={(e) => setNuevaTareaFecha(e.target.value)} className="flex-1 bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none" />
                          <button type="submit" className="bg-surface border border-border hover:bg-purple-600 hover:text-white px-3 rounded-lg transition-colors"><Plus className="w-4 h-4" /></button>
                        </div>
                      </form>
                    </div>

                    <div className="bg-background p-4 rounded-xl border border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Cobros</h4>
                        <span className="text-[10px] text-emerald-400 font-bold border border-emerald-900/50 bg-emerald-950/30 px-1.5 py-0.5 rounded">${pagosCliente.reduce((acc, p) => acc + (p.estado === "pagado" ? Number(p.monto) : 0), 0).toLocaleString()} / ${pagosCliente.reduce((acc, p) => acc + Number(p.monto), 0).toLocaleString()}</span>
                      </div>
                      {pagosCliente.length > 0 && (
                        <div className="space-y-1.5">
                          {pagosCliente.map((pago) => (
                            <div key={pago.id} className={`flex items-center justify-between p-2 rounded-lg border text-xs ${pago.estado === "pagado" ? "bg-emerald-950/20 border-emerald-900/40" : "bg-surface border-border"}`}>
                              <button onClick={() => marcarPago(pago.id, pago.estado)} className="mr-2 flex-shrink-0">{pago.estado === "pagado" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4 text-amber-500" />}</button>
                              <div className="flex-1 min-w-0">
                                <span className={pago.estado === "pagado" ? "line-through text-gray-500" : "text-gray-200"}>${Number(pago.monto).toLocaleString()}</span>
                                <div className="text-[9px] text-gray-500 truncate">{pago.notas} • {pago.fecha_vencimiento}</div>
                              </div>
                              <button onClick={() => eliminarPago(pago.id)} className="text-gray-600 hover:text-red-400 ml-1"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <form onSubmit={agregarPagos} className="pt-2 border-t border-border/50 flex flex-col gap-2">
                        <div className="flex bg-surface p-0.5 rounded-lg text-[10px]">
                          <button type="button" onClick={() => setTipoPago("unico")} className={`flex-1 py-1.5 rounded-md transition-all ${tipoPago === "unico" ? "bg-purple-600 text-white" : "text-gray-400"}`}>Único</button>
                          <button type="button" onClick={() => setTipoPago("cuotas")} className={`flex-1 py-1.5 rounded-md transition-all ${tipoPago === "cuotas" ? "bg-purple-600 text-white" : "text-gray-400"}`}>Cuotas</button>
                        </div>
                        <input type="number" placeholder="Monto total ($)" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-purple-500" required />
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
              </div>
            )}
          </>
        )}

        {/* ==================== PIPELINE ==================== */}
        {tab === "pipeline" && (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
            <header className="p-4 md:p-6 border-b border-border flex items-center justify-between bg-surface/30">
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-100">Pipeline</h1>
                <p className="text-xs md:text-sm text-gray-400">Embudo visual de trabajos</p>
              </div>
              <button onClick={() => setIsEditingPipeline(!isEditingPipeline)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${isEditingPipeline ? "bg-purple-600 text-white" : "bg-surface border border-border text-gray-300 hover:bg-surfaceHover"}`}>
                <Settings className="w-4 h-4" /> {isEditingPipeline ? "Cerrar" : "Configurar"}
              </button>
            </header>

            <div className="flex-1 flex overflow-x-auto p-4 md:p-6 gap-4">
              {isEditingPipeline && (
                <div className="w-72 flex-shrink-0 bg-surface border border-border rounded-2xl p-4 flex flex-col gap-4 shadow-xl">
                  <h2 className="text-sm font-bold text-purple-300 flex items-center gap-2 border-b border-border pb-2"><Edit2 className="w-4 h-4" /> Editar Etapas</h2>
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {pipelineEtapas.map((etapa, idx) => (
                      <div key={etapa.id} className="flex items-center gap-2 bg-background p-2 rounded-lg border border-border">
                        <div className="flex flex-col gap-1">
                          <button onClick={() => moverEtapa(idx, -1)} className="text-gray-500 hover:text-white"><ArrowUp className="w-3 h-3" /></button>
                          <button onClick={() => moverEtapa(idx, 1)} className="text-gray-500 hover:text-white"><ArrowDown className="w-3 h-3" /></button>
                        </div>
                        <input type="text" value={etapa.nombre} onChange={(e) => actualizarNombreEtapa(etapa.id, e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none focus:text-purple-300" />
                        <button onClick={() => eliminarEtapa(etapa.id)} className="text-red-500/70 hover:text-red-400 p-1"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={agregarEtapaPipeline} className="w-full py-2 bg-surfaceHover border border-dashed border-gray-600 rounded-lg text-xs text-gray-400 hover:text-white flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Agregar Etapa</button>
                </div>
              )}

              {pipelineEtapas.filter((e) => e.clave !== "spam").map((col) => {
                const clientesEnCol = conversaciones.filter((c) => (c.clientes?.estado || "nuevo_lead") === col.clave && !c.clientes?.es_spam);
                return (
                  <div key={col.id} className="w-72 flex-shrink-0 bg-surface/60 border border-border rounded-2xl p-4 flex flex-col gap-3 min-h-full">
                    <div className={`flex items-center justify-between pb-2 border-b-2 ${col.color || "border-purple-500"}`}>
                      <h2 className="text-xs font-bold text-gray-200">{col.nombre}</h2>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surfaceHover text-gray-400 font-semibold">{clientesEnCol.length}</span>
                    </div>
                    <div className="space-y-3 overflow-y-auto flex-1">
                      {clientesEnCol.map((c) => (
                        <div key={c.id} onClick={() => { selectConversation(c); setTab("chats"); }} className="p-3 bg-surface rounded-xl border border-border/80 hover:border-purple-500/80 cursor-pointer shadow-sm group">
                          <h3 className="text-xs font-bold text-gray-200 group-hover:text-purple-300 truncate">{c.clientes?.nombre || c.clientes?.telefono_display || c.numero_whatsapp}</h3>
                          <p className="text-[11px] text-gray-400 mt-1 truncate">{c.clientes?.tipo_trabajo || "Sin clasificar"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================== TAREAS GLOBALES ==================== */}
        {tab === "tareas" && (
          <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-background">
            <header className="mb-6">
              <h1 className="text-xl md:text-2xl font-bold text-gray-100 flex items-center gap-2"><ListTodo className="text-purple-400 w-6 h-6" /> Panel de Tareas</h1>
              <p className="text-xs md:text-sm text-gray-400">Pendientes del día y checklist de clientes</p>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 items-start">
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4">
                <h2 className="text-sm font-bold text-amber-400 flex items-center gap-2 border-b border-border pb-2"><Clock className="w-4 h-4" /> Pendientes / Vencidas</h2>
                <div className="space-y-2">
                  {todasTareas.filter((t) => !t.completada && t.fecha_vencimiento && new Date(t.fecha_vencimiento) <= ahora).length === 0 && <p className="text-xs text-gray-500 italic">Todo al día ✅</p>}
                  {todasTareas.filter((t) => !t.completada && t.fecha_vencimiento && new Date(t.fecha_vencimiento) <= ahora).map((t) => (
                    <div key={t.id} className="bg-background border border-amber-900/30 p-3 rounded-xl">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] bg-amber-950/50 text-amber-500 px-1.5 rounded border border-amber-900">{t.fecha_vencimiento}</span>
                        <span className="text-[10px] text-gray-400 truncate max-w-[120px]">{t.clientes?.nombre || "Cliente"}</span>
                      </div>
                      <p className="text-xs text-gray-200 font-medium">{t.titulo}</p>
                      <button onClick={() => toggleTarea(t.id, false)} className="mt-2 text-[10px] text-purple-400 hover:text-purple-300">Marcar hecha ✓</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4">
                <h2 className="text-sm font-bold text-blue-400 flex items-center gap-2 border-b border-border pb-2"><Calendar className="w-4 h-4" /> Próximas / Sin fecha</h2>
                <div className="space-y-2">
                  {todasTareas.filter((t) => !t.completada && (!t.fecha_vencimiento || new Date(t.fecha_vencimiento) > ahora)).map((t) => (
                    <div key={t.id} className="bg-background border border-border p-3 rounded-xl">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] text-blue-400">{t.fecha_vencimiento || "Sin fecha"}</span>
                        <span className="text-[10px] text-gray-400 truncate max-w-[120px]">{t.clientes?.nombre || "Cliente"}</span>
                      </div>
                      <p className="text-xs text-gray-200">{t.titulo}</p>
                      <button onClick={() => toggleTarea(t.id, false)} className="mt-2 text-[10px] text-purple-400 hover:text-purple-300">Marcar hecha ✓</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4">
                <h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2 border-b border-border pb-2"><CheckCircle2 className="w-4 h-4" /> Completadas</h2>
                <div className="space-y-2">
                  {todasTareas.filter((t) => t.completada).slice(-15).reverse().map((t) => (
                    <div key={t.id} className="bg-background border border-border p-3 rounded-xl opacity-60">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] text-gray-500 line-through">{t.titulo}</span>
                        <span className="text-[10px] text-gray-600">{t.clientes?.nombre}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== CARTERA ==================== */}
        {tab === "cartera" && (
          <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6 md:space-y-8 bg-background">
            <header>
              <h1 className="text-xl md:text-2xl font-bold text-gray-100">Cartera y Métricas</h1>
              <p className="text-xs md:text-sm text-gray-400">Rendimiento y estado financiero</p>
            </header>
            <div>
              <h2 className="text-sm font-bold text-purple-300 mb-3 uppercase tracking-wider">Rendimiento</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-2xl md:text-3xl font-extrabold text-gray-100">{totalAtendidos}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Clientes atendidos</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-2xl md:text-3xl font-extrabold text-emerald-400">{totalConvertidos}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Convertidos</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-2xl md:text-3xl font-extrabold text-purple-400">{efectividad}%</p>
                  <p className="text-[11px] text-gray-400 mt-1">Efectividad</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-2xl md:text-3xl font-extrabold text-red-400">{leadsPerdidos}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Perdidos</p>
                </div>
              </div>
            </div>
            <div>
              <h2 className="text-sm font-bold text-emerald-300 mb-3 uppercase tracking-wider">Finanzas</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-xl md:text-2xl font-extrabold text-emerald-400">${totalCobradoMes.toLocaleString()}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Cobrado este mes</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-xl md:text-2xl font-extrabold text-green-400">${totalCobradoHistorico.toLocaleString()}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Total histórico</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-xl md:text-2xl font-extrabold text-amber-400">${totalPendiente.toLocaleString()}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Por cobrar</p>
                </div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                  <p className="text-xl md:text-2xl font-extrabold text-red-400">${totalVencido.toLocaleString()}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Vencido</p>
                </div>
              </div>
            </div>
            <div>
              <h2 className="text-sm font-bold text-purple-300 mb-3 uppercase tracking-wider">Embudo</h2>
              <div className="bg-surface border border-border rounded-2xl p-5 space-y-3">
                {[
                  { label: "Leads Nuevos", valor: leadsNuevos, color: "bg-blue-500" },
                  { label: "En Consulta", valor: leadsEnConsulta, color: "bg-amber-500" },
                  { label: "Convertidos", valor: totalConvertidos, color: "bg-emerald-500" },
                ].map((step) => {
                  const pct = totalAtendidos > 0 ? (step.valor / totalAtendidos) * 100 : 0;
                  return (
                    <div key={step.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-300 font-medium">{step.label}</span>
                        <span className="text-gray-400">{step.valor} ({pct.toFixed(1)}%)</span>
                      </div>
                      <div className="h-3 bg-background rounded-full overflow-hidden">
                        <div className={`h-full ${step.color} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {todosPagos.filter((p) => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora).length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-red-300 mb-3 uppercase tracking-wider">⚠️ Pagos Vencidos</h2>
                <div className="bg-surface border border-red-800/50 rounded-2xl divide-y divide-border">
                  {todosPagos.filter((p) => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora).map((pago) => {
                    const cliente = todosClientes.find((c) => c.id === pago.cliente_id);
                    return (
                      <div key={pago.id} className="p-4 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-200">{cliente?.nombre || "Cliente"}</div>
                          <div className="text-xs text-gray-400">{pago.notas} • Vencía: {pago.fecha_vencimiento}</div>
                        </div>
                        <div className="text-lg font-bold text-red-400">${Number(pago.monto).toLocaleString()}</div>
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
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-bold text-gray-100 flex items-center gap-2"><TrendingUp className="text-purple-400 w-6 h-6" /> Gestor de Meta Ads (COP)</h1>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${isLiveAds ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800' : 'bg-amber-950/60 text-amber-400 border-amber-800'}`}>{isLiveAds ? 'Meta Live API' : 'Modo Demo'}</span>
                </div>
                <p className="text-xs md:text-sm text-gray-400">Control de campañas y costo por lead. Haz clic en una campaña para ver detalles.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={fetchCampanasAds} disabled={loadingAds} className="bg-surface hover:bg-surfaceHover border border-border text-gray-300 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingAds ? 'animate-spin' : ''}`} /> Actualizar
                </button>
                <button onClick={consultarAsesorIAAds} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-purple-900/30 flex items-center gap-2 transition-all">
                  <Sparkles className="w-4 h-4" /> Analizar con IA
                </button>
              </div>
            </header>

            {adsNote && !loadingAds && (
              <div className="p-3 rounded-xl border border-purple-800/40 bg-purple-950/20 text-purple-200 text-xs">{adsNote}</div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Inversión Total</span>
                <p className="text-xl md:text-2xl font-extrabold text-gray-100 mt-1">${Math.round(campanas.reduce((acc, c) => acc + Number(c.spend || 0), 0)).toLocaleString("es-CO")} COP</p>
              </div>
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Leads de Ads</span>
                <p className="text-xl md:text-2xl font-extrabold text-purple-400 mt-1">{campanas.reduce((acc, c) => acc + Number(c.leads || 0), 0)}</p>
              </div>
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">CPL Promedio</span>
                <p className="text-xl md:text-2xl font-extrabold mt-1 text-emerald-400">${campanas.reduce((acc, c) => acc + Number(c.leads || 0), 0) > 0 ? Math.round(campanas.reduce((acc, c) => acc + Number(c.spend || 0), 0) / campanas.reduce((acc, c) => acc + Number(c.leads || 0), 0)).toLocaleString("es-CO") : "0"} COP</p>
              </div>
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Campañas Activas</span>
                <p className="text-xl md:text-2xl font-extrabold text-emerald-400 mt-1">{campanas.filter(c => c.status === "ACTIVE").length}</p>
              </div>
            </div>

            <div className="bg-surface/50 border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-border bg-surface/80 flex justify-between items-center">
                <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">Campañas</h3>
                <span className="text-xs text-gray-400">{campanas.length} en lista</span>
              </div>
              <div className="divide-y divide-border/40">
                {campanas.map((c) => {
                  const isActive = c.status === "ACTIVE";
                  const isExpanded = expandedCamp === c.id;
                  return (
                    <div key={c.id} className="hover:bg-surface/40 transition-colors">
                      <div className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer" onClick={() => setExpandedCamp(isExpanded ? null : c.id)}>
                        <div className="flex items-start gap-3 min-w-0">
                          <button onClick={(e) => { e.stopPropagation(); toggleEstadoCampana(c.id, c.status); }} className={`mt-1 p-2 rounded-xl border transition-all ${isActive ? "bg-emerald-950/60 border-emerald-800 text-emerald-400" : "bg-surfaceHover border-border text-gray-500"}`} title={isActive ? "Pausar" : "Activar"}>
                            {isActive ? <Pause className="w-4 h-4 fill-emerald-400" /> : <Play className="w-4 h-4 fill-gray-400 ml-0.5" />}
                          </button>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-gray-100">{c.name}</h4>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${isActive ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-gray-800 text-gray-400'}`}>
                                {isActive ? 'ACTIVA' : c.status === 'ARCHIVED' ? 'ARCHIVADA' : 'PAUSADA'}
                              </span>
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Presupuesto: <span className="text-gray-200 font-medium">${Number(c.dailyBudget).toLocaleString("es-CO")} COP/día</span></p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-border">
                          <div className="text-left md:text-right"><span className="text-[10px] text-gray-500 block uppercase font-bold">Invertido</span><span className="text-sm font-bold text-gray-200">${Number(c.spend).toLocaleString("es-CO")}</span></div>
                          <div className="text-left md:text-right"><span className="text-[10px] text-gray-500 block uppercase font-bold">Leads</span><span className="text-sm font-bold text-purple-400">{c.leads}</span></div>
                          <div className="text-left md:text-right"><span className="text-[10px] text-gray-500 block uppercase font-bold">CPL</span><span className={`text-xs font-extrabold px-2 py-0.5 rounded ${c.cpl < 10000 ? 'bg-emerald-950/80 text-emerald-400' : c.cpl < 18000 ? 'bg-amber-950/80 text-amber-400' : 'bg-red-950/80 text-red-400'}`}>${Number(c.cpl).toLocaleString("es-CO")} COP</span></div>
                        </div>
                      </div>

                      {/* PANEL EXPANDIDO DE DETALLES */}
                      {isExpanded && (
                        <div className="px-5 pb-5 pt-2 bg-surface/30 border-t border-border/50">
                          <h5 className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-3">Detalles de Rendimiento</h5>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <span className="text-[10px] text-gray-500 uppercase">Impresiones</span>
                              <p className="text-sm text-gray-200 font-medium">{Number(c.impressions).toLocaleString()}</p>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-500 uppercase">Clics</span>
                              <p className="text-sm text-gray-200 font-medium">{Number(c.clicks).toLocaleString()}</p>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-500 uppercase">CTR</span>
                              <p className="text-sm text-gray-200 font-medium">{c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : 0}%</p>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-500 uppercase">CPC</span>
                              <p className="text-sm text-gray-200 font-medium">${c.clicks > 0 ? Math.round(c.spend / c.clicks).toLocaleString("es-CO") : 0} COP</p>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-500 uppercase">Presupuesto Total</span>
                              <p className="text-sm text-gray-200 font-medium">{c.lifetimeBudget > 0 ? `$${Number(c.lifetimeBudget).toLocaleString("es-CO")} COP` : "Diario continuo"}</p>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-500 uppercase">Estado Real</span>
                              <p className="text-sm text-gray-200 font-medium">{c.status}</p>
                            </div>
                            <div className="col-span-2 md:col-span-2">
                              <span className="text-[10px] text-gray-500 uppercase">ID Campaña</span>
                              <p className="text-[10px] text-gray-500 font-mono mt-1">{c.id}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* CEREBRO IA */}
        {tab === "cerebro" && (
          <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
            <Brain className="w-16 h-16 text-purple-500 mb-4 stroke-[1.5]" />
            <h2 className="text-xl font-bold text-gray-200">Cerebro IA</h2>
            <p className="text-sm text-gray-400 max-w-md mt-2">Auto-aprendizaje de conversaciones exitosas (Fase 3).</p>
          </div>
        )}
      </main>

      {/* MODAL IA RECOMENDACIONES ADS */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="w-full max-w-2xl bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-purple-400"><Sparkles className="w-5 h-5" /><h3 className="text-lg font-bold text-gray-100">Auditoría IA</h3></div>
              <button onClick={() => setShowAiModal(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {loadingAiAds ? (
                <div className="p-12 text-center space-y-3"><Sparkles className="w-10 h-10 text-purple-500 animate-spin mx-auto" /><p className="text-sm text-gray-300 font-medium">Analizando métricas con OpenAI...</p></div>
              ) : (
                <div className="prose prose-invert max-w-none text-xs md:text-sm leading-relaxed whitespace-pre-wrap text-gray-200 bg-background/80 p-5 rounded-xl border border-border">{aiRecommendation}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL ADMIN */}
      {showAdmin && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-purple-400" /><h3 className="text-base font-bold text-gray-100">Panel Admin</h3></div>
              <button onClick={() => { setShowAdmin(false); setBalances(null); setAdminSecret(""); }} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-gray-400">Clave admin</label>
              <input type="password" placeholder="Ingresa tu clave admin" value={adminSecret} onChange={(e) => setAdminSecret(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") cargarSaldos(); }} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500" />
            </div>
            <button onClick={cargarSaldos} disabled={loadingBal} className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium py-2.5 rounded-lg">
              {loadingBal ? "Consultando..." : "Ver saldos APIs"}
            </button>
            {balances?.error && <div className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 p-3 rounded-lg">{balances.error}</div>}
            {balances && !balances.error && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-background border border-border">
                  <div className="flex items-center justify-between mb-1"><span className="text-gray-400 font-medium">OpenAI</span><span className={`w-2 h-2 rounded-full ${balances.openai?.ok ? "bg-emerald-500" : "bg-red-500"}`} /></div>
                  <div className="text-xl font-bold text-gray-100">{balances.openai?.balance != null ? `$${Number(balances.openai.balance).toFixed(2)}` : "—"}</div>
                  <div className="text-[10px] text-gray-500 mt-1">{balances.openai?.note}</div>
                </div>
                <div className="p-3 rounded-xl bg-background border border-border">
                  <div className="flex items-center justify-between mb-1"><span className="text-gray-400 font-medium">Fish Audio</span><span className={`w-2 h-2 rounded-full ${balances.fish?.ok ? "bg-emerald-500" : "bg-red-500"}`} /></div>
                  <div className="text-xl font-bold text-gray-100">{balances.fish?.balance != null ? `$${Number(balances.fish.balance).toFixed(2)}` : "—"}</div>
                  <div className="text-[10px] text-gray-500 mt-1">{balances.fish?.note}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}