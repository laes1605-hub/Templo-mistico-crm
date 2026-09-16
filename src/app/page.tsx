"use client";

import React, { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { supabase } from "../lib/supabase";
import VoiceNotePlayer from "../components/VoiceNotePlayer";
import ChatImage from "../components/ChatImage";
import ChatVideo from "../components/ChatVideo";
import ChatFile from "../components/ChatFile";
import CerebroPanel from "../components/CerebroPanel";
import AjustesPanel from "../components/AjustesPanel";
import { downloadMany, guessImageFilename, guessFilename, isImageMessage, isAudioMessage, isVideoMessage, isFileMessage, saveAudioFiles } from "../lib/download-media";
import { audioMensajeToArchivo } from "../lib/audio-download";
import {
  type RespuestaRapida,
  listarRespuestasRapidas,
  actualizarRespuestasRapidas,
  sincronizarRespuestasRapidas,
  guardarRespuestaRapida,
  eliminarRespuestaRapida,
  prepararAudioRR,
  prepararImagenRR,
  adjuntoParaEnviar,
} from "../lib/respuestas-rapidas";
import { estaContactoGuardadoEnTelefono, guardarContactoEnTelefono } from "../lib/contacts";
import DivisorFecha from "../components/DivisorFecha";
import VentanaWhatsApp from "../components/VentanaWhatsApp";
import {
  CLAVE_VENCIDOS,
  calcularVentana,
  claveDia,
  decidirTraspasoVencidos,
  esChatWhatsAppApi,
  esClaveVencidos,
  tieneChatApi,
  ultimoEntranteApiDeConversacion,
  ultimoEntranteDeMensajes,
} from "../lib/tiempo-chat";
import { abrirLlamadaWhatsAppPersonal, llamadasWhatsAppPersonalDisponibles } from "../lib/whatsapp-personal";
import { initTheme } from "../lib/theme";
import {
  initializeNotificationChannels,
  NOTIFICATION_CHANNELS,
  notify,
  scheduleFollowUpReminders,
  scheduleTaskReminders,
} from "../lib/notifications";
import {
  MessageSquare, Users, DollarSign, TrendingUp, Brain, Send, Bot, Phone,
  CheckCircle2, Clock, Plus, Ban, Settings, Edit2, Trash2, ArrowUp, ArrowDown,
  ChevronsUp, ChevronsDown,
  Wallet, Target, TrendingDown, Award, Calendar, Shield, X,
  Mic, Paperclip, ArrowLeft, Info, ListTodo, CheckSquare, Square, MailOpen,
  Sparkles, Play, Pause, RefreshCw, Image as ImageIcon, ChevronDown, ChevronRight, ChevronLeft, Download,
  Archive, ArchiveRestore, Search, AlertTriangle, GitBranch, Check, Zap, Type,
  StickyNote, FileText, Coins, Globe, Percent, Save, Eye, EyeOff, Palette, Power, User, Landmark, UserPlus,
  PhoneCall, BellRing, Video
} from "lucide-react";

// Normaliza estados antiguos o con sufijo _templo al pipeline unificado
// VALIDACION POR NOMBRE: Luna trabaja en "Nuevo Lead" y "Datos" por nombre visible
function normalizarEstado(estado: string | null | undefined): string {
  if (!estado) return "nuevo_lead";
  let s = String(estado).trim();
  if (s === "spam_personal" || s === "spam_templo") return "spam";
  if (s === "archivado_personal" || s === "archivado_templo") return "__archivados__";
  if (s.endsWith("_templo")) {
    s = s.replace(/_templo$/, "");
  }
  if (s === "en_seguimiento") return "en_consulta";
  // Etapas eliminadas del pipeline: se remapean a etapas vigentes
  if (s === "pago_recibido") return "trabajo_proceso";
  if (s === "perdido") return "nuevo_lead";
  // Normalizacion por nombre para Luna: si viene "Nuevo Lead" o "Lead Nuevo" o "Datos"
  const lower = s.toLowerCase();
  if (lower.includes("nuevo") && lower.includes("lead") || lower === "lead nuevo" || lower === "nuevo lead") return "nuevo_lead";
  if (lower.includes("datos") || lower === "solicitar datos" || lower === "pedir datos") return "datos";
  return s;
}

// Etapas retiradas del pipeline (se remapean a etapas vigentes) — datos y nuevo_lead NO se retiran
const ETAPAS_ELIMINADAS = ["pago_recibido", "perdido"];

// Etapas base del pipeline unificado con su cuenta encargada por defecto
// Luna trabaja en "Nuevo Lead" y "Datos" validando por NOMBRE, no por clave
const ETAPAS_DEFAULT = [
  { clave: "nuevo_lead", nombre: "Nuevo Lead", orden: 1, color: "border-blue-500", bg_color: "bg-blue-500/10", text_color: "text-blue-300", cuenta_responsable: "meta_business" },
  { clave: "datos", nombre: "Datos", orden: 2, color: "border-sky-500", bg_color: "bg-sky-500/10", text_color: "text-sky-300", cuenta_responsable: "meta_business" },
  { clave: "en_consulta", nombre: "En Consulta", orden: 3, color: "border-yellow-500", bg_color: "bg-yellow-500/10", text_color: "text-yellow-300", cuenta_responsable: "meta_business" },
  { clave: "consulta_hecha", nombre: "Consulta Hecha", orden: 4, color: "border-orange-500", bg_color: "bg-orange-500/10", text_color: "text-orange-300", cuenta_responsable: "evolution" },
  { clave: "trabajo_proceso", nombre: "Trabajo en Proceso", orden: 5, color: "border-purple-500", bg_color: "bg-purple-500/10", text_color: "text-purple-300", cuenta_responsable: "evolution" },
  { clave: "trabajo_completado", nombre: "Trabajo Completado", orden: 6, color: "border-green-500", bg_color: "bg-green-500/10", text_color: "text-green-300", cuenta_responsable: "evolution" },
  // Etapa receptora del traspaso automático: los chats del WhatsApp API cuya
  // ventana de 24 h venció se continúan desde el WhatsApp Personal.
  { clave: CLAVE_VENCIDOS, nombre: "Vencidos", orden: 7, color: "border-red-500", bg_color: "bg-red-500/10", text_color: "text-red-300", cuenta_responsable: "evolution" },
];

// Cuotas: límite y fechas por defecto (una cuota por mes desde la primera).
const MAX_CUOTAS = 30;
const nCuotasLimite = (v: string) => Math.min(MAX_CUOTAS, Math.max(2, parseInt(v) || 2));
function fechasCuotasPorDefecto(n: number, base: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (!base) { out.push(""); continue; }
    const d = new Date(base);
    d.setMonth(d.getMonth() + i);
    out.push(d.toISOString().split("T")[0]);
  }
  return out;
}

// Resumen que devuelve /api/clientes/eliminar al borrar un cliente por completo.
type ResumenEliminacion = {
  cliente: string;
  crm: {
    cliente_eliminado: number;
    conversaciones_eliminadas: number;
    mensajes_eliminados: number;
    pagos_eliminados: number;
    tareas_eliminadas: number;
    recordatorios_eliminados: number;
    reglas_cerebro_eliminadas: number;
    otras_tablas?: Record<string, number>;
  } | null;
  chatwoot: {
    conversaciones: number;
    eliminadas: number;
    ya_no_existian: number;
    memoria_vaciada: number;
    fichas_luna_borradas: number;
    omitidas: number;
  } | null;
  advertencias: string[];
};

// Textos del resumen que se muestra al terminar de eliminar un cliente.
function lineasResumenCrm(crm: ResumenEliminacion["crm"]): string[] {
  if (!crm) return ["Datos borrados de Supabase."];
  const otras = Object.entries(crm.otras_tablas || {}).filter(([, cantidad]) => Number(cantidad) > 0);
  return [
    `Cliente borrado de la base de datos (${crm.cliente_eliminado}).`,
    `${crm.conversaciones_eliminadas} conversación(es) y ${crm.mensajes_eliminados} mensaje(s).`,
    `${crm.pagos_eliminados} pago(s), ${crm.tareas_eliminadas} tarea(s) y ${crm.recordatorios_eliminados} recordatorio(s).`,
    `${crm.reglas_cerebro_eliminadas} regla(s) del Cerebro que lo mencionaban.`,
    ...otras.map(([tabla, cantidad]) => `${cantidad} fila(s) más en ${tabla}.`),
  ];
}

function lineasResumenChatwoot(chatwoot: ResumenEliminacion["chatwoot"]): string[] {
  if (!chatwoot) return [];
  if (chatwoot.conversaciones === 0) return ["No había chat de WhatsApp asociado."];
  const lineas: string[] = [];
  if (chatwoot.eliminadas > 0) {
    lineas.push(`${chatwoot.eliminadas} chat(s) de WhatsApp borrados por completo.`);
  }
  if (chatwoot.memoria_vaciada > 0) {
    lineas.push(`${chatwoot.memoria_vaciada} memoria(s) de Luna vaciadas (motivo, nombres, fotos y etapa).`);
  }
  if (chatwoot.fichas_luna_borradas > 0) {
    lineas.push(`${chatwoot.fichas_luna_borradas} ficha(s) de Luna eliminadas.`);
  }
  if (chatwoot.ya_no_existian > 0) {
    lineas.push(`${chatwoot.ya_no_existian} chat(s) que ya no existían en WhatsApp.`);
  }
  if (chatwoot.omitidas > 0) {
    lineas.push(`${chatwoot.omitidas} chat(s) de WhatsApp sin tocar.`);
  }
  return lineas.length > 0 ? lineas : ["Sin cambios en WhatsApp."];
}

export default function CRMApp() {
  // Subcategorías especiales de chats:
  // - Por leer: chats con mensajes sin leer
  // - En seguimiento: clientes con check activo pendientes para hoy (corte 8:00 AM)
  // - Archivados: subcategoría para chats archivados (ya no es pestaña separada)
  const CATEGORIA_POR_LEER = "__por_leer__";
  const CATEGORIA_EN_SEGUIMIENTO = "__en_seguimiento__";
  const CATEGORIA_ARCHIVADOS = "__archivados__";

  // Hora de corte diaria para la subcategoría En seguimiento (8:00 AM)
  function getHoraCorteSeguimiento(): Date {
    const ahora = new Date();
    const corte = new Date(ahora);
    corte.setHours(8, 0, 0, 0); // 8:00 AM hoy
    if (ahora.getTime() < corte.getTime()) {
      corte.setDate(corte.getDate() - 1); // 8:00 AM de ayer si aún no son las 8 AM
    }
    return corte;
  }

  function estaPendienteSeguimientoHoy(cliente: any): boolean {
    if (!cliente || !cliente.en_seguimiento) return false;
    if (cliente.es_spam) return false;
    if (!cliente.seguimiento_revisado_en) return true;
    const revisado = new Date(cliente.seguimiento_revisado_en).getTime();
    return revisado < getHoraCorteSeguimiento().getTime();
  }

  const [tab, setTab] = useState<"chats" | "pipeline" | "cartera" | "tareas" | "ads" | "cerebro">("chats");
  const subcatScrollRef = useRef<HTMLDivElement>(null);
  
  const [conversaciones, setConversaciones] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any | null>(null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  // Espejo del estado para consultas incrementales (ahorra Egress de Supabase:
  // en vez de re-descargar toda la conversación, solo se piden los mensajes
  // nuevos desde el último que ya tenemos en pantalla).
  const mensajesRef = useRef<any[]>([]);
  useEffect(() => { mensajesRef.current = mensajes; }, [mensajes]);
  // Ventana de 24 h de WhatsApp API: si la migración 20260918 todavía no está
  // aplicada en Supabase (no existe la columna conversaciones.ultimo_entrante_en),
  // el dashboard rellena la marca con una consulta corta (máx. una por minuto).
  const ventanaFallbackEnRef = useRef(0);
  const [clienteActual, setClienteActual] = useState<any | null>(null);
  
  const [todosPagos, setTodosPagos] = useState<any[]>([]);
  const [todosClientes, setTodosClientes] = useState<any[]>([]);
  const [todasTareas, setTodosTareas] = useState<any[]>([]);
  const [tareasCliente, setTareasCliente] = useState<any[]>([]);
  const [pagosCliente, setPagosCliente] = useState<any[]>([]);
  
  const [pipelineEtapas, setPipelineEtapas] = useState<any[]>([]);
  const [isEditingPipeline, setIsEditingPipeline] = useState(false);

  // GRUPOS PERSONAL / TEMPLO
  const [grupoActivo, setGrupoActivo] = useState<"personal" | "templo">("personal");
  const [personalLabel, setPersonalLabel] = useState("Personal");
  const [temploLabel, setTemploLabel] = useState("Templo");
  const [isEditingGroupLabels, setIsEditingGroupLabels] = useState(false);

  // KILL SWITCH GLOBAL LUNA
  const [lunaGlobalActiva, setLunaGlobalActiva] = useState(true);
  const [togglingLunaGlobal, setTogglingLunaGlobal] = useState(false);
  const [editingEtapaColor, setEditingEtapaColor] = useState<string | null>(null);

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

  // Edición y creación de campañas - POTENCIADO
  const [showCrearCampModal, setShowCrearCampModal] = useState(false);
  const [guardandoCampana, setGuardandoCampana] = useState(false);
  const [nuevaCampNombre, setNuevaCampNombre] = useState("");
  const [nuevaCampPresupuesto, setNuevaCampPresupuesto] = useState("");
  const [nuevaCampTipoPresupuesto, setNuevaCampTipoPresupuesto] = useState<"lifetime" | "daily">("lifetime");
  const [nuevaCampDias, setNuevaCampDias] = useState<number>(4);
  const [nuevaCampObjetivo, setNuevaCampObjetivo] = useState("OUTCOME_ENGAGEMENT");
  const [nuevaCampEstado, setNuevaCampEstado] = useState<"ACTIVE" | "PAUSED">("ACTIVE");
  const [nuevaCampFechaInicio, setNuevaCampFechaInicio] = useState<string>(() => new Date().toISOString().split("T")[0]);
  // Cantidad de anuncios = cantidad de VIDEOS DIFERENTES de la Fan Page
  const [nuevaCampNumAnuncios, setNuevaCampNumAnuncios] = useState<number>(2);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [nuevaCampCopy, setNuevaCampCopy] = useState<string>("");
  const [nuevaCampCopies, setNuevaCampCopies] = useState<string[]>(["", "", "", "", ""]);
  const [usarCopyVideo, setUsarCopyVideo] = useState<boolean>(true);
  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);
  const [loadingWhatsappNumbers, setLoadingWhatsappNumbers] = useState(false);
  const [selectedWhatsappId, setSelectedWhatsappId] = useState<string>("");
  const [selectedWhatsappDisplay, setSelectedWhatsappDisplay] = useState<string>("");
  const [accountInfo, setAccountInfo] = useState<any>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [previewCampana, setPreviewCampana] = useState<any>(null);

  // TODAS las segmentaciones guardadas en la cuenta (públicos guardados, personalizados y en uso)
  const [segmentacionesGuardadas, setSegmentacionesGuardadas] = useState<any[]>([]);
  const [loadingSegmentaciones, setLoadingSegmentaciones] = useState(false);
  const [segmentacionesNota, setSegmentacionesNota] = useState("");
  const [selectedSegmentacionId, setSelectedSegmentacionId] = useState<string>("");

  // Segmentación guardada por defecto Templo Místico - WhatsApp ONLY
  const [segmentacionGuardada, setSegmentacionGuardada] = useState<any>(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("tm_ads_segmentacion") : null;
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      nombre: "Segmentación por defecto Templo Místico",
      location: { countries: ["CO"] },
      age_min: 18,
      age_max: 65,
      genders: [1, 2],
      interests: ["Esoterismo", "Tarot", "Amarres de amor", "Espiritualidad", "Astrología"],
      destination: "WHATSAPP_ONLY",
      placements: ["facebook", "instagram"],
      note: "Solo WhatsApp - Messenger excluido",
    };
  });

  const [campanaEditando, setCampanaEditando] = useState<any | null>(null);
  const [editCampNombre, setEditCampNombre] = useState("");
  const [editCampPresupuesto, setEditCampPresupuesto] = useState("");
  const [editCampTipoPresupuesto, setEditCampTipoPresupuesto] = useState<"lifetime" | "daily">("lifetime");
  const [editCampDias, setEditCampDias] = useState<number>(8);
  const [editCampEstado, setEditCampEstado] = useState<"ACTIVE" | "PAUSED">("ACTIVE");

  // Memoria del Agente de Ads (Aprendizaje de campañas ganadoras y descarte de fallidas)
  const [adsMemoriaModal, setAdsMemoriaModal] = useState(false);
  const [generandoEstrategia, setGenerandoEstrategia] = useState(false);
  const [topCampanasGuardadas, setTopCampanasGuardadas] = useState<any[]>([]);
  const [campanasFallidasGuardadas, setCampanasFallidasGuardadas] = useState<any[]>([]);
  const [pageVideos, setPageVideos] = useState<any[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string>("");
  const [videosNota, setVideosNota] = useState<string>("");

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
  const [filtroCanal, setFiltroCanal] = useState<"todos" | "evolution" | "meta_business">("todos");
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  
  // ARCHIVADOS & ELIMINAR
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ convId: string; clienteId: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Resultado de la eliminación completa (se muestra en el mismo modal).
  const [resultadoEliminar, setResultadoEliminar] = useState<ResumenEliminacion | null>(null);
  // Chatwoot no permitió borrar la memoria de Luna: se ofrece seguir "sólo CRM".
  const [bloqueoChatwoot, setBloqueoChatwoot] = useState<{ clienteId: string; detalle: string[] } | null>(null);
  const [filtroArchivados, setFiltroArchivados] = useState<"todos" | "evolution" | "meta_business">("todos");
  const [searchArchivados, setSearchArchivados] = useState("");
  const [searchChats, setSearchChats] = useState("");

  // PAGOS Y DIVISAS
  const [tipoPago, setTipoPago] = useState<"unico" | "cuotas">("unico");
  const [montoTotal, setMontoTotal] = useState("");
  const [numeroCuotas, setNumeroCuotas] = useState("2");
  const [fechaInicial, setFechaInicial] = useState("");
  // Cuotas: fecha de CADA cuota (índice 0 = primera, sigue a fechaInicial).
  // Por defecto una por mes desde la primera; cada una se puede editar.
  const [fechasCuotas, setFechasCuotas] = useState<string[]>([]);
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

  // SUBCATEGORÍAS CHATS: filtro por etapa del pipeline (Nuevo Lead por defecto)
  const [chatCategoria, setChatCategoria] = useState<string>("nuevo_lead");
  // Traspaso automático a la etapa Vencidos (WhatsApp API → WhatsApp Personal).
  // Se puede apagar desde Ajustes (config_general: vencidos_auto).
  const [vencidosAuto, setVencidosAuto] = useState(true);

  // CARTERA POR COBRAR (control de próximos pagos)
  const [carteraGrupoFiltro, setCarteraGrupoFiltro] = useState<"personal" | "templo" | "todas">("personal");
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [expandedCarteraCliente, setExpandedCarteraCliente] = useState<string | null>(null);
  const [abonoModalCliente, setAbonoModalCliente] = useState<any | null>(null); // { cliente, proximoPago }
  const [abonoMonto, setAbonoMonto] = useState("");
  const [reprogramarModal, setReprogramarModal] = useState<any | null>(null); // { pago, nombre }
  const [nuevaFechaPago, setNuevaFechaPago] = useState("");
  const [searchCartera, setSearchCartera] = useState("");

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
  const [descargandoFotos, setDescargandoFotos] = useState(false);
  // Descargar una nota de voz del chat como OGG (botón de la burbuja)
  const [descargandoAudioId, setDescargandoAudioId] = useState<string | null>(null);
  // Botón "Cambiar etapa" junto al clip de enviar archivos
  const [showEtapaMenu, setShowEtapaMenu] = useState(false);
  // RESPUESTAS RÁPIDAS (textos, audios OGG, imágenes) — sirven para todas las conversaciones
  const [showRespuestasMenu, setShowRespuestasMenu] = useState(false);
  const [respuestasRapidas, setRespuestasRapidas] = useState<RespuestaRapida[]>([]);
  const [rrBorrador, setRrBorrador] = useState<null | {
    tipo: "texto" | "audio" | "imagen";
    texto: string;
    titulo: string;
    dataUri: string;
    nombre: string;
    mime: string;
  }>(null);
  const [rrError, setRrError] = useState("");
  const [rrNotice, setRrNotice] = useState("");
  const [guardandoRR, setGuardandoRR] = useState(false);
  const [sincronizandoRR, setSincronizandoRR] = useState(false);
  const rrFileInputRef = useRef<HTMLInputElement>(null);
  const [guardandoContacto, setGuardandoContacto] = useState(false);
  const [contactoGuardado, setContactoGuardado] = useState<"nativo" | "vcf" | null>(null);
  // null = comprobando / sin acceso a agenda; true = puede llamar; false = debe guardarlo primero.
  const [contactoEnTelefono, setContactoEnTelefono] = useState<boolean | null>(null);
  const [llamandoWhatsApp, setLlamandoWhatsApp] = useState(false);
  const [llamadasPersonalDisponibles, setLlamadasPersonalDisponibles] = useState(false);

  const [showAdmin, setShowAdmin] = useState(false);
  const [showAjustes, setShowAjustes] = useState(false);
  const [adminSecret, setAdminSecret] = useState("");
  const [balances, setBalances] = useState<any>(null);
  const [loadingBal, setLoadingBal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Marca de tiempo de la última sincronización de Ads (para el refresco de 10 min)
  const ultimaActualizacionAdsRef = useRef<number>(0);
  const [ultimaActualizacionAds, setUltimaActualizacionAds] = useState<number>(0);

  // ===================== CARGA INICIAL =====================
  useEffect(() => {
    // Registra las categorías Android al abrir la APK, incluso antes de que
    // llegue el primer mensaje o recordatorio.
    void initializeNotificationChannels();
    fetchConversaciones();
    fetchPipelineEtapas();
    fetchTodosPagos();
    fetchTodosClientes();
    fetchTodasTareas();
    fetchCampanasAds();
    cargarConfigDivisas();
    cargarConfigGeneral();
    cargarMemoriaAds();
    fetchVideosFanPage();
    void actualizarRespuestasRapidas().then(setRespuestasRapidas);
    // Recalcular mensajes no leídos (cubre los que llegaron con la app cerrada)
    sincronizarNoLeidos();
    // Sincronizar con Chatwoot al abrir: trae lo que haya perdido el webhook
    // de n8n (mensajes nuevos, chats nuevos, contactos nuevos).
    sincronizarConChatwoot({ silencioso: true });

    // Refrescos de lista con mini-debounce: una ráfaga de eventos (mensaje +
    // resumen de conversación + cliente) produce UN solo refetch ~1500 ms
    // después, no tres seguidos. El mensaje en sí no espera: lo pinta el
    // realtime de `mensajes` o el refetch directo del sondeo del chat abierto.
    let refrescoTimer: ReturnType<typeof setTimeout> | null = null;
    const refrescarLista = () => {
      if (refrescoTimer) clearTimeout(refrescoTimer);
      refrescoTimer = setTimeout(() => {
        refrescoTimer = null;
        fetchConversaciones(false);
      }, 1500);
    };

    let clientesTimer: ReturnType<typeof setTimeout> | null = null;
    const refrescarClientes = () => {
      if (clientesTimer) clearTimeout(clientesTimer);
      clientesTimer = setTimeout(() => {
        clientesTimer = null;
        fetchTodosClientes();
      }, 2000);
    };

    const convSub = supabase.channel("r-conv").on("postgres_changes", { event: "*", schema: "public", table: "conversaciones" }, () => refrescarLista()).subscribe();
    const cliSub = supabase.channel("r-cli").on("postgres_changes", { event: "*", schema: "public", table: "clientes" }, () => { refrescarLista(); refrescarClientes(); }).subscribe();
    const pagSub = supabase.channel("r-pag").on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, fetchTodosPagos).subscribe();
    const tarSub = supabase.channel("r-tar").on("postgres_changes", { event: "*", schema: "public", table: "tareas" }, fetchTodasTareas).subscribe();
    const pipeSub = supabase.channel("r-pipe").on("postgres_changes", { event: "*", schema: "public", table: "pipeline_etapas" }, () => {
      fetchPipelineEtapas();
    }).subscribe();
    const rrSub = supabase.channel("r-rr").on("postgres_changes", { event: "*", schema: "public", table: "respuestas_rapidas" }, () => {
      void actualizarRespuestasRapidas().then(setRespuestasRapidas);
    }).subscribe();

    return () => {
      if (refrescoTimer) clearTimeout(refrescoTimer);
      if (clientesTimer) clearTimeout(clientesTimer);
      supabase.removeChannel(convSub);
      supabase.removeChannel(cliSub);
      supabase.removeChannel(pagSub);
      supabase.removeChannel(tarSub);
      supabase.removeChannel(pipeSub);
      supabase.removeChannel(rrSub);
    };
  }, []);

  // ===================== TEMA (claro/oscuro + acento) =====================
  useEffect(() => {
    const cleanup = initTheme();
    return cleanup;
  }, []);

  // Se calcula ya en el dispositivo para que la versión web no intente usar el
  // puente Android ni produzca diferencias de hidratación.
  useEffect(() => {
    setLlamadasPersonalDisponibles(llamadasWhatsAppPersonalDisponibles());
  }, []);

  // Ticker: actualiza cartera y cortes cada minuto
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Actualización automática de Ads CADA 10 MINUTOS: resultados de campañas,
  // saldo de la cuenta publicitaria, videos de la Fan Page y segmentaciones.
  // Además refresca al volver a la app si ya pasaron 10 minutos desde la última vez.
  useEffect(() => {
    const DIEZ_MINUTOS_MS = 10 * 60 * 1000;

    const refrescarTodoAds = () => {
      fetchCampanasAds();
      fetchAccountInfo();
    };

    const intervalAds = setInterval(refrescarTodoAds, DIEZ_MINUTOS_MS);

    // Al volver a la app (o a la pestaña) se refresca si el dato ya está viejo
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const ultima = Number(ultimaActualizacionAdsRef.current || 0);
      if (Date.now() - ultima >= DIEZ_MINUTOS_MS) refrescarTodoAds();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(intervalAds);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al abrir la pestaña de Ads, trae datos frescos de inmediato
  useEffect(() => {
    if (tab !== "ads") return;
    fetchCampanasAds();
    fetchAccountInfo();
    if (segmentacionesGuardadas.length === 0) fetchSegmentaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Ajustes → Vencidos: el interruptor avisa al dashboard al instante.
  useEffect(() => {
    const onCambio = (e: any) => {
      const activo = e?.detail?.activo;
      if (typeof activo === "boolean") setVencidosAuto(activo);
    };
    window.addEventListener("tm-vencidos-auto-changed", onCambio);
    return () => window.removeEventListener("tm-vencidos-auto-changed", onCambio);
  }, []);

  // Si la subcategoría de chat seleccionada no existe en el pipeline, volver a nuevo_lead
  useEffect(() => {
    if (
      chatCategoria === CATEGORIA_POR_LEER ||
      chatCategoria === CATEGORIA_EN_SEGUIMIENTO ||
      chatCategoria === CATEGORIA_ARCHIVADOS ||
      chatCategoria === "spam" ||
      chatCategoria === "nuevo_lead"
    ) return;
    const existe = pipelineEtapas.find((e) => e.clave === chatCategoria);
    if (!existe && pipelineEtapas.length > 0) {
      setChatCategoria("nuevo_lead");
    }
  }, [chatCategoria, pipelineEtapas]);

  // Al volver a la app con un chat abierto, ese chat cuenta como revisado
  useEffect(() => {
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible" && selectedConvRef.current) {
        marcarLeido(selectedConvRef.current.id);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ===================== NOTIFICACIONES DE MENSAJES ENTRANTES =====================
  const conversacionesRef = useRef<any[]>([]);
  const selectedConvRef = useRef<any | null>(null);
  useEffect(() => { conversacionesRef.current = conversaciones; }, [conversaciones]);
  useEffect(() => { selectedConvRef.current = selectedConv; }, [selectedConv]);

  // Botón atrás (Android / historial): no salir de la app; volver a Chats.
  const tabRef = useRef(tab);
  const showMobileDetailsRef = useRef(showMobileDetails);
  const showAjustesRef = useRef(showAjustes);
  const showAdminRef = useRef(showAdmin);
  const showAiModalRef = useRef(showAiModal);
  const showDeleteConfirmRef = useRef(showDeleteConfirm);
  const showEtapaMenuRef = useRef(showEtapaMenu);
  const showRespuestasMenuRef = useRef(showRespuestasMenu);
  const abonoModalRef = useRef(abonoModalCliente);
  const reprogramarModalRef = useRef(reprogramarModal);
  const showDivisaConfigRef = useRef(showDivisaConfig);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { showMobileDetailsRef.current = showMobileDetails; }, [showMobileDetails]);
  useEffect(() => { showAjustesRef.current = showAjustes; }, [showAjustes]);
  useEffect(() => { showAdminRef.current = showAdmin; }, [showAdmin]);
  useEffect(() => { showAiModalRef.current = showAiModal; }, [showAiModal]);
  useEffect(() => { showDeleteConfirmRef.current = showDeleteConfirm; }, [showDeleteConfirm]);
  useEffect(() => { showEtapaMenuRef.current = showEtapaMenu; }, [showEtapaMenu]);
  useEffect(() => { showRespuestasMenuRef.current = showRespuestasMenu; }, [showRespuestasMenu]);
  useEffect(() => { abonoModalRef.current = abonoModalCliente; }, [abonoModalCliente]);
  useEffect(() => { reprogramarModalRef.current = reprogramarModal; }, [reprogramarModal]);
  useEffect(() => { showDivisaConfigRef.current = showDivisaConfig; }, [showDivisaConfig]);

  // MainActivity envía este evento para el botón y el gesto Atrás de Android.
  // El primer gesto siempre deja una pantalla conocida: la lista de Chats.
  // La Activity se encarga de cerrar la app sólo si recibe un segundo gesto
  // consecutivo dentro de dos segundos.
  useEffect(() => {
    const volverAChats = () => {
      setTab("chats");
      setSelectedConv(null);
      setShowMobileDetails(false);

      // No dejar un panel o diálogo sobre la lista de chats al volver.
      setShowAjustes(false);
      setShowAdmin(false);
      setBalances(null);
      setAdminSecret("");
      setShowAiModal(false);
      setShowDeleteConfirm(null);
      setResultadoEliminar(null);
      setBloqueoChatwoot(null);
      setAbonoModalCliente(null);
      setAbonoMonto("");
      setReprogramarModal(null);
      setNuevaFechaPago("");
      setShowDivisaConfig(false);
      setShowEtapaMenu(false);
      setShowRespuestasMenu(false);
      setRrBorrador(null);
      setIsEditingPipeline(false);
      setIsEditingGroupLabels(false);
    };

    window.addEventListener("temploBackButton", volverAChats);
    return () => window.removeEventListener("temploBackButton", volverAChats);
  }, []);

  useEffect(() => {
    const atraparHistorial = () => {
      try { window.history.pushState({ tmBack: true }, ""); } catch {}
    };
    atraparHistorial();
    const onPop = () => {
      if (showAjustesRef.current) setShowAjustes(false);
      else if (showAdminRef.current) { setShowAdmin(false); setBalances(null); setAdminSecret(""); }
      else if (showAiModalRef.current) setShowAiModal(false);
      else if (showDeleteConfirmRef.current) { setShowDeleteConfirm(null); setResultadoEliminar(null); setBloqueoChatwoot(null); }
      else if (abonoModalRef.current) { setAbonoModalCliente(null); setAbonoMonto(""); }
      else if (reprogramarModalRef.current) { setReprogramarModal(null); setNuevaFechaPago(""); }
      else if (showDivisaConfigRef.current) setShowDivisaConfig(false);
      else if (showEtapaMenuRef.current) setShowEtapaMenu(false);
      else if (showRespuestasMenuRef.current) { setShowRespuestasMenu(false); setRrBorrador(null); }
      else if (showMobileDetailsRef.current) setShowMobileDetails(false);
      else if (selectedConvRef.current) {
        setSelectedConv(null);
        setShowMobileDetails(false);
        setTab("chats");
      } else {
        setTab("chats");
        setSelectedConv(null);
        setShowMobileDetails(false);
      }
      atraparHistorial();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const notifSub = supabase.channel("r-msg-notif")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes" }, (payload) => {
        const msg = payload.new as any;
        if (!msg || msg.tipo === "enviado") return; // solo mensajes entrantes
        const conv = conversacionesRef.current.find((c) => c.id === msg.conversacion_id || (c.all_conv_ids && c.all_conv_ids.includes(msg.conversacion_id)));
        // Spam: ni recordatorios ni notificaciones
        if (conv?.clientes?.es_spam) return;
        // Si el chat está abierto y la app visible, se marca como leído al vuelo
        const abierta = typeof document !== "undefined" && document.visibilityState === "visible";
        const convAbierta = selectedConvRef.current;
        const estaEnChat = convAbierta && (convAbierta.id === msg.conversacion_id || (convAbierta.all_conv_ids && convAbierta.all_conv_ids.includes(msg.conversacion_id)));
        if (abierta && estaEnChat) {
          marcarLeido(msg.conversacion_id);
          return;
        }
        // Si no, se suma al contador de no leídos (solo lo limpia el operador al revisar)
        sincronizarNoLeidos();
        // Título de la notificación: solo nombre MANUAL o el número con + (nunca el nombre cargado)
        const nombre = (() => {
          const manual = getNombreManual(conv?.clientes);
          if (manual) return manual;
          const num = getTelefonoE164(conv?.clientes, conv);
          return num || "Cliente";
        })();
        let preview = msg.contenido || "";
        if (msg.tipo_contenido === "audio" || /\[audio\]|\[nota_de_voz\]/i.test(preview)) preview = "🎤 Nota de voz";
        else if (msg.tipo_contenido === "imagen") preview = "📷 Imagen";
        if (preview.length > 90) preview = preview.slice(0, 90) + "…";
        notify(
          `💬 ${nombre}`,
          preview || "Mensaje nuevo",
          `msg-${msg.conversacion_id}`,
          NOTIFICATION_CHANNELS.MESSAGES,
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(notifSub); };
  }, []);

  // Recordatorios de tareas pendientes (APK Android)
  useEffect(() => {
    if (todasTareas.length > 0) scheduleTaskReminders(todasTareas);
  }, [todasTareas]);

  // Aviso diario de En seguimiento (8:00 AM todos los días). Se
  // recalcula al cargar/sincronizar clientes y cuando se activan o apagan los
  // avisos desde Ajustes, sin crear alarmas duplicadas en Android.
  useEffect(() => {
    const programarSeguimiento = () => {
      const clientesSeguimiento = todosClientes.filter((cliente) =>
        estaPendienteSeguimientoHoy(cliente)
      );
      void scheduleFollowUpReminders(clientesSeguimiento);
    };
    programarSeguimiento();
    window.addEventListener("tm-notification-pref-changed", programarSeguimiento);
    return () => window.removeEventListener("tm-notification-pref-changed", programarSeguimiento);
  }, [todosClientes]);

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

  // ===================== CONFIG GENERAL (Luna global, grupos) =====================
  async function cargarConfigGeneral() {
    try {
      const { data } = await supabase.from("config_general").select("*");
      if (data) {
        data.forEach((row: any) => {
          if (row.clave === "luna_global_activa") setLunaGlobalActiva(row.valor !== "false");
          if (row.clave === "grupo_activo" && (row.valor === "personal" || row.valor === "templo")) {
            setGrupoActivo(row.valor as any);
          }
          if (row.clave === "personal_label" && row.valor) setPersonalLabel(row.valor);
          if (row.clave === "templo_label" && row.valor) setTemploLabel(row.valor);
          if (row.clave === "vencidos_auto") setVencidosAuto(row.valor !== "false");
        });
      }
    } catch (e) {
      console.log("config_general no disponible:", e);
    }
  }

  async function toggleLunaGlobal() {
    const nuevoEstado = !lunaGlobalActiva;
    setTogglingLunaGlobal(true);
    setLunaGlobalActiva(nuevoEstado);

    // 1) Apagar/encender TODAS las conversaciones de un solo golpe
    //    (usamos .not("id","is",null) porque Supabase exige al menos un filtro en UPDATE)
    try {
      const { error } = await supabase.from("conversaciones").update({ agente_activo: nuevoEstado }).not("id", "is", null);
      if (error) {
        // Fallback por si el operador "is" no funciona: actualizar en bloques
        const { data: allConvs } = await supabase.from("conversaciones").select("id");
        if (allConvs && allConvs.length > 0) {
          const ids = allConvs.map((c: any) => c.id);
          await supabase.from("conversaciones").update({ agente_activo: nuevoEstado }).in("id", ids);
        }
      }
      // Actualizar estado local
      setConversaciones(prev => prev.map(c => ({ ...c, agente_activo: nuevoEstado })));
      if (selectedConv) setSelectedConv({ ...selectedConv, agente_activo: nuevoEstado });
    } catch (e) {
      console.error("Error cambiando estado global de Luna:", e);
    }

    // 2) Guardar el kill switch en config
    try {
      await supabase.from("config_general").upsert([
        { clave: "luna_global_activa", valor: nuevoEstado ? "true" : "false" }
      ]);
    } catch {}
    setTogglingLunaGlobal(false);
  }

  async function guardarLabelsGrupos() {
    try {
      await supabase.from("config_general").upsert([
        { clave: "personal_label", valor: personalLabel || "Personal" },
        { clave: "templo_label", valor: temploLabel || "Templo" }
      ]);
    } catch {}
    setIsEditingGroupLabels(false);
  }

  function cambiarGrupo(grupo: "personal" | "templo") {
    setGrupoActivo(grupo);
    setChatCategoria(grupo === "templo" ? "nuevo_lead_templo" : "nuevo_lead");
    setSelectedConv(null);
    setFiltroCanal("todos");
    setSearchChats("");
    setSearchArchivados("");
    try {
      supabase.from("config_general").upsert([{ clave: "grupo_activo", valor: grupo }]).then(() => {});
    } catch {}
  }

  // ===================== COLOR PIPELINE =====================
  const PALETA_COLORES = [
    { color: "border-blue-500", bg: "bg-blue-500/15", text: "text-blue-300" },
    { color: "border-indigo-500", bg: "bg-indigo-500/15", text: "text-indigo-300" },
    { color: "border-purple-500", bg: "bg-purple-500/15", text: "text-purple-300" },
    { color: "border-pink-500", bg: "bg-pink-500/15", text: "text-pink-300" },
    { color: "border-fuchsia-500", bg: "bg-fuchsia-500/15", text: "text-fuchsia-300" },
    { color: "border-violet-500", bg: "bg-violet-500/15", text: "text-violet-300" },
    { color: "border-cyan-500", bg: "bg-cyan-500/15", text: "text-cyan-300" },
    { color: "border-teal-500", bg: "bg-teal-500/15", text: "text-teal-300" },
    { color: "border-emerald-500", bg: "bg-emerald-500/15", text: "text-emerald-300" },
    { color: "border-green-500", bg: "bg-green-500/15", text: "text-green-300" },
    { color: "border-yellow-500", bg: "bg-yellow-500/15", text: "text-yellow-300" },
    { color: "border-orange-500", bg: "bg-orange-500/15", text: "text-orange-300" },
    { color: "border-red-500", bg: "bg-red-500/15", text: "text-red-300" },
    { color: "border-rose-500", bg: "bg-rose-500/15", text: "text-rose-300" },
    { color: "border-amber-500", bg: "bg-amber-500/15", text: "text-amber-300" },
  ];

  async function actualizarColorEtapa(id: string, paleta: any) {
    setPipelineEtapas(prev => prev.map(e => e.id === id ? { ...e, color: paleta.color, bg_color: paleta.bg, text_color: paleta.text } : e));
    try {
      await supabase.from("pipeline_etapas").update({ color: paleta.color, bg_color: paleta.bg, text_color: paleta.text }).eq("id", id);
    } catch (e) { console.error(e); }
    setEditingEtapaColor(null);
  }

  function getEtapa(clienteEstado: string | undefined) {
    const clave = normalizarEstado(clienteEstado);
    return pipelineEtapas.find(e => e.clave === clave) || pipelineEtapas.find(e => e.clave === "nuevo_lead") || null;
  }

  async function toggleEnSeguimientoCliente(clienteId: string) {
    const cli = todosClientes.find(c => c.id === clienteId) || clienteActual;
    const nuevoEstado = !cli?.en_seguimiento;

    setTodosClientes(prev => prev.map(c => c.id === clienteId ? { ...c, en_seguimiento: nuevoEstado } : c));
    setConversaciones(prev => prev.map(c => c.cliente_id === clienteId ? { ...c, clientes: { ...c.clientes, en_seguimiento: nuevoEstado } } : c));
    if (clienteActual?.id === clienteId) {
      setClienteActual((prev: any) => prev ? { ...prev, en_seguimiento: nuevoEstado } : null);
    }

    try {
      await supabase.from("clientes").update({ en_seguimiento: nuevoEstado }).eq("id", clienteId);
    } catch (e) {
      console.warn("No se pudo actualizar en_seguimiento:", e);
    }
  }

  async function marcarSeguimientoRevisado(clienteId: string) {
    const ahoraISO = new Date().toISOString();
    setTodosClientes(prev => prev.map(c => c.id === clienteId ? { ...c, seguimiento_revisado_en: ahoraISO } : c));
    setConversaciones(prev => prev.map(c => c.cliente_id === clienteId ? { ...c, clientes: { ...c.clientes, seguimiento_revisado_en: ahoraISO } } : c));
    if (clienteActual?.id === clienteId) {
      setClienteActual((prev: any) => prev ? { ...prev, seguimiento_revisado_en: ahoraISO } : null);
    }

    try {
      await supabase.from("clientes").update({ seguimiento_revisado_en: ahoraISO }).eq("id", clienteId);
    } catch (e) {
      console.warn("No se pudo actualizar seguimiento_revisado_en:", e);
    }
  }

  // ============ IDENTIDAD DEL CLIENTE: NÚMERO PRIMERO, NOMBRE SOLO SI ES MANUAL ============
  // Regla: el CRM muestra el número de teléfono en formato internacional con
  // el indicativo del país y el "+" (ej: +573054021111 o +595985123456).
  // El nombre SOLO se muestra si el operador lo puso manualmente (nombre_manual);
  // nunca se muestran nombres cargados de WhatsApp ni de la agenda del teléfono.

  // Normaliza cualquier número a formato E.164 compacto: +573054021111
  function formatPhoneE164(raw: any): string {
    if (raw === null || raw === undefined) return "";
    const s = String(raw).trim();
    if (!s) return "";
    const tieneMas = s.startsWith("+");
    let digitos = s.replace(/\D/g, "");
    if (!digitos) return "";
    if (!tieneMas) digitos = digitos.replace(/^0+/, ""); // quita prefijo 00 internacional o 0 local
    if (!digitos) return "";
    return `+${digitos}`;
  }

  // Devuelve el mejor número disponible del cliente en formato +XXXXXXXXX.
  // Entre candidatos (telefono_display, telefono, numero_whatsapp) gana el más
  // largo, porque es el que incluye el indicativo del país.
  function getTelefonoE164(cliente: any, conv?: any): string {
    const candidatos = [cliente?.telefono_display, cliente?.telefono, conv?.numero_whatsapp];
    let mejor = "";
    for (const cand of candidatos) {
      const f = formatPhoneE164(cand);
      if (f.length > mejor.length) mejor = f;
    }
    return mejor;
  }

  // Nombre visible: solo el puesto manualmente por el operador (nombre_manual).
  // "nombre" viene cargado automáticamente (WhatsApp/agenda) y NUNCA se muestra.
  function getNombreManual(cliente: any): string {
    const n = cliente?.nombre_manual;
    if (!n) return "";
    const t = String(n).trim();
    if (!t || t.toLowerCase() === "sin nombre") return "";
    return t;
  }

  // Lo que se muestra como título del chat: nombre manual si existe, si no el número con +
  function getDisplayName(cliente: any, conv?: any) {
    const manual = getNombreManual(cliente);
    if (manual) return manual;
    const num = getTelefonoE164(cliente, conv);
    return num || "Sin número";
  }

  // La fuente meta_business es WhatsApp API/Templo. Todo lo demás corresponde
  // a la bandeja que usa la cuenta Personal del teléfono.
  function esConversacionWhatsAppPersonal(conv: any): boolean {
    return Boolean(conv && conv.fuente !== "meta_business");
  }

  // Verifica silenciosamente si el número ya está en la agenda. La comprobación
  // nativa vuelve a ejecutarse al pulsar Llamar, así que nunca basta solo esta UI.
  useEffect(() => {
    let cancelado = false;
    const telefono = getTelefonoE164(clienteActual, selectedConv);
    if (!selectedConv || !esConversacionWhatsAppPersonal(selectedConv) || !telefono) {
      setContactoEnTelefono(null);
      return () => { cancelado = true; };
    }

    setContactoEnTelefono(null);
    void estaContactoGuardadoEnTelefono(telefono)
      .then((guardado) => {
        if (!cancelado) setContactoEnTelefono(guardado);
      })
      .catch(() => {
        if (!cancelado) setContactoEnTelefono(false);
      });

    return () => { cancelado = true; };
  }, [selectedConv, clienteActual]);

  async function guardarContactoCliente() {
    if (!clienteActual || guardandoContacto) return;
    const telefono = getTelefonoE164(clienteActual, selectedConv);
    if (!telefono) {
      alert("Este cliente no tiene un número de teléfono válido para guardarlo.");
      return;
    }

    const nombre = getDisplayName(clienteActual, selectedConv);
    setGuardandoContacto(true);
    try {
      const resultado = await guardarContactoEnTelefono(nombre, telefono);
      setContactoGuardado(resultado.native ? "nativo" : "vcf");
      if (resultado.native) {
        setContactoEnTelefono(true);
        const ajuste = resultado.nombreAjustado
          ? ` Ya existía "${nombre}" en la agenda, por eso se guardó como "${resultado.nombreGuardado}".`
          : "";
        alert(`Contacto guardado en el teléfono: ${resultado.nombreGuardado} (${telefono}).${ajuste}`);
      } else {
        const ajuste = resultado.nombreAjustado
          ? ` El CRM lo nombró "${resultado.nombreGuardado}" para no repetir una exportación anterior.`
          : "";
        alert(`Se descargó ${resultado.fileName || "el contacto.vcf"}. Ábrelo en el teléfono para añadirlo a Contactos.${ajuste}`);
      }
    } catch (e: any) {
      console.error("Error guardando contacto:", e);
      alert(e?.message || "No se pudo guardar el contacto en el teléfono.");
    } finally {
      setGuardandoContacto(false);
    }
  }

  async function llamarPorWhatsAppPersonal() {
    if (!selectedConv || !clienteActual || llamandoWhatsApp) return;
    if (!esConversacionWhatsAppPersonal(selectedConv)) {
      alert("Las llamadas por este botón solo están disponibles en WhatsApp Personal.");
      return;
    }
    const telefono = getTelefonoE164(clienteActual, selectedConv);
    if (!telefono) {
      alert("Este cliente no tiene un número válido para llamar por WhatsApp.");
      return;
    }
    if (contactoEnTelefono !== true) {
      alert("Para llamar por WhatsApp Personal primero guarda este cliente en los contactos del teléfono.");
      return;
    }

    setLlamandoWhatsApp(true);
    try {
      await abrirLlamadaWhatsAppPersonal(telefono);
    } catch (e: any) {
      if (e?.code === "CONTACT_NOT_SAVED" || e?.code === "CONTACT_PERMISSION_REQUIRED") {
        setContactoEnTelefono(false);
      }
      alert(e?.message || "No se pudo abrir WhatsApp Personal para la llamada.");
    } finally {
      setLlamandoWhatsApp(false);
    }
  }

  function getAvatarInitial(displayName: string) {
    // Si empieza con +, mostrar un ícono de teléfono; si no, la inicial
    if (displayName.startsWith("+")) return "#";
    return displayName.charAt(0).toUpperCase();
  }

  function slugFoto(value: string) {
    return (value || "cliente").replace(/[^\w.+-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "cliente";
  }

  // Chatwoot/Evolution usan estos marcadores cuando una imagen no trae pie.
  // El texto real que acompañó una foto se muestra debajo de ella, nunca se
  // descarta por tratarse de un mensaje multimedia.
  function textoAdjuntoMultimedia(msg: any): string {
    const texto = String(msg?.contenido || "").trim();
    if (!texto) return "";
    if (/^\[(?:imagen|image|sticker|archivo|video|audio|nota_de_voz|documento)\]$/i.test(texto)) return "";
    return texto;
  }

  function fotosDelCliente(cliente: any, msgs: any[] = []) {
    const slug = slugFoto(getDisplayName(cliente, selectedConv));
    const labeled = [
      cliente?.foto_url && { url: cliente.foto_url, label: "Cliente", filename: `foto-${slug}-cliente.jpg` },
      cliente?.foto_otra_persona && { url: cliente.foto_otra_persona, label: "Pareja", filename: `foto-${slug}-pareja.jpg` },
      cliente?.foto_mano && { url: cliente.foto_mano, label: "Palma", filename: `foto-${slug}-palma.jpg` },
    ].filter(Boolean) as Array<{ url: string; label: string; filename: string }>;
    const seen = new Set(labeled.map((f) => f.url));
    const delChat = (msgs || [])
      .filter((m) => m.tipo !== "enviado" && isImageMessage(m))
      .map((m: any, i: number) => ({
        url: String(m.url_archivo),
        label: `Chat ${i + 1}`,
        filename: guessImageFilename(String(m.url_archivo), `foto-${slug}-chat-${i + 1}`),
        id: m.id,
      }))
      .filter((f) => f.url && !seen.has(f.url));
    return { labeled, delChat, all: [...labeled, ...delChat] };
  }

  async function descargarFotosCliente() {
    if (!clienteActual || descargandoFotos) return;
    const { all } = fotosDelCliente(clienteActual, mensajes);
    if (all.length === 0) return;
    setDescargandoFotos(true);
    try {
      const result = await downloadMany(all.map((f) => ({ url: f.url, filename: f.filename })));
      if (result.fail > 0 && result.ok === 0) {
        alert("No se pudieron descargar las imágenes. Puede que el enlace de WhatsApp ya haya vencido.");
      } else if (result.fail > 0) {
        alert(`Se descargaron ${result.ok} imagen(es). ${result.fail} no se pudieron bajar.`);
      }
    } finally {
      setDescargandoFotos(false);
    }
  }

  // ===================== DESCARGAR NOTAS DE VOZ (OGG) =====================
  // Nombre de archivo legible: nota-voz-<cliente>-<aammdd-hhmmss>-<n>.ogg
  function nombreBaseAudioMsg(msg: any, indice: number): string {
    const slug = slugFoto(getDisplayName(clienteActual, selectedConv));
    const d = new Date(msg.creado_en || Date.now());
    const p2 = (n: number) => n.toString().padStart(2, "0");
    return `nota-voz-${slug}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${indice + 1}`;
  }

  // Botón de la burbuja: descarga ESTA nota de voz en OGG. Las grabadas en
  // WebM se remuevan sin recodificar; las que ya son OGG se guardan tal cual
  // (otro formato, p. ej. mp3, se conserva en su formato original).
  async function descargarAudioMensaje(msg: any, indice: number) {
    const id = String(msg.id || indice);
    setDescargandoAudioId(id);
    try {
      const { file } = await audioMensajeToArchivo(msg, nombreBaseAudioMsg(msg, indice), true);
      await saveAudioFiles([file], "Nota de voz (OGG)");
    } catch (e: any) {
      console.error("Error descargando audio:", e);
      alert(e?.message || "No se pudo descargar el audio. Puede que el enlace de WhatsApp ya haya vencido.");
    } finally {
      setDescargandoAudioId(null);
    }
  }

  // Nombre para las tarjetas de tareas: nombre manual o número con +
  function getNombreTarea(t: any): string {
    const c: any = t?.clientes;
    if (!c) return "Cliente";
    const manual = getNombreManual(c);
    if (manual) return manual;
    return getTelefonoE164(c) || "Cliente";
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

  // ===================== CARTERA POR COBRAR: HELPERS =====================
  function diasHasta(fechaISO: string): number {
    if (!fechaISO) return 9999;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const f = new Date(fechaISO.length <= 10 ? `${fechaISO}T00:00:00` : fechaISO);
    f.setHours(0, 0, 0, 0);
    return Math.round((f.getTime() - hoy.getTime()) / 86400000);
  }

  function getGrupoCliente(cliente: any): "personal" | "templo" {
    if (!cliente) return "personal";
    if (cliente.grupo === "templo" || cliente.grupo === "personal") return cliente.grupo;
    // Fallback: si el cliente no tiene grupo, deducirlo de su conversación
    const conv = conversaciones.find((c) => c.cliente_id === cliente.id);
    if (conv?.fuente === "meta_business") return "templo";
    return "personal";
  }

  const clientePorId = (id: string) => todosClientes.find((c) => c.id === id);

  // Registrar un abono: se descuenta del/los pagos pendientes más antiguos y
  // se actualiza automáticamente la fecha del siguiente pago.
  async function registrarAbono(clienteId: string, montoAbono: number) {
    if (!(montoAbono > 0)) return;
    const pendientes = todosPagos
      .filter((p) => p.cliente_id === clienteId && p.estado === "pendiente")
      .sort((a, b) => new Date(a.fecha_vencimiento).getTime() - new Date(b.fecha_vencimiento).getTime());
    if (pendientes.length === 0) return;
    // El abono se aplica solo en la divisa del pago más antiguo (no se mezclan divisas)
    const monedaAbono = pendientes[0].moneda || "COP";
    let restante = montoAbono;
    const tareas: any[] = [];
    for (const pago of pendientes) {
      if (restante <= 0) break;
      if ((pago.moneda || "COP") !== monedaAbono) break;
      const montoPago = Number(pago.monto) || 0;
      if (restante >= montoPago) {
        // Se paga la cuota completa
        tareas.push(
          supabase
            .from("pagos")
            .update({ estado: "pagado", fecha_pago: new Date().toISOString().split("T")[0] })
            .eq("id", pago.id)
        );
        restante -= montoPago;
      } else {
        // Abono parcial: se reduce el monto pendiente de la cuota
        const nuevoMonto = Math.round((montoPago - restante) * 100) / 100;
        const factor = montoPago > 0 ? nuevoMonto / montoPago : 0;
        const nuevoConvertido = pago.monto_convertido_cop != null ? Math.round(Number(pago.monto_convertido_cop) * factor) : null;
        tareas.push(
          supabase
            .from("pagos")
            .update({ monto: nuevoMonto, monto_convertido_cop: nuevoConvertido })
            .eq("id", pago.id)
        );
        restante = 0;
      }
    }
    await Promise.all(tareas);
    fetchTodosPagos();
    setAbonoModalCliente(null);
    setAbonoMonto("");
  }

  // Reprogramar la fecha de vencimiento de un pago
  async function reprogramarPago(pagoId: string, nuevaFecha: string) {
    if (!nuevaFecha) return;
    await supabase.from("pagos").update({ fecha_vencimiento: nuevaFecha }).eq("id", pagoId);
    setReprogramarModal(null);
    setNuevaFechaPago("");
    fetchTodosPagos();
  }

  // Eliminar de la cartera por abandono: cancela/borra los pendientes y archiva al cliente
  async function abandonarCartera(cliente: any) {
    const nombre = getDisplayName(cliente);
    if (!confirm(`¿Eliminar a "${nombre}" de la cartera por abandono?\n\nSe eliminarán sus pagos pendientes y el cliente quedará archivado.`)) return;
    const pendientes = todosPagos.filter((p) => p.cliente_id === cliente.id && p.estado === "pendiente");
    let fallbackDelete = false;
    for (const p of pendientes) {
      const { error } = await supabase.from("pagos").update({ estado: "cancelado" }).eq("id", p.id);
      if (error) fallbackDelete = true;
    }
    if (fallbackDelete) {
      await supabase.from("pagos").delete().eq("cliente_id", cliente.id).eq("estado", "pendiente");
    }
    await supabase.from("clientes").update({
      notas_personales: `${cliente.notas_personales ? cliente.notas_personales + "\n" : ""}[${new Date().toLocaleDateString("es-CO")}] ⚠️ Abandonó cartera (pagos pendientes eliminados, cliente archivado)`,
      actualizado_en: new Date().toISOString(),
    }).eq("id", cliente.id);
    // Archivar sus conversaciones para sacarlo de la vista activa
    await supabase.from("conversaciones").update({
      archivada: true,
      fecha_archivado: new Date().toISOString(),
      motivo_archivado: "abandono_cartera",
    }).eq("cliente_id", cliente.id);
    fetchTodosPagos();
    fetchTodosClientes();
    fetchConversaciones();
  }

  // ===================== MENSAJES NO LEÍDOS =====================
  // El contador solo se limpia cuando el operador abre/revisa el chat.
  // La respuesta de la agente (tipo "enviado") no cuenta y no lo limpia.
  async function marcarLeido(convId: string) {
    try { await supabase.rpc("marcar_leido", { p_conv_id: convId }); } catch {}
    setConversaciones(prev => prev.map(c => (c.id === convId ? { ...c, no_leidos: 0 } : c)));
  }

  async function sincronizarNoLeidos() {
    try { await supabase.rpc("sincronizar_no_leidos"); } catch {}
    fetchConversaciones(false);
  }

  // ===================== SINCRONIZACIÓN DIRECTA CON CHATWOOT =====================
  // El dashboard ya no depende del workflow de n8n para enterarse de los
  // mensajes: pregunta directamente a Chatwoot (la fuente de la verdad) vía
  // /api/chatwoot/sync y repara Supabase. Se ejecuta al abrir la app (completa),
  // en modo RÁPIDO cada pocos segundos (bandeja 5 s, chat abierto 2.5 s), al
  // abrir un chat y con el botón 🔄. Con el webhook directo de Chatwoot
  // configurado, el mensaje llega empujado por el propio Chatwoot en <1 s y
  // Supabase Realtime lo refleja en el dashboard al instante.
  const [sincronizandoCW, setSincronizandoCW] = useState(false);
  const sincronizandoCWRef = useRef(false);      // pasadas completas / manuales
  const sincronizandoRapidoRef = useRef(false);  // delta de bandeja (5 s)
  const sincronizandoChatRef = useRef(false);    // chat abierto (2.5 s), lock propio

  async function sincronizarConChatwoot(
    opciones: { conversacionId?: string | number; completa?: boolean; silencioso?: boolean; rapido?: boolean } = {}
  ) {
    // Cada tipo de sondeo tiene su propio candado: un sondeo del chat abierto
    // no bloquea el de la bandeja ni viceversa (antes se pisaban entre sí).
    const lock = opciones.conversacionId
      ? sincronizandoChatRef
      : opciones.rapido
        ? sincronizandoRapidoRef
        : sincronizandoCWRef;
    if (lock.current) return;
    lock.current = true;
    if (!opciones.silencioso) setSincronizandoCW(true);
    try {
      const params = new URLSearchParams();
      if (opciones.conversacionId) params.set("conversacionId", String(opciones.conversacionId));
      if (opciones.completa) params.set("completa", "1");
      if (opciones.rapido) params.set("rapido", "1");
      const res = await fetch(`/api/chatwoot/sync?${params.toString()}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (data && (data.mensajes_nuevos > 0 || data.mensajes_actualizados > 0 || data.conversaciones_nuevas > 0 || !opciones.silencioso)) {
        fetchConversaciones(false);
        // Si hay un chat abierto, refrescar sus mensajes con lo nuevo.
        const convAbierta = selectedConvRef.current;
        if (convAbierta && (!opciones.conversacionId || String(opciones.conversacionId) === String(convAbierta.chatwoot_conversation_id))) {
          // AHORRO DE EGRESS: antes se re-descargaba la conversación completa
          // (con audios/imágenes en base64) en cada tic con novedades. Ahora
          // solo se piden los mensajes desde ~5 min antes del último conocido
          // y se fusionan por id con los que ya están en pantalla.
          const idsConv = convAbierta.all_conv_ids || [convAbierta.id];
          const actuales = mensajesRef.current;
          const ultimoTs = actuales.length > 0
            ? Math.max(...actuales.map((m: any) => Date.parse(m.creado_en) || 0))
            : 0;
          let q = supabase.from("mensajes").select("id, conversacion_id, tipo, tipo_contenido, contenido, url_archivo, creado_en, chatwoot_message_id").in("conversacion_id", idsConv).order("creado_en", { ascending: true });
          if (ultimoTs > 0) q = q.gt("creado_en", new Date(ultimoTs - 5 * 60_000).toISOString());
          const { data: msgs } = await q;
          if (msgs && msgs.length > 0) {
            setMensajes((prev) => {
              const porId = new Map<string, any>(prev.map((m: any) => [String(m.id), m]));
              let cambio = false;
              for (const n of msgs) {
                const clave = String(n.id);
                const previo = porId.get(clave);
                if (!previo || JSON.stringify(previo) !== JSON.stringify(n)) cambio = true;
                porId.set(clave, n);
              }
              if (!cambio) return prev;
              return Array.from(porId.values()).sort(
                (a: any, b: any) => (Date.parse(a.creado_en) || 0) - (Date.parse(b.creado_en) || 0)
              );
            });
          }
        }
      }
    } catch (e) {
      console.warn("Sincronización con Chatwoot falló (se reintentará):", e);
    } finally {
      lock.current = false;
      setSincronizandoCW(false);
    }
  }

  // Sondeos adaptativos con la app visible (la APK/web no siempre recibe el
  // realtime de Supabase; con esto los mensajes aparecen igual, en ~2-3 s sin
  // webhook y en <1 s con él). Con la app oculta se pausa todo.
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const enLinea = () => typeof navigator === "undefined" || navigator.onLine !== false;
    let ultimaActividad = Date.now();
    const registrarActividad = () => { ultimaActividad = Date.now(); };
    window.addEventListener("mousemove", registrarActividad, { passive: true });
    window.addEventListener("keydown", registrarActividad, { passive: true });
    window.addEventListener("touchstart", registrarActividad, { passive: true });

    const ticBandeja = () => {
      if (!visible() || !enLinea()) return;
      // Si el usuario no ha interactuado en más de 2 minutos, reducimos la frecuencia
      const inactivo = Date.now() - ultimaActividad > 120_000;
      if (inactivo && Math.random() > 0.3) return;
      void sincronizarConChatwoot({ silencioso: true, rapido: true });
    };
    const ticChatAbierto = () => {
      if (!visible() || !enLinea()) return;
      const conv = selectedConvRef.current;
      if (!conv?.chatwoot_conversation_id) return;
      const inactivo = Date.now() - ultimaActividad > 120_000;
      if (inactivo && Math.random() > 0.3) return;
      void sincronizarConChatwoot({
        conversacionId: conv.chatwoot_conversation_id,
        silencioso: true,
        rapido: true,
      });
    };
    const t1 = setInterval(ticBandeja, 15_000);
    const t2 = setInterval(ticChatAbierto, 8_000);
    // Respaldo: una pasada completa ocasional (atrapa chats que bajaron de las
    // primeras páginas del listado y repara pies de foto/adjuntos).
    const t3 = setInterval(() => {
      if (visible() && enLinea()) void sincronizarConChatwoot({ silencioso: true });
    }, 300_000);
    const onVis = () => {
      if (!visible()) return;
      ultimaActividad = Date.now();
      ticBandeja();
      ticChatAbierto();
      void sincronizarConChatwoot({ silencioso: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
      window.removeEventListener("mousemove", registrarActividad);
      window.removeEventListener("keydown", registrarActividad);
      window.removeEventListener("touchstart", registrarActividad);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchConversaciones(completa = true) {
    if (completa) {
      try {
        await supabase.rpc("unificar_conversaciones_whatsapp");
      } catch (e) {
        console.warn("No se pudo unificar el historial WhatsApp todavía:", e);
      }
    }
    const { data } = await supabase.from("conversaciones").select("*, clientes(*)").order("ultimo_mensaje_en", { ascending: false });
    if (data) {
      // ¿Ya está aplicada la migración de la ventana de 24 h? Si la columna no
      // existe, Supabase no la devuelve y se usa el respaldo de abajo.
      const hayColumnaVentana = data.some((fila: any) => Object.prototype.hasOwnProperty.call(fila, "ultimo_entrante_en"));
      // Unificar conversaciones por cliente_id para que haya una sola conversación por cliente
      const convsPorCliente = new Map<string, any>();
      data.forEach((c: any) => {
        const cid = c.cliente_id || c.id;
        const existente = convsPorCliente.get(cid);
        if (!existente) {
          convsPorCliente.set(cid, {
            ...c,
            all_conv_ids: [c.id],
          });
        } else {
          // Combinar datos en una sola fila representativa
          const cwId = existente.chatwoot_conversation_id || c.chatwoot_conversation_id;
          const tExistente = new Date(existente.ultimo_mensaje_en || 0).getTime();
          const tNuevo = new Date(c.ultimo_mensaje_en || 0).getTime();
          const principal = tNuevo > tExistente ? c : existente;
          const secundaria = tNuevo > tExistente ? existente : c;
          // La ventana de 24 h se toma del chat unificado más reciente: si el
          // cliente escribió en cualquiera de las dos conversaciones, cuenta.
          const entrantes = [existente.ultimo_entrante_en, c.ultimo_entrante_en].filter(Boolean);
          const ultimoEntrante = entrantes.length > 0
            ? entrantes.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b))
            : undefined;
          // La marca del WhatsApp API (la que mueve a Vencidos) también se toma de
          // la más nueva de las dos: si el chat del API quedó como secundario, el
          // traspaso no debe perder la fecha en que venció la ventana.
          const apiEntrantes = [existente.ultimo_entrante_api_en, c.ultimo_entrante_api_en].filter(Boolean);
          const ultimoApi = apiEntrantes.length > 0
            ? apiEntrantes.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b))
            : undefined;
          const idsUnidos = Array.from(new Set([
            ...(existente.chatwoot_conversation_ids || []),
            ...(c.chatwoot_conversation_ids || []),
          ].map((x: any) => String(x)).filter(Boolean)));
          convsPorCliente.set(cid, {
            ...principal,
            chatwoot_conversation_id: cwId,
            ...(idsUnidos.length > 0 ? { chatwoot_conversation_ids: idsUnidos } : {}),
            no_leidos: (principal.no_leidos || 0) + (secundaria.no_leidos || 0),
            all_conv_ids: [...(existente.all_conv_ids || [existente.id]), c.id],
            ...(ultimoEntrante ? { ultimo_entrante_en: ultimoEntrante } : {}),
            ...(ultimoApi ? { ultimo_entrante_api_en: ultimoApi } : {}),
          });
        }
      });
      const lista = Array.from(convsPorCliente.values());
      if (!hayColumnaVentana) await completarVentanaSinMigracion(lista);
      setConversaciones(lista);
    }
    setLoadingChats(false);
  }

  /**
   * Respaldo de la ventana de 24 h mientras no se aplique la migración
   * supabase/migrations/20260918_ventana_24h_whatsapp_api.sql: pide los mensajes
   * ENTRANTES de los últimos 8 días de los chats del WhatsApp API visibles y
   * guarda el más nuevo de cada uno. Sale barato (una consulta por minuto como
   * máximo) y en cuanto la columna exista deja de ejecutarse.
   */
  async function completarVentanaSinMigracion(lista: any[]) {
    const desde = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const pendientes = lista.filter((c) =>
      esChatWhatsAppApi(c) &&
      !c.ultimo_entrante_en &&
      c.ultimo_mensaje_en &&
      new Date(c.ultimo_mensaje_en).getTime() > desde
    );
    if (pendientes.length === 0) return;
    if (Date.now() - ventanaFallbackEnRef.current < 60_000) return;
    ventanaFallbackEnRef.current = Date.now();

    const ids = pendientes.flatMap((c) => c.all_conv_ids || [c.id]).filter(Boolean);
    try {
      for (let i = 0; i < ids.length; i += 80) {
        const { data } = await supabase
          .from("mensajes")
          .select("conversacion_id, creado_en")
          .in("conversacion_id", ids.slice(i, i + 80))
          .neq("tipo", "enviado")
          .gte("creado_en", new Date(desde).toISOString())
          .order("creado_en", { ascending: false })
          .limit(400);
        for (const msg of data || []) {
          for (const conv of pendientes) {
            if (!(conv.all_conv_ids || [conv.id]).includes(msg.conversacion_id)) continue;
            if (!conv.ultimo_entrante_en || new Date(msg.creado_en).getTime() > new Date(conv.ultimo_entrante_en).getTime()) {
              conv.ultimo_entrante_en = msg.creado_en;
            }
          }
        }
      }
    } catch (e) {
      console.warn("Ventana de 24 h: cálculo de respaldo no disponible todavía:", e);
    }
  }

  async function fetchPipelineEtapas() {
    const { data } = await supabase.from("pipeline_etapas").select("*").order("orden", { ascending: true });
    const etapasEliminadasSet = obtenerEtapasEliminadas();
    if (!data || data.length === 0) {
      // Sin etapas en la base el CRM queda degradado; la etapa Vencidos no se
      // inventa porque el traspaso solo puede mover a etapas que existen.
      setPipelineEtapas(
        ETAPAS_DEFAULT.filter(
          (e) => e.clave !== CLAVE_VENCIDOS && !etapasEliminadasSet.has(e.clave) && !etapasEliminadasSet.has(normalizarEstado(e.clave))
        )
      );
      return;
    }

    // Filtrar duplicados con sufijo _templo y etapas técnicas (spam/archivado/en_seguimiento)
    const limpias: any[] = [];
    const clavesVistas = new Set<string>();

    data.forEach((e: any) => {
      if (e.es_spam || e.es_archivado || e.clave === "en_seguimiento") return;
      // Etapas retiradas del pipeline (por si quedaron filas viejas en la BD o borradas por el usuario)
      const baseClave = String(e.clave).replace(/_templo$/, "");
      const claveNorm = normalizarEstado(e.clave);
      if (etapasEliminadasSet.has(baseClave) || etapasEliminadasSet.has(claveNorm)) return;
      if (clavesVistas.has(claveNorm)) return;
      clavesVistas.add(claveNorm);

      let cuentaResp = e.cuenta_responsable;
      if (!cuentaResp) {
        cuentaResp = ["nuevo_lead", "en_consulta"].includes(claveNorm) ? "meta_business" : "evolution";
      }
      limpias.push({
        ...e,
        clave: claveNorm,
        cuenta_responsable: cuentaResp,
      });
    });

    // Solo para una instalación desde cero absoluta se usan etapas base por defecto
    // Si la base ya tiene etapas, NO inyectar etapas por defecto que el usuario haya borrado.
    if (limpias.length === 0) {
      ETAPAS_DEFAULT.forEach((def) => {
        if (!etapasEliminadasSet.has(def.clave) && def.clave !== CLAVE_VENCIDOS) {
          limpias.push({
            id: def.clave,
            ...def,
          });
        }
      });
    }

    limpias.sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
    setPipelineEtapas(limpias);
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
    const { data } = await supabase.from("tareas").select("*, clientes(*)").order("fecha_vencimiento", { ascending: true });
    if (data) setTodosTareas(data);
  }

  // ===================== 📲 ENRUTAR LEADS POR NÚMERO (Publicidad → WhatsApp API) =====================
  // Los leads de publicidad que escriben al número WhatsApp API (fuente = "meta_business")
  // se aseguran siempre en "Nuevo Lead" con la cuenta WhatsApp API encargada.
  const enrutarEnCurso = useRef(false);
  async function enrutarLeadsPorNumero() {
    if (enrutarEnCurso.current) return;
    if (conversaciones.length === 0 || pipelineEtapas.length === 0) return;
    enrutarEnCurso.current = true;
    try {
      const tareasFix: any[] = [];
      const fixes: { id: string; estado?: string; en_seguimiento?: boolean }[] = [];

      todosClientes.forEach((cliente) => {
        const estActual = cliente.estado || "";
        const estNorm = normalizarEstado(estActual);
        let cambios: any = null;

        // Si el cliente tiene estado con sufijo _templo, normalizar al pipeline unificado
        if (estActual.endsWith("_templo")) {
          cambios = { ...(cambios || {}), estado: estNorm };
        }

        // Si el cliente tenía la antigua etapa en_seguimiento, pasar a check booleano
        if (estActual === "en_seguimiento") {
          cambios = { ...(cambios || {}), estado: "en_consulta", en_seguimiento: true };
        }

        // Si el cliente llegó por WhatsApp API (publicidad) y no tiene etapa o era nuevo_lead_templo, asegurar nuevo_lead
        const convMeta = conversaciones.find((c) => c.cliente_id === cliente.id && c.fuente === "meta_business");
        if (convMeta && (!estActual || estActual === "nuevo_lead_templo")) {
          cambios = { ...(cambios || {}), estado: "nuevo_lead" };
        }

        if (cambios) {
          cambios.actualizado_en = new Date().toISOString();
          tareasFix.push(supabase.from("clientes").update(cambios).eq("id", cliente.id));
          fixes.push({ id: cliente.id, ...cambios });
        }
      });

      if (tareasFix.length === 0) return;
      console.log(`📲 Normalizando y enrutando ${tareasFix.length} lead(s) al pipeline unificado (WhatsApp API)`);
      await Promise.all(tareasFix);

      setTodosClientes((prev) => prev.map((c) => {
        const f = fixes.find((x) => x.id === c.id);
        return f ? { ...c, ...(f.estado !== undefined ? { estado: f.estado } : {}), ...(f.en_seguimiento !== undefined ? { en_seguimiento: f.en_seguimiento } : {}) } : c;
      }));
      setConversaciones((prev) => prev.map((c) => {
        const f = c.cliente_id ? fixes.find((x) => x.id === c.cliente_id) : undefined;
        return f ? { ...c, clientes: { ...c.clientes, ...(f.estado !== undefined ? { estado: f.estado } : {}), ...(f.en_seguimiento !== undefined ? { en_seguimiento: f.en_seguimiento } : {}) } } : c;
      }));
    } finally {
      enrutarEnCurso.current = false;
    }
  }

  // Re-enrutar cada vez que llega data nueva (mensajes, leads, etapas)
  useEffect(() => {
    void enrutarLeadsPorNumero();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaciones, pipelineEtapas]);

  // ===================== 🕐 VENCIDOS: WhatsApp API → WhatsApp Personal =====================
  // Reglas (pedidas por el negocio):
  //   1) Si un chat está en una etapa que responde el WhatsApp API y su ventana
  //      de 24 h ya venció, pasa a la etapa "Vencidos" (la responde el WhatsApp
  //      Personal) para poder continuar la conversación ahí.
  //   2) Si la etapa ya la responde el WhatsApp Personal (evolution) no se toca:
  //      no hay ventana que vencer.
  //   3) Si el cliente vuelve a escribir POR EL WHATSAPP API y la ventana se
  //      reabre, el chat regresa solo a la etapa donde estaba antes de vencer.
  // Corre al abrir el CRM (mueve también el historial ya vencido) y en cada
  // refresco de la bandeja / minuto, así los chats que vencen con la app abierta
  // se traspasan solos. Se puede apagar desde Ajustes → Vencidos.
  const vencidosEnCurso = useRef(false);
  // Si una escritura falla (p. ej. migración pendiente y sin permisos), se
  // espera antes de reintentar para no repetir la misma escritura cada 15 s.
  const vencidosEsperaHasta = useRef(0);
  // Aviso único (consola) cuando falta la migración de la etapa Vencidos.
  const avisoVencidosFalta = useRef(false);

  function esEtapaVencidos(etapa: any): boolean {
    return Boolean(etapa && (String(etapa.clave) === CLAVE_VENCIDOS || esClaveVencidos(etapa.nombre)));
  }

  /**
   * ¿La etapa existe de verdad en `pipeline_etapas`? Las etapas de relleno
   * (`ETAPAS_DEFAULT`, cuando la tabla no las tiene) llevan `id` = su clave, así
   * que solo las de la base traen un UUID. Es importante: si el traspaso moviera
   * un cliente a una etapa que no existe en la base, ese chat desaparecería del
   * pipeline y del listado. Sin la migración 20260919 no se mueve nada.
   */
  function esEtapaReal(etapa: any): boolean {
    return Boolean(
      etapa && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(etapa.id || ""))
    );
  }

  function etapaVencidosDelPipeline(): any | null {
    return pipelineEtapas.find((e: any) => !e.es_spam && !e.es_archivado && esEtapaVencidos(e)) || null;
  }

  /** Etapa válida para regresar al cliente: debe seguir existiendo en el pipeline. */
  function etapaParaRegresar(clave: string | null | undefined): any | null {
    if (!clave) return null;
    const buscada = normalizarEstado(clave);
    const etapa = pipelineEtapas.find((e: any) => normalizarEstado(e.clave) === buscada);
    if (!etapa || etapa.es_spam || etapa.es_archivado || esEtapaVencidos(etapa)) return null;
    // Volver a una etapa que no está en la base dejaría el chat sin columna en el
    // pipeline: mejor dejarlo en Vencidos y que el operador lo mueva a mano.
    return esEtapaReal(etapa) ? etapa : null;
  }

  /**
   * Actualiza clientes en lote. Si la columna nueva (`estado_antes_vencido`) no
   * existe todavía en Supabase, reintenta sin ella para no bloquear el traspaso.
   */
  async function actualizarClientesEnLote(ids: string[], cambios: Record<string, any>): Promise<boolean> {
    if (ids.length === 0) return false;
    try {
      const { error } = await supabase.from("clientes").update(cambios).in("id", ids);
      if (!error) return true;
      if (/estado_antes_vencido/i.test(error.message || "")) {
        const { estado_antes_vencido, ...resto } = cambios;
        const reintento = await supabase.from("clientes").update(resto).in("id", ids);
        if (!reintento.error) return true;
        console.warn("Vencidos: no se pudo actualizar (reintento):", reintento.error.message);
        return false;
      }
      console.warn("Vencidos: no se pudo actualizar:", error.message);
      return false;
    } catch (e) {
      console.warn("Vencidos: error actualizando clientes:", e);
      return false;
    }
  }

  /** Refleja el cambio de etapa en pantalla sin esperar al realtime. */
  function aplicarCambioEtapaLocal(cambios: Array<{ id: string; estado: string; estado_antes_vencido: string | null }>) {
    if (cambios.length === 0) return;
    const porId = new Map(cambios.map((c) => [c.id, c]));
    setTodosClientes((prev) => prev.map((c) => (porId.has(c.id) ? { ...c, ...porId.get(c.id)! } : c)));
    setConversaciones((prev) => prev.map((conv) => {
      const cambio = conv.cliente_id ? porId.get(conv.cliente_id) : undefined;
      return cambio ? { ...conv, clientes: { ...conv.clientes, ...cambio } } : conv;
    }));
    setClienteActual((prev: any) => (prev && porId.get(prev.id) ? { ...prev, ...porId.get(prev.id)! } : prev));
  }

  async function traspasarVencidos() {
    if (vencidosEnCurso.current) return;
    if (Date.now() < vencidosEsperaHasta.current) return;
    if (pipelineEtapas.length === 0 || conversaciones.length === 0) return;
    const destino = etapaVencidosDelPipeline();
    // Sin etapa receptora REAL en la base no se mueve nada: mover a una etapa que
    // no existe haría desaparecer el chat del pipeline. Pasa mientras no se aplique
    // supabase/migrations/20260919_vencidos_a_whatsapp_personal.sql.
    if (!destino || !esEtapaReal(destino)) {
      if (!avisoVencidosFalta.current) {
        avisoVencidosFalta.current = true;
        console.warn(
          "Vencidos: falta la etapa en la base de datos. Aplica " +
            "supabase/migrations/20260919_vencidos_a_whatsapp_personal.sql para activar el traspaso."
        );
      }
      return;
    }

    const ahoraMs = Date.now();
    const aVencidos = new Map<string, any[]>(); // etapa anterior → clientes
    const aRegresar = new Map<string, any[]>(); // etapa destino  → clientes

    for (const conv of conversaciones) {
      const cliente = conv?.clientes;
      if (!cliente) continue;
      if (cliente.es_spam || (conv as any).archivada) continue;

      const claveCliente = normalizarEstado(cliente.estado);
      // Sin fallback: si el estado no corresponde a una etapa real, no se toca.
      const etapaActual = pipelineEtapas.find((e: any) => normalizarEstado(e.clave) === claveCliente);
      if (!etapaActual) continue;

      const decision = decidirTraspasoVencidos({
        etapaActual: { clave: etapaActual.clave, cuenta_responsable: etapaActual.cuenta_responsable },
        ultimoEntranteApi: ultimoEntranteApiDeConversacion(conv),
        // Marca exacta del API (columna de la migración 20260918). Sin ella la
        // fecha es una aproximación y un mensaje del WhatsApp Personal podría
        // devolver el chat a una etapa del API: en ese caso no se regresa.
        apiExacto: Boolean((conv as any).ultimo_entrante_api_en),
        estadoAntesVencido: cliente.estado_antes_vencido,
        ahoraMs,
      });

      if (decision === "mover") {
        const lista = aVencidos.get(claveCliente) || [];
        lista.push(cliente);
        aVencidos.set(claveCliente, lista);
      } else if (decision === "volver") {
        const regreso = etapaParaRegresar(cliente.estado_antes_vencido);
        if (!regreso) continue;
        const lista = aRegresar.get(regreso.clave) || [];
        lista.push(cliente);
        aRegresar.set(regreso.clave, lista);
      }
    }

    if (aVencidos.size === 0 && aRegresar.size === 0) return;

    vencidosEnCurso.current = true;
    const ahoraISO = new Date().toISOString();
    const aplicados: Array<{ id: string; estado: string; estado_antes_vencido: string | null }> = [];
    let huboFallo = false;
    try {
      // Se agrupa por etapa (de destino o de origen) para hacer una sola
      // escritura por grupo y no una por cliente.
      const grupos: Array<{ estado: string; previa: string | null; clientes: any[] }> = [
        ...[...aVencidos.entries()].map(([previa, clientes]) => ({ estado: destino.clave, previa, clientes })),
        ...[...aRegresar.entries()].map(([estado, clientes]) => ({ estado, previa: null as string | null, clientes })),
      ];

      for (const grupo of grupos) {
        for (let i = 0; i < grupo.clientes.length; i += 50) {
          const lote = grupo.clientes.slice(i, i + 50);
          const ids = lote.map((c) => c.id);
          const ok = await actualizarClientesEnLote(ids, {
            estado: grupo.estado,
            estado_antes_vencido: grupo.previa,
            actualizado_en: ahoraISO,
          });
          if (ok) {
            aplicados.push(...lote.map((c) => ({ id: c.id, estado: grupo.estado, estado_antes_vencido: grupo.previa })));
          } else {
            huboFallo = true;
          }
        }
      }

      if (aplicados.length > 0) {
        aplicarCambioEtapaLocal(aplicados);
        const deVuelta = aplicados.filter((c) => c.estado_antes_vencido === null).length;
        const aVencidosTotal = aplicados.length - deVuelta;
        console.log(
          `🕐 Vencidos: ${aVencidosTotal} chat(s) movidos a "${destino.nombre}"` +
          (deVuelta > 0 ? ` y ${deVuelta} devuelto(s) a su etapa del WhatsApp API.` : ".")
        );
        // La conversación de la lista lleva el estado del cliente: refrescar la
        // bandeja deja la subcategoría de cada chat en su sitio.
        void fetchConversaciones(false);
      }
    } finally {
      vencidosEnCurso.current = false;
      if (huboFallo) vencidosEsperaHasta.current = Date.now() + 5 * 60_000;
    }
  }

  useEffect(() => {
    if (!vencidosAuto) return;
    void traspasarVencidos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaciones, pipelineEtapas, nowTick, vencidosAuto]);

  // ===================== META ADS =====================
  async function fetchCampanasAds() {
    setLoadingAds(true);
    setAdsNote("");
    try {
      const res = await fetch("/api/ads/campaigns", { cache: "no-store" });
      const data = await res.json();
      if (data.campaigns) {
        setCampanas(data.campaigns);
        setIsLiveAds(!!data.live);
      }
      if (data.error || data.note) {
        setAdsNote(data.error || data.note);
      }
      const ahora = Date.now();
      ultimaActualizacionAdsRef.current = ahora;
      setUltimaActualizacionAds(ahora);
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

  // Cargar memoria de aprendizaje de Ads (Top 3 mejores y campañas fallidas)
  function cargarMemoriaAds() {
    if (typeof window === "undefined") return;
    try {
      const top = JSON.parse(localStorage.getItem("tm_ads_top_campanas") || "[]");
      const fail = JSON.parse(localStorage.getItem("tm_ads_failed_campanas") || "[]");
      setTopCampanasGuardadas(top);
      setCampanasFallidasGuardadas(fail);
    } catch (e) {
      console.warn("Error leyendo memoria de Ads:", e);
    }
  }

  // Cargar TODOS los videos publicados en la Fan Page de Facebook
  async function fetchVideosFanPage() {
    setLoadingVideos(true);
    try {
      const res = await fetch("/api/ads/videos", { cache: "no-store" });
      const data = await res.json();
      if (data.videos && Array.isArray(data.videos)) {
        setPageVideos(data.videos);
        if (data.videos.length > 0 && !selectedVideoId) {
          setSelectedVideoId(data.videos[0].id);
        }
      }
      setVideosNota([data.pageWarning, data.note].filter(Boolean).join(" "));
      if (data.error) setVideosNota(data.error);
    } catch (err) {
      console.warn("Error cargando videos de Fan Page:", err);
    } finally {
      setLoadingVideos(false);
    }
  }

  // Cargar TODAS las segmentaciones guardadas en la cuenta publicitaria
  async function fetchSegmentaciones() {
    setLoadingSegmentaciones(true);
    setSegmentacionesNota("");
    try {
      const res = await fetch("/api/ads/segmentations", { cache: "no-store" });
      const data = await res.json();
      const lista = Array.isArray(data.segmentations) ? data.segmentations : [];
      setSegmentacionesGuardadas(lista);
      if (data.error || data.note) setSegmentacionesNota(data.error || data.note);
    } catch (err) {
      console.warn("Error cargando segmentaciones:", err);
      setSegmentacionesNota("No se pudieron cargar las segmentaciones guardadas.");
    } finally {
      setLoadingSegmentaciones(false);
    }
  }

  // Al elegir una segmentación guardada, se usa tal cual viene de Meta
  function aplicarSegmentacion(id: string) {
    setSelectedSegmentacionId(id);
    const seg = segmentacionesGuardadas.find((s: any) => String(s.id) === String(id));
    if (!seg) return;
    const normalizada = {
      id: seg.id,
      nombre: seg.nombre,
      origen: seg.origen,
      location: { countries: seg.paises || [], cities: seg.ciudades || [], regions: seg.regiones || [] },
      age_min: seg.edad_min ?? 18,
      age_max: seg.edad_max ?? 65,
      genders: seg.generos || [1, 2],
      interests: seg.intereses || [],
      behaviors: seg.comportamientos || [],
      placements: seg.placements || ["facebook", "instagram"],
      destination: "WHATSAPP_ONLY",
      targeting_raw: seg.targeting_raw || null,
    };
    setSegmentacionGuardada(normalizada);
    try {
      localStorage.setItem("tm_ads_segmentacion", JSON.stringify(normalizada));
    } catch {}
  }

  // Cargar números de WhatsApp vinculados - SOLO WHATSAPP (se muestra EL NÚMERO)
  async function fetchWhatsappNumbers() {
    setLoadingWhatsappNumbers(true);
    try {
      const res = await fetch("/api/ads/whatsapp-numbers", { cache: "no-store" });
      const data = await res.json();
      if (data.numbers && Array.isArray(data.numbers)) {
        setWhatsappNumbers(data.numbers);
        if (data.numbers.length > 0) {
          const sigueValido = data.numbers.some((n: any) => n.id === selectedWhatsappId);
          if (!selectedWhatsappId || !sigueValido) {
            const primero = data.numbers[0];
            setSelectedWhatsappId(primero.id);
            setSelectedWhatsappDisplay(primero.display_number || primero.display_phone_number || "");
          }
        } else {
          setSelectedWhatsappId("");
          setSelectedWhatsappDisplay("");
        }
      }
    } catch (err) {
      console.warn("Error cargando números WhatsApp:", err);
    } finally {
      setLoadingWhatsappNumbers(false);
    }
  }

  // Cargar info cuenta publicitaria: SALDO TOTAL + gasto de hoy
  async function fetchAccountInfo() {
    setLoadingAccount(true);
    try {
      const res = await fetch("/api/ads/account", { cache: "no-store" });
      const data = await res.json();
      if (data.account) {
        setAccountInfo({ ...data.account, billing_url: data.billing_url });
      } else if (data.error) {
        setAccountInfo({ error: data.error, hint: data.hint, debug: data.debug, billing_url: data.billing_url });
      }
    } catch (err) {
      console.warn("Error cargando cuenta:", err);
    } finally {
      setLoadingAccount(false);
    }
  }

  // Videos realmente elegidos (en el orden en que se marcaron), limitados al número de anuncios
  const videosSeleccionadosObj = selectedVideoIds
    .map((id) => pageVideos.find((v: any) => v.id === id))
    .filter(Boolean)
    .slice(0, nuevaCampNumAnuncios);

  // Marcar / desmarcar un video. No deja pasar del número de anuncios pedido.
  function toggleVideoSeleccionado(id: string) {
    setSelectedVideoIds((prev) => {
      if (prev.includes(id)) return prev.filter((v) => v !== id);
      if (prev.length >= nuevaCampNumAnuncios) {
        // Reemplaza el más antiguo para que siempre coincida con la cantidad pedida
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  }

  // Calcular preview completo dinámico - AHORA CON COPY DEL VIDEO O DEL AGENTE
  function calcularPreviewCampana() {
    const presupuestoNum = Number(nuevaCampPresupuesto) || 0;
    if (!presupuestoNum || !nuevaCampFechaInicio) {
      setPreviewCampana(null);
      return;
    }
    try {
      const dias = Math.max(1, nuevaCampDias);
      const fechaInicio = new Date(nuevaCampFechaInicio + "T00:01:00");
      const fechaFin = new Date(fechaInicio);
      fechaFin.setDate(fechaFin.getDate() + dias - 1);
      fechaFin.setHours(23, 59, 59, 999);

      const iva = Math.round(presupuestoNum * 0.19);
      const totalConIva = Math.round(presupuestoNum * 1.19);
      const diario = nuevaCampTipoPresupuesto === "lifetime" ? Math.round(presupuestoNum / dias) : presupuestoNum;

      const legibleInicio = fechaInicio.toLocaleString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/Bogota" });
      const legibleFin = fechaFin.toLocaleString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/Bogota" });

      const waObj = whatsappNumbers.find((w: any) => w.id === selectedWhatsappId);

      // Un anuncio = un VIDEO DIFERENTE de la Fan Page
      const videosElegidos = videosSeleccionadosObj;
      const copyAgenteBase = nuevaCampCopy.trim();
      const copyVideoBase = String((videosElegidos[0] as any)?.copy_original || (videosElegidos[0] as any)?.description || "").trim();

      const anunciosConCopy = Array.from({ length: nuevaCampNumAnuncios }, (_, i) => {
        const vid: any = videosElegidos[i] || null;
        // Solo el COPY ORIGINAL real; el título NO es copy y no debe usarse como tal.
        const descVideo = String(vid?.copy_original || vid?.description || "").trim();
        let copyFinal = "";
        let origen = "";
        if (usarCopyVideo) {
          if (descVideo) {
            // COPY ORIGINAL tal cual está publicado en la fan page
            copyFinal = nuevaCampCopies[i]?.trim() ? `${descVideo}\n\n--- Variación ${i + 1} ---\n${nuevaCampCopies[i]}` : descVideo;
            origen = nuevaCampCopies[i]?.trim() ? "copy original del video + variación" : "copy original del video";
          } else {
            // Sin copy original: se usa lo que escriba el agente. NUNCA se inventa texto.
            copyFinal = nuevaCampCopies[i]?.trim() || copyAgenteBase || "";
            origen = nuevaCampCopies[i]?.trim() ? "agente variación" : (copyAgenteBase ? "agente" : "⚠️ este video no tiene copy — escribe uno");
          }
        } else {
          copyFinal = nuevaCampCopies[i]?.trim() || copyAgenteBase || "";
          origen = nuevaCampCopies[i]?.trim() ? "agente variación" : (copyAgenteBase ? "agente" : "⚠️ falta copy — escribe uno");
        }
        return {
          id: i + 1,
          nombre: `${nuevaCampNombre || "Campaña"} - Anuncio ${i + 1}`,
          cta: "Enviar WhatsApp",
          copy: copyFinal,
          copy_origen: origen,
          copy_preview: copyFinal.substring(0, 120) + (copyFinal.length > 120 ? "..." : ""),
          video: vid,
          video_title: vid?.title || "⚠️ Falta elegir video",
          video_thumb: vid?.picture || null,
        };
      });

      setPreviewCampana({
        nombre: nuevaCampNombre || "Campaña sin nombre",
        presupuesto: presupuestoNum,
        iva,
        totalConIva,
        diario,
        tipo: nuevaCampTipoPresupuesto,
        dias,
        fechaInicio: nuevaCampFechaInicio,
        fechaFin: fechaFin.toISOString().split("T")[0],
        legibleInicio,
        legibleFin,
        horaInicio: "00:01",
        horaFin: "23:59",
        resumenFechas: `${legibleInicio} → ${legibleFin} (${dias} días)`,
        numAnuncios: nuevaCampNumAnuncios,
        anuncios: anunciosConCopy,
        copy_base_video: copyVideoBase,
        copy_base_agente: copyAgenteBase,
        usar_copy_video: usarCopyVideo,
        videos: videosElegidos,
        videosFaltantes: Math.max(0, nuevaCampNumAnuncios - videosElegidos.length),
        whatsapp: waObj || null,
        whatsappNumero: waObj?.display_number || waObj?.display_phone_number || selectedWhatsappDisplay || "",
        segmentacion: segmentacionGuardada,
        segmentacionNombre: segmentacionGuardada?.nombre || "Segmentación por defecto",
        destino: "WHATSAPP_ONLY",
        estado: nuevaCampEstado,
        objetivo: nuevaCampObjetivo,
      });
    } catch (e) {
      console.warn("Error calculando preview:", e);
    }
  }

  // Recalcular preview cuando cambian campos clave
  useEffect(() => {
    if (showCrearCampModal) {
      calcularPreviewCampana();
    }
  }, [nuevaCampNombre, nuevaCampPresupuesto, nuevaCampTipoPresupuesto, nuevaCampDias, nuevaCampFechaInicio, nuevaCampNumAnuncios, selectedVideoIds, selectedWhatsappId, segmentacionGuardada, nuevaCampEstado, nuevaCampObjetivo, showCrearCampModal, pageVideos, whatsappNumbers, nuevaCampCopy, nuevaCampCopies, usarCopyVideo]);

  // Cargar WhatsApp, cuenta, videos y segmentaciones cuando se abre el modal
  useEffect(() => {
    if (showCrearCampModal) {
      fetchWhatsappNumbers();
      fetchAccountInfo();
      fetchSegmentaciones();
      if (pageVideos.length === 0) fetchVideosFanPage();
      if (!nuevaCampFechaInicio) {
        setNuevaCampFechaInicio(new Date().toISOString().split("T")[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCrearCampModal]);

  // Si se sube el número de anuncios, autocompleta con los videos más recientes aún no usados
  useEffect(() => {
    if (!showCrearCampModal || pageVideos.length === 0) return;
    setSelectedVideoIds((prev) => {
      const validos = prev.filter((id) => pageVideos.some((v: any) => v.id === id));
      if (validos.length >= nuevaCampNumAnuncios) return validos.slice(0, nuevaCampNumAnuncios);
      const faltan = nuevaCampNumAnuncios - validos.length;
      const candidatos = pageVideos
        .filter((v: any) => !validos.includes(v.id))
        .slice(0, faltan)
        .map((v: any) => v.id);
      return [...validos, ...candidatos];
    });
  }, [nuevaCampNumAnuncios, pageVideos, showCrearCampModal]);

  // Guardar campaña en el Top 3 de mejores o en lo que no funciona
  function marcarMemoriaAds(campana: any, tipo: "top" | "fail") {
    if (typeof window === "undefined" || !campana) return;
    try {
      if (tipo === "top") {
        let actual = [...topCampanasGuardadas].filter(c => c.id !== campana.id);
        actual.unshift({
          id: campana.id,
          name: campana.name,
          cpl: campana.cpl,
          leads: campana.leads,
          spend: campana.spend,
          dailyBudget: campana.dailyBudget,
          lifetimeBudget: campana.lifetimeBudget,
          fecha: new Date().toLocaleDateString("es-CO")
        });
        actual = actual.slice(0, 3); // Mantener el Top 3
        setTopCampanasGuardadas(actual);
        localStorage.setItem("tm_ads_top_campanas", JSON.stringify(actual));
        alert(`⭐ ¡Campaña "${campana.name}" guardada en el Top 3 de mejores para que el agente aprenda de ella!`);
      } else {
        let actual = [...campanasFallidasGuardadas].filter(c => c.id !== campana.id);
        actual.unshift({
          id: campana.id,
          name: campana.name,
          cpl: campana.cpl,
          spend: campana.spend,
          leads: campana.leads,
          fecha: new Date().toLocaleDateString("es-CO")
        });
        actual = actual.slice(0, 5);
        setCampanasFallidasGuardadas(actual);
        localStorage.setItem("tm_ads_failed_campanas", JSON.stringify(actual));
        alert(`🚫 Campaña "${campana.name}" registrada en la lista de lo que NO funcionó para no repetir sus fallos.`);
      }
    } catch (e) {
      console.error("Error guardando en memoria de Ads:", e);
    }
  }

  function eliminarDeMemoriaAds(id: string, tipo: "top" | "fail") {
    if (tipo === "top") {
      const actual = topCampanasGuardadas.filter(c => c.id !== id);
      setTopCampanasGuardadas(actual);
      localStorage.setItem("tm_ads_top_campanas", JSON.stringify(actual));
    } else {
      const actual = campanasFallidasGuardadas.filter(c => c.id !== id);
      setCampanasFallidasGuardadas(actual);
      localStorage.setItem("tm_ads_failed_campanas", JSON.stringify(actual));
    }
  }

  async function crearNuevaCampanaAds(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevaCampNombre.trim()) {
      alert("Por favor ingresa el nombre de la campaña.");
      return;
    }
    const presupuestoNum = Number(nuevaCampPresupuesto) || 0;
    if (presupuestoNum <= 0) {
      alert("Por favor ingresa un presupuesto válido mayor a 0.");
      return;
    }
    if (!nuevaCampFechaInicio) {
      alert("Por favor selecciona la fecha de inicio de la campaña - ¡Super importante!");
      return;
    }
    // Validar fecha no pasado (permitir hoy)
    const hoyStr = new Date().toISOString().split("T")[0];
    if (nuevaCampFechaInicio < hoyStr) {
      if (!confirm(`La fecha de inicio ${nuevaCampFechaInicio} es anterior a hoy (${hoyStr}). ¿Quieres crear la campaña con esa fecha de todas formas? Se ajustará a hoy.`)) {
        return;
      }
    }

    // Cada anuncio debe llevar un VIDEO DIFERENTE de la Fan Page
    if (videosSeleccionadosObj.length < nuevaCampNumAnuncios) {
      alert(
        `Pediste ${nuevaCampNumAnuncios} anuncios, o sea ${nuevaCampNumAnuncios} videos DIFERENTES, pero solo elegiste ${videosSeleccionadosObj.length}.\n\nSelecciona ${nuevaCampNumAnuncios - videosSeleccionadosObj.length} video(s) más en la lista de la Fan Page.`
      );
      return;
    }

    const waObjSel = whatsappNumbers.find((w: any) => w.id === selectedWhatsappId);
    const numeroWhatsapp = waObjSel?.display_number || waObjSel?.display_phone_number || selectedWhatsappDisplay || "";
    if (!numeroWhatsapp) {
      alert("Selecciona el número de WhatsApp al que deben llegar los mensajes de la campaña.");
      return;
    }

    setGuardandoCampana(true);
    try {
      const waObj = waObjSel;
      const videosElegidos = videosSeleccionadosObj;

      // Copy por anuncio: cada uno usa la descripción de SU propio video
      const adCopiesFinal = Array.from({ length: nuevaCampNumAnuncios }, (_, i) => {
        const vid: any = videosElegidos[i];
        // COPY ORIGINAL del video publicado en la fan page
        const descVideo = String(vid?.copy_original || vid?.description || "").trim();
        const base = usarCopyVideo && descVideo ? descVideo : nuevaCampCopy.trim();
        const variacion = nuevaCampCopies[i]?.trim() || "";
        if (variacion) return base ? `${base}\n\n${variacion}` : variacion;
        return base;
      });

      // Si algún anuncio quedaría sin texto, se avisa en vez de inventar copy
      const sinCopy = adCopiesFinal
        .map((c, i) => (c.trim() ? null : i + 1))
        .filter(Boolean);
      if (sinCopy.length > 0) {
        alert(
          `Los anuncios ${sinCopy.join(", ")} no tienen copy.\n\nEsos videos no traen texto publicado en la fan page, así que escribe un copy en "Copy del Anuncio" o en la variación correspondiente.`
        );
        setGuardandoCampana(false);
        return;
      }

      const copyBase = usarCopyVideo
        ? String((videosElegidos[0] as any)?.copy_original || (videosElegidos[0] as any)?.description || "").trim() || nuevaCampCopy.trim()
        : nuevaCampCopy.trim();

      const payload = {
        name: nuevaCampNombre.trim(),
        budgetType: nuevaCampTipoPresupuesto,
        budgetAmount: presupuestoNum,
        days: nuevaCampDias,
        startDate: nuevaCampFechaInicio,
        startTime: "00:01",
        endTime: "23:59",
        numAds: nuevaCampNumAnuncios,
        objective: nuevaCampObjetivo || "OUTCOME_ENGAGEMENT",
        status: nuevaCampEstado,
        // Videos DIFERENTES: uno por anuncio
        selectedVideos: videosElegidos.map((v: any) => ({
          id: v.id,
          title: v.title,
          description: v.description,
          picture: v.picture,
        })),
        selectedVideoId: (videosElegidos[0] as any)?.id,
        videoTitle: (videosElegidos[0] as any)?.title,
        videoDescription: (videosElegidos[0] as any)?.description,
        whatsappNumberId: selectedWhatsappId || waObj?.id,
        whatsappDisplayNumber: numeroWhatsapp,
        whatsappVerifiedName: waObj?.verified_name || "Templo Místico",
        segmentation: segmentacionGuardada,
        segmentationName: segmentacionGuardada?.nombre,
        pageId: undefined,
        adCopies: adCopiesFinal,
        adCopyBase: copyBase,
        usarCopyVideo: usarCopyVideo,
      };

      console.log("Creando campaña con payload completo:", payload);

      const res = await fetch("/api/ads/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // Mostrar preview aunque falle Meta para que agente vea campaña completa
        if (data.preview) {
          setPreviewCampana(data.preview);
          alert(`⚠️ Vista previa generada aunque Meta falló: ${data.error}\n\nPreview:\n${JSON.stringify(data.preview, null, 2).substring(0, 800)}`);
        } else {
          alert(data.error || "No se pudo crear la campaña en Meta Ads.");
        }
      } else {
        const listaVideos = videosElegidos
          .map((v: any, i: number) => `   ${i + 1}. ${v.title}`)
          .join("\n");
        const erroresAds = Array.isArray(data.ads_errors) && data.ads_errors.length > 0
          ? `\n\n⚠️ Anuncios con problema: ${data.ads_errors.map((e: any) => `#${e.index || "?"} ${e.error}`).join(" | ")}`
          : "";
        const resumen = `¡Campaña "${nuevaCampNombre}" creada con éxito en Meta Ads!\n\n` +
          `📅 Inicio: ${data.legibleInicio || data.preview?.duracion?.legible_inicio}\n` +
          `🏁 Fin: ${data.legibleFin || data.preview?.duracion?.legible_fin}\n` +
          `⏰ Horario: 00:01 a 23:59 (${nuevaCampDias} días)\n` +
          `🎬 ${nuevaCampNumAnuncios} anuncios con ${videosElegidos.length} videos DIFERENTES:\n${listaVideos}\n` +
          `💬 WhatsApp destino: ${numeroWhatsapp}\n` +
          `💰 $${presupuestoNum.toLocaleString("es-CO")} COP + IVA = $${Math.round(presupuestoNum * 1.19).toLocaleString("es-CO")} COP\n` +
          `🎯 Segmentación: ${segmentacionGuardada?.nombre || "Por defecto"}\n` +
          `ID: ${data.id}${erroresAds}`;
        alert(resumen);
        setShowCrearCampModal(false);
        setNuevaCampNombre("");
        setNuevaCampPresupuesto("");
        setNuevaCampEstado("ACTIVE");
        setNuevaCampCopy("");
        setNuevaCampCopies(["", "", "", "", ""]);
        setUsarCopyVideo(true);
        setSelectedVideoIds([]);
        fetchCampanasAds();
        fetchAccountInfo();
      }
    } catch (err: any) {
      console.error("Error creando campaña:", err);
      alert(err.message || "Error al conectar con el servidor.");
    } finally {
      setGuardandoCampana(false);
    }
  }

  function abrirEditarCampana(c: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    setCampanaEditando(c);
    setEditCampNombre(c.name || "");
    const valorPresupuesto = c.lifetimeBudget > 0 ? c.lifetimeBudget : c.dailyBudget;
    setEditCampPresupuesto(String(valorPresupuesto || ""));
    setEditCampTipoPresupuesto(c.lifetimeBudget > 0 ? "lifetime" : "daily");
    setEditCampDias(8);
    setEditCampEstado(c.status === "ACTIVE" ? "ACTIVE" : "PAUSED");
  }

  async function guardarEdicionCampana(e: React.FormEvent) {
    e.preventDefault();
    if (!campanaEditando) return;
    if (!editCampNombre.trim()) {
      alert("El nombre de la campaña no puede estar vacío.");
      return;
    }
    const presupuestoNum = Number(editCampPresupuesto) || 0;
    if (presupuestoNum < 0) {
      alert("El presupuesto no puede ser negativo.");
      return;
    }

    setGuardandoCampana(true);
    // Optimistic update
    setCampanas(prev => prev.map(c => c.id === campanaEditando.id ? {
      ...c,
      name: editCampNombre.trim(),
      ...(editCampTipoPresupuesto === "lifetime" ? { lifetimeBudget: presupuestoNum } : { dailyBudget: presupuestoNum }),
      status: editCampEstado
    } : c));

    try {
      const res = await fetch("/api/ads/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campanaEditando.id,
          name: editCampNombre.trim(),
          budgetType: editCampTipoPresupuesto,
          budgetAmount: presupuestoNum,
          days: editCampDias,
          status: editCampEstado
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || "No se pudo actualizar la campaña.");
        fetchCampanasAds();
      } else {
        alert("¡Campaña y presupuesto actualizados en Meta Ads!");
        setCampanaEditando(null);
        fetchCampanasAds();
      }
    } catch (err: any) {
      console.error("Error actualizando campaña:", err);
      alert(err.message || "Error de conexión al actualizar campaña.");
      fetchCampanasAds();
    } finally {
      setGuardandoCampana(false);
    }
  }

  // Generar propuesta de nueva campaña con IA basada en las mejores y videos de la Fan Page
  async function generarCampanaConIA() {
    setGenerandoEstrategia(true);
    setShowAiModal(true);
    setAiRecommendation(null);
    try {
      const res = await fetch("/api/ads/ai-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_strategy",
          campaigns: campanas,
          topCampaigns: topCampanasGuardadas,
          failedCampaigns: campanasFallidasGuardadas,
          pageVideos: pageVideos
        }),
      });
      const data = await res.json();
      if (data.recommendation) {
        setAiRecommendation(data.recommendation);
      } else {
        setAiRecommendation("Error: " + (data.error || "No se pudo generar la propuesta."));
      }
    } catch (e: any) {
      setAiRecommendation("Error conectando con la IA: " + e.message);
    }
    setGenerandoEstrategia(false);
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

  // El botón está en una conversación, pero la eliminación es del CLIENTE
  // completo. Guardamos ambos ids al abrir el modal para no dejar datos de
  // otras conversaciones del mismo número por fuera.
  function solicitarEliminarCliente(conv: any) {
    if (!conv?.cliente_id) {
      alert("No se pudo identificar el cliente de esta conversación.");
      return;
    }
    setResultadoEliminar(null);
    setBloqueoChatwoot(null);
    setShowDeleteConfirm({ convId: String(conv.id), clienteId: String(conv.cliente_id) });
  }

  function cerrarModalEliminar() {
    setShowDeleteConfirm(null);
    setResultadoEliminar(null);
    setBloqueoChatwoot(null);
  }

  function errorIndicaFuncionNoDisponible(error: any): boolean {
    const mensaje = String(error?.message || error || "").toLowerCase();
    return error?.code === "pgrst202"
      || mensaje.includes("eliminar_cliente_completo")
      || mensaje.includes("could not find the function");
  }

  function errorIndicaTablaNoDisponible(error: any, tabla: string): boolean {
    const mensaje = String(error?.message || error || "").toLowerCase();
    return (error?.code === "pgrst205" || mensaje.includes("does not exist") || mensaje.includes("could not find the table"))
      && mensaje.includes(tabla.toLowerCase());
  }

  // Respaldo para instalaciones que todavía no tienen la migración de la RPC.
  // La RPC es la ruta principal porque ejecuta todo en una sola transacción.
  async function eliminarClientePorTablas(clienteId: string) {
    const { data: convs, error: convsError } = await supabase
      .from("conversaciones")
      .select("id")
      .eq("cliente_id", clienteId);
    if (convsError) throw convsError;

    const convIds = (convs || []).map((conv: any) => conv.id).filter(Boolean);

    // Borrar primero las tablas que pueden impedir borrar conversaciones o el cliente.
    const { error: recordatoriosError } = await supabase
      .from("recordatorios_whatsapp")
      .delete()
      .eq("cliente_id", clienteId);
    if (recordatoriosError && !errorIndicaTablaNoDisponible(recordatoriosError, "recordatorios_whatsapp")) throw recordatoriosError;

    const { error: reglasClienteError } = await supabase
      .from("cerebro_reglas")
      .delete()
      .eq("cliente_id", clienteId);
    if (reglasClienteError && !errorIndicaTablaNoDisponible(reglasClienteError, "cerebro_reglas")) throw reglasClienteError;

    if (convIds.length > 0) {
      const { error: reglasConvError } = await supabase.from("cerebro_reglas").delete().in("conversacion_id", convIds);
      if (reglasConvError && !errorIndicaTablaNoDisponible(reglasConvError, "cerebro_reglas")) throw reglasConvError;

      const { error: mensajesError } = await supabase.from("mensajes").delete().in("conversacion_id", convIds);
      if (mensajesError) throw mensajesError;
    }

    const eliminaciones = await Promise.all([
      supabase.from("tareas").delete().eq("cliente_id", clienteId),
      supabase.from("pagos").delete().eq("cliente_id", clienteId),
      supabase.from("conversaciones").delete().eq("cliente_id", clienteId),
    ]);
    const errorEliminacion = eliminaciones.find((resultado) => resultado.error)?.error;
    if (errorEliminacion) throw errorEliminacion;

    const { error: clienteError } = await supabase.from("clientes").delete().eq("id", clienteId);
    if (clienteError) throw clienteError;
  }

  // Borra al cliente de Supabase sin pasar por el endpoint (respaldo para una
  // APK antigua o una instalación sin el route desplegado).
  async function eliminarSoloSupabase(clienteId: string) {
    const resultado = await supabase.rpc("eliminar_cliente_completo", { p_cliente_id: clienteId });
    if (resultado.error) {
      if (!errorIndicaFuncionNoDisponible(resultado.error)) throw resultado.error;
      // Compatibilidad temporal mientras se aplica la migración en Supabase.
      await eliminarClientePorTablas(clienteId);
    }
  }

  function limpiarEstadoLocalCliente(clienteId: string) {
    setConversaciones(prev => prev.filter(c => c.cliente_id !== clienteId));
    setTodosClientes(prev => prev.filter(c => c.id !== clienteId));
    setTodosPagos(prev => prev.filter(p => p.cliente_id !== clienteId));
    setTodosTareas(prev => prev.filter(t => t.cliente_id !== clienteId));
    if (selectedConv?.cliente_id === clienteId) {
      setSelectedConv(null);
      setClienteActual(null);
      setMensajes([]);
      setPagosCliente([]);
      setTareasCliente([]);
      setContactoGuardado(null);
      setContactoEnTelefono(null);
      setLlamandoWhatsApp(false);
      setShowMobileDetails(false);
      setIsEditingNombre(false);
      setIsEditingNotas(false);
    }

    // El realtime normalmente actualiza estas listas; el refetch también
    // limpia cualquier tarjeta que estuviera abierta en otra pestaña.
    void fetchConversaciones();
    void fetchTodosClientes();
    void fetchTodosPagos();
    void fetchTodasTareas();
  }

  // Elimina TODO: CRM + Supabase + el historial y las fichas de Luna en
  // WhatsApp/Chatwoot. El trabajo pesado lo hace /api/clientes/eliminar porque
  // el token de Chatwoot no puede viajar en el navegador.
  async function eliminarClienteDefinitivo(clienteId: string, soloCrm: boolean = false) {
    if (isDeleting) return;
    setIsDeleting(true);
    setBloqueoChatwoot(null);
    try {
      let respuesta: Response | null = null;
      try {
        respuesta = await fetch("/api/clientes/eliminar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clienteId, soloCrm }),
        });
      } catch (errorRed) {
        console.warn("Endpoint de eliminación no disponible, se borra directo en Supabase:", errorRed);
        respuesta = null;
      }

      const esJson = Boolean(
        respuesta && (respuesta.headers.get("content-type") || "").includes("application/json")
      );

      if (!respuesta || !esJson) {
        // Sin endpoint (APK antigua / export estático): se borra Supabase desde
        // el navegador. La memoria de Luna en WhatsApp queda intacta.
        await eliminarSoloSupabase(clienteId);
        limpiarEstadoLocalCliente(clienteId);
        setResultadoEliminar({
          cliente: "",
          crm: null,
          chatwoot: null,
          advertencias: [
            "Se eliminó del CRM y de Supabase, pero no se pudo borrar el historial ni las fichas de Luna de WhatsApp: esta versión no tiene el endpoint /api/clientes/eliminar.",
          ],
        });
        return;
      }

      const data = await respuesta.json();

      // Chatwoot no dejó borrar la memoria de Luna: no tocamos nada todavía.
      if (respuesta.status === 409 && data?.bloqueo === "chatwoot") {
        setBloqueoChatwoot({ clienteId, detalle: Array.isArray(data.detalle) ? data.detalle : [] });
        return;
      }

      if (!respuesta.ok) throw new Error(data?.error || `Error ${respuesta.status}`);

      limpiarEstadoLocalCliente(clienteId);
      setResultadoEliminar({
        cliente: data.cliente || "",
        crm: data.crm || null,
        chatwoot: data.chatwoot || null,
        advertencias: Array.isArray(data.advertencias) ? data.advertencias : [],
      });
    } catch (e: any) {
      console.error("Error eliminando cliente completo:", e);
      const mensaje = errorIndicaFuncionNoDisponible(e)
        ? "Falta aplicar en Supabase la migración supabase/migrations/20260905_eliminar_cliente_total.sql."
        : (e?.message || "desconocido");
      alert("No se pudo eliminar el cliente completo: " + mensaje);
    } finally {
      setIsDeleting(false);
    }
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
    setContactoGuardado(null);
    setContactoEnTelefono(null);
    setLlamandoWhatsApp(false);
    // Al abrir un chat, mantener la subcategoría si estamos en Por leer, En seguimiento o Archivados
    const esSpamCliente = conv.clientes?.es_spam === true;
    const isArchivada = (conv as any).archivada === true;
    if (chatCategoria !== CATEGORIA_POR_LEER && chatCategoria !== CATEGORIA_EN_SEGUIMIENTO && chatCategoria !== CATEGORIA_ARCHIVADOS) {
      const estCliente = esSpamCliente ? "spam" : normalizarEstado(conv.clientes?.estado);
      setChatCategoria(estCliente);
    }
    // Revisar el chat limpia el contador de mensajes no leídos
    marcarLeido(conv.id);
    setIsEditingNombre(false);
    setIsEditingNotas(false);
    setTempNotas(conv.clientes?.notas_personales || "");
    setTempDetallesCaso(conv.clientes?.detalles_caso || "");
    setShowMobileDetails(false);
    fetchMensajes(conv);
    fetchPagos(conv.cliente_id);
    fetchTareasCliente(conv.cliente_id);
    // Traer el historial fresco directo de Chatwoot para ESTE chat
    if (conv.chatwoot_conversation_id) {
      void sincronizarConChatwoot({ conversacionId: conv.chatwoot_conversation_id, silencioso: true });
    }
  }

  async function fetchMensajes(conv: any) {
    const convId = typeof conv === "string" ? conv : conv?.id;
    const ids = (typeof conv === "object" && conv?.all_conv_ids) ? conv.all_conv_ids : [convId];
    const { data } = await supabase
      .from("mensajes")
      .select("id, conversacion_id, tipo, tipo_contenido, contenido, url_archivo, creado_en, chatwoot_message_id")
      .in("conversacion_id", ids)
      .order("creado_en", { ascending: true });
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
    const ids = selectedConv.all_conv_ids || [selectedConv.id];
    const msgSub = supabase.channel(`r-msg-convs`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes" },
        (payload) => {
          const nuevo = payload.new as any;
          if (!nuevo || !ids.includes(nuevo.conversacion_id)) return;
          setMensajes((prev) => {
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
          });
        }
      ).subscribe();
    return () => { supabase.removeChannel(msgSub); };
  }, [selectedConv]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  async function guardarNuevoNombre() {
    if (!clienteActual) return;
    const nuevoNombre = tempNombre.trim();
    // Vaciar el campo = quitar el nombre manual y volver a mostrar solo el número
    if (!nuevoNombre && !getNombreManual(clienteActual)) { setIsEditingNombre(false); return; }
    const { error } = await supabase
      .from("clientes")
      .update({
        nombre_manual: nuevoNombre || null,
        // Se sincroniza "nombre" por compatibilidad con otras herramientas (Cerebro IA),
        // pero la interfaz SOLO muestra nombre_manual.
        nombre: nuevoNombre || "Sin Nombre",
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", clienteActual.id);
    if (error) {
      console.error("Error guardando nombre:", error);
      const faltaColumna = /nombre_manual/i.test(error.message || "");
      alert(faltaColumna
        ? "Falta aplicar la migración en Supabase: supabase/migrations/20260829_nombre_manual_prioridad_telefono.sql (columna nombre_manual)."
        : "Error guardando nombre: " + (error.message || "desconocido"));
      return;
    }
    setClienteActual({ ...clienteActual, nombre_manual: nuevoNombre || null, nombre: nuevoNombre || "Sin Nombre" });
    setConversaciones(prev => prev.map(c => c.cliente_id === clienteActual.id ? { ...c, clientes: { ...c.clientes, nombre_manual: nuevoNombre || null, nombre: nuevoNombre || "Sin Nombre" } } : c));
    setTodosClientes(prev => prev.map(c => c.id === clienteActual.id ? { ...c, nombre_manual: nuevoNombre || null, nombre: nuevoNombre || "Sin Nombre" } : c));
    setContactoGuardado(null);
    setIsEditingNombre(false);
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
  async function sendToApi(texto: string, fileBase64: string | null = null, fileMime: string | null = null, fileName: string | null = null, fileUrl: string | null = null) {
    if (!selectedConv) return;
    setIsSending(true);
    setSendError("");
    setSendNotice("");

    const etapaActual = getEtapa(clienteActual?.estado);
    const cuentaResponsable = etapaActual?.cuenta_responsable || "meta_business";

    try {
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversacionId: selectedConv.id,
          clienteId: selectedConv.cliente_id || clienteActual?.id,
          numeroWhatsApp: selectedConv.numero_whatsapp,
          cuentaResponsable,
          texto, fileBase64, fileMime, fileName, fileUrl
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || "No se pudo enviar el mensaje.");
      const esNotaDeVoz = Boolean((fileBase64 || fileUrl) && ((fileMime || "").startsWith("audio/") || String(fileName || "").toLowerCase().includes("nota_de_voz")));
      if (esNotaDeVoz && result.voiceNote === false) {
        const motivo = typeof result.audioReason === "string" && result.audioReason.trim()
          ? ` Motivo: ${result.audioReason.trim()}`
          : " Revisa la credencial del canal WhatsApp en Ajustes → Notas de voz, o la versión de Chatwoot (>= 4.15.0).";
        setSendNotice(`La nota se envió, pero llegó como audio simple en vez de nota de voz nativa.${motivo}`);
      }
      if ((selectedConv as any).archivada) {
        archivarConversacion(selectedConv.id, false);
      }

      // Si el cliente estaba en seguimiento, al responder queda marcado como revisado hoy y sale de la subcategoría
      if (clienteActual?.id && clienteActual.en_seguimiento) {
        marcarSeguimientoRevisado(clienteActual.id);
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
    // Si Luna está apagada globalmente, no permitir encenderla individualmente
    if (!lunaGlobalActiva && !selectedConv.agente_activo) {
      alert("Luna está apagada globalmente. Actívala primero con el botón superior.");
      return;
    }
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
    if (est) setSelectedConv(null);
    fetchConversaciones();
  }

  async function actualizarEstadoCliente(clienteId: string, nuevoEstado: string) {
    const estadoNorm = normalizarEstado(nuevoEstado);
    const pasaConsultaHecha = estadoNorm === "consulta_hecha";
    // Memoria de la etapa anterior solo para la etapa Vencidos: permite devolver
    // el chat a su sitio cuando el cliente vuelve a escribir por el WhatsApp API.
    const cliente = todosClientes.find((c) => c.id === clienteId) || clienteActual;
    const estadoPrevio = normalizarEstado(cliente?.estado);
    const memoria = estadoNorm === CLAVE_VENCIDOS
      ? (esClaveVencidos(estadoPrevio) ? cliente?.estado_antes_vencido ?? null : estadoPrevio)
      : null;
    await actualizarClientesEnLote([clienteId], {
      estado: estadoNorm,
      estado_antes_vencido: memoria,
      ...(pasaConsultaHecha ? { atendido: true } : {}),
      actualizado_en: new Date().toISOString(),
    });
    if (clienteActual?.id === clienteId) setClienteActual({
      ...clienteActual,
      estado: estadoNorm,
      estado_antes_vencido: memoria,
      ...(pasaConsultaHecha ? { atendido: true } : {}),
    });
    fetchConversaciones(false); fetchTodosClientes();
  }

  // Menú rápido "Cambiar etapa" que se abre en la barra de escribir
  function renderMenuEtapaRapida(): React.ReactNode {
    const estadoActual = normalizarEstado(clienteActual?.estado);
    const etapas = pipelineEtapas.filter((e: any) => !e.es_spam && !e.es_archivado).sort((a: any, b: any) => a.orden - b.orden);
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setShowEtapaMenu(false)} />
        <div className="absolute bottom-full right-0 mb-2 z-50 w-64 max-h-80 overflow-y-auto bg-surface border border-border rounded-xl shadow-2xl p-1.5">
          <p className="text-[9px] uppercase font-bold text-gray-500 px-2 py-1.5 truncate">
            Cambiar etapa — {getDisplayName(clienteActual, selectedConv)}
          </p>
          <div className="space-y-0.5">
            {etapas.map((etapa: any) => {
              const activa = etapa.clave === estadoActual;
              const esApi = etapa.cuenta_responsable === "meta_business";
              return (
                <button
                  key={etapa.id || etapa.clave}
                  onClick={() => { setShowEtapaMenu(false); if (!activa) actualizarEstadoCliente(clienteActual.id, etapa.clave); }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                    activa ? "bg-purple-950/40 text-purple-300 font-bold" : "text-gray-300 hover:bg-surfaceHover"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className={`w-2 h-2 rounded-full ${etapa.color ? etapa.color.replace("border-", "bg-") : "bg-purple-500"}`} />
                    <span className="truncate">{etapa.nombre}</span>
                    <span className={`text-[9px] px-1 py-0.2 rounded font-normal ${esApi ? "bg-indigo-950 text-indigo-300" : "bg-blue-950 text-blue-300"}`}>
                      {esApi ? "API" : "Personal"}
                    </span>
                  </div>
                  {activa && <Check className="w-3.5 h-3.5 flex-shrink-0 text-purple-400" />}
                </button>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  // ===================== RESPUESTAS RÁPIDAS =====================
  // La biblioteca remota es común para todos los dispositivos. Las respuestas
  // nuevas quedan marcadas como pendientes hasta que se pulsa Sincronizar.
  function abrirMenuRespuestas() {
    setRespuestasRapidas(listarRespuestasRapidas());
    setRrError("");
    setRrNotice("");
    setShowRespuestasMenu(true);
    // Al abrir sólo se descargan cambios: nunca se suben copias antiguas de
    // forma automática, que era lo que podía duplicar audios entre teléfonos.
    void actualizarRespuestasRapidas().then(setRespuestasRapidas);
  }

  async function sincronizarRRManual() {
    if (sincronizandoRR) return;
    setSincronizandoRR(true);
    setRrError("");
    setRrNotice("");
    try {
      const resultado = await sincronizarRespuestasRapidas();
      setRespuestasRapidas(resultado.respuestas);
      if (resultado.error) {
        setRrError(resultado.error);
      } else if (resultado.subidas > 0) {
        setRrNotice(`${resultado.subidas} ${resultado.subidas === 1 ? "respuesta compartida" : "respuestas compartidas"} con todos los dispositivos.`);
      } else {
        setRrNotice("Biblioteca actualizada: todos los dispositivos verán las mismas respuestas.");
      }
    } catch (error: any) {
      setRrError(error?.message || "No se pudo sincronizar la biblioteca.");
    } finally {
      setSincronizandoRR(false);
    }
  }

  async function handleRRFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !rrBorrador) return;
    try {
      if (rrBorrador.tipo === "audio") {
        const { dataUri, titulo, mime } = await prepararAudioRR(file);
        setRrBorrador({ ...rrBorrador, dataUri, nombre: file.name, mime, titulo: rrBorrador.titulo || titulo });
      } else {
        const { dataUri, titulo } = await prepararImagenRR(file);
        setRrBorrador({ ...rrBorrador, dataUri, nombre: file.name, titulo: rrBorrador.titulo || titulo });
      }
      setRrError("");
    } catch (err: any) {
      setRrError(err?.message || "No se pudo leer el archivo.");
    } finally {
      if (rrFileInputRef.current) rrFileInputRef.current.value = "";
    }
  }

  async function guardarNuevaRR() {
    if (!rrBorrador || guardandoRR) return;
    setGuardandoRR(true);
    setRrError("");
    setRrNotice("");
    try {
      let nueva: RespuestaRapida;
      if (rrBorrador.tipo === "texto") {
        const texto = rrBorrador.texto.trim();
        if (!texto) { setRrError("Escribe el texto de la respuesta."); return; }
        nueva = await guardarRespuestaRapida({ tipo: "texto", titulo: rrBorrador.titulo.trim() || texto.slice(0, 40), contenido: texto });
      } else {
        if (!rrBorrador.dataUri) { setRrError("Selecciona el archivo de la respuesta."); return; }
        nueva = await guardarRespuestaRapida({ tipo: rrBorrador.tipo, titulo: rrBorrador.titulo.trim() || rrBorrador.nombre || "respuesta", contenido: rrBorrador.dataUri });
      }
      setRespuestasRapidas(listarRespuestasRapidas());
      setRrNotice(
        nueva.sincronizada === true
          ? "Esta respuesta ya estaba en la biblioteca; no se creó un duplicado."
          : "Guardada en este dispositivo. Pulsa Sincronizar con todos para compartirla."
      );
      setRrBorrador(null);
    } catch (e: any) {
      setRrError(e?.message || "No se pudo guardar la respuesta.");
    } finally {
      setGuardandoRR(false);
    }
  }

  async function borrarRespuestaRapida(id: string) {
    if (!window.confirm("¿Borrar esta respuesta rápida?")) return;
    setRrError("");
    try {
      setRespuestasRapidas(await eliminarRespuestaRapida(id));
      setRrNotice("Respuesta rápida eliminada.");
    } catch (error: any) {
      setRrError(error?.message || "No se pudo borrar la respuesta rápida.");
    }
  }

  // Envía la respuesta seleccionada a la conversación actual (mismo camino
  // que un mensaje normal: texto plano, o archivo vía /api/send-message).
  // Un audio/imagen ya publicado en Storage viaja como URL: el servidor lo
  // descarga y el teléfono no mueve los megabytes del archivo.
  async function enviarRespuestaRapida(rr: RespuestaRapida) {
    if (!selectedConv) return;
    setShowRespuestasMenu(false);
    setRrBorrador(null);
    try {
      if (rr.tipo === "texto") {
        await sendToApi(rr.contenido);
        return;
      }
      const adjunto = adjuntoParaEnviar(rr);
      if (!adjunto) {
        setRrError("Esa respuesta rápida no tiene archivo para enviar.");
        return;
      }
      await sendToApi("", adjunto.fileBase64, adjunto.fileMime, adjunto.fileName, adjunto.fileUrl);
    } catch (e: any) {
      console.error("Error enviando respuesta rápida:", e);
    }
  }

  function renderMenuRespuestasRapidas(): React.ReactNode {
    const pendientesRR = respuestasRapidas.filter((respuesta) => respuesta.sincronizada !== true).length;
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={() => { setShowRespuestasMenu(false); setRrBorrador(null); }} />
        <div className="absolute bottom-full right-0 mb-2 z-50 w-80 max-w-[92vw] bg-surface border border-border rounded-xl shadow-2xl p-2">
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
            <p className="text-[9px] uppercase font-bold text-gray-500">Respuestas rápidas</p>
            <button
              type="button"
              onClick={sincronizarRRManual}
              disabled={sincronizandoRR}
              title="Subir las respuestas pendientes y actualizar la biblioteca compartida"
              className="flex items-center gap-1 rounded-md border border-purple-700/60 px-1.5 py-1 text-[9px] font-bold text-purple-300 hover:bg-purple-950/40 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`w-3 h-3 ${sincronizandoRR ? "animate-spin" : ""}`} />
              <span>{sincronizandoRR ? "Sincronizando..." : pendientesRR > 0 ? `Sincronizar (${pendientesRR})` : "Sincronizar"}</span>
            </button>
          </div>
          {rrNotice && <p className="mx-1.5 mb-1.5 rounded-md bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-300">{rrNotice}</p>}
          {!rrBorrador && rrError && <p className="mx-1.5 mb-1.5 rounded-md bg-red-950/40 px-2 py-1 text-[10px] text-red-300">{rrError}</p>}
          {rrBorrador ? (
            <div className="bg-background border border-border rounded-lg p-2 space-y-2 mb-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-gray-300">Nueva respuesta</p>
                <button type="button" onClick={() => setRrBorrador(null)} className="text-gray-500 hover:text-gray-300"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex gap-1">
                {(["texto", "audio", "imagen"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRrBorrador({ ...rrBorrador, tipo: t, dataUri: "", nombre: "", mime: "" })}
                    className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-bold capitalize ${rrBorrador.tipo === t ? "bg-purple-600 text-white" : "bg-surface text-gray-400 hover:text-gray-200"}`}
                  >
                    {t === "audio" ? <Mic className="w-3 h-3" /> : t === "imagen" ? <ImageIcon className="w-3 h-3" /> : <Type className="w-3 h-3" />} {t}
                  </button>
                ))}
              </div>
              {rrBorrador.tipo === "texto" ? (
                <textarea
                  value={rrBorrador.texto}
                  onChange={(e) => setRrBorrador({ ...rrBorrador, texto: e.target.value })}
                  placeholder="Escribe el texto de la respuesta..."
                  rows={3}
                  className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-none"
                />
              ) : rrBorrador.dataUri ? (
                <div className="space-y-1">
                  {rrBorrador.tipo === "imagen" ? (
                    <img src={rrBorrador.dataUri} alt="" className="max-h-24 rounded-md border border-border" />
                  ) : (
                    <p className="text-[10px] text-emerald-400 flex items-center gap-1"><Mic className="w-3 h-3" /> {rrBorrador.mime || "audio/ogg"} listo</p>
                  )}
                  <button type="button" onClick={() => setRrBorrador({ ...rrBorrador, dataUri: "", nombre: "" })} className="text-[10px] text-gray-500 hover:text-red-400">Quitar archivo</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => rrFileInputRef.current?.click()}
                  className="w-full bg-surface border border-dashed border-border rounded-lg py-2 text-[10px] text-gray-400 hover:text-purple-300"
                >
                  {rrBorrador.tipo === "audio" ? "Seleccionar audio (se guarda en OGG)" : "Seleccionar imagen"}
                </button>
              )}
              <input
                type="text"
                value={rrBorrador.titulo}
                onChange={(e) => setRrBorrador({ ...rrBorrador, titulo: e.target.value })}
                placeholder="Título (para identificarla)"
                className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
              />
              {rrError && <p className="text-[10px] text-red-400">{rrError}</p>}
              <button
                type="button"
                onClick={guardarNuevaRR}
                disabled={guardandoRR}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg py-1.5 text-[11px] font-bold"
              >
                {guardandoRR ? "Guardando..." : "Guardar respuesta"}
              </button>
              <p className="text-[9px] text-gray-600">Se guarda aquí primero; luego pulsa Sincronizar con todos.</p>
            </div>
          ) : (
            <>
              {respuestasRapidas.length === 0 ? (
                <p className="text-[11px] text-gray-600 italic px-1.5 py-2">Aún no hay respuestas guardadas.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {respuestasRapidas.map((rr) => (
                    <div key={rr.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => enviarRespuestaRapida(rr)}
                        className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-gray-300 hover:bg-surfaceHover"
                        title="Enviar a esta conversación"
                      >
                        <span className={rr.tipo === "audio" ? "text-purple-400" : rr.tipo === "imagen" ? "text-emerald-400" : "text-gray-400"}>
                          {rr.tipo === "audio" ? <Mic className="w-3.5 h-3.5" /> : rr.tipo === "imagen" ? <ImageIcon className="w-3.5 h-3.5" /> : <Type className="w-3.5 h-3.5" />}
                        </span>
                        <span className="truncate">{rr.titulo || (rr.tipo === "audio" ? "Nota de voz" : rr.tipo === "imagen" ? "Imagen" : rr.contenido)}</span>
                        {rr.sincronizada !== true && <span className="ml-auto flex-shrink-0 rounded bg-amber-950/70 px-1 py-0.5 text-[8px] font-bold uppercase text-amber-300">Pendiente</span>}
                      </button>
                      <button type="button" onClick={() => borrarRespuestaRapida(rr.id)} className="p-1 text-gray-600 hover:text-red-400 md:opacity-0 md:group-hover:opacity-100 transition-opacity" title="Borrar"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => { setRrBorrador({ tipo: "texto", texto: "", titulo: "", dataUri: "", nombre: "", mime: "" }); setRrError(""); }}
                className="w-full mt-1.5 border border-dashed border-purple-700/50 text-purple-300 hover:bg-purple-950/30 rounded-lg py-1.5 text-[11px] font-bold flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Nueva respuesta rápida
              </button>
            </>
          )}
        </div>
      </>
    );
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
  // Al activar "Cuotas" se prellenan las fechas (una por mes desde la primera).
  function activarCuotas() {
    setTipoPago("cuotas");
    setFechasCuotas((prev) => (prev.length >= 2 ? prev : fechasCuotasPorDefecto(nCuotasLimite(numeroCuotas), fechaInicial)));
  }
  // Cambiar el número de cuotas vuelve a generar las fechas por defecto.
  function cambiarNumeroCuotas(v: string) {
    const n = nCuotasLimite(v);
    setNumeroCuotas(String(n));
    setFechasCuotas(fechasCuotasPorDefecto(n, fechaInicial));
  }
  // Cambiar la primera cuota reorganiza el calendario; después cada cuota
  // puede editarse por separado.
  function cambiarFechaInicialCuotas(v: string) {
    setFechaInicial(v);
    if (tipoPago === "cuotas") setFechasCuotas(fechasCuotasPorDefecto(nCuotasLimite(numeroCuotas), v));
  }
  // Editar la fecha de una cuota individual (índice 0 = primera, gestionada arriba).
  function editarFechaCuota(indice: number, v: string) {
    setFechasCuotas((prev) => prev.map((f, i) => (i === indice ? v : f)));
  }

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
      const n = nCuotasLimite(numeroCuotas);
      const mCuota = t / n;
      const mCuotaConvertida = convertirACOP(mCuota, monedaPago, tasaNum, comisionNum);
      // Cada cuota tiene SU fecha editable (por defecto una por mes desde la
      // primera). Si falta alguna se pide completarla antes de guardar.
      const fechas = [fechaInicial, ...fechasCuotas.slice(1, n)];
      while (fechas.length < n) fechas.push("");
      const faltantes = fechas.map((f, i) => (!f ? i + 1 : null)).filter((x): x is number => x !== null);
      if (faltantes.length > 0) {
        alert(`Faltan las fechas de las cuotas: ${faltantes.join(", ")}.`);
        return;
      }
      for (let i = 0; i < n; i++) {
        arr.push({ 
          cliente_id: clienteActual.id, 
          monto: mCuota,
          monto_original: mCuota,
          monto_convertido_cop: mCuotaConvertida,
          moneda: monedaPago,
          comision_porcentaje: comisionNum,
          tasa_cambio: tasaNum,
          fecha_vencimiento: fechas[i], 
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
      setFechasCuotas([]); 
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

  // Etapas retiradas/eliminadas manualmente del pipeline: se persisten en localStorage
  // para que si fetchPipelineEtapas() o ETAPAS_DEFAULT intentan recrearlas, no vuelvan a aparecer.
  function obtenerEtapasEliminadas(): Set<string> {
    if (typeof window === "undefined") return new Set(ETAPAS_ELIMINADAS);
    try {
      const guardadas = JSON.parse(localStorage.getItem("tm_etapas_eliminadas") || "[]");
      return new Set([...ETAPAS_ELIMINADAS, ...guardadas]);
    } catch {
      return new Set(ETAPAS_ELIMINADAS);
    }
  }

  function registrarEtapaEliminada(clave: string) {
    if (typeof window === "undefined" || !clave) return;
    try {
      const set = obtenerEtapasEliminadas();
      set.add(clave);
      set.add(normalizarEstado(clave));
      localStorage.setItem("tm_etapas_eliminadas", JSON.stringify(Array.from(set)));
    } catch (e) {
      console.error("Error guardando etapa eliminada en localStorage:", e);
    }
  }
  async function agregarEtapaPipeline(cuentaResponsable: "meta_business" | "evolution" = "meta_business") {
    const etapasValidas = pipelineEtapas.filter(e => !e.es_spam && !e.es_archivado);
    const paletaDefault = PALETA_COLORES[etapasValidas.length % PALETA_COLORES.length];
    const nuevaEtapa = {
      clave: `etapa_${Date.now()}`,
      nombre: "Nueva Etapa",
      orden: etapasValidas.length + 1,
      color: paletaDefault.color,
      bg_color: paletaDefault.bg,
      text_color: paletaDefault.text,
      cuenta_responsable: cuentaResponsable,
      grupo: "general",
      es_spam: false,
      es_archivado: false,
    };
    const { data } = await supabase.from("pipeline_etapas").insert([nuevaEtapa]).select();
    if (data) setPipelineEtapas([...pipelineEtapas, data[0]]);
  }

  async function actualizarNombreEtapa(id: string, nuevoNombre: string) {
    setPipelineEtapas(pipelineEtapas.map((e) => (e.id === id ? { ...e, nombre: nuevoNombre } : e)));
    await supabase.from("pipeline_etapas").update({ nombre: nuevoNombre }).eq("id", id);
  }

  async function actualizarCuentaResponsableEtapa(id: string, cuenta: "meta_business" | "evolution") {
    setPipelineEtapas(pipelineEtapas.map((e) => (e.id === id ? { ...e, cuenta_responsable: cuenta } : e)));
    await supabase.from("pipeline_etapas").update({ cuenta_responsable: cuenta }).eq("id", id);
  }

  async function eliminarEtapa(id: string) {
    const etapa = pipelineEtapas.find(e => e.id === id);
    if (!etapa) return;
    if (etapa.clave === "nuevo_lead") {
      alert("No puedes eliminar la etapa inicial Nuevo Lead.");
      return;
    }
    if (esEtapaVencidos(etapa)) {
      alert(
        "No puedes eliminar la etapa Vencidos: ahí llegan automáticamente los chats del WhatsApp API " +
        "cuya ventana de 24 h venció, para continuarlos desde el WhatsApp Personal."
      );
      return;
    }
    if (!confirm(`¿Eliminar la etapa "${etapa.nombre}"? Los clientes en esta etapa pasarán a "Nuevo Lead".`)) return;

    // Registrar en memoria y almacenamiento local para que no vuelva a regenerarse
    registrarEtapaEliminada(etapa.clave);

    // Mover clientes en esa etapa a nuevo_lead
    await supabase.from("clientes").update({ estado: "nuevo_lead" }).eq("estado", etapa.clave);

    // Eliminar de Supabase por id y por clave
    try {
      if (etapa.id && etapa.id !== etapa.clave) {
        await supabase.from("pipeline_etapas").delete().eq("id", etapa.id);
      }
      await supabase.from("pipeline_etapas").delete().eq("clave", etapa.clave);
    } catch (e) {
      console.error("Error al borrar etapa de pipeline_etapas:", e);
    }

    // Reordenar las etapas restantes limpiamente 1, 2, 3...
    const restantes = pipelineEtapas
      .filter((e) => e.id !== id && e.clave !== etapa.clave)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
      .map((e, index) => ({ ...e, orden: index + 1 }));

    setPipelineEtapas(restantes);
    guardarNuevoOrdenPipeline(restantes);

    fetchTodosClientes();
    fetchConversaciones(false);
  }

  // Guarda en lote el orden limpio 1, 2, 3... de todas las etapas
  async function guardarNuevoOrdenPipeline(etapasOrdenadas: any[]) {
    try {
      const updates = etapasOrdenadas
        .filter((e) => e.id && e.id !== e.clave)
        .map((e) =>
          supabase.from("pipeline_etapas").update({ orden: e.orden }).eq("id", e.id)
        );
      await Promise.allSettled(updates);
    } catch (e) {
      console.error("Error persistiendo orden del pipeline:", e);
    }
  }

  async function reordenarEtapa(id: string, nuevoIndice: number) {
    const list = pipelineEtapas
      .filter((e) => !e.es_spam && !e.es_archivado)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

    const currentIndex = list.findIndex((e) => e.id === id);
    if (currentIndex === -1) return;
    const targetIndex = Math.max(0, Math.min(list.length - 1, nuevoIndice));
    if (currentIndex === targetIndex) return;

    const copia = [...list];
    const [movida] = copia.splice(currentIndex, 1);
    copia.splice(targetIndex, 0, movida);

    // Asignar ordenes limpios correlativos 1, 2, 3...
    const reordenadas = copia.map((e, idx) => ({ ...e, orden: idx + 1 }));

    // Integrar con las demás etapas si existieran (spam/archivado)
    const resto = pipelineEtapas.filter((e) => e.es_spam || e.es_archivado);
    const resultadoFinal = [...reordenadas, ...resto];

    setPipelineEtapas(resultadoFinal);
    await guardarNuevoOrdenPipeline(reordenadas);
  }

  async function moverEtapaPipeline(idA: string, idB: string) {
    const list = pipelineEtapas
      .filter((e) => !e.es_spam && !e.es_archivado)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
    const targetIdx = list.findIndex((e) => e.id === idB);
    if (targetIdx !== -1) {
      await reordenarEtapa(idA, targetIdx);
    }
  }

  // Desplazamiento suave y selección de subcategorías
  function selectSubcat(clave: string) {
    setChatCategoria(clave);
    setTimeout(() => {
      if (subcatScrollRef.current) {
        const el = subcatScrollRef.current.querySelector(`[data-cat="${clave}"]`);
        if (el && typeof (el as any).scrollIntoView === "function") {
          (el as any).scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
      }
    }, 50);
  }

  function scrollSubcat(dir: "left" | "right") {
    if (subcatScrollRef.current) {
      const scrollAmount = 220;
      subcatScrollRef.current.scrollBy({
        left: dir === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
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

  // ===================== RENDER Y FILTROS UNIFICADOS =====================
  // Chats con mensajes pendientes por leer (todas las etapas)
  const conversacionesPorLeer = conversaciones.filter((c) => {
    if ((c as any).archivada === true) return false;
    if (c.clientes?.es_spam === true) return false;
    return (c.no_leidos || 0) > 0;
  });
  const totalMensajesPorLeer = conversacionesPorLeer.reduce((s, c) => s + (c.no_leidos || 0), 0);

  // Clientes con check "En seguimiento" activo pendientes de revisar para hoy (corte 8:00 AM)
  const conversacionesEnSeguimiento = conversaciones.filter((c) => {
    if ((c as any).archivada === true || c.clientes?.es_spam === true) return false;
    return estaPendienteSeguimientoHoy(c.clientes);
  });

  // Conversaciones archivadas (subcategoría dentro de Chats)
  const conversacionesArchivadas = conversaciones.filter((c) => {
    const esSpam = c.clientes?.es_spam === true;
    const isArchivada = (c as any).archivada === true;
    if (!isArchivada || esSpam) return false;
    const q = searchChats.toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const tel = getTelefonoE164(c.clientes, c);
    const matchSearch = !searchChats ||
      getDisplayName(c.clientes, c).toLowerCase().includes(q) ||
      tel.includes(searchChats) ||
      (!!qDigits && tel.replace("+", "").includes(qDigits)) ||
      (c.ultimo_mensaje || "").toLowerCase().includes(q);
    return matchSearch;
  });

  // Conversaciones spam
  const conversacionesSpam = conversaciones.filter((c) => {
    return c.clientes?.es_spam === true;
  });

  // Conteo de chats por cada etapa del pipeline unificado
  const conteosPorEtapa = React.useMemo(() => {
    const counts: Record<string, number> = {};
    conversaciones.forEach((c) => {
      if (c.clientes?.es_spam || (c as any).archivada) return;
      const est = normalizarEstado(c.clientes?.estado);
      counts[est] = (counts[est] || 0) + 1;
    });
    return counts;
  }, [conversaciones]);

  const conversacionesFiltradas = conversaciones.filter((c) => {
    const esSpam = c.clientes?.es_spam === true;
    const isArchivada = (c as any).archivada === true;

    // 📬 Por leer
    if (chatCategoria === CATEGORIA_POR_LEER) {
      if (esSpam || isArchivada || !(c.no_leidos > 0)) return false;
    }
    // 🔔 En seguimiento
    else if (chatCategoria === CATEGORIA_EN_SEGUIMIENTO) {
      if (esSpam || isArchivada || !estaPendienteSeguimientoHoy(c.clientes)) return false;
    }
    // 📦 Archivados (subcategoría en vez de pestaña)
    else if (chatCategoria === CATEGORIA_ARCHIVADOS) {
      if (esSpam || !isArchivada) return false;
    }
    // 🚫 Spam
    else if (chatCategoria === "spam") {
      if (!esSpam) return false;
    }
    // Etapas normales del pipeline unificado
    else {
      if (esSpam || isArchivada) return false;
      const estadoCliente = normalizarEstado(c.clientes?.estado);
      if (estadoCliente !== chatCategoria) return false;
    }

    // Búsqueda: nombre manual, número o dígitos
    const q = searchChats.toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const tel = getTelefonoE164(c.clientes, c);
    const matchSearch = !searchChats ||
      getDisplayName(c.clientes, c).toLowerCase().includes(q) ||
      tel.includes(searchChats) ||
      (!!qDigits && tel.replace("+", "").includes(qDigits)) ||
      (chatCategoria === CATEGORIA_ARCHIVADOS && (c.ultimo_mensaje || "").toLowerCase().includes(q));
    return matchSearch;
  });

  // ===== VENTANA DE 24 H DEL CHAT ABIERTO (WhatsApp API) =====
  // Se cuenta desde el último mensaje del CLIENTE (regla de Meta). Se calcula
  // con los mensajes ya cargados del chat —incluye los entrantes que llegan por
  // realtime— y se refresca con el ticker de cada minuto.
  const ultimoEntranteChatAbierto = React.useMemo(() => {
    if (!selectedConv) return null;
    // La marca del API la mantiene la sincronización (sabe el canal real).
    const almacenado = ultimoEntranteApiDeConversacion(selectedConv);
    // En un chat que es solo del WhatsApp API, los mensajes en pantalla son de
    // ese canal, así que sirven para refrescar el contador al instante.
    if (!esChatWhatsAppApi(selectedConv)) return almacenado;
    const ids = new Set<string>(
      ((selectedConv.all_conv_ids || [selectedConv.id]) as any[]).filter(Boolean).map(String)
    );
    const propios = ids.size > 0 ? mensajes.filter((m: any) => ids.has(String(m.conversacion_id))) : mensajes;
    const enVivo = ultimoEntranteDeMensajes(propios);
    if (!enVivo) return almacenado;
    if (!almacenado) return enVivo;
    return Date.parse(enVivo) > Date.parse(almacenado) ? enVivo : almacenado;
  }, [mensajes, selectedConv]);
  const estadoVentanaAbierto = React.useMemo(
    () => calcularVentana(ultimoEntranteChatAbierto, nowTick),
    [ultimoEntranteChatAbierto, nowTick],
  );

  const ahora = new Date(); const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  
  function calcularCOP(pago: any) {
    if (pago.monto_convertido_cop != null) return Number(pago.monto_convertido_cop);
    const moneda = pago.moneda || "COP";
    const comision = pago.comision_porcentaje != null ? Number(pago.comision_porcentaje) : (moneda === "COP" ? 0 : comisionDefault);
    const tasa = pago.tasa_cambio != null ? Number(pago.tasa_cambio) : obtenerTasaPorMoneda(moneda);
    return convertirACOP(Number(pago.monto), moneda, tasa, comision);
  }

  // ===== CARTERA REAL POR COBRAR (control de próximos pagos) =====
  // Cada fila = cliente con al menos un pago pendiente. De aquí salen TODAS las estadísticas.
  const carteraGrupoOk = (cliente: any) => carteraGrupoFiltro === "todas" || getGrupoCliente(cliente) === carteraGrupoFiltro;

  const clientesCartera = todosClientes
    .filter((c) => !c.es_spam && carteraGrupoOk(c))
    .map((cliente) => {
      const pagosCliente = todosPagos.filter((p) => p.cliente_id === cliente.id);
      const pendientes = pagosCliente
        .filter((p) => p.estado === "pendiente")
        .sort((a, b) => new Date(a.fecha_vencimiento).getTime() - new Date(b.fecha_vencimiento).getTime());
      const proximoPago = pendientes[0] || null;
      const diasRest = proximoPago ? diasHasta(proximoPago.fecha_vencimiento) : null;
      const totalServicioCOP = pagosCliente.filter((p) => p.estado !== "cancelado").reduce((s, p) => s + calcularCOP(p), 0);
      const pendienteCOP = pendientes.reduce((s, p) => s + calcularCOP(p), 0);
      const pagadoCOP = pagosCliente.filter((p) => p.estado === "pagado").reduce((s, p) => s + calcularCOP(p), 0);
      return {
        cliente,
        pagos: pagosCliente,
        pendientes,
        proximoPago,
        diasRest,
        vencido: diasRest !== null && diasRest < 0,
        venceHoy: diasRest === 0,
        totalServicioCOP,
        pendienteCOP,
        pagadoCOP,
      };
    })
    .filter((r) => r.pendientes.length > 0) // Solo los que deben = cartera real por cobrar
    .filter((r) => {
      const q = searchCartera.trim().toLowerCase();
      if (!q) return true;
      const nombre = getDisplayName(r.cliente).toLowerCase();
      const tel = getTelefonoE164(r.cliente).replace("+", "");
      const qDigits = q.replace(/\D/g, "");
      return nombre.includes(q) || (!!qDigits && tel.includes(qDigits)) || tel.includes(q);
    })
    .sort((a, b) => {
      // Vencidos primero, luego por próxima fecha de pago (el más urgente arriba)
      if (a.vencido !== b.vencido) return a.vencido ? -1 : 1;
      return (a.diasRest ?? 9999) - (b.diasRest ?? 9999);
    });

  const totalCarteraCOP = clientesCartera.reduce((s, r) => s + r.pendienteCOP, 0);
  const totalVencidoCarteraCOP = clientesCartera.filter((r) => r.vencido).reduce((s, r) => s + r.pendienteCOP, 0);
  const clientesVencidos = clientesCartera.filter((r) => r.vencido);
  const proximos7dias = clientesCartera.filter((r) => !r.vencido && r.diasRest !== null && r.diasRest <= 7);
  const totalProximos7diasCOP = proximos7dias.reduce((s, r) => s + r.pendienteCOP, 0);

  // Rendimiento y finanzas filtrados por el grupo de cartera seleccionado
  const clientesNoSpam = todosClientes.filter((c) => !c.es_spam && carteraGrupoOk(c));
  // "Clientes atendidos" = clientes que PASARON por "Consulta Hecha" alguna vez.
  // El flag atendido se mantiene aunque después salgan del pipeline.
  const totalAtendidos = clientesNoSpam.filter((c) => c.atendido).length;
  // "Convertidos" = de esos atendidos, cuántos pasaron a pago (estado de pago o con pago cobrado)
  const clienteIdsPagados = new Set(todosPagos.filter((p) => p.estado === "pagado").map((p) => p.cliente_id));
  const totalConvertidos = clientesNoSpam.filter((c) => c.atendido && (
    ["trabajo_proceso", "trabajo_completado"].includes(normalizarEstado(c.estado)) ||
    clienteIdsPagados.has(c.id)
  )).length;
  const efectividad = totalAtendidos > 0 ? ((totalConvertidos / totalAtendidos) * 100).toFixed(1) : "0";

  // Calculos de cartera con conversión a COP
  const pagosDelMes = todosPagos.filter((p) => p.estado === "pagado" && p.fecha_pago && new Date(p.fecha_pago) >= inicioMes && carteraGrupoOk(clientePorId(p.cliente_id)));

  const totalCobradoMesCOP = pagosDelMes.reduce((sum, p) => sum + calcularCOP(p), 0);
  const totalCobradoHistoricoCOP = todosPagos.filter((p) => p.estado === "pagado" && carteraGrupoOk(clientePorId(p.cliente_id))).reduce((sum, p) => sum + calcularCOP(p), 0);
  const totalPendienteCOP = totalCarteraCOP;
  const totalVencidoCOP = totalVencidoCarteraCOP;

  // Para compatibilidad, mantener totales antiguos también
  const totalCobradoMes = totalCobradoMesCOP;
  const totalCobradoHistorico = totalCobradoHistoricoCOP;
  const totalPendiente = totalPendienteCOP;
  const totalVencido = totalVencidoCOP;

  const leadsEnConsulta = clientesNoSpam.filter((c) => ["en_consulta", "consulta_hecha"].includes(normalizarEstado(c.estado))).length;
  const leadsNuevos = clientesNoSpam.filter((c) => normalizarEstado(c.estado) === "nuevo_lead" || !c.estado).length;

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
    { id: "pipeline", icon: Users, label: "Pipeline" },
    { id: "tareas", icon: ListTodo, label: "Tareas" },
    { id: "cartera", icon: DollarSign, label: "Cartera" },
    { id: "ads", icon: TrendingUp, label: "Ads" },
    { id: "cerebro", icon: Brain, label: "Cerebro" }
  ];

  const etapasGrupoActual = pipelineEtapas.filter(e => !e.es_spam && !e.es_archivado).sort((a, b) => a.orden - b.orden);
  const etapaSpam = pipelineEtapas.find(e => e.grupo === grupoActivo && e.es_spam);
  const etapaArchivado = pipelineEtapas.find(e => e.grupo === grupoActivo && e.es_archivado);

  // Preview conversión en form
  const previewMonto = parseFloat(montoTotal) || 0;
  const previewComision = parseFloat(comisionPago) || 0;
  const previewTasa = parseFloat(tasaCambioPago) || obtenerTasaPorMoneda(monedaPago);
  const previewConvertido = convertirACOP(previewMonto, monedaPago, previewTasa, previewComision);

  return (
    // w-full + max-w-[100vw] en vez de w-screen: si aparece una barra de scroll
    // vertical, 100vw es más ancho que el área visible y la app "se corría" hacia
    // la derecha, cortando el borde de la ventana del cliente.
    <div className="flex flex-col md:flex-row h-[100dvh] w-full max-w-[100vw] bg-background text-gray-200 overflow-hidden font-sans pt-[var(--safe-area-inset-top)]">
      
      {/* BARRA NAVEGACIÓN */}
      {/* La altura incluye la zona de gestos/navegación de Android para que el
          fondo del CRM llegue hasta el borde inferior de la pantalla. */}
      <aside className="fixed bottom-0 w-full h-[calc(4rem_+_var(--safe-area-inset-bottom))] pb-[var(--safe-area-inset-bottom)] bg-surface border-t border-border flex flex-row items-center justify-around z-40 md:relative md:w-20 md:h-full md:pb-0 md:border-r md:border-t-0 md:flex-col md:py-6 md:justify-between">
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
          <button onClick={() => setShowAjustes(true)}
            className="p-2 md:p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all flex-1 md:flex-none text-gray-500 hover:text-gray-200">
            <Palette className="w-5 h-5" />
            <span className="text-[10px] font-medium">Tema</span>
          </button>
        </nav>
        <div className="hidden md:flex flex-col items-center gap-3">
          <button onClick={() => setShowAdmin(true)} className="text-gray-500 hover:text-purple-300 p-1"><Shield className="w-4 h-4" /></button>
          <div className="flex flex-col items-center gap-1 text-[10px] text-emerald-400">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" /><span>Online</span>
          </div>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL */}
      {/* El margen inferior despeja la barra de navegación, que ahora también
          cubre la zona de gestos de Android (safe-area-inset-bottom). */}
      <main className="flex-1 min-w-0 flex overflow-hidden mb-[calc(4rem_+_var(--safe-area-inset-bottom))] md:mb-0 relative">
        
        {/* ================= CHATS ================= */}
        {tab === "chats" && (
          <>
            <section className={`w-full md:w-80 border-r border-border bg-surface/50 flex-col ${selectedConv ? "hidden md:flex" : "flex"}`}>
              <div className="p-4 border-b border-border flex flex-col gap-3 pt-6 md:pt-4">

                {/* KILL SWITCH GLOBAL LUNA */}
                <button
                  onClick={toggleLunaGlobal}
                  disabled={togglingLunaGlobal}
                  className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-50 ${
                    lunaGlobalActiva
                      ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300 hover:bg-emerald-900/40"
                      : "bg-red-950/40 border-red-700 text-red-300 hover:bg-red-900/50 animate-pulse"
                  }`}
                >
                  <Power className={`w-4 h-4 ${togglingLunaGlobal ? "animate-spin" : ""}`} />
                  {togglingLunaGlobal ? "Cambiando..." : lunaGlobalActiva ? "🌙 Luna Encendida (Click para Apagarla TODO)" : "⚠️ Luna APAGADA Globalmente (Click para Encender)"}
                </button>

                <div className="flex items-center justify-between">
                  <h1 className="text-lg font-bold text-gray-100">Bandeja</h1>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 font-medium">
                      {conversacionesFiltradas.length}
                    </span>
                    <button className="md:hidden text-gray-500" onClick={() => setShowAdmin(true)}><Shield className="w-4 h-4" /></button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input 
                      value={searchChats} 
                      onChange={e => setSearchChats(e.target.value)}
                      placeholder="Buscar por nombre o número..." 
                      className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    />
                    {searchChats && (
                      <button onClick={() => setSearchChats("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {/* 🔄 Sincronizar directo con Chatwoot (repara Supabase aunque n8n esté caído) */}
                  <button
                    onClick={() => sincronizarConChatwoot({})}
                    disabled={sincronizandoCW}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-border text-gray-400 hover:text-purple-400 hover:border-purple-500/40 hover:bg-surfaceHover transition-colors disabled:opacity-50"
                    title="Sincronizar chats con Chatwoot ahora (trae los mensajes que falten)"
                  >
                    <RefreshCw className={`w-4 h-4 ${sincronizandoCW ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline text-[10px] font-medium">{sincronizandoCW ? "Sincronizando..." : "Chatwoot"}</span>
                  </button>
                </div>

                {/* SUBPESTAÑAS DE CATEGORÍA UNIFICADAS (CARRUSEL FLUIDO) */}
                {tab === "chats" && (
                  <div className="relative flex items-center group">
                    <button
                      type="button"
                      onClick={() => scrollSubcat("left")}
                      className="hidden sm:flex items-center justify-center w-6 h-6 rounded-full bg-surface border border-border text-gray-400 hover:text-white hover:bg-surfaceHover shadow-md mr-1 flex-shrink-0"
                      title="Desplazar subcategorías a la izquierda"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    <div
                      ref={subcatScrollRef}
                      className="flex-1 flex gap-1.5 overflow-x-auto scroll-smooth py-1 px-0.5 no-scrollbar select-none"
                      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                    >
                      {/* Subcategorías en el MISMO ORDEN del pipeline, con las pestañas
                          "Por leer" y "En seguimiento" fijas en la posición 2 y 3. */}
                      {(() => {
                        const etapasOrdenadas = pipelineEtapas
                          .filter((e: any) => !e.es_spam && !e.es_archivado)
                          .sort((a: any, b: any) => (Number(a.orden) || 0) - (Number(b.orden) || 0));

                        const btnPorLeer = (
                          <button
                            key="subcat-por-leer"
                            data-cat={CATEGORIA_POR_LEER}
                            onClick={() => selectSubcat(CATEGORIA_POR_LEER)}
                            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                              chatCategoria === CATEGORIA_POR_LEER
                                ? "bg-red-600 text-white border-red-500 shadow-md shadow-red-900/30 ring-2 ring-red-500/30"
                                : "bg-red-950/20 border-red-900/40 text-red-300 hover:text-red-200 hover:border-red-600/50 hover:bg-red-950/40"
                            }`}
                            title={`Chats con mensajes pendientes por leer (${conversacionesPorLeer.length})`}
                          >
                            <MailOpen className="w-3.5 h-3.5" />
                            <span>Por leer</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                              chatCategoria === CATEGORIA_POR_LEER ? "bg-white/20 text-white" : "bg-red-900/50 text-red-200"
                            }`}>
                              {conversacionesPorLeer.length}
                            </span>
                          </button>
                        );

                        const btnSeguimiento = (
                          <button
                            key="subcat-en-seguimiento"
                            data-cat={CATEGORIA_EN_SEGUIMIENTO}
                            onClick={() => selectSubcat(CATEGORIA_EN_SEGUIMIENTO)}
                            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                              chatCategoria === CATEGORIA_EN_SEGUIMIENTO
                                ? "bg-cyan-600 text-white border-cyan-500 shadow-md shadow-cyan-900/30 ring-2 ring-cyan-500/30"
                                : "bg-cyan-950/20 border-cyan-900/40 text-cyan-300 hover:text-cyan-200 hover:border-cyan-600/50 hover:bg-cyan-950/40"
                            }`}
                            title={`Clientes en seguimiento diario pendientes para hoy (${conversacionesEnSeguimiento.length}). Se renueva cada día a las 8:00 AM.`}
                          >
                            <BellRing className="w-3.5 h-3.5" />
                            <span>En seguimiento</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                              chatCategoria === CATEGORIA_EN_SEGUIMIENTO ? "bg-white/20 text-white" : "bg-cyan-900/50 text-cyan-200"
                            }`}>
                              {conversacionesEnSeguimiento.length}
                            </span>
                          </button>
                        );

                        const btnEtapa = (etapa: any) => {
                          const activa = chatCategoria === etapa.clave;
                          const conteo = conteosPorEtapa[etapa.clave] || 0;
                          const esApi = etapa.cuenta_responsable === "meta_business";
                          return (
                            <button
                              key={etapa.id || etapa.clave}
                              data-cat={etapa.clave}
                              onClick={() => selectSubcat(etapa.clave)}
                              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                                activa
                                  ? "bg-purple-600 text-white border-purple-500 shadow-md shadow-purple-900/30 ring-2 ring-purple-500/30"
                                  : "bg-surface border-border text-gray-400 hover:text-gray-200 hover:border-purple-500/40 hover:bg-surfaceHover"
                              }`}
                              title={`Etapa "${etapa.nombre}" • Cuenta: ${esApi ? "WhatsApp API" : "WhatsApp Personal"}`}
                            >
                              <span className="text-[10px]">{esApi ? "🌐" : "👤"}</span>
                              <span>{etapa.nombre}</span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                activa ? "bg-white/20 text-white" : "bg-background text-gray-400"
                              }`}>
                                {conteo}
                              </span>
                            </button>
                          );
                        };

                        // Orden: etapa 1, Por leer, En seguimiento, etapa 2, etapa 3, ...
                        const items: React.ReactNode[] = [];
                        etapasOrdenadas.forEach((etapa: any, idx: number) => {
                          items.push(btnEtapa(etapa));
                          if (idx === 0) {
                            items.push(btnPorLeer);
                            items.push(btnSeguimiento);
                          }
                        });
                        if (etapasOrdenadas.length === 0) {
                          items.push(btnPorLeer, btnSeguimiento);
                        }
                        return items;
                      })()}

                      {/* 4. Spam */}
                      <button
                        data-cat="spam"
                        onClick={() => selectSubcat("spam")}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                          chatCategoria === "spam"
                            ? "bg-gray-200 text-gray-900 border-gray-100 shadow-md ring-2 ring-gray-400/30"
                            : "bg-surface border-border text-gray-400 hover:text-gray-200 hover:border-gray-600 hover:bg-surfaceHover"
                        }`}
                        title={`Chats marcados como spam (${conversacionesSpam.length})`}
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Spam</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          chatCategoria === "spam" ? "bg-gray-800 text-white" : "bg-background text-gray-400"
                        }`}>
                          {conversacionesSpam.length}
                        </span>
                      </button>

                      {/* 5. Archivados (subcategoría en vez de pestaña completa) */}
                      <button
                        data-cat={CATEGORIA_ARCHIVADOS}
                        onClick={() => selectSubcat(CATEGORIA_ARCHIVADOS)}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                          chatCategoria === CATEGORIA_ARCHIVADOS
                            ? "bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-900/30 ring-2 ring-amber-500/30"
                            : "bg-amber-950/20 border-amber-900/40 text-amber-300 hover:text-amber-200 hover:border-amber-600/50 hover:bg-amber-950/40"
                        }`}
                        title={`Conversaciones archivadas (${conversacionesArchivadas.length})`}
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archivados</span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          chatCategoria === CATEGORIA_ARCHIVADOS ? "bg-white/20 text-white" : "bg-amber-900/50 text-amber-200"
                        }`}>
                          {conversacionesArchivadas.length}
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => scrollSubcat("right")}
                      className="hidden sm:flex items-center justify-center w-6 h-6 rounded-full bg-surface border border-border text-gray-400 hover:text-white hover:bg-surfaceHover shadow-md ml-1 flex-shrink-0"
                      title="Desplazar subcategorías a la derecha"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {tab === "chats" && (
                  <button onClick={autoArchivarInactivos} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-amber-950/30 border border-amber-900/50 text-amber-400 hover:bg-amber-900/30 text-xs font-medium transition-colors">
                    <Archive className="w-3.5 h-3.5" /> Archivar inactivos (+7 días)
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border/50">
                {loadingChats ? <div className="p-6 text-center text-sm text-gray-500">Cargando...</div>
                  : conversacionesFiltradas.length === 0
                  ? <div className="p-6 text-center text-sm text-gray-500">
                      {chatCategoria === CATEGORIA_POR_LEER ? "No hay chats pendientes por leer 🎉"
                        : chatCategoria === CATEGORIA_EN_SEGUIMIENTO ? "No hay clientes en seguimiento pendientes para hoy 🎉"
                        : chatCategoria === CATEGORIA_ARCHIVADOS ? "No hay conversaciones archivadas 📦"
                        : chatCategoria === "spam" ? "No hay chats marcados como spam 🛡️"
                        : "Bandeja vacía"}
                    </div>
                  : conversacionesFiltradas.map((conv) => {
                    const cliente = conv.clientes;
                    const displayName = getDisplayName(cliente, conv);
                    const tieneNotas = cliente?.notas_personales || cliente?.detalles_caso;
                    const esSpamChat = cliente?.es_spam === true;
                    const isArchivada = (conv as any).archivada === true;
                    const etapaCliente = getEtapa(cliente?.estado);
                    const etapaColor = esSpamChat ? "border-gray-500" : isArchivada ? "border-amber-700" : (etapaCliente?.color || "border-transparent");
                    const etapaBg = esSpamChat ? "bg-gray-500/15" : isArchivada ? "bg-amber-950/20" : (etapaCliente?.bg_color || "");
                    const etapaText = esSpamChat ? "text-gray-300" : isArchivada ? "text-amber-300" : (etapaCliente?.text_color || "text-gray-400");
                    const esApi = etapaCliente?.cuenta_responsable === "meta_business";
                    const diasArchivado = conv.fecha_archivado ? Math.floor((Date.now() - new Date(conv.fecha_archivado).getTime()) / (1000*60*60*24)) : Math.floor((Date.now() - new Date(conv.ultimo_mensaje_en).getTime()) / (1000*60*60*24));

                    return (
                      <div key={conv.id} className={`group relative w-full flex items-start gap-3 text-left hover:bg-surfaceHover transition-colors ${selectedConv?.id === conv.id ? `bg-surfaceHover border-l-4 ${etapaColor}` : `border-l-4 ${etapaColor} ${etapaBg}`}`}>
                        <button onClick={() => selectConversation(conv)} className="flex-1 p-4 flex items-start gap-3 text-left">
                          <div className="relative flex-shrink-0">
                            <div className={`w-12 h-12 rounded-full bg-surface border ${etapaColor} flex items-center justify-center ${etapaText} font-bold overflow-hidden ${isArchivada ? "opacity-80" : ""}`}>
                              {cliente?.foto_url
                                ? <img src={cliente.foto_url} alt="" className={`w-full h-full object-cover ${isArchivada ? "grayscale" : ""}`} />
                                : displayName.startsWith("+")
                                  ? <Phone className="w-5 h-5" />
                                  : <span>{displayName.charAt(0).toUpperCase()}</span>}
                            </div>
                            {conv.agente_activo && !cliente?.es_spam && lunaGlobalActiva && !isArchivada && <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-purple-600 border-2 border-surface flex items-center justify-center"><Bot className="w-2.5 h-2.5 text-white" /></span>}
                            {!lunaGlobalActiva && !cliente?.es_spam && !isArchivada && <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-red-800 border-2 border-surface flex items-center justify-center" title="Luna apagada globalmente"><Power className="w-2 h-2 text-red-200" /></span>}
                            {isArchivada && <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-amber-900 border-2 border-surface flex items-center justify-center"><Archive className="w-2.5 h-2.5 text-amber-300" /></span>}
                            {tieneNotas && <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-amber-600 border-2 border-surface flex items-center justify-center"><StickyNote className="w-2.5 h-2.5 text-white" /></span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between mb-1 gap-2">
                              <h2 className={`text-sm font-semibold truncate flex items-center gap-1 ${etapaText} ${displayName.startsWith("+") ? "font-mono tracking-tight" : ""}`}>
                                {displayName}
                                {cliente?.en_seguimiento && (
                                  <span title={estaPendienteSeguimientoHoy(cliente) ? "En seguimiento (pendiente hoy)" : "En seguimiento (revisado)"}>
                                    <BellRing className={`w-3 h-3 ${estaPendienteSeguimientoHoy(cliente) ? "text-cyan-400 animate-pulse" : "text-gray-500"}`} />
                                  </span>
                                )}
                                {tieneNotas && <StickyNote className="w-3 h-3 text-amber-400" />}
                              </h2>
                              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <span className="text-[10px] text-gray-500">
                                  {isArchivada ? `${diasArchivado}d` : new Date(conv.ultimo_mensaje_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                                {/* Ventana de 24 h: en los chats con conversación del WhatsApp API
                                    (incluidos los unificados con Personal). WhatsApp Personal puro no
                                    tiene esa regla, así que ahí no aparece nada. */}
                                {!isArchivada && tieneChatApi(conv) && (
                                  <VentanaWhatsApp
                                    estado={calcularVentana(ultimoEntranteApiDeConversacion(conv), nowTick)}
                                    variante="lista"
                                  />
                                )}
                                {conv.no_leidos > 0 && !isArchivada && (
                                  <span className="bg-red-600 text-white text-[9px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-bold" title={`${conv.no_leidos} mensaje(s) sin revisar`}>
                                    {conv.no_leidos > 99 ? "99+" : conv.no_leidos}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 mb-1 flex-wrap">
                              {isArchivada ? (
                                <span className="text-[9px] px-1.5 py-0 rounded bg-amber-900/50 text-amber-300 border border-amber-800/50">
                                  ARCHIVADO
                                </span>
                              ) : etapaCliente && !cliente?.es_spam ? (
                                <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0 rounded ${etapaBg} ${etapaText} border ${etapaColor}`}>
                                  <span>{esApi ? "🌐" : "👤"}</span>
                                  <span>{etapaCliente.nombre}</span>
                                </span>
                              ) : null}
                              {chatCategoria === CATEGORIA_EN_SEGUIMIENTO && estaPendienteSeguimientoHoy(cliente) && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); marcarSeguimientoRevisado(conv.cliente_id); }}
                                  className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 hover:bg-cyan-900 transition-colors flex items-center gap-1 font-semibold"
                                  title="Marcar revisado por hoy (sale de la lista hasta mañana 8:00 AM)"
                                >
                                  <Check className="w-2.5 h-2.5" /> Revisado
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate flex items-center gap-1">
                              {(conv.ultimo_mensaje === "[audio]" || conv.ultimo_mensaje === "[nota_de_voz]" || (conv.ultimo_mensaje && /\[audio\]|nota_de_voz|Nota de voz/i.test(conv.ultimo_mensaje)))
                                ? (<><Mic className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" /><span>Nota de voz</span></>)
                                : (conv.ultimo_mensaje || "Sin mensajes")}
                            </p>
                          </div>
                        </button>
                        <div className="absolute right-2 top-2 hidden group-hover:flex items-center gap-1 bg-surface border border-border rounded-lg p-1 shadow-lg">
                          {isArchivada ? (
                            <button onClick={(e) => { e.stopPropagation(); archivarConversacion(conv.id, false); }} className="p-1.5 text-emerald-400 hover:bg-emerald-950/50 rounded-md transition-colors" title="Restaurar a bandeja"><ArchiveRestore className="w-3.5 h-3.5" /></button>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); archivarConversacion(conv.id, true); }} className="p-1.5 text-amber-400 hover:bg-amber-950/50 rounded-md transition-colors" title="Archivar"><Archive className="w-3.5 h-3.5" /></button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); solicitarEliminarCliente(conv); }} className="p-1.5 text-red-400 hover:bg-red-950/50 rounded-md transition-colors" title="Eliminar cliente"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            </section>

            {selectedConv && clienteActual ? (
              /* min-w-0: permite que la columna del chat encoja cuando la ficha del
                    cliente está abierta; sin esto el ancho mínimo del compositor
                    empujaba la ventana del cliente fuera de la pantalla. */
                <div className="flex-1 min-w-0 flex w-full h-full absolute inset-0 md:relative bg-background z-20">
                {/* El chat solo se oculta (para dejar ver la ficha) por debajo de
                    xl; de md a xl la ficha se abre como panel superpuesto. */}
                <section className={`flex-1 flex flex-col h-full min-h-0 min-w-0 overflow-hidden ${showMobileDetails ? "hidden xl:flex" : "flex"}`}>
                  {/* Cabecera flexible: si la columna del chat queda estrecha, los
                      botones de acción bajan a una segunda fila en vez de salirse
                      de la pantalla (antes quedaban cortados por overflow-hidden). */}
                  <header className="min-h-[4rem] px-3 md:px-6 py-2 md:py-0 border-b border-border bg-surface/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-x-2 gap-y-2 flex-shrink-0">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button onClick={() => setSelectedConv(null)} className="md:hidden p-2 -ml-2 text-gray-400 hover:text-white flex-shrink-0"><ArrowLeft className="w-5 h-5" /></button>
                      <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-purple-400 font-bold overflow-hidden flex-shrink-0">
                        {clienteActual.foto_url
                          ? <img src={clienteActual.foto_url} className="w-full h-full object-cover" alt="" />
                          : getNombreManual(clienteActual)
                            ? <span>{getNombreManual(clienteActual).charAt(0).toUpperCase()}</span>
                            : <Phone className="w-4 h-4 text-purple-400" />}
                      </div>
                      <div className="flex flex-col cursor-pointer min-w-0" onClick={() => setShowMobileDetails(true)}>
                        <h2 className={`text-sm font-bold text-gray-100 flex items-center gap-1 min-w-0 ${getDisplayName(clienteActual, selectedConv).startsWith("+") ? "font-mono" : ""}`}>
                          <span className="truncate" title={getDisplayName(clienteActual, selectedConv)}>{getDisplayName(clienteActual, selectedConv)}</span>
                          {clienteActual.notas_personales && <StickyNote className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                        </h2>
                        <span className="text-[10px] text-gray-400 flex items-center gap-1 font-mono min-w-0">
                          <Phone className="w-3 h-3 flex-shrink-0" /><span className="truncate">{getTelefonoE164(clienteActual, selectedConv) || "Sin número"}</span>
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 md:gap-2 min-w-0">
                      {!clienteActual.es_spam && esConversacionWhatsAppPersonal(selectedConv) && (
                        <button
                          onClick={llamarPorWhatsAppPersonal}
                          disabled={!llamadasPersonalDisponibles || contactoEnTelefono !== true || llamandoWhatsApp}
                          title={
                            !llamadasPersonalDisponibles
                              ? "Disponible desde la APK Android actualizada"
                              : contactoEnTelefono === null
                                ? "Verificando que el número esté guardado en el teléfono..."
                                : contactoEnTelefono === false
                                  ? "Guarda el contacto en el teléfono antes de llamar"
                                  : "Intentar llamada de voz con WhatsApp Personal"
                          }
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50 ${
                            contactoEnTelefono === true && llamadasPersonalDisponibles
                              ? "bg-emerald-950/40 border-emerald-700 text-emerald-300 hover:bg-emerald-900/60"
                              : "bg-surfaceHover border-border text-gray-500"
                          }`}
                        >
                          <PhoneCall className={`w-3.5 h-3.5 ${llamandoWhatsApp ? "animate-pulse" : ""}`} />
                          <span className="hidden xl:inline">{llamandoWhatsApp ? "Abriendo..." : contactoEnTelefono === null ? "Verificando..." : contactoEnTelefono ? "Llamar" : "Guardar contacto"}</span>
                        </button>
                      )}
                      {!clienteActual.es_spam && (!lunaGlobalActiva ? (
                        <button onClick={toggleLunaGlobal} className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all bg-red-950/40 border-red-700 text-red-300 animate-pulse">
                          <Power className="w-3.5 h-3.5" /><span>Luna APAGADA</span>
                        </button>
                      ) : (
                        <button onClick={toggleAgenteIA} title={selectedConv.agente_activo ? "Luna respondiendo en este chat (clic para pausarla)" : "Luna pausada en este chat (clic para activarla)"} className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${selectedConv.agente_activo ? "bg-purple-950/50 border-purple-700 text-purple-300" : "bg-surfaceHover border-border text-gray-400"}`}>
                          <Bot className="w-3.5 h-3.5" /><span className="hidden xl:inline">{selectedConv.agente_activo ? "Luna: ON" : "Pausada"}</span>
                        </button>
                      ))}

                      {/* Cuenta encargada activa */}
                      {(() => {
                        const et = getEtapa(clienteActual?.estado);
                        const esApi = et?.cuenta_responsable === "meta_business";
                        return (
                          <span
                            className={`hidden md:flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border ${
                              esApi ? "bg-indigo-950/40 border-indigo-700/50 text-indigo-300" : "bg-blue-950/40 border-blue-700/50 text-blue-300"
                            }`}
                            title={`Cuenta responsable de esta etapa: ${esApi ? "WhatsApp API" : "WhatsApp Personal"}`}
                          >
                            <span>{esApi ? "🌐 API" : "👤 Personal"}</span>
                          </span>
                        );
                      })()}

                      {/* Ventana de 24 h de WhatsApp API: tiempo restante desde el último mensaje del cliente */}
                      {tieneChatApi(selectedConv) && (
                        <span className="hidden md:flex">
                          <VentanaWhatsApp estado={estadoVentanaAbierto} variante="cabecera" />
                        </span>
                      )}

                      {/* Check rápido de En seguimiento */}
                      <button
                        type="button"
                        onClick={() => toggleEnSeguimientoCliente(clienteActual.id)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-all ${
                          clienteActual?.en_seguimiento
                            ? "bg-cyan-950/50 border-cyan-500 text-cyan-300 shadow-sm"
                            : "bg-surfaceHover border-border text-gray-400 hover:text-gray-200"
                        }`}
                        title={clienteActual?.en_seguimiento ? "En seguimiento diario activo (clic para quitar check)" : "Activar en seguimiento diario (8:00 AM)"}
                      >
                        <BellRing className={`w-3.5 h-3.5 ${clienteActual?.en_seguimiento ? "text-cyan-400" : ""}`} />
                        <span className="hidden 2xl:inline">Seguimiento</span>
                      </button>

                      {clienteActual?.en_seguimiento && estaPendienteSeguimientoHoy(clienteActual) && (
                        <button
                          type="button"
                          onClick={() => marcarSeguimientoRevisado(clienteActual.id)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow transition-all"
                          title="Marcar revisado por hoy (sale de la lista de En seguimiento hasta mañana 8:00 AM)"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span className="hidden 2xl:inline">Revisado hoy</span>
                        </button>
                      )}

                      {Boolean((selectedConv as any).archivada) ? (
                        <button
                          onClick={() => archivarConversacion(selectedConv.id, false)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-900/40 border border-emerald-700 text-emerald-300 hover:bg-emerald-800/50 transition-colors"
                          title="Restaurar chat a la bandeja"
                        >
                          <ArchiveRestore className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Restaurar</span>
                        </button>
                      ) : (
                        <button onClick={() => archivarConversacion(selectedConv.id, true)} className="p-2 text-amber-400 hover:bg-amber-950/30 rounded-lg border border-amber-900/30 transition-colors" title="Archivar"><Archive className="w-4 h-4" /></button>
                      )}

                      <button onClick={() => solicitarEliminarCliente(selectedConv)} className="p-2 text-red-400 hover:bg-red-950/30 rounded-lg border border-red-900/30 transition-colors" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                      {/* Desde xl la ficha ya está fija a la derecha: el botón ℹ️
                          solo hace falta cuando el panel se abre superpuesto. */}
                      <button onClick={() => setShowMobileDetails(true)} className="xl:hidden p-2 text-gray-400" title="Ver ficha del cliente"><Info className="w-5 h-5" /></button>
                    </div>
                  </header>

                  <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 space-y-4">
                    {Boolean((selectedConv as any).archivada) && (
                      <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-3 flex items-center justify-between gap-2 text-xs text-amber-200/80 mb-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <span>Esta conversación está archivada. Si respondes se restaurará automáticamente, o puedes pulsar Restaurar.</span>
                        </div>
                        <button
                          onClick={() => archivarConversacion(selectedConv.id, false)}
                          className="px-2.5 py-1 rounded-lg bg-amber-900/50 border border-amber-700 text-amber-300 hover:bg-amber-800/60 font-semibold text-xs transition-colors flex-shrink-0"
                        >
                          Restaurar
                        </button>
                      </div>
                    )}
                    {mensajes.map((msg, idxMsg) => {
                      const isMe = msg.tipo === "enviado";
                      const isAudioMsg = isAudioMessage(msg);
                      const isImgMsg = isImageMessage(msg);
                      const isVidMsg = isVideoMessage(msg);
                      const isDocMsg = isFileMessage(msg);
                      const slug = slugFoto(getDisplayName(clienteActual, selectedConv));
                      // Sufijo único por mensaje (fecha + n.º) para que cada
                      // adjunto descargado tenga su propio nombre y no se pisen.
                      const sufijoMsg = (() => {
                        const d = new Date(msg.creado_en || Date.now());
                        const p2 = (n: number) => String(n).padStart(2, "0");
                        return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${idxMsg + 1}`;
                      })();
                      const pieDeFoto = textoAdjuntoMultimedia(msg);
                      // Marca horizontal de fecha: se dibuja solo cuando el
                      // mensaje cambia de día respecto al anterior (o es el
                      // primero del historial).
                      const diaMsg = claveDia(msg.creado_en);
                      const diaPrevio = idxMsg > 0 ? claveDia(mensajes[idxMsg - 1].creado_en) : "";
                      const mostrarDivisorFecha = Boolean(diaMsg) && diaMsg !== diaPrevio;

                      return (
                        <React.Fragment key={msg.id}>
                        {mostrarDivisorFecha && <DivisorFecha fecha={msg.creado_en} />}
                        <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm ${isMe ? "bg-purple-600 text-white rounded-br-none" : "bg-surface border border-border text-gray-200 rounded-bl-none"}`}>
                            {(() => {
                              if (isAudioMsg && msg.url_archivo) {
                                return (
                                  <div className="space-y-1">
                                    <VoiceNotePlayer src={msg.url_archivo} isMe={isMe} />
                                    {pieDeFoto && <p className="text-sm whitespace-pre-wrap leading-relaxed">{pieDeFoto}</p>}
                                  </div>
                                );
                              }
                              if (isImgMsg && msg.url_archivo) {
                                return (
                                  <div className="space-y-2">
                                    <ChatImage
                                      src={msg.url_archivo}
                                      filename={guessImageFilename(String(msg.url_archivo), `foto-${slug}-${isMe ? "enviada" : "cliente"}-${sufijoMsg}`)}
                                    />
                                    {pieDeFoto && <p className="text-sm whitespace-pre-wrap leading-relaxed">{pieDeFoto}</p>}
                                  </div>
                                );
                              }
                              if (isVidMsg && msg.url_archivo) {
                                return (
                                  <div className="space-y-2">
                                    <ChatVideo
                                      src={msg.url_archivo}
                                      filename={guessFilename(String(msg.url_archivo), `video-${slug}-${isMe ? "enviado" : "cliente"}-${sufijoMsg}.mp4`, "video/mp4")}
                                      isMe={isMe}
                                    />
                                    {pieDeFoto && <p className="text-sm whitespace-pre-wrap leading-relaxed">{pieDeFoto}</p>}
                                  </div>
                                );
                              }
                              if (msg.url_archivo && (isDocMsg || msg.tipo_contenido === "archivo" || !msg.contenido || msg.contenido.startsWith("["))) {
                                return (
                                  <div className="space-y-2">
                                    <ChatFile
                                      src={msg.url_archivo}
                                      filename={guessFilename(String(msg.url_archivo), `archivo-${slug}`)}
                                      isMe={isMe}
                                    />
                                    {pieDeFoto && <p className="text-sm whitespace-pre-wrap leading-relaxed">{pieDeFoto}</p>}
                                  </div>
                                );
                              }
                              return <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.contenido}</p>;
                            })()}
                            <div className={`flex items-center gap-1.5 mt-1 ${isMe ? "justify-end" : "justify-start"}`}>
                              <span className={`text-[9px] ${isMe ? "text-white/75" : "text-gray-500"}`}>{new Date(msg.creado_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                              {isAudioMsg && msg.url_archivo && (
                                <button
                                  type="button"
                                  onClick={() => descargarAudioMensaje(msg, idxMsg)}
                                  disabled={descargandoAudioId === String(msg.id || idxMsg)}
                                  className={`p-0.5 rounded transition-colors disabled:opacity-50 ${isMe ? "text-white/75 hover:text-white" : "text-gray-500 hover:text-purple-300"}`}
                                  title="Descargar esta nota de voz (OGG)"
                                >
                                  <Download className={`w-3 h-3 ${descargandoAudioId === String(msg.id || idxMsg) ? "animate-pulse" : ""}`} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        </React.Fragment>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="border-t border-border bg-surface/80 backdrop-blur-md flex flex-col flex-shrink-0">
                    {/* Barra informativa de cuenta que envía.
                        REGLA DE DISEÑO: siempre UNA sola línea. Antes, con
                        etapas largas + el aviso de "En seguimiento", el texto
                        hacía wrap a 2-3 líneas y empujaba el compositor (con
                        el botón de audio) fuera de la pantalla en el teléfono.
                        Ahora cada segmento trunca con "…" y el aviso va
                        compacto; el detalle completo está en el title. */}
                    {/* Sin whitespace-nowrap en el contenedor: obligaba a la barra
                        a medir su texto completo (~610 px), y ese mínimo ensanchaba
                        la ventana del cliente hasta sacar de la pantalla el panel
                        de la ficha. Cada segmento trunca con "…" por separado, así
                        la barra sigue siendo UNA sola línea y además puede encoger. */}
                    <div className="flex items-center gap-2 px-3 md:px-4 py-0.5 text-[11px] bg-background/50 border-b border-border/40 min-w-0 overflow-hidden">
                      {(() => {
                        const et = getEtapa(clienteActual?.estado);
                        const esApi = et?.cuenta_responsable === "meta_business";
                        const cuentaTexto = esApi ? "WhatsApp API" : "WhatsApp Personal";
                        const etapaNombre = et?.nombre || "Nuevo Lead";
                        return (
                          <div
                            className="flex items-center gap-1.5 text-gray-400 min-w-0 flex-1"
                            title={`Responde desde: ${cuentaTexto} • Etapa: ${etapaNombre}`}
                          >
                            <span className="text-gray-500 flex-shrink-0">
                              <span className="hidden sm:inline">Responde desde:</span>
                              <span className="sm:hidden">Desde:</span>
                            </span>
                            <span className={`font-semibold flex items-center gap-1 min-w-0 truncate ${esApi ? "text-indigo-400" : "text-blue-400"}`}>
                              <span className="flex-shrink-0">{esApi ? "🌐" : "👤"}</span>
                              <span className="hidden sm:inline truncate">{cuentaTexto}</span>
                              <span className="sm:hidden">{esApi ? "API" : "Personal"}</span>
                            </span>
                            <span className="text-gray-500 min-w-0 truncate">
                              <span className="hidden sm:inline">• Etapa: </span>
                              <span className="sm:hidden">• </span>
                              {etapaNombre}
                            </span>
                          </div>
                        );
                      })()}
                      {clienteActual?.en_seguimiento && (
                        <span
                          className="min-w-0 flex items-center gap-1 text-cyan-400 font-medium flex-shrink"
                          title={
                            estaPendienteSeguimientoHoy(clienteActual)
                              ? "En seguimiento: pendiente para hoy"
                              : "En seguimiento: ya revisado hoy"
                          }
                        >
                          <BellRing className="w-3 h-3 flex-shrink-0" />
                          <span className="hidden sm:inline truncate">
                            {estaPendienteSeguimientoHoy(clienteActual) ? "Pendiente hoy" : "Revisado hoy ✓"}
                          </span>
                          <span className="sm:hidden flex-shrink-0">
                            {estaPendienteSeguimientoHoy(clienteActual) ? "Hoy" : "Hoy ✓"}
                          </span>
                        </span>
                      )}
                      {/* Ventana de 24 h del WhatsApp API, siempre visible al escribir */}
                      {tieneChatApi(selectedConv) && (
                        <VentanaWhatsApp estado={estadoVentanaAbierto} variante="barra" />
                      )}
                    </div>

                    <div className="p-2 md:p-3 flex items-center gap-1.5 md:gap-2">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" />
                    <input type="file" ref={rrFileInputRef} className="hidden" onChange={handleRRFile} accept="audio/*,image/*" />
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
                      <form onSubmit={handleSendMessage} className="flex-1 min-w-0 flex flex-wrap items-center gap-1 md:gap-1.5">
                        {/* size={1}: sin esto el input mide ~360 px de ancho intrínseco
                            y ese mínimo ensanchaba la ventana del cliente hasta
                            sacar la ficha fuera de la pantalla. Con flex-1 sigue
                            ocupando todo el ancho disponible. */}
                        <input type="text" size={1} value={nuevoMensaje} onChange={(e) => setNuevoMensaje(e.target.value)} placeholder="Escribe un mensaje..." disabled={clienteActual.es_spam || isSending} className="flex-1 min-w-0 bg-background border border-border rounded-full px-3 md:px-4 py-2 md:py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50" />
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={clienteActual.es_spam || isSending} className="p-2 md:p-2.5 text-gray-400 hover:text-purple-400 hover:bg-surfaceHover rounded-full transition-colors disabled:opacity-40 flex-shrink-0" title="Enviar archivos"><Paperclip className="w-5 h-5" /></button>
                        <div className="relative flex-shrink-0">
                          <button type="button" onClick={() => setShowEtapaMenu((v) => !v)} disabled={isSending} className="p-2 md:p-2.5 text-gray-400 hover:text-purple-400 hover:bg-surfaceHover rounded-full transition-colors disabled:opacity-40" title="Cambiar etapa del cliente"><GitBranch className="w-5 h-5" /></button>
                          {showEtapaMenu && renderMenuEtapaRapida()}
                        </div>
                        <div className="relative flex-shrink-0">
                          <button type="button" onClick={abrirMenuRespuestas} disabled={isSending} className="p-2 md:p-2.5 text-gray-400 hover:text-purple-400 hover:bg-surfaceHover rounded-full transition-colors disabled:opacity-40" title="Respuestas rápidas (textos, audios e imágenes para todas las conversaciones)"><Zap className="w-5 h-5" /></button>
                          {showRespuestasMenu && renderMenuRespuestasRapidas()}
                        </div>
                        {nuevoMensaje.trim() ? (
                          <button type="submit" disabled={isSending} className="bg-purple-600 hover:bg-purple-700 text-white p-2 md:p-2.5 rounded-full transition-colors disabled:opacity-50 flex-shrink-0"><Send className="w-5 h-5" /></button>
                        ) : (
                          <button type="button" onClick={startRecording} disabled={clienteActual.es_spam || isSending || isPreparingRecording} className="bg-surface border border-border text-purple-400 hover:bg-purple-600 hover:text-white hover:border-purple-600 p-2 md:p-2.5 rounded-full transition-colors disabled:opacity-50 flex-shrink-0" aria-label="Grabar nota de voz"><Mic className="w-5 h-5" /></button>
                        )}
                        {sendNotice && <p className="w-full text-xs text-amber-400 px-2">{sendNotice}</p>}
                        {sendError && <p className="w-full text-xs text-red-400 px-2">{sendError}</p>}
                      </form>
                    )}
                    </div>
                  </div>
                </section>

                {/* Ficha del cliente: se muestra fija a la derecha desde xl; por
                    debajo se abre completa como panel superpuesto sobre el chat
                    (antes se encajaba en columna desde md y la ventana del cliente
                    quedaba tan estrecha que se cortaba). */}
                <aside className={`w-full xl:w-96 max-h-full border-l border-border bg-surface/95 overflow-y-auto overscroll-contain absolute inset-0 z-30 xl:relative flex flex-col ${!showMobileDetails ? "hidden xl:flex" : "flex"}`}>
                  <header className="xl:hidden flex items-center p-4 border-b border-border bg-background sticky top-0 z-10">
                    <button onClick={() => setShowMobileDetails(false)} className="p-2 -ml-2 text-gray-400"><ArrowLeft className="w-5 h-5" /></button>
                    <h2 className="font-bold ml-2">Ficha del Cliente</h2>
                  </header>
                  {/* El relleno inferior despeja la barra de navegación/gestos de
                      Android para que el último bloque de la ficha se vea entero. */}
                  <div className="p-5 space-y-5 pb-[calc(2rem_+_var(--safe-area-inset-bottom))]">
                    <div className="text-center">
                      <div className="w-20 h-20 mx-auto rounded-full bg-surface border-2 border-purple-500 flex items-center justify-center text-2xl font-bold text-purple-300 mb-3 overflow-hidden shadow-lg shadow-purple-900/20">
                        {clienteActual.foto_url
                          ? <img src={clienteActual.foto_url} alt="" className="w-full h-full object-cover" />
                          : getNombreManual(clienteActual)
                            ? <span>{getNombreManual(clienteActual).charAt(0).toUpperCase()}</span>
                            : <Phone className="w-7 h-7 text-purple-400" />}
                      </div>
                      {isEditingNombre ? (
                        <div className="flex items-center justify-center gap-1.5 px-2">
                          <input
                            type="text"
                            value={tempNombre}
                            onChange={(e) => setTempNombre(e.target.value)}
                            placeholder="Nombre personalizado (vacío = solo número)"
                            className="bg-background border border-purple-500 rounded-lg px-2.5 py-1 text-sm text-gray-100 focus:outline-none w-full text-center"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") guardarNuevoNombre(); if (e.key === "Escape") setIsEditingNombre(false); }}
                          />
                          <button onClick={guardarNuevoNombre} className="p-1.5 text-emerald-400 hover:text-emerald-300" title="Guardar nombre"><CheckCircle2 className="w-4 h-4" /></button>
                          <button onClick={() => setIsEditingNombre(false)} className="p-1.5 text-gray-400 hover:text-red-400" title="Cancelar"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2 group">
                          <h3 className={`text-base font-bold ${getDisplayName(clienteActual, selectedConv).startsWith("+") ? "text-purple-300 font-mono text-sm" : "text-gray-100"}`}>
                            {getDisplayName(clienteActual, selectedConv)}
                          </h3>
                          <button
                            onClick={() => { setTempNombre(getNombreManual(clienteActual)); setIsEditingNombre(true); }}
                            className="text-gray-500 hover:text-purple-300 transition-colors"
                            title={getNombreManual(clienteActual) ? "Editar o quitar nombre manual" : "Asignar nombre personalizado"}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {/* El número del cliente SIEMPRE visible en la tarjeta (formato +país) */}
                      <p className="text-xs text-gray-300 mt-1 flex items-center justify-center gap-1.5 font-mono bg-background border border-border rounded-lg py-1.5 px-2">
                        <Phone className="w-3 h-3 text-purple-400 flex-shrink-0" />
                        {getTelefonoE164(clienteActual, selectedConv) || "Sin número"}
                      </p>
                      <button
                        onClick={guardarContactoCliente}
                        disabled={guardandoContacto || contactoGuardado === "nativo" || !getTelefonoE164(clienteActual, selectedConv)}
                        className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-semibold transition-all disabled:opacity-50 ${contactoGuardado ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300" : "bg-purple-950/20 border-purple-800/50 text-purple-300 hover:bg-purple-900/40 hover:border-purple-600"}`}
                        title="Guardar en los contactos del teléfono"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        {guardandoContacto ? "Guardando contacto..." : contactoGuardado === "nativo" ? "Contacto guardado en el teléfono" : contactoGuardado === "vcf" ? "Contacto descargado (.vcf)" : "Guardar en teléfono"}
                      </button>
                      {!clienteActual.es_spam && esConversacionWhatsAppPersonal(selectedConv) && (
                        <>
                          <button
                            onClick={llamarPorWhatsAppPersonal}
                            disabled={!llamadasPersonalDisponibles || contactoEnTelefono !== true || llamandoWhatsApp}
                            className={`w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-semibold transition-all disabled:opacity-50 ${
                              contactoEnTelefono === true && llamadasPersonalDisponibles
                                ? "bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white"
                                : "bg-surface border-border text-gray-500"
                            }`}
                          >
                            <PhoneCall className={`w-3.5 h-3.5 ${llamandoWhatsApp ? "animate-pulse" : ""}`} />
                            {llamandoWhatsApp ? "Abriendo WhatsApp..." : contactoEnTelefono === null ? "Verificando contacto..." : contactoEnTelefono ? "Llamar por WhatsApp" : "Guarda el contacto para llamar"}
                          </button>
                          <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
                            {llamadasPersonalDisponibles
                              ? "Solo se habilita si este número está guardado. La APK intenta abrir la llamada de voz de WhatsApp Personal; si tu agenda no expone esa acción, abre el chat para tocar el ícono de teléfono."
                              : "Las llamadas por WhatsApp Personal requieren la APK Android actualizada."}
                          </p>
                        </>
                      )}
                      {!getNombreManual(clienteActual) && (
                        <p className="text-[10px] text-gray-500 mt-1.5 italic">Sin nombre asignado — toca ✏️ para ponerle uno</p>
                      )}
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
                      <button onClick={() => solicitarEliminarCliente(selectedConv)} className="flex-1 flex justify-center items-center gap-1.5 py-2 rounded-lg bg-red-950/30 border border-red-800/50 text-red-400 hover:bg-red-900/30 text-xs font-medium transition-all">
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
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Etapa del Pipeline</label>
                      <select
                        value={normalizarEstado(clienteActual.estado)}
                        onChange={(e) => actualizarEstadoCliente(clienteActual.id, e.target.value)}
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                      >
                        {pipelineEtapas.filter(e => !e.es_spam && !e.es_archivado).sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0)).map((etapa) => {
                          const esApi = etapa.cuenta_responsable === "meta_business";
                          return (
                            <option key={etapa.clave} value={etapa.clave}>
                              {etapa.nombre} ({esApi ? "WhatsApp API" : "WhatsApp Personal"})
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* CHECK EN SEGUIMIENTO DIARIO (8:00 AM) */}
                    <div className="bg-background p-4 rounded-xl border border-cyan-900/30 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                          <BellRing className={`w-3.5 h-3.5 ${clienteActual?.en_seguimiento ? "text-cyan-400" : "text-gray-500"}`} />
                          En seguimiento diario (8:00 AM)
                        </label>
                        <button
                          type="button"
                          onClick={() => toggleEnSeguimientoCliente(clienteActual.id)}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            clienteActual?.en_seguimiento ? "bg-cyan-600" : "bg-gray-700"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              clienteActual?.en_seguimiento ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-400 leading-relaxed">
                        {clienteActual?.en_seguimiento
                          ? estaPendienteSeguimientoHoy(clienteActual)
                            ? "⚠️ Pendiente para hoy. Al responder o marcar revisado saldrá de la subcategoría hasta mañana."
                            : "✓ Ya revisado hoy. Reaparecerá automáticamente mañana a las 8:00 AM."
                          : "Independiente de la etapa. Actívalo para que entre a tu lista de revisión cada mañana a las 8:00 AM."}
                      </p>
                      {clienteActual?.en_seguimiento && estaPendienteSeguimientoHoy(clienteActual) && (
                        <button
                          type="button"
                          onClick={() => marcarSeguimientoRevisado(clienteActual.id)}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-cyan-950/50 border border-cyan-700 text-cyan-300 hover:bg-cyan-900/60 text-xs font-semibold transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Marcar revisado hoy
                        </button>
                      )}
                    </div>

                    {(() => {
                      const fotos = fotosDelCliente(clienteActual, mensajes);
                      return (
                    <div className="bg-background p-4 rounded-xl border border-border space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Fotos Recibidas</h4>
                        {fotos.all.length > 0 && (
                          <button
                            type="button"
                            onClick={descargarFotosCliente}
                            disabled={descargandoFotos}
                            className="text-[10px] text-purple-300 hover:text-purple-200 flex items-center gap-1 disabled:opacity-50"
                            title="Descargar todas las fotos del cliente"
                          >
                            <Download className="w-3 h-3" /> {descargandoFotos ? "Descargando..." : "Descargar todas"}
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {clienteActual.foto_url ? (
                          <ChatImage src={clienteActual.foto_url} variant="thumb" label="Cliente" filename={`foto-${slugFoto(getDisplayName(clienteActual, selectedConv))}-cliente.jpg`} />
                        ) : (<div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600"><span>Foto</span><span>Cliente</span></div>)}
                        {clienteActual.foto_otra_persona ? (
                          <ChatImage src={clienteActual.foto_otra_persona} variant="thumb" label="Pareja" filename={`foto-${slugFoto(getDisplayName(clienteActual, selectedConv))}-pareja.jpg`} />
                        ) : (<div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600"><span>Foto</span><span>Pareja</span></div>)}
                        {clienteActual.foto_mano ? (
                          <ChatImage src={clienteActual.foto_mano} variant="thumb" label="Palma" filename={`foto-${slugFoto(getDisplayName(clienteActual, selectedConv))}-palma.jpg`} />
                        ) : (<div className="aspect-square rounded-lg bg-surface/40 border border-dashed border-border flex flex-col items-center justify-center text-[9px] text-gray-600"><span>Foto</span><span>Mano</span></div>)}
                      </div>
                      {fotos.delChat.length > 0 && (
                        <div className="space-y-2 pt-1">
                          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">En el chat ({fotos.delChat.length})</p>
                          <div className="grid grid-cols-3 gap-2">
                            {fotos.delChat.map((foto) => (
                              <ChatImage key={foto.id || foto.url} src={foto.url} variant="thumb" label={foto.label} filename={foto.filename} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                      );
                    })()}

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
                          ${pagosCliente.reduce((acc, p) => acc + (p.estado === "pagado" ? calcularCOP(p) : 0), 0).toLocaleString()} COP / ${pagosCliente.filter((p) => p.estado !== "cancelado").reduce((acc, p) => acc + calcularCOP(p), 0).toLocaleString()} COP
                        </span>
                      </div>
                      {pagosCliente.length > 0 && (
                        <div className="space-y-1.5">
                          {pagosCliente.map((pago) => {
                            const moneda = pago.moneda || "COP";
                            const cop = calcularCOP(pago);
                            const esCancelado = pago.estado === "cancelado";
                            return (
                              <div key={pago.id} className={`flex items-center justify-between p-2 rounded-lg border text-xs ${pago.estado === "pagado" ? "bg-emerald-950/20 border-emerald-900/40" : esCancelado ? "bg-gray-900/40 border-border opacity-60" : "bg-surface border-border"}`}>
                                {esCancelado ? (
                                  <span className="mr-2 flex-shrink-0 text-gray-600"><Ban className="w-4 h-4" /></span>
                                ) : (
                                  <button onClick={() => marcarPago(pago.id, pago.estado)} className="mr-2 flex-shrink-0">{pago.estado === "pagado" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4 text-amber-500" />}</button>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className={pago.estado === "pagado" || esCancelado ? "line-through text-gray-500" : "text-gray-200"}>{formatearMoneda(pago.monto, moneda)}</span>
                                    {moneda !== "COP" && <span className="text-[9px] text-emerald-400">→ ${Math.round(cop).toLocaleString()} COP</span>}
                                    <span className={`text-[8px] px-1 py-0.5 rounded font-bold ${moneda === "PYG" ? "bg-amber-900/30 text-amber-400" : moneda === "USD" ? "bg-green-900/30 text-green-400" : "bg-gray-800 text-gray-400"}`}>{moneda}</span>
                                    {esCancelado && <span className="text-[8px] px-1 py-0.5 rounded bg-gray-800 text-gray-500 font-bold">ABANDONADO</span>}
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
                          <button type="button" onClick={activarCuotas} className={`flex-1 py-1.5 rounded-md transition-all ${tipoPago === "cuotas" ? "bg-purple-600 text-white" : "text-gray-400"}`}>Cuotas</button>
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
                        {tipoPago === "cuotas" ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <span>Dividir en</span>
                              <input type="number" min="2" max={MAX_CUOTAS} value={numeroCuotas} onChange={(e) => cambiarNumeroCuotas(e.target.value)} className="w-14 bg-surface border border-border rounded-lg px-2 py-1 text-center text-xs focus:outline-none" />
                              <span>cuotas</span>
                            </div>
                            <div>
                              <label className="text-[9px] text-gray-500 font-bold uppercase block mb-0.5">Primera cuota</label>
                              <input type="date" value={fechaInicial} onChange={(e) => cambiarFechaInicialCuotas(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none" />
                            </div>
                            {fechasCuotas.length >= 2 && (
                              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                                {fechasCuotas.slice(1).map((f, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 w-14 flex-shrink-0">Cuota {i + 2}</span>
                                    <input type="date" value={f} onChange={(e) => editarFechaCuota(i + 1, e.target.value)} className="flex-1 bg-surface border border-border rounded-lg px-2 py-1 text-xs text-gray-400 focus:outline-none" />
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="text-[9px] text-gray-600">Por defecto una cuota por mes desde la primera; cada fecha se puede editar.</p>
                          </div>
                        ) : (
                          <input type="date" value={fechaInicial} onChange={(e) => setFechaInicial(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none" />
                        )}
                        <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none">
                          <option value="Nequi">Nequi</option>
                          <option value="Daviplata">Daviplata</option>
                          <option value="Bancolombia">Bancolombia</option>
                          <option value="Efectivo">Efectivo</option>
                          <option value="Transferencia">Transferencia</option>
                          <option value="Otro">Otro</option>
                        </select>
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

        {/* ==================== PIPELINE UNIFICADO ==================== */}
        {tab === "pipeline" && (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
            <header className="p-4 md:p-6 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface/30">
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-100">Pipeline Unificado</h1>
                <p className="text-xs md:text-sm text-gray-400">Embudo comercial — asigna la cuenta responsable de enviar y responder en cada etapa (WhatsApp API o WhatsApp Personal)</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditingPipeline(!isEditingPipeline)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${
                    isEditingPipeline ? "bg-purple-600 text-white" : "bg-surface border border-border text-gray-300 hover:bg-surfaceHover"
                  }`}
                >
                  <Settings className="w-4 h-4" /> {isEditingPipeline ? "Cerrar configuración" : "Configurar etapas"}
                </button>
              </div>
            </header>
            <div className="flex-1 flex overflow-x-auto p-4 md:p-6 gap-4">
              {isEditingPipeline && (
                <div className="w-80 flex-shrink-0 bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3 shadow-xl overflow-y-auto">
                  <h2 className="text-sm font-bold text-purple-300 flex items-center gap-2 border-b border-border pb-2">
                    <Edit2 className="w-4 h-4" /> Configurar subcategorías
                  </h2>
                  <p className="text-[10px] text-gray-400">Define nombres, colores, orden y la cuenta responsable de enviar y responder en cada etapa.</p>
                  <div className="space-y-3">
                    {pipelineEtapas.filter(e => !e.es_spam && !e.es_archivado).sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0)).map((etapa, idx, arr) => {
                      const esApi = etapa.cuenta_responsable === "meta_business";
                      return (
                        <div key={etapa.id || etapa.clave} className={`bg-background p-3 rounded-xl border-l-4 ${etapa.color} border border-border space-y-2`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="flex items-center gap-0.5 bg-surface p-0.5 rounded border border-border">
                              <button
                                onClick={() => reordenarEtapa(etapa.id, 0)}
                                disabled={idx === 0}
                                className="text-gray-400 hover:text-purple-300 disabled:opacity-20 p-0.5"
                                title="Mover al principio"
                              >
                                <ChevronsUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => reordenarEtapa(etapa.id, idx - 1)}
                                disabled={idx === 0}
                                className="text-gray-400 hover:text-white disabled:opacity-20 p-0.5"
                                title="Subir una posición"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => reordenarEtapa(etapa.id, idx + 1)}
                                disabled={idx === arr.length - 1}
                                className="text-gray-400 hover:text-white disabled:opacity-20 p-0.5"
                                title="Bajar una posición"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => reordenarEtapa(etapa.id, arr.length - 1)}
                                disabled={idx === arr.length - 1}
                                className="text-gray-400 hover:text-purple-300 disabled:opacity-20 p-0.5"
                                title="Mover al final"
                              >
                                <ChevronsDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <input
                              type="text"
                              value={etapa.nombre}
                              onChange={(e) => actualizarNombreEtapa(etapa.id, e.target.value)}
                              className="flex-1 bg-transparent text-sm font-semibold text-gray-200 focus:outline-none focus:text-purple-300"
                            />
                            <div className="relative">
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingEtapaColor(editingEtapaColor === etapa.id ? null : etapa.id); }}
                                className={`w-5 h-5 rounded-full ${etapa.color.replace("border-", "bg-")} border border-white/20`}
                                title="Cambiar color"
                              />
                              {editingEtapaColor === etapa.id && (
                                <div className="absolute right-0 top-7 z-20 bg-surface border border-border rounded-lg p-2 grid grid-cols-5 gap-1 shadow-xl">
                                  {PALETA_COLORES.map(p => (
                                    <button
                                      key={p.color}
                                      onClick={(e) => { e.stopPropagation(); actualizarColorEtapa(etapa.id, p); }}
                                      className={`w-6 h-6 rounded-full ${p.color.replace("border-", "bg-")} border-2 border-white/20 hover:scale-125 transition-transform`}
                                      title={p.color}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                            {etapa.clave !== "nuevo_lead" && (
                              <button onClick={() => eliminarEtapa(etapa.id)} className="text-red-500/70 hover:text-red-400 p-1" title="Eliminar etapa">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          {/* Segmented Account Selector */}
                          <div className="flex items-center gap-1 bg-surface p-1 rounded-lg border border-border">
                            <span className="text-[9px] uppercase font-bold text-gray-500 px-1">Cuenta:</span>
                            <button
                              type="button"
                              onClick={() => actualizarCuentaResponsableEtapa(etapa.id, "meta_business")}
                              className={`flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-md text-[11px] font-bold transition-all ${
                                esApi ? "bg-indigo-600 text-white shadow" : "text-gray-400 hover:text-white"
                              }`}
                              title="WhatsApp API (Meta Business / Templo)"
                            >
                              <span>🌐</span> API
                            </button>
                            <button
                              type="button"
                              onClick={() => actualizarCuentaResponsableEtapa(etapa.id, "evolution")}
                              className={`flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-md text-[11px] font-bold transition-all ${
                                !esApi ? "bg-blue-600 text-white shadow" : "text-gray-400 hover:text-white"
                              }`}
                              title="WhatsApp Personal"
                            >
                              <span>👤</span> Personal
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => agregarEtapaPipeline("meta_business")}
                    className="w-full py-2 bg-surfaceHover border border-dashed border-gray-600 rounded-lg text-xs text-gray-400 hover:text-white flex items-center justify-center gap-2 mt-1"
                  >
                    <Plus className="w-4 h-4" /> Agregar subcategoría
                  </button>
                </div>
              )}

              {/* Columnas Kanban de etapas unificadas */}
              {pipelineEtapas.filter(e => !e.es_spam && !e.es_archivado).sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0)).map((col) => {
                const clientesEnCol = conversaciones.filter((c) => {
                  if (c.clientes?.es_spam || (c as any).archivada) return false;
                  const est = normalizarEstado(c.clientes?.estado);
                  return est === col.clave;
                });
                const esApi = col.cuenta_responsable === "meta_business";
                return (
                  <div key={col.id || col.clave} className={`w-72 flex-shrink-0 rounded-2xl p-4 flex flex-col gap-3 min-h-full border ${col.color} ${col.bg_color}`}>
                    <div className={`flex items-center justify-between pb-2 border-b-2 ${col.color}`}>
                      <div className="flex flex-col">
                        <h2 className={`text-xs font-bold ${col.text_color}`}>{col.nombre}</h2>
                        <span className="text-[9px] text-gray-400 flex items-center gap-1 font-medium">
                          <span>{esApi ? "🌐 WhatsApp API" : "👤 WhatsApp Personal"}</span>
                        </span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface/60 text-gray-300 font-semibold">{clientesEnCol.length}</span>
                    </div>
                    <div className="space-y-2 overflow-y-auto flex-1">
                      {clientesEnCol.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => { selectConversation(c); setChatCategoria(col.clave); setTab("chats"); }}
                          className="p-3 bg-surface/80 backdrop-blur rounded-xl border border-border/60 hover:border-white/30 cursor-pointer shadow-sm group"
                        >
                          <div className="flex items-center justify-between">
                            <h3 className={`text-xs font-bold ${col.text_color} truncate ${getDisplayName(c.clientes, c).startsWith("+") ? "font-mono" : ""}`}>
                              {getDisplayName(c.clientes, c)}
                            </h3>
                            {c.clientes?.en_seguimiento && (
                              <span title={estaPendienteSeguimientoHoy(c.clientes) ? "En seguimiento (pendiente hoy)" : "En seguimiento (revisado)"}>
                                <BellRing className={`w-3 h-3 ${estaPendienteSeguimientoHoy(c.clientes) ? "text-cyan-400 animate-pulse" : "text-gray-500"}`} />
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-500 font-mono mt-0.5 truncate">{getTelefonoE164(c.clientes, c) || "Sin número"}</p>
                          <p className="text-[11px] text-gray-400 mt-1 truncate">
                            {c.clientes?.tipo_trabajo || "Sin clasificar"}
                            {c.clientes?.notas_personales ? " • 📝" : ""}
                          </p>
                        </div>
                      ))}
                      {clientesEnCol.length === 0 && (
                        <p className="text-[11px] text-gray-500 italic text-center py-4">Vacío</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Columna de Spam */}
              <div className="w-64 flex-shrink-0 bg-gray-900/60 border-2 border-gray-800 rounded-2xl p-4 flex flex-col gap-3 min-h-full">
                <div className="flex items-center justify-between pb-2 border-b-2 border-gray-700">
                  <h2 className="text-xs font-bold text-gray-300 flex items-center gap-1"><Ban className="w-3 h-3" /> Spam</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 font-semibold">{conversacionesSpam.length}</span>
                </div>
                <div className="space-y-2 overflow-y-auto flex-1">
                  {conversacionesSpam.map((c) => (
                    <div key={c.id} onClick={() => { selectConversation(c); setChatCategoria("spam"); setTab("chats"); }} className="p-3 bg-surface/70 rounded-xl border border-gray-800 cursor-pointer hover:border-gray-600">
                      <h3 className="text-xs font-bold text-gray-300 truncate">{getDisplayName(c.clientes, c)}</h3>
                      {c.no_leidos > 0 && <span className="mt-1 inline-flex bg-red-600 text-white text-[9px] min-w-[18px] h-[18px] px-1 rounded-full items-center justify-center font-bold">{c.no_leidos > 99 ? "99+" : c.no_leidos}</span>}
                    </div>
                  ))}
                  {conversacionesSpam.length === 0 && <p className="text-[11px] text-gray-500 italic text-center py-4">Sin spam 🎉</p>}
                </div>
              </div>

              {/* Columna Archivados */}
              <div className="w-64 flex-shrink-0 bg-amber-950/20 border-2 border-amber-800/50 rounded-2xl p-4 flex flex-col gap-3 min-h-full">
                <div className="flex items-center justify-between pb-2 border-b-2 border-amber-700">
                  <h2 className="text-xs font-bold text-amber-300 flex items-center gap-1"><Archive className="w-3 h-3" /> Archivados</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 font-semibold">{conversacionesArchivadas.length}</span>
                </div>
                <div className="space-y-2 overflow-y-auto flex-1">
                  {conversacionesArchivadas.map((c) => (
                    <div key={c.id} onClick={() => { selectConversation(c); setChatCategoria(CATEGORIA_ARCHIVADOS); setTab("chats"); }} className="p-3 bg-surface/70 rounded-xl border border-amber-900/30 cursor-pointer hover:border-amber-500/50 opacity-80">
                      <h3 className="text-xs font-bold text-amber-300/80 truncate">{getDisplayName(c.clientes, c)}</h3>
                    </div>
                  ))}
                  {conversacionesArchivadas.length === 0 && <p className="text-[11px] text-gray-500 italic text-center py-4">Sin archivados ✨</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAREAS GLOBALES ==================== */}
        {tab === "tareas" && (
          <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-background">
            <header className="mb-6"><h1 className="text-xl md:text-2xl font-bold text-gray-100 flex items-center gap-2"><ListTodo className="text-purple-400 w-6 h-6" /> Panel de Tareas</h1><p className="text-xs md:text-sm text-gray-400">Pendientes del día y checklist de clientes</p></header>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 items-start">
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4"><h2 className="text-sm font-bold text-amber-400 flex items-center gap-2 border-b border-border pb-2"><Clock className="w-4 h-4" /> Pendientes / Vencidas</h2><div className="space-y-2">{todasTareas.filter((t) => !t.completada && t.fecha_vencimiento && new Date(t.fecha_vencimiento) <= ahora).length === 0 && <p className="text-xs text-gray-500 italic">Todo al día ✅</p>}{todasTareas.filter((t) => !t.completada && t.fecha_vencimiento && new Date(t.fecha_vencimiento) <= ahora).map((t) => { const nombreT = getNombreTarea(t); return (<div key={t.id} className="bg-background border border-amber-900/30 p-3 rounded-xl"><div className="flex justify-between items-start mb-1"><span className="text-[10px] bg-amber-950/50 text-amber-500 px-1.5 rounded border border-amber-900">{t.fecha_vencimiento}</span><span className="text-[10px] text-gray-400 truncate max-w-[120px]">{nombreT}</span></div><p className="text-xs text-gray-200 font-medium">{t.titulo}</p><button onClick={() => toggleTarea(t.id, false)} className="mt-2 text-[10px] text-purple-400 hover:text-purple-300">Marcar hecha ✓</button></div>); })}</div></div>
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4"><h2 className="text-sm font-bold text-blue-400 flex items-center gap-2 border-b border-border pb-2"><Calendar className="w-4 h-4" /> Próximas / Sin fecha</h2><div className="space-y-2">{todasTareas.filter((t) => !t.completada && (!t.fecha_vencimiento || new Date(t.fecha_vencimiento) > ahora)).map((t) => { const nombreT = getNombreTarea(t); return (<div key={t.id} className="bg-background border border-border p-3 rounded-xl"><div className="flex justify-between items-start mb-1"><span className="text-[10px] text-blue-400">{t.fecha_vencimiento || "Sin fecha"}</span><span className="text-[10px] text-gray-400 truncate max-w-[120px]">{nombreT}</span></div><p className="text-xs text-gray-200">{t.titulo}</p><button onClick={() => toggleTarea(t.id, false)} className="mt-2 text-[10px] text-purple-400 hover:text-purple-300">Marcar hecha ✓</button></div>); })}</div></div>
              <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4"><h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2 border-b border-border pb-2"><CheckCircle2 className="w-4 h-4" /> Completadas</h2><div className="space-y-2">{todasTareas.filter((t) => t.completada).slice(-15).reverse().map((t) => { const nombreT = getNombreTarea(t); return (<div key={t.id} className="bg-background border border-border p-3 rounded-xl opacity-60"><div className="flex justify-between items-start"><span className="text-[10px] text-gray-500 line-through">{t.titulo}</span><span className="text-[10px] text-gray-600">{nombreT}</span></div></div>); })}</div></div>
            </div>
          </div>
        )}

        {/* ==================== CARTERA POR COBRAR (CONTROL DE PRÓXIMOS PAGOS) ==================== */}
        {tab === "cartera" && (
          <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6 bg-background">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-100 flex items-center gap-2"><DollarSign className="text-emerald-400 w-6 h-6" /> Cartera por Cobrar</h1>
                <p className="text-xs md:text-sm text-gray-400">Control de próximos pagos — se actualiza día a día. Al recibir un abono, el saldo pendiente se descuenta y el siguiente pago se recalcula automáticamente.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Selector de grupo para la cartera */}
                <div className="flex bg-surface border border-border rounded-lg p-0.5">
                  <button onClick={() => setCarteraGrupoFiltro("personal")} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${carteraGrupoFiltro === "personal" ? "bg-blue-600 text-white" : "text-gray-400"}`}><User className="w-3 h-3" /> {personalLabel}</button>
                  <button onClick={() => setCarteraGrupoFiltro("templo")} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${carteraGrupoFiltro === "templo" ? "bg-purple-600 text-white" : "text-gray-400"}`}><Landmark className="w-3 h-3" /> {temploLabel}</button>
                  <button onClick={() => setCarteraGrupoFiltro("todas")} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${carteraGrupoFiltro === "todas" ? "bg-emerald-600 text-white" : "text-gray-400"}`}><Users className="w-3 h-3" /> Todas</button>
                </div>
                <button onClick={() => setShowDivisaConfig(!showDivisaConfig)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border text-xs font-medium hover:bg-surfaceHover">
                  <Coins className="w-4 h-4 text-amber-400" /> Config Divisas
                </button>
              </div>
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

            {/* ===== RESUMEN RÁPIDO (derivado 100% de la lista de cartera) ===== */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="p-4 md:p-5 bg-gradient-to-br from-emerald-950/40 to-surface border border-emerald-900/30 rounded-2xl">
                <p className="text-xl md:text-2xl font-extrabold text-emerald-400">${Math.round(totalCarteraCOP).toLocaleString("es-CO")}</p>
                <p className="text-[11px] text-gray-400 mt-1">Por cobrar (pendiente)</p>
                <p className="text-[9px] text-gray-500 mt-0.5">{clientesCartera.length} clientes en cartera</p>
              </div>
              <div className={`p-4 md:p-5 bg-surface border rounded-2xl ${clientesVencidos.length > 0 ? "border-red-800/60 bg-red-950/20" : "border-border"}`}>
                <p className="text-xl md:text-2xl font-extrabold text-red-400">${Math.round(totalVencidoCarteraCOP).toLocaleString("es-CO")}</p>
                <p className="text-[11px] text-gray-400 mt-1">Vencido</p>
                <p className={`text-[9px] mt-0.5 ${clientesVencidos.length > 0 ? "text-red-400 font-bold" : "text-gray-500"}`}>{clientesVencidos.length > 0 ? `⚠️ ${clientesVencidos.length} cliente(s) con pago vencido` : "Nada vencido 🎉"}</p>
              </div>
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                <p className="text-xl md:text-2xl font-extrabold text-amber-400">${Math.round(totalProximos7diasCOP).toLocaleString("es-CO")}</p>
                <p className="text-[11px] text-gray-400 mt-1">Próximos 7 días</p>
                <p className="text-[9px] text-gray-500 mt-0.5">{proximos7dias.length} pago(s) esta semana</p>
              </div>
              <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl">
                <p className="text-xl md:text-2xl font-extrabold text-gray-100">{clientesCartera.length}</p>
                <p className="text-[11px] text-gray-400 mt-1">Clientes por cobrar</p>
                <p className="text-[9px] text-gray-500 mt-0.5">Hoy: {new Date(nowTick).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}</p>
              </div>
            </div>

            {/* ===== LISTA: CONTROL DE PRÓXIMOS PAGOS ===== */}
            <div className="bg-surface/50 border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-border bg-surface/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-gray-200 uppercase tracking-wider">📋 Control de Próximos Pagos</h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-300 border border-emerald-800/50">{clientesCartera.length}</span>
                </div>
                <div className="relative w-full md:w-60">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input value={searchCartera} onChange={e => setSearchCartera(e.target.value)} placeholder="Buscar por nombre o teléfono..." className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500" />
                  {searchCartera && <button onClick={() => setSearchCartera("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
                </div>
              </div>

              {clientesCartera.length === 0 ? (
                <div className="p-10 text-center">
                  <Wallet className="w-12 h-12 mx-auto text-gray-600 mb-3" />
                  <p className="text-sm text-gray-400 font-medium">Cartera al día ✨</p>
                  <p className="text-xs text-gray-500 mt-1">No hay pagos pendientes. Cuando agendes un cobro en la ficha de un cliente, aparecerá aquí.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {clientesCartera.map((row) => {
                    const cliente = row.cliente;
                    const nombre = getDisplayName(cliente);
                    const telefono = getTelefonoE164(cliente) || "Sin teléfono";
                    const pp = row.proximoPago;
                    const monedaPP = pp?.moneda || "COP";
                    const expandido = expandedCarteraCliente === cliente.id;
                    // Conversación del cliente para saltar al chat y mostrar no leídos
                    const convCliente = conversaciones.find((c) => c.cliente_id === cliente.id && !(c as any).archivada) || conversaciones.find((c) => c.cliente_id === cliente.id);
                    const noLeidosCliente = convCliente?.no_leidos || 0;
                    const estadoPill = row.vencido
                      ? { txt: `⚠️ Vencido hace ${Math.abs(row.diasRest!)}d`, cls: "bg-red-950/60 text-red-300 border-red-800" }
                      : row.venceHoy
                      ? { txt: "🔔 Vence HOY", cls: "bg-amber-950/60 text-amber-300 border-amber-800" }
                      : { txt: row.diasRest === 1 ? "⏳ Vence mañana" : `📅 En ${row.diasRest} días`, cls: "bg-surfaceHover text-gray-300 border-border" };
                    return (
                      <div key={cliente.id} className={`transition-colors ${row.vencido ? "bg-red-950/15" : ""}`}>
                        <div
                          onClick={() => {
                            // Click en la fila: salta al chat del cliente
                            if (convCliente) {
                              selectConversation(convCliente);
                              setTab("chats");
                            } else {
                              setExpandedCarteraCliente(expandido ? null : cliente.id);
                            }
                          }}
                          className={`p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-3 cursor-pointer hover:bg-surface/40 transition-colors border-l-4 ${row.vencido ? "border-red-500" : "border-transparent"}`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`relative w-11 h-11 rounded-full bg-surface border ${row.vencido ? "border-red-700" : "border-emerald-800/60"} flex items-center justify-center font-bold ${row.vencido ? "text-red-300" : "text-emerald-300"} flex-shrink-0 overflow-hidden`}>
                              {cliente.foto_url ? <img src={cliente.foto_url} alt="" className="w-full h-full object-cover" /> : nombre.startsWith("+") ? <Phone className="w-4 h-4" /> : <span>{nombre.charAt(0).toUpperCase()}</span>}
                              {noLeidosCliente > 0 && <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-bold border-2 border-surface">{noLeidosCliente > 99 ? "99+" : noLeidosCliente}</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className={`text-sm font-bold truncate ${row.vencido ? "text-red-200" : "text-gray-100"}`}>{nombre}</h3>
                                {noLeidosCliente > 0 && <span className="bg-red-600 text-white text-[9px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-bold">{noLeidosCliente > 99 ? "99+" : noLeidosCliente}</span>}
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${estadoPill.cls}`}>{estadoPill.txt}</span>
                              </div>
                              <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" /> {telefono}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-900/40 font-semibold">Pendiente: ${Math.round(row.pendienteCOP).toLocaleString("es-CO")} COP</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surfaceHover text-gray-400 border border-border">Servicio: ${Math.round(row.totalServicioCOP).toLocaleString("es-CO")} COP</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surfaceHover text-gray-400 border border-border">{row.pendientes.length} pago(s)</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 md:gap-4 pl-14 md:pl-0">
                            <div className="text-left md:text-right min-w-0">
                              {pp ? (
                                <>
                                  <p className={`text-xs font-bold ${row.vencido ? "text-red-300" : "text-amber-300"}`}>
                                    {new Date(pp.fecha_vencimiento + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                                  </p>
                                  <p className={`text-sm font-extrabold ${row.vencido ? "text-red-200" : "text-gray-100"}`}>{formatearMoneda(Number(pp.monto), monedaPP)}</p>
                                  <p className="text-[9px] text-emerald-400">≈ ${Math.round(calcularCOP(pp)).toLocaleString("es-CO")} COP</p>
                                </>
                              ) : (
                                <p className="text-[10px] text-gray-500">Sin fecha</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); setAbonoModalCliente({ cliente, proximoPago: pp }); setAbonoMonto(pp ? String(Number(pp.monto) || "") : ""); }}
                                className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50 transition-colors"
                                title="Registrar abono / pago"
                              ><Coins className="w-4 h-4" /></button>
                              <button
                                onClick={(e) => { e.stopPropagation(); if (pp) { setReprogramarModal({ pago: pp, nombre }); setNuevaFechaPago(pp.fecha_vencimiento || ""); } }}
                                disabled={!pp}
                                className="p-2 rounded-lg bg-surfaceHover border border-border text-amber-300 hover:bg-amber-950/40 hover:border-amber-800/60 transition-colors disabled:opacity-40"
                                title="Reprogramar próximo pago"
                              ><Calendar className="w-4 h-4" /></button>
                              <button
                                onClick={(e) => { e.stopPropagation(); abandonarCartera(cliente); }}
                                className="p-2 rounded-lg bg-red-950/30 border border-red-800/50 text-red-300 hover:bg-red-900/50 transition-colors"
                                title="Eliminar de la cartera por abandono"
                              ><Ban className="w-4 h-4" /></button>
                              <button onClick={(e) => { e.stopPropagation(); setExpandedCarteraCliente(expandido ? null : cliente.id); }} className="p-2 rounded-lg text-gray-400 hover:text-white transition-colors" title="Ver detalle">
                                {expandido ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* DETALLE DE LA CARTERA POR COBRAR */}
                        {expandido && (
                          <div className="px-4 md:px-12 pb-4">
                            <div className="bg-background border border-border rounded-xl p-3 md:p-4 space-y-2">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-emerald-400" /> Detalle de pagos</h4>
                                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                  <span className="px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-900/50">Pagado: ${Math.round(row.pagadoCOP).toLocaleString("es-CO")} COP</span>
                                  <span className="px-2 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-900/50">Pendiente: ${Math.round(row.pendienteCOP).toLocaleString("es-CO")} COP</span>
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                {row.pagos
                                  .slice()
                                  .sort((a: any, b: any) => new Date(a.fecha_vencimiento).getTime() - new Date(b.fecha_vencimiento).getTime())
                                  .map((pago: any) => {
                                    const moneda = pago.moneda || "COP";
                                    const esPagado = pago.estado === "pagado";
                                    const esCancelado = pago.estado === "cancelado";
                                    const pagoVencido = !esPagado && !esCancelado && diasHasta(pago.fecha_vencimiento) < 0;
                                    return (
                                      <div key={pago.id} className={`flex items-center gap-2 p-2 rounded-lg border text-xs ${esPagado ? "bg-emerald-950/20 border-emerald-900/40 opacity-70" : esCancelado ? "bg-gray-900/40 border-border opacity-50" : pagoVencido ? "bg-red-950/20 border-red-900/50" : "bg-surface border-border"}`}>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className={`text-[10px] font-bold ${esPagado ? "text-emerald-400" : esCancelado ? "text-gray-500" : pagoVencido ? "text-red-300" : "text-amber-300"}`}>
                                              {new Date(pago.fecha_vencimiento + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}
                                            </span>
                                            <span className={esPagado ? "line-through text-gray-500" : esCancelado ? "line-through text-gray-600" : "text-gray-200"}>{formatearMoneda(Number(pago.monto), moneda)}</span>
                                            {moneda !== "COP" && <span className="text-[9px] text-emerald-400">→ ${Math.round(calcularCOP(pago)).toLocaleString("es-CO")} COP</span>}
                                            {esPagado && <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-bold">PAGADO {pago.fecha_pago ? `el ${pago.fecha_pago}` : ""}</span>}
                                            {esCancelado && <span className="text-[8px] px-1 py-0.5 rounded bg-gray-800 text-gray-500 font-bold">ABANDONADO</span>}
                                            {!esPagado && !esCancelado && pagoVencido && <span className="text-[8px] px-1 py-0.5 rounded bg-red-900/50 text-red-300 font-bold">VENCIDO</span>}
                                          </div>
                                          {pago.notas && <p className="text-[10px] text-gray-500 truncate mt-0.5">{pago.notas}</p>}
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                          {!esPagado && !esCancelado && (
                                            <button onClick={() => marcarPago(pago.id, pago.estado)} className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-900/40 transition-colors" title="Marcar como pagado"><CheckCircle2 className="w-4 h-4" /></button>
                                          )}
                                          {!esPagado && !esCancelado && (
                                            <button onClick={() => { setReprogramarModal({ pago, nombre }); setNuevaFechaPago(pago.fecha_vencimiento || ""); }} className="p-1.5 rounded-md text-amber-300 hover:bg-amber-950/40 transition-colors" title="Reprogramar fecha"><Calendar className="w-4 h-4" /></button>
                                          )}
                                          <button onClick={() => { if (confirm(`¿Eliminar este pago de ${formatearMoneda(Number(pago.monto), moneda)}?`)) eliminarPago(pago.id); }} className="p-1.5 rounded-md text-red-400 hover:bg-red-950/40 transition-colors" title="Eliminar pago"><Trash2 className="w-4 h-4" /></button>
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                              <p className="text-[9px] text-gray-600 pt-1">💡 Al registrar un abono se descuenta del pago más antiguo y se actualiza la fecha del siguiente pago automáticamente.</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-sm font-bold text-purple-300 mb-3 uppercase tracking-wider">Rendimiento</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><p className="text-2xl md:text-3xl font-extrabold text-gray-100">{totalAtendidos}</p><p className="text-[11px] text-gray-400 mt-1">Clientes atendidos</p></div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><p className="text-2xl md:text-3xl font-extrabold text-emerald-400">{totalConvertidos}</p><p className="text-[11px] text-gray-400 mt-1">Convertidos</p></div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><p className="text-2xl md:text-3xl font-extrabold text-purple-400">{efectividad}%</p><p className="text-[11px] text-gray-400 mt-1">Efectividad</p></div>
                <div className="p-4 md:p-5 bg-surface border border-border rounded-2xl"><p className="text-2xl md:text-3xl font-extrabold text-blue-400">{leadsNuevos}</p><p className="text-[11px] text-gray-400 mt-1">Leads nuevos</p></div>
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
                  <p className="text-[9px] text-gray-500 mt-1">Suma de {todosPagos.filter(p => p.estado === "pagado" && carteraGrupoOk(clientePorId(p.cliente_id))).length} pagos</p>
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

            {/* MODAL ABONO
                El contenedor con scroll y el my-auto de la tarjeta garantizan que
                el modal se vea completo (y centrado) incluso en pantallas bajas. */}
            {abonoModalCliente && (
              <div className="fixed inset-0 z-[70] bg-scrim flex justify-center overflow-y-auto p-3 sm:p-4 pt-[calc(0.75rem_+_var(--safe-area-inset-top))] pb-[calc(0.75rem_+_var(--safe-area-inset-bottom))] backdrop-blur-md">
                <div className="w-full max-w-sm my-auto max-h-[92dvh] overflow-y-auto overscroll-contain bg-surface border border-emerald-900/40 rounded-2xl p-6 space-y-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-400"><Coins className="w-5 h-5" /><h3 className="text-base font-bold text-gray-100">Registrar abono</h3></div>
                    <button onClick={() => setAbonoModalCliente(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="bg-background border border-border rounded-xl p-3 text-xs space-y-1">
                    <p className="text-gray-200 font-bold">{getDisplayName(abonoModalCliente.cliente)}</p>
                    <p className="text-gray-400 font-mono">{getTelefonoE164(abonoModalCliente.cliente) || "Sin teléfono"}</p>
                    {abonoModalCliente.proximoPago ? (
                      <>
                        <p className="text-amber-300 mt-1">Próximo pago: {formatearMoneda(Number(abonoModalCliente.proximoPago.monto), abonoModalCliente.proximoPago.moneda || "COP")} <span className="text-gray-500">• vence {abonoModalCliente.proximoPago.fecha_vencimiento}</span></p>
                        <p className="text-emerald-400">Pendiente total: ${Math.round(todosPagos.filter((p) => p.cliente_id === abonoModalCliente.cliente.id && p.estado === "pendiente").reduce((s, p) => s + calcularCOP(p), 0)).toLocaleString("es-CO")} COP</p>
                      </>
                    ) : <p className="text-gray-500">Sin pagos pendientes</p>}
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Monto del abono {abonoModalCliente.proximoPago ? `(${abonoModalCliente.proximoPago.moneda || "COP"})` : ""}</label>
                    <input type="number" min="0.01" step="0.01" value={abonoMonto} onChange={(e) => setAbonoMonto(e.target.value)} autoFocus className="w-full bg-background border border-emerald-900/40 rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500" placeholder="0.00" />
                    <p className="text-[9px] text-gray-500 mt-1.5">Se descuenta del pago más antiguo en esa divisa. Si cubre más de una cuota, se pagan en orden y la fecha del siguiente pago se actualiza sola.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setAbonoModalCliente(null)} className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-gray-300 hover:bg-surfaceHover text-sm font-medium transition-colors">Cancelar</button>
                    <button
                      onClick={() => registrarAbono(abonoModalCliente.cliente.id, parseFloat(abonoMonto))}
                      disabled={!(parseFloat(abonoMonto) > 0)}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    ><CheckCircle2 className="w-4 h-4" /> Abonar</button>
                  </div>
                </div>
              </div>
            )}

            {/* MODAL REPROGRAMAR PAGO */}
            {reprogramarModal && (
              <div className="fixed inset-0 z-[70] bg-scrim flex justify-center overflow-y-auto p-3 sm:p-4 pt-[calc(0.75rem_+_var(--safe-area-inset-top))] pb-[calc(0.75rem_+_var(--safe-area-inset-bottom))] backdrop-blur-md">
                <div className="w-full max-w-sm my-auto max-h-[92dvh] overflow-y-auto overscroll-contain bg-surface border border-amber-900/40 rounded-2xl p-6 space-y-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-300"><Calendar className="w-5 h-5" /><h3 className="text-base font-bold text-gray-100">Reprogramar pago</h3></div>
                    <button onClick={() => setReprogramarModal(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="bg-background border border-border rounded-xl p-3 text-xs space-y-1">
                    <p className="text-gray-200 font-bold">{reprogramarModal.nombre}</p>
                    <p className="text-amber-300">{formatearMoneda(Number(reprogramarModal.pago.monto), reprogramarModal.pago.moneda || "COP")}</p>
                    <p className="text-gray-500">{reprogramarModal.pago.notas || "Sin nota"} • actual: {reprogramarModal.pago.fecha_vencimiento}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Nueva fecha de pago</label>
                    <input type="date" value={nuevaFechaPago} onChange={(e) => setNuevaFechaPago(e.target.value)} className="w-full bg-background border border-amber-900/40 rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:border-amber-500" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setReprogramarModal(null)} className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-gray-300 hover:bg-surfaceHover text-sm font-medium transition-colors">Cancelar</button>
                    <button
                      onClick={() => reprogramarPago(reprogramarModal.pago.id, nuevaFechaPago)}
                      disabled={!nuevaFechaPago}
                      className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    ><Save className="w-4 h-4" /> Guardar</button>
                  </div>
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCrearCampModal(true)}
                  className="bg-purple-600 hover:bg-purple-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-purple-900/30 flex items-center gap-1.5 transition-all"
                  title="Crear nueva campaña en Meta Ads"
                >
                  <Plus className="w-3.5 h-3.5" /> Nueva Campaña
                </button>
                <button
                  onClick={() => setAdsMemoriaModal(true)}
                  className="bg-amber-950/60 hover:bg-amber-900/60 border border-amber-800 text-amber-300 px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-amber-950/20 flex items-center gap-1.5 transition-all"
                  title="Memoria de Top 3 Campañas y Errores descartados"
                >
                  <Brain className="w-3.5 h-3.5 text-amber-400" /> Memoria & Top 3 ({topCampanasGuardadas.length})
                </button>
                <button onClick={fetchCampanasAds} disabled={loadingAds} className="bg-surface hover:bg-surfaceHover border border-border text-gray-300 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all"><RefreshCw className={`w-3.5 h-3.5 ${loadingAds ? 'animate-spin' : ''}`} /> Actualizar</button>
                <button onClick={consultarAsesorIAAds} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-purple-900/30 flex items-center gap-2 transition-all"><Sparkles className="w-4 h-4" /> Analizar con IA</button>
              </div>
            </header>
            {adsNote && !loadingAds && (<div className="p-3 rounded-xl border border-purple-800/40 bg-purple-950/20 text-purple-300 text-xs">{adsNote}</div>)}

            {/* ===== SALDO DE LA CUENTA PUBLICITARIA (total + gasto de hoy) ===== */}
            <div className="p-4 md:p-5 rounded-2xl border border-emerald-900/50 bg-gradient-to-br from-emerald-950/30 via-surface to-surface space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">💳 Saldo de la Cuenta Publicitaria</h3>
                  {accountInfo?.name && <span className="text-[10px] text-gray-500 font-mono">{accountInfo.name}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-gray-500">
                    {ultimaActualizacionAds ? `Actualizado ${new Date(ultimaActualizacionAds).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}` : "Sincronizando..."} • auto cada 10 min
                  </span>
                  <button type="button" onClick={() => { fetchAccountInfo(); fetchCampanasAds(); }} className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1">
                    <RefreshCw className={`w-3 h-3 ${loadingAccount ? "animate-spin" : ""}`} /> Actualizar
                  </button>
                </div>
              </div>

              {accountInfo && !accountInfo.error ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-background border border-emerald-900/40">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Saldo total en la cuenta</span>
                      <p className="text-xl md:text-2xl font-extrabold text-emerald-400 mt-1">{accountInfo.saldo_disponible_formatted || accountInfo.balance_formatted || "—"}</p>
                      <span className="text-[9px] text-gray-500">{accountInfo.is_prepay ? "Cuenta prepago · fondos disponibles" : accountInfo.balance_label || "Facturación por umbral"}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-background border border-border">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Gastado hoy</span>
                      <p className="text-xl md:text-2xl font-extrabold text-amber-400 mt-1">{accountInfo.spend_today_formatted || "$0 COP"}</p>
                      <span className="text-[9px] text-gray-500">{accountInfo.leads_today || 0} leads hoy{accountInfo.cpl_today ? ` · CPL $${Number(accountInfo.cpl_today).toLocaleString("es-CO")}` : ""}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-background border border-border">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Gastado histórico</span>
                      <p className="text-lg md:text-xl font-extrabold text-gray-200 mt-1">{accountInfo.amount_spent_formatted || "—"}</p>
                      <span className="text-[9px] text-gray-500">Últimos 30 días: {accountInfo.spend_last_30d_formatted || "—"}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-background border border-border">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Límite de gasto</span>
                      <p className="text-lg md:text-xl font-extrabold text-gray-200 mt-1">{accountInfo.spend_cap_formatted || "Sin límite"}</p>
                      <span className="text-[9px] text-gray-500">{accountInfo.payment_method ? `Pago: ${accountInfo.payment_method}` : accountInfo.currency || "COP"}</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    La recarga de saldo solo se puede hacer desde Meta (la API no lo permite).{" "}
                    <a href={accountInfo.billing_url || "https://business.facebook.com/billing_hub/accounts"} target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300 underline font-semibold">
                      Abrir Facturación en Meta Business ↗
                    </a>
                  </p>
                </>
              ) : accountInfo?.error ? (
                <div className="text-[11px] text-center py-4 border border-amber-800/50 bg-amber-950/20 rounded-xl px-4 space-y-1.5">
                  <p className="font-semibold text-amber-300">⚠️ Respuesta de Meta: {accountInfo.error}</p>
                  {accountInfo.hint && <p className="text-[10px] text-gray-400">{accountInfo.hint}</p>}
                  {Array.isArray(accountInfo.debug) && accountInfo.debug.length > 0 && (
                    <p className="text-[9px] text-gray-500 font-mono">{accountInfo.debug.join(" • ")}</p>
                  )}
                  <button type="button" onClick={() => { fetchAccountInfo(); }} className="text-[10px] text-emerald-400 hover:text-emerald-300 underline font-semibold">
                    Reintentar consulta
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-gray-400 text-center py-4 border border-dashed border-border rounded-xl px-4">
                  {loadingAccount ? "Consultando saldo en Meta..." : "Sin datos de cuenta — verifica META_AD_ACCOUNT_ID y META_MARKETING_TOKEN"}
                </div>
              )}
            </div>
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
                  return (
                    <div key={c.id} className="hover:bg-surface/40 transition-colors">
                      <div className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer" onClick={() => setExpandedCamp(isExpanded ? null : c.id)}>
                        <div className="flex items-start gap-3 min-w-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleEstadoCampana(c.id, c.status); }}
                            className={`mt-1 p-2 rounded-xl border transition-all ${isActive ? "bg-emerald-950/60 border-emerald-800 text-emerald-400" : "bg-surfaceHover border-border text-gray-500"}`}
                            title={isActive ? "Pausar campaña" : "Activar campaña"}
                          >
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
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-xs text-gray-400">
                                Presupuesto: <span className="text-gray-200 font-medium">${Number(c.dailyBudget).toLocaleString("es-CO")} COP/día</span>
                              </p>
                              <button
                                type="button"
                                onClick={(e) => abrirEditarCampana(c, e)}
                                className="text-[10px] text-purple-400 hover:text-purple-300 underline font-medium flex items-center gap-0.5 ml-1"
                                title="Editar presupuesto o nombre de campaña"
                              >
                                <Edit2 className="w-2.5 h-2.5" /> Editar
                              </button>
                            </div>
                            {/* FECHAS DE LA CAMPAÑA Y DEL ANUNCIO */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px]">
                              <span className="text-gray-400">
                                📅 Inicio: <span className="text-gray-200 font-semibold">{c.startDate ? new Date(c.startTime).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Bogota" }) : "—"}</span>
                              </span>
                              <span className="text-gray-400">
                                🏁 Fin del anuncio: <span className="text-gray-200 font-semibold">{c.adEndTime || c.stopTime ? new Date(c.adEndTime || c.stopTime).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Bogota" }) : "Sin fecha de fin"}</span>
                              </span>
                              {c.diasRestantes !== null && c.diasRestantes !== undefined && (
                                <span className={`px-1.5 py-0.5 rounded font-bold ${c.diasRestantes > 0 ? "bg-emerald-950/70 text-emerald-400 border border-emerald-900" : "bg-red-950/70 text-red-400 border border-red-900"}`}>
                                  {c.diasRestantes > 0 ? `Quedan ${c.diasRestantes} día${c.diasRestantes === 1 ? "" : "s"}` : "Finalizada"}
                                </span>
                              )}
                              <span className="text-gray-500">🎬 {c.numAnuncios} anuncio{c.numAnuncios === 1 ? "" : "s"}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-border">
                          <div className="text-left md:text-right">
                            <span className="text-[10px] text-gray-500 block uppercase font-bold">Invertido</span>
                            <span className="text-sm font-bold text-gray-200">${Number(c.spend).toLocaleString("es-CO")}</span>
                          </div>
                          <div className="text-left md:text-right">
                            <span className="text-[10px] text-gray-500 block uppercase font-bold">Leads</span>
                            <span className="text-sm font-bold text-purple-400">{c.leads}</span>
                          </div>
                          <div className="text-left md:text-right">
                            <span className="text-[10px] text-gray-500 block uppercase font-bold">CPL</span>
                            <span className={`text-xs font-extrabold px-2 py-0.5 rounded ${c.cpl < 10000 ? 'bg-emerald-950/80 text-emerald-400' : c.cpl < 18000 ? 'bg-amber-950/80 text-amber-400' : 'bg-red-950/80 text-red-400'}`}>
                              ${Number(c.cpl).toLocaleString("es-CO")} COP
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* DETALLE EXPANDIBLE CON ACCESO RÁPIDO */}
                      {isExpanded && (
                        <div className="px-5 pb-5 pt-1 bg-surface/30 border-t border-border/30 flex flex-col gap-3 text-xs">
                          {/* FECHAS COMPLETAS */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div className="p-2.5 rounded-lg bg-background/70 border border-border">
                              <p className="text-[10px] uppercase font-bold text-purple-400 mb-1">📅 Fechas de la campaña</p>
                              <p className="text-[11px] text-gray-300">Inicio: <span className="text-gray-100 font-semibold">{c.legibleInicio || "—"}</span></p>
                              <p className="text-[11px] text-gray-300">Fin: <span className="text-gray-100 font-semibold">{c.legibleFin || "Sin fecha de finalización"}</span></p>
                              {c.diasTotales && <p className="text-[10px] text-gray-500 mt-0.5">Duración: {c.diasTotales} días{c.diasRestantes !== null ? ` • Restan ${c.diasRestantes}` : ""}</p>}
                            </div>
                            <div className="p-2.5 rounded-lg bg-background/70 border border-border">
                              <p className="text-[10px] uppercase font-bold text-emerald-400 mb-1">🏁 Fechas del anuncio (conjunto)</p>
                              <p className="text-[11px] text-gray-300">Inicio: <span className="text-gray-100 font-semibold">{c.legibleInicioAnuncio || c.legibleInicio || "—"}</span></p>
                              <p className="text-[11px] text-gray-300">Fin: <span className="text-gray-100 font-semibold">{c.legibleFinAnuncio || c.legibleFin || "Sin fecha de finalización"}</span></p>
                            </div>
                          </div>

                          {/* ANUNCIOS Y SUS VIDEOS */}
                          {Array.isArray(c.anuncios) && c.anuncios.length > 0 && (
                            <div className="p-2.5 rounded-lg bg-background/70 border border-border">
                              <p className="text-[10px] uppercase font-bold text-amber-400 mb-1.5">🎬 {c.anuncios.length} anuncio(s) · videos usados</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                                {c.anuncios.map((a: any) => (
                                  <div key={a.id} className="flex items-center gap-2 p-1.5 rounded bg-surface/60 border border-border/60">
                                    {a.thumbnail ? <img src={a.thumbnail} alt="" className="w-8 h-8 rounded object-cover border border-border shrink-0" /> : <div className="w-8 h-8 rounded bg-purple-950 text-purple-400 text-[8px] font-bold flex items-center justify-center shrink-0">VID</div>}
                                    <div className="min-w-0">
                                      <p className="text-[10px] text-gray-200 truncate font-medium">{a.name}</p>
                                      <p className="text-[9px] text-gray-500">{a.status} {a.videoId ? `• video ${String(a.videoId).slice(-8)}` : "• sin video"}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-4 text-gray-400">
                            <div><span className="text-gray-500 block text-[10px] uppercase font-bold">Impresiones:</span> <span className="text-gray-200 font-semibold">{Number(c.impressions || 0).toLocaleString()}</span></div>
                            <div><span className="text-gray-500 block text-[10px] uppercase font-bold">Clics en anuncio:</span> <span className="text-gray-200 font-semibold">{Number(c.clicks || 0).toLocaleString()}</span></div>
                            <div><span className="text-gray-500 block text-[10px] uppercase font-bold">CTR aprox:</span> <span className="text-gray-200 font-semibold">{c.impressions ? ((c.clicks / c.impressions) * 100).toFixed(2) + "%" : "0%"}</span></div>
                            <div><span className="text-gray-500 block text-[10px] uppercase font-bold">ID Meta:</span> <span className="font-mono text-[10px] text-gray-400">{c.id}</span></div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); marcarMemoriaAds(c, "top"); }}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-950/40 border border-amber-800/60 hover:bg-amber-900/40 text-amber-300 font-semibold text-xs flex items-center gap-1 transition-all"
                              title="Guardar en el Top 3 para que el Agente replique su estrategia"
                            >
                              ⭐ Aprender (Top 3)
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); marcarMemoriaAds(c, "fail"); }}
                              className="px-2.5 py-1.5 rounded-lg bg-red-950/40 border border-red-800/60 hover:bg-red-900/40 text-red-300 font-semibold text-xs flex items-center gap-1 transition-all"
                              title="Marcar como campaña no rentable para evitar sus errores"
                            >
                              🚫 Descartar (Error)
                            </button>
                            <button
                              type="button"
                              onClick={(e) => abrirEditarCampana(c, e)}
                              className="px-3 py-1.5 rounded-lg bg-surface border border-border hover:bg-surfaceHover text-purple-300 font-semibold text-xs flex items-center gap-1.5 transition-all"
                            >
                              <Edit2 className="w-3 h-3" /> Reajustar Presupuesto
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleEstadoCampana(c.id, c.status); }}
                              className={`px-3 py-1.5 rounded-lg border font-semibold text-xs flex items-center gap-1.5 transition-all ${
                                isActive
                                  ? "bg-amber-950/30 border-amber-800/60 text-amber-300 hover:bg-amber-900/40"
                                  : "bg-emerald-950/30 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/40"
                              }`}
                            >
                              {isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              {isActive ? "Pausar campaña" : "Activar campaña"}
                            </button>
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

        {/* ==================== CEREBRO IA ==================== */}
        {tab === "cerebro" && <CerebroPanel />}
      </main>

      {/* MODAL CONFIRMAR ELIMINACIÓN COMPLETA DEL CLIENTE */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] bg-scrim flex justify-center overflow-y-auto p-3 sm:p-4 pt-[calc(0.75rem_+_var(--safe-area-inset-top))] pb-[calc(0.75rem_+_var(--safe-area-inset-bottom))] backdrop-blur-md">
          <div className="w-full max-w-sm my-auto max-h-[92dvh] overflow-y-auto overscroll-contain bg-surface border border-red-900/50 rounded-2xl p-6 space-y-4 shadow-2xl">
            {resultadoEliminar ? (
              <>
                <div className="flex items-center gap-3 text-emerald-400">
                  <div className="w-10 h-10 rounded-full bg-emerald-950/50 border border-emerald-800 flex items-center justify-center"><CheckCircle2 className="w-5 h-5" /></div>
                  <div><h3 className="text-base font-bold text-gray-100">Cliente eliminado por completo</h3><p className="text-xs text-gray-400 break-all">{resultadoEliminar.cliente || "Se borró de todos lados"}</p></div>
                </div>
                <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-3 text-xs text-gray-300 space-y-1">
                  <p className="text-emerald-300 font-bold uppercase tracking-wider text-[10px] mb-1">CRM y Supabase</p>
                  {lineasResumenCrm(resultadoEliminar.crm).map((linea, i) => <p key={i}>• {linea}</p>)}
                  {resultadoEliminar.chatwoot ? (
                    <>
                      <p className="text-emerald-300 font-bold uppercase tracking-wider text-[10px] mt-2 mb-1">WhatsApp y fichas de Luna</p>
                      {lineasResumenChatwoot(resultadoEliminar.chatwoot).map((linea, i) => <p key={i}>• {linea}</p>)}
                    </>
                  ) : null}
                </div>
                {resultadoEliminar.advertencias.length > 0 && (
                  <div className="bg-amber-950/25 border border-amber-800/40 rounded-xl p-3 text-[11px] text-amber-200 space-y-1.5">
                    {resultadoEliminar.advertencias.map((aviso, i) => (
                      <p key={i} className="flex gap-2"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{aviso}</p>
                    ))}
                  </div>
                )}
                <div className="bg-surface/60 border border-border rounded-xl p-3 text-[11px] text-gray-400 leading-relaxed">Si este número vuelve a escribir, entra como <span className="text-gray-200 font-bold">lead nuevo</span>: sin etapa, sin notas y con las fichas de Luna reiniciadas.</div>
                <button onClick={cerrarModalEliminar} className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold transition-colors">Listo</button>
              </>
            ) : bloqueoChatwoot ? (
              <>
                <div className="flex items-center gap-3 text-amber-400">
                  <div className="w-10 h-10 rounded-full bg-amber-950/50 border border-amber-800 flex items-center justify-center"><AlertTriangle className="w-5 h-5" /></div>
                  <div><h3 className="text-base font-bold text-gray-100">No se pudo borrar la memoria de Luna</h3><p className="text-xs text-gray-400">No se eliminó nada todavía</p></div>
                </div>
                <div className="bg-amber-950/25 border border-amber-800/40 rounded-xl p-3 text-[11px] text-amber-100 leading-relaxed space-y-1.5">
                  <p>WhatsApp (Chatwoot) no dejó borrar las fichas y la memoria de Luna de este cliente.</p>
                  {bloqueoChatwoot.detalle.map((detalle, i) => <p key={i} className="text-amber-200/80">• {detalle}</p>)}
                  <p className="text-amber-200/80">Revisa que el token de Chatwoot sea de administrador (variable CHATWOOT_API_TOKEN en Vercel).</p>
                </div>
                <div className="bg-surface/60 border border-border rounded-xl p-3 text-[11px] text-gray-400 leading-relaxed">Si continuas, el cliente se borra del CRM y de Supabase, <span className="text-gray-200 font-bold">pero Luna puede seguir recordando el caso</span> cuando vuelva a escribir.</div>
                <div className="flex gap-2"><button onClick={cerrarModalEliminar} disabled={isDeleting} className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-gray-300 hover:bg-surfaceHover text-sm font-medium transition-colors disabled:opacity-50">Cancelar</button><button onClick={() => eliminarClienteDefinitivo(bloqueoChatwoot.clienteId, true)} disabled={isDeleting} className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">{isDeleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}{isDeleting ? "Eliminando..." : "Eliminar solo del CRM"}</button></div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 text-red-400">
                  <div className="w-10 h-10 rounded-full bg-red-950/50 border border-red-800 flex items-center justify-center"><Trash2 className="w-5 h-5" /></div>
                  <div><h3 className="text-base font-bold text-gray-100">¿Eliminar cliente y todos sus datos?</h3><p className="text-xs text-gray-400">Esta acción no se puede deshacer</p></div>
                </div>
                <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-3 text-xs text-gray-300 leading-relaxed space-y-1.5">
                  <p>Se eliminan permanentemente <span className="text-red-300 font-bold">todas sus conversaciones, mensajes, fotos, audios, notas, tareas, pagos, recordatorios y reglas del Cerebro</span> del CRM y de Supabase.</p>
                  <p>También se borra <span className="text-red-300 font-bold">su chat de WhatsApp y las fichas de Luna</span> (motivo del caso, nombres, fotos y etapa que Luna ya aprendió).</p>
                </div>
                <div className="bg-surface/60 border border-border rounded-xl p-3 text-[11px] text-gray-400 leading-relaxed">Si vuelve a escribir, se crea desde cero como <span className="text-gray-200 font-bold">lead nuevo</span>, con las fichas de Luna reiniciadas.</div>
                <div className="flex gap-2"><button onClick={cerrarModalEliminar} disabled={isDeleting} className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-gray-300 hover:bg-surfaceHover text-sm font-medium transition-colors disabled:opacity-50">Cancelar</button><button onClick={() => eliminarClienteDefinitivo(showDeleteConfirm.clienteId)} disabled={isDeleting} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">{isDeleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}{isDeleting ? "Eliminando todo..." : "Sí, eliminar todo"}</button></div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODAL IA */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 bg-scrim flex justify-center overflow-y-auto p-3 sm:p-4 pt-[calc(0.75rem_+_var(--safe-area-inset-top))] pb-[calc(0.75rem_+_var(--safe-area-inset-bottom))] backdrop-blur-md">
          <div className="w-full max-w-2xl my-auto max-h-[92dvh] bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3"><div className="flex items-center gap-2 text-purple-400"><Sparkles className="w-5 h-5" /><h3 className="text-lg font-bold text-gray-100">Auditoría IA</h3></div><button onClick={() => setShowAiModal(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button></div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">{loadingAiAds ? (<div className="p-12 text-center space-y-3"><Sparkles className="w-10 h-10 text-purple-500 animate-spin mx-auto" /><p className="text-sm text-gray-300 font-medium">Analizando métricas con OpenAI...</p></div>) : (<div className="prose prose-invert max-w-none text-xs md:text-sm leading-relaxed whitespace-pre-wrap text-gray-200 bg-background/80 p-5 rounded-xl border border-border">{aiRecommendation}</div>)}</div>
          </div>
        </div>
      )}

      {/* MODAL ADMIN */}
      {showAdmin && (
        <div className="fixed inset-0 z-50 bg-scrim flex justify-center overflow-y-auto p-3 sm:p-4 pt-[calc(0.75rem_+_var(--safe-area-inset-top))] pb-[calc(0.75rem_+_var(--safe-area-inset-bottom))] backdrop-blur-sm">
          <div className="w-full max-w-sm my-auto max-h-[92dvh] overflow-y-auto overscroll-contain bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl">
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

      {/* MODAL AJUSTES: TEMA Y NOTIFICACIONES */}
      {showAjustes && <AjustesPanel onClose={() => setShowAjustes(false)} />}

      {/* MODAL CREAR NUEVA CAMPAÑA EN META ADS - POTENCIADO: FECHA INICIO + NUM ANUNCIOS + WHATSAPP + PREVIEW + SALDO */}
      {showCrearCampModal && (
        <div className="fixed inset-0 z-50 bg-scrim flex justify-center overflow-y-auto p-3 sm:p-4 pt-[calc(0.75rem_+_var(--safe-area-inset-top))] pb-[calc(0.75rem_+_var(--safe-area-inset-bottom))] backdrop-blur-md">
          <div className="w-full max-w-2xl my-auto bg-surface border border-border rounded-2xl p-5 space-y-4 shadow-2xl flex flex-col max-h-[95dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3 sticky top-0 bg-surface z-10">
              <div className="flex items-center gap-2 text-purple-400">
                <Plus className="w-5 h-5" />
                <h3 className="text-base font-bold text-gray-100">Crear Campaña Potenciada - Solo WhatsApp</h3>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold">WHATSAPP ONLY</span>
              </div>
              <button type="button" onClick={() => setShowCrearCampModal(false)} className="text-gray-400 hover:text-white p-1 rounded-lg"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={crearNuevaCampanaAds} className="space-y-4">
              {/* GRID PRINCIPAL */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* COLUMNA IZQ: CONFIG */}
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-300 block mb-1 font-bold flex items-center gap-1">🏷️ Nombre de la Campaña *</label>
                    <input type="text" required placeholder="Ej: Retornos Pareja - Marzo 2026" value={nuevaCampNombre} onChange={(e) => setNuevaCampNombre(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500" />
                  </div>

                  {/* FECHA INICIO SUPER IMPORTANTE */}
                  <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-800/40 space-y-2">
                    <label className="text-xs text-purple-300 block font-bold flex items-center gap-1.5">📅 Fecha de Inicio * <span className="text-[9px] bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">SUPER IMPORTANTE</span></label>
                    <input type="date" required value={nuevaCampFechaInicio} min={new Date().toISOString().split("T")[0]} onChange={(e) => setNuevaCampFechaInicio(e.target.value)} className="w-full bg-background border border-purple-700/50 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500" />
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="bg-background/80 p-2 rounded-lg border border-border"><span className="text-gray-500 block">Hora inicio</span><span className="text-gray-200 font-mono font-bold">00:01 Bogotá</span></div>
                      <div className="bg-background/80 p-2 rounded-lg border border-border"><span className="text-gray-500 block">Hora fin</span><span className="text-gray-200 font-mono font-bold">23:59 Bogotá</span></div>
                    </div>
                    {previewCampana && (
                      <div className="text-[10px] text-purple-200 bg-background/60 p-2 rounded-lg border border-purple-900/30">
                        <p className="font-semibold">🗓️ {previewCampana.dias} días programados</p>
                        <p>Inicio: {previewCampana.legibleInicio}</p>
                        <p>Fin: {previewCampana.legibleFin}</p>
                      </div>
                    )}
                  </div>

                  {/* DÍAS */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-300 font-bold">⏳ Duración (Días)</label>
                      <span className="text-[10px] text-purple-400 font-mono">00:01 → 23:59</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[1,2,3,4,5,7,8,14,21,30].map((d) => (
                        <button key={d} type="button" onClick={() => setNuevaCampDias(d)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${nuevaCampDias === d ? "bg-purple-600 border-purple-500 text-white shadow" : "bg-surface border-border text-gray-400 hover:text-white"}`}>{d}d</button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <input type="number" min="1" max="90" value={nuevaCampDias} onChange={(e) => setNuevaCampDias(Math.max(1, Number(e.target.value) || 1))} className="w-20 bg-background border border-border rounded px-2 py-1 text-xs text-gray-200 text-center" />
                      <span className="text-[11px] text-gray-500">días personalizados • Finaliza siempre 23:59</span>
                    </div>
                  </div>

                  {/* NUMERO DE ANUNCIOS 1-5 */}
                  <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-800/30 space-y-2">
                    <label className="text-xs text-amber-300 block font-bold">🎬 ¿Cuántos anuncios? = videos DIFERENTES (1-5)</label>
                    <div className="flex gap-1.5">
                      {[1,2,3,4,5].map((n) => (
                        <button key={n} type="button" onClick={() => setNuevaCampNumAnuncios(n)} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${nuevaCampNumAnuncios === n ? "bg-amber-600 border-amber-500 text-white shadow" : "bg-surface border-border text-gray-400 hover:text-white"}`}>{n}</button>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-400">Cada anuncio usa un <span className="text-amber-300 font-bold">video DIFERENTE</span> de los publicados en la Fan Page. Si eliges {nuevaCampNumAnuncios}, serán {nuevaCampNumAnuncios} video{nuevaCampNumAnuncios===1?"":"s"} distinto{nuevaCampNumAnuncios===1?"":"s"} compitiendo entre sí para hallar el ganador por CPL.</p>
                  </div>

                  {/* WHATSAPP SELECTOR VINCULADO */}
                  <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-emerald-300 block font-bold flex items-center gap-1.5">💬 Número WhatsApp Destino * <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-300">SOLO WHATSAPP</span></label>
                      <button type="button" onClick={fetchWhatsappNumbers} className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"><RefreshCw className={`w-3 h-3 ${loadingWhatsappNumbers?'animate-spin':''}`} /> Recargar</button>
                    </div>
                    {whatsappNumbers.length>0 ? (
                      <div className="space-y-2">
                        <select value={selectedWhatsappId} onChange={(e)=>{ const v=e.target.value; setSelectedWhatsappId(v); const obj=whatsappNumbers.find((w:any)=>w.id===v); if(obj) setSelectedWhatsappDisplay(obj.display_number || obj.display_phone_number); }} className="w-full bg-background border border-emerald-700/50 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500">
                          {whatsappNumbers.map((w:any)=> (<option key={w.id} value={w.id}>{w.display_number || w.display_phone_number}{w.verified_name?` — ${w.verified_name}`:""}</option>))}
                        </select>
                        {/* EL NÚMERO, bien grande y claro */}
                        {(() => {
                          const wsel = whatsappNumbers.find((w:any)=>w.id===selectedWhatsappId) || whatsappNumbers[0];
                          if(!wsel) return null;
                          return (
                            <div className="p-2.5 rounded-lg bg-background border border-emerald-800/50">
                              <p className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">Los mensajes llegarán a este número</p>
                              <p className="text-base font-extrabold text-emerald-300 font-mono tracking-wide">{wsel.display_number || wsel.display_phone_number}</p>
                              <p className="text-[10px] text-gray-400">{wsel.verified_name}{wsel.quality_rating?` • Calidad ${wsel.quality_rating}`:""}{wsel.waba_name?` • ${wsel.waba_name}`:""}</p>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (<div className="p-2 rounded-lg border border-dashed border-amber-800/50 text-center text-[11px] text-amber-300/80">{loadingWhatsappNumbers?"Cargando números vinculados...":"⚠️ No hay números de WhatsApp vinculados al token. Vincula tu WhatsApp Business en Meta o configura META_WABA_ID."}</div>)}
                    <div className="flex items-center gap-2 text-[10px] text-emerald-200 bg-background/60 p-2 rounded-lg border border-emerald-900/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Campañas únicamente dirigidas a WhatsApp. Nada de Messenger ni otras plataformas. Solo WhatsApp.
                    </div>
                  </div>
                </div>

                {/* COLUMNA DER: PRESUPUESTO + SEGMENTACION + VIDEO + SALDO */}
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-300 block mb-1 font-bold">💰 Modalidad de Presupuesto</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={()=>{ setNuevaCampTipoPresupuesto("lifetime"); if(!nuevaCampPresupuesto) setNuevaCampPresupuesto("40000"); }} className={`p-2.5 rounded-xl border text-left transition-all ${nuevaCampTipoPresupuesto==="lifetime" ? "bg-purple-950/60 border-purple-600 text-purple-200 shadow-sm" : "bg-surface border-border text-gray-400 hover:text-white"}`}><p className="text-xs font-bold">Total</p><p className="text-[10px] text-gray-400 mt-0.5">Global X días</p></button>
                      <button type="button" onClick={()=>{ setNuevaCampTipoPresupuesto("daily"); if(!nuevaCampPresupuesto) setNuevaCampPresupuesto("10000"); }} className={`p-2.5 rounded-xl border text-left transition-all ${nuevaCampTipoPresupuesto==="daily" ? "bg-purple-950/60 border-purple-600 text-purple-200 shadow-sm" : "bg-surface border-border text-gray-400 hover:text-white"}`}><p className="text-xs font-bold">Diario</p><p className="text-[10px] text-gray-400 mt-0.5">Por día</p></button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-300 block mb-1 font-bold">{nuevaCampTipoPresupuesto==="lifetime" ? "Presupuesto Total (COP)" : "Presupuesto Diario (COP)"} *</label>
                    <div className="relative"><span className="absolute left-3 top-2 text-xs text-gray-500 font-mono">$</span><input type="number" min="1000" step="1000" placeholder={nuevaCampTipoPresupuesto==="lifetime"?"Ej: 40000":"Ej: 10000"} value={nuevaCampPresupuesto} onChange={(e)=>setNuevaCampPresupuesto(e.target.value)} className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500" required /></div>
                    {Number(nuevaCampPresupuesto)>0 && (
                      <div className="mt-2 p-2.5 rounded-lg bg-surface/80 border border-border text-[11px] text-gray-400 space-y-1">
                        <div className="flex justify-between"><span>Neta:</span><span className="text-gray-200 font-semibold">${Number(nuevaCampPresupuesto).toLocaleString("es-CO")} COP</span></div>
                        <div className="flex justify-between"><span>IVA 19%:</span><span className="text-amber-400 font-semibold">+${Math.round(Number(nuevaCampPresupuesto)*0.19).toLocaleString("es-CO")} COP</span></div>
                        <div className="flex justify-between border-t border-border/50 pt-1 font-bold text-gray-200"><span>Total factura:</span><span className="text-emerald-400">${Math.round(Number(nuevaCampPresupuesto)*1.19).toLocaleString("es-CO")} COP</span></div>
                        <div className="text-[10px] text-purple-300">{nuevaCampTipoPresupuesto==="lifetime"?`≈ $${Math.round(Number(nuevaCampPresupuesto)/(nuevaCampDias||4)).toLocaleString("es-CO")} COP/día neto`:`$${Number(nuevaCampPresupuesto).toLocaleString("es-CO")} COP/día • Total ${nuevaCampDias}d = $${(Number(nuevaCampPresupuesto)*nuevaCampDias).toLocaleString("es-CO")} neto`}</div>
                      </div>
                    )}
                  </div>

                  {/* VIDEOS DE LA FAN PAGE: UNO DIFERENTE POR CADA ANUNCIO */}
                  <div className="p-3 rounded-xl bg-purple-950/10 border border-purple-800/20 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-300 font-bold flex items-center gap-1.5"><Video className="w-3.5 h-3.5 text-purple-400" /> Videos de la Fan Page</label>
                      <button type="button" onClick={fetchVideosFanPage} className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1"><RefreshCw className={`w-3 h-3 ${loadingVideos?'animate-spin':''}`} /> Refrescar</button>
                    </div>
                    {videosNota && <p className="text-[9px] text-gray-500 leading-snug">{videosNota}</p>}

                    <div className={`p-2 rounded-lg text-[10px] font-semibold border ${videosSeleccionadosObj.length === nuevaCampNumAnuncios ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300" : "bg-amber-950/40 border-amber-800/50 text-amber-300"}`}>
                      {videosSeleccionadosObj.length === nuevaCampNumAnuncios
                        ? `✅ ${nuevaCampNumAnuncios} anuncios = ${videosSeleccionadosObj.length} videos DIFERENTES seleccionados`
                        : `⚠️ Pediste ${nuevaCampNumAnuncios} anuncios → elige ${nuevaCampNumAnuncios} videos diferentes (llevas ${videosSeleccionadosObj.length})`}
                    </div>

                    {pageVideos.length>0 ? (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {pageVideos.map((v:any)=>{
                          const pos = selectedVideoIds.indexOf(v.id);
                          const elegido = pos >= 0 && pos < nuevaCampNumAnuncios;
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={()=>toggleVideoSeleccionado(v.id)}
                              className={`w-full text-left p-2 rounded-lg border flex items-center gap-2.5 transition-all ${elegido ? "bg-purple-950/50 border-purple-600" : "bg-surface/50 border-border hover:border-purple-800"}`}
                            >
                              <div className="relative shrink-0">
                                {v.picture ? <img src={v.picture} alt="" className="w-11 h-11 object-cover rounded-md border border-border" /> : <div className="w-11 h-11 rounded-md bg-purple-950 flex items-center justify-center text-purple-400 font-bold text-[9px]">VID</div>}
                                {elegido && <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-purple-600 text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-surface">{pos+1}</span>}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={`text-[11px] font-semibold truncate ${elegido ? "text-purple-200" : "text-gray-200"}`}>{v.title}</p>
                                <p className="text-[9px] text-gray-500">{v.views ? `${Number(v.views).toLocaleString("es-CO")} vistas • ` : ""}{v.length ? `${v.length}s • ` : ""}{v.createdTime ? new Date(v.createdTime).toLocaleDateString("es-CO", { day:"2-digit", month:"short", year:"numeric" }) : ""}</p>
                                {v.tiene_copy
                                  ? <p className="text-[9px] text-gray-400 line-clamp-2 mt-0.5 whitespace-pre-wrap">📝 {v.copy_original || v.description}</p>
                                  : <p className="text-[9px] text-amber-500/80 mt-0.5">⚠️ Sin copy publicado — tendrás que escribirlo</p>}
                              </div>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${elegido ? "bg-purple-600 text-white" : "bg-surface border border-border text-gray-500"}`}>{elegido ? `Anuncio ${pos+1}` : "Elegir"}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (<div className="p-2.5 rounded-lg border border-dashed border-border text-center text-[11px] text-gray-400">{loadingVideos ? "Cargando videos publicados..." : "No se encontraron videos publicados en la Fan Page."}</div>)}

                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={()=>setUsarCopyVideo(true)} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border ${usarCopyVideo?"bg-purple-600 border-purple-500 text-white":"bg-surface border-border text-gray-400"}`}>Usar copy de cada video</button>
                      <button type="button" onClick={()=>setUsarCopyVideo(false)} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border ${!usarCopyVideo?"bg-amber-600 border-amber-500 text-white":"bg-surface border-border text-gray-400"}`}>Usar copy del agente</button>
                    </div>

                    {/* COPY ORIGINAL COMPLETO DE CADA VIDEO ELEGIDO */}
                    {usarCopyVideo && videosSeleccionadosObj.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-[10px] font-bold text-purple-300">📝 Copy original publicado en la fan page:</p>
                        {videosSeleccionadosObj.map((v: any, idx: number) => (
                          <div key={v.id} className="p-2 rounded-lg bg-background/70 border border-border/60">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[9px] font-bold text-gray-300 truncate">Anuncio {idx + 1} · {v.title}</span>
                              <span className={`text-[8px] px-1.5 py-0.5 rounded shrink-0 ${v.tiene_copy ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-amber-950 text-amber-300 border border-amber-800"}`}>
                                {v.copy_origen === "post" ? "texto del post" : v.copy_origen === "video_description" ? "descripción del video" : v.copy_origen === "video_node" ? "texto del video" : "sin copy"}
                              </span>
                            </div>
                            {v.tiene_copy ? (
                              <>
                                <p className="text-[10px] text-gray-300 whitespace-pre-wrap leading-snug max-h-24 overflow-y-auto">{v.copy_original || v.description}</p>
                                {v.permalink && (
                                  <a href={v.permalink} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()} className="text-[9px] text-purple-400 hover:text-purple-300 underline">Ver publicación original ↗ (verifica que el copy sea este)</a>
                                )}
                              </>
                            ) : (
                              <p className="text-[10px] text-amber-400/90">Este video no tiene texto publicado. Escribe el copy abajo para este anuncio.</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* COPY DEL AGENTE - BASE + VARIACIONES 1-5 */}
                  <div className="p-3 rounded-xl bg-amber-950/15 border border-amber-800/30 space-y-2">
                    <label className="text-xs text-amber-300 font-bold flex items-center gap-1.5">✍️ Copy del Anuncio {usarCopyVideo?"(Base + variaciones)" : "(Del agente)"} <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900 text-amber-200">{usarCopyVideo?"VIDEO + AGENTE":"SOLO AGENTE"}</span></label>
                    <textarea placeholder={usarCopyVideo?"Copy base opcional del agente que se sumará al copy del video... Ej: ¡Oferta limitada! Consulta gratis hoy.":"Escribe el copy principal que llevará el anuncio... Ej: 🔮 ¿Sientes que tu pareja se aleja? Amarres efectivos, retornos en 24h. Escríbeme al WhatsApp ahora y te revelo tu destino..."} value={nuevaCampCopy} onChange={(e)=>setNuevaCampCopy(e.target.value)} rows={3} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-amber-500 resize-y" />
                    <p className="text-[9px] text-gray-500">{usarCopyVideo?"Si dejas vacío, se usa solo el copy que ya trae el video. Si escribes algo, se combinará.":"Este será el texto principal del anuncio. Puedes añadir variaciones por cada anuncio abajo."}</p>
                    
                    {/* VARIACIONES POR ANUNCIO */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-gray-400 font-bold">Variaciones por anuncio (opcional) - para probar {nuevaCampNumAnuncios} copies diferentes:</label>
                      {Array.from({ length: nuevaCampNumAnuncios }, (_, i) => (
                        <div key={i} className="flex gap-1.5 items-start">
                          <span className="text-[9px] font-bold text-gray-500 mt-2 w-6">#{i+1}</span>
                          <textarea placeholder={`Variación ${i+1} - Ej: ${i===0?"Versión directa" : i===1?"Versión emocional" : i===2?"Versión con testimonio" : "Otra prueba A/B"}...`} value={nuevaCampCopies[i] || ""} onChange={(e)=>{ const cp=[...nuevaCampCopies]; cp[i]=e.target.value; setNuevaCampCopies(cp); }} rows={2} className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-gray-200 focus:outline-none focus:border-amber-500 resize-y" />
                        </div>
                      ))}
                    </div>
                    <div className="text-[9px] text-amber-200/70 bg-background/50 p-1.5 rounded border border-amber-900/30">
                      💡 Tip: Usa el copy del video para mantener autenticidad + añade variaciones del agente para probar ganchos diferentes. El preview abajo mostrará exactamente cómo quedará cada anuncio.
                    </div>
                  </div>

                  {/* TODAS LAS SEGMENTACIONES GUARDADAS */}
                  <div className="p-3 rounded-xl bg-surface/60 border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-300 font-bold flex items-center gap-1">🎯 Segmentaciones Guardadas ({segmentacionesGuardadas.length})</label>
                      <button type="button" onClick={fetchSegmentaciones} className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1"><RefreshCw className={`w-3 h-3 ${loadingSegmentaciones?'animate-spin':''}`} /> Recargar</button>
                    </div>

                    {segmentacionesGuardadas.length > 0 ? (
                      <select
                        value={selectedSegmentacionId}
                        onChange={(e)=>aplicarSegmentacion(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                      >
                        <option value="">— Elegir segmentación guardada —</option>
                        <optgroup label={`Públicos guardados (${segmentacionesGuardadas.filter((x:any)=>x.origen==="saved_audience").length})`}>
                          {segmentacionesGuardadas.filter((x:any)=>x.origen==="saved_audience").map((x:any)=>(
                            <option key={x.id} value={x.id}>{x.nombre}{typeof x.tamano_aprox === "number" ? ` (${x.tamano_aprox.toLocaleString("es-CO")})` : ""}</option>
                          ))}
                        </optgroup>
                        <optgroup label={`Públicos personalizados (${segmentacionesGuardadas.filter((x:any)=>x.origen==="custom_audience").length})`}>
                          {segmentacionesGuardadas.filter((x:any)=>x.origen==="custom_audience").map((x:any)=>(
                            <option key={x.id} value={x.id}>{x.nombre}</option>
                          ))}
                        </optgroup>
                        <optgroup label={`En uso en conjuntos (${segmentacionesGuardadas.filter((x:any)=>x.origen==="adset").length})`}>
                          {segmentacionesGuardadas.filter((x:any)=>x.origen==="adset").map((x:any)=>(
                            <option key={x.id} value={x.id}>{x.nombre}</option>
                          ))}
                        </optgroup>
                      </select>
                    ) : (
                      <div className="p-2 rounded-lg border border-dashed border-border text-center text-[11px] text-gray-400">
                        {loadingSegmentaciones ? "Cargando segmentaciones de la cuenta..." : (segmentacionesNota || "No se encontraron segmentaciones guardadas.")}
                      </div>
                    )}

                    {/* Detalle de la segmentación activa */}
                    <div className="text-[10px] text-gray-400 space-y-1 bg-background/60 p-2 rounded-lg border border-border/50">
                      <div className="flex justify-between"><span>Usando:</span><span className="text-purple-300 font-bold text-right truncate max-w-[60%]">{segmentacionGuardada?.nombre || "Segmentación por defecto"}</span></div>
                      <div className="flex justify-between"><span>País:</span><span className="text-gray-200 font-medium">{segmentacionGuardada?.location?.countries?.join(", ") || "CO"}</span></div>
                      {segmentacionGuardada?.location?.cities?.length > 0 && (
                        <div className="flex justify-between"><span>Ciudades:</span><span className="text-gray-200 text-right truncate max-w-[60%]">{segmentacionGuardada.location.cities.slice(0,3).join(", ")}</span></div>
                      )}
                      <div className="flex justify-between"><span>Edad:</span><span className="text-gray-200">{segmentacionGuardada?.age_min ?? 18}-{segmentacionGuardada?.age_max ?? 65}</span></div>
                      <div className="flex justify-between"><span>Género:</span><span className="text-gray-200">{(segmentacionGuardada?.genders||[1,2]).length===2?"Todos":(segmentacionGuardada?.genders||[]).includes(1)?"Hombres":"Mujeres"}</span></div>
                      <div><span className="text-gray-500">Intereses:</span><div className="flex flex-wrap gap-1 mt-1">{(segmentacionGuardada?.interests || []).slice(0,6).map((it:string,idx:number)=>(<span key={idx} className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950 border border-purple-800 text-purple-300">{it}</span>))}{(segmentacionGuardada?.interests||[]).length===0 && <span className="text-gray-600">Sin intereses definidos</span>}</div></div>
                      <div className="flex justify-between"><span>Destino:</span><span className="text-emerald-300 font-bold">WHATSAPP_ONLY</span></div>
                    </div>
                    {segmentacionesGuardadas.length > 0 && segmentacionesGuardadas.filter((x:any)=>x.origen==="saved_audience").length === 0 && !loadingSegmentaciones && (
                      <p className="text-[10px] text-amber-300/90 bg-amber-950/20 border border-amber-800/40 rounded-lg p-2">⚠️ Esta cuenta publicitaria no tiene públicos guardados (o el token no tiene permiso ads_read). Los que ves son personalizados o segmentaciones en uso. Crea públicos en el Administrador de anuncios → Públicos.</p>
                    )}
                    {segmentacionesNota && segmentacionesGuardadas.length > 0 && <p className="text-[9px] text-gray-500">{segmentacionesNota}</p>}
                  </div>

                  {/* SALDO CUENTA PUBLICITARIA (solo lectura - Meta no permite recargar por API) */}
                  <div className="p-3 rounded-xl bg-gray-900/60 border border-border space-y-2">
                    <div className="flex items-center justify-between"><label className="text-xs text-gray-300 font-bold">💳 Saldo Cuenta Publicitaria</label><button type="button" onClick={fetchAccountInfo} className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1"><RefreshCw className={`w-3 h-3 ${loadingAccount?'animate-spin':''}`} /> Actualizar</button></div>
                    {accountInfo && !accountInfo.error ? (
                      <div className="text-[11px] space-y-1 bg-background/80 p-2.5 rounded-lg border border-border">
                        <div className="flex justify-between"><span className="text-gray-500">Cuenta:</span><span className="text-gray-200 font-mono truncate max-w-[60%] text-right">{accountInfo.name || accountInfo.id}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Saldo total:</span><span className="text-emerald-400 font-bold">{accountInfo.saldo_disponible_formatted || accountInfo.balance_formatted}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Gastado hoy:</span><span className="text-amber-300 font-semibold">{accountInfo.spend_today_formatted}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Gastado total:</span><span className="text-gray-300">{accountInfo.amount_spent_formatted}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">Límite:</span><span className="text-gray-300">{accountInfo.spend_cap_formatted}</span></div>
                      </div>
                    ) : accountInfo?.error ? (
                      <div className="text-[11px] text-center py-2 px-2 border border-amber-800/50 bg-amber-950/20 rounded-lg text-amber-300">⚠️ {accountInfo.error}</div>
                    ) : (<div className="text-[11px] text-gray-500 text-center py-2 border border-dashed border-border rounded-lg">{loadingAccount?"Cargando cuenta...":"Sin datos de cuenta - verifica META_AD_ACCOUNT_ID"}</div>)}
                    <p className="text-[9px] text-gray-500">La API de Meta no permite recargar saldo. Hazlo en <a href={accountInfo?.billing_url || "https://business.facebook.com/billing_hub/accounts"} target="_blank" rel="noreferrer" className="text-emerald-400 underline">Meta Business → Facturación ↗</a></p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-xs text-gray-400 block mb-1 font-semibold">Objetivo</label><select value={nuevaCampObjetivo} onChange={(e)=>setNuevaCampObjetivo(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"><option value="OUTCOME_ENGAGEMENT">Mensajes WhatsApp (Recomendado)</option><option value="OUTCOME_LEADS">Leads</option><option value="OUTCOME_TRAFFIC">Tráfico</option></select></div>
                    <div><label className="text-xs text-gray-400 block mb-1 font-semibold">Estado Inicial</label><div className="flex gap-1"><button type="button" onClick={()=>setNuevaCampEstado("ACTIVE")} className={`flex-1 py-2 rounded-lg text-[10px] font-bold border ${nuevaCampEstado==="ACTIVE"?"bg-emerald-950/60 border-emerald-800 text-emerald-300":"bg-surface border-border text-gray-400"}`}>Activa</button><button type="button" onClick={()=>setNuevaCampEstado("PAUSED")} className={`flex-1 py-2 rounded-lg text-[10px] font-bold border ${nuevaCampEstado==="PAUSED"?"bg-amber-950/60 border-amber-800 text-amber-300":"bg-surface border-border text-gray-400"}`}>Pausada</button></div></div>
                  </div>
                </div>
              </div>

              {/* PREVIEW COMPLETO - SIEMPRE VISIBLE CON COPY DEL VIDEO O AGENTE */}
              {previewCampana ? (
                <div className="p-4 rounded-xl bg-gradient-to-br from-purple-950/30 via-background to-emerald-950/20 border border-purple-800/40 space-y-3">
                  <h4 className="text-xs font-bold text-purple-300 flex items-center gap-2">👁️ Vista Previa Completa de Campaña <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-900 text-purple-200">EN VIVO</span> <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900 text-amber-200">COPY: {previewCampana.usar_copy_video?"VIDEO + AGENTE":"AGENTE"}</span></h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                    <div className="space-y-1.5 bg-background/70 p-2.5 rounded-lg border border-border">
                      <p className="font-bold text-gray-100 text-xs">{previewCampana.nombre}</p>
                      <div className="space-y-0.5 text-gray-400"><p>📅 <span className="text-gray-200">{previewCampana.legibleInicio}</span></p><p>🏁 <span className="text-gray-200">{previewCampana.legibleFin}</span></p><p>⏰ 00:01 → 23:59 Bogotá • {previewCampana.dias} días</p><p>📊 {previewCampana.numAnuncios} anuncios con {previewCampana.videos?.length || 0} videos diferentes</p><p>🎯 Destino: <span className="text-emerald-300 font-bold">SOLO WHATSAPP {previewCampana.whatsappNumero || "⚠️ falta número"}</span></p></div>
                    </div>
                    <div className="space-y-1.5 bg-background/70 p-2.5 rounded-lg border border-border">
                      <p className="font-bold text-gray-300">💰 Presupuesto</p>
                      <p className="text-gray-400">Tipo: <span className="text-gray-200">{previewCampana.tipo==="lifetime"?"Total":"Diario"}</span> • Neto: <span className="text-gray-200">${previewCampana.presupuesto.toLocaleString("es-CO")} COP</span></p>
                      <p className="text-amber-300">IVA 19%: +${previewCampana.iva.toLocaleString("es-CO")} COP</p>
                      <p className="text-emerald-400 font-bold">Total factura: ${previewCampana.totalConIva.toLocaleString("es-CO")} COP</p>
                      <p className="text-purple-300">Diario aprox: ${previewCampana.diario.toLocaleString("es-CO")} COP</p>
                    </div>
                  </div>

                  {/* COPY PREVIEW POR ANUNCIO - NUEVO REQUERIMIENTO */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-amber-300">✍️ Copy con el que va cada anuncio ({previewCampana.usar_copy_video?"del video seleccionado o del agente" : "del agente"}):</p>
                    <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1">
                      {previewCampana.anuncios.map((ad:any, idx:number)=>(
                        <div key={ad.id} className="p-2.5 rounded-lg bg-background/80 border border-border space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-gray-200">{ad.nombre}</span>
                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-surface border border-border text-gray-400">{ad.copy_origen}</span>
                          </div>
                          <div className="flex gap-2 items-start">
                            {ad.video_thumb && <img src={ad.video_thumb} alt="thumb" className="w-8 h-8 rounded object-cover border border-border shrink-0 mt-0.5" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-gray-200 whitespace-pre-wrap leading-snug">{ad.copy}</p>
                              <p className="text-[9px] text-gray-500 mt-1">CTA: {ad.cta} • 🎬 <span className="text-purple-300 font-semibold">{ad.video_title}</span> → WhatsApp <span className="text-emerald-300 font-mono">{previewCampana.whatsappNumero || "—"}</span></p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {previewCampana.copy_base_video && (
                      <div className="p-2 rounded-lg bg-purple-950/20 border border-purple-800/30 text-[10px]">
                        <p className="text-purple-300 font-bold">📹 Copy original publicado en la fan page:</p>
                        <p className="text-gray-400 whitespace-pre-wrap mt-1">{previewCampana.copy_base_video.substring(0,300)}{previewCampana.copy_base_video.length>300?"...":""}</p>
                      </div>
                    )}
                    {previewCampana.copy_base_agente && (
                      <div className="p-2 rounded-lg bg-amber-950/20 border border-amber-800/30 text-[10px]">
                        <p className="text-amber-300 font-bold">🤖 Copy colocado por el agente:</p>
                        <p className="text-gray-300 whitespace-pre-wrap mt-1">{previewCampana.copy_base_agente}</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[10px]">
                    <div className="bg-background/60 p-2 rounded-lg border border-border/50"><p className="font-bold text-gray-300 mb-1">🎯 Segmentación: <span className="text-purple-300">{previewCampana.segmentacionNombre}</span></p><p className="text-gray-400">País: {previewCampana.segmentacion?.location?.countries?.join(", ") || "CO"} • Edad: {previewCampana.segmentacion?.age_min ?? 18}-{previewCampana.segmentacion?.age_max ?? 65}</p><p className="text-gray-400">Intereses: {(previewCampana.segmentacion?.interests || []).slice(0,3).join(", ") || "—"}</p><p className="text-emerald-300">Solo WhatsApp placements: {previewCampana.segmentacion?.placements?.length || 4} (FB/IG feed/story/reels)</p></div>
                    <div className="bg-background/60 p-2 rounded-lg border border-border/50"><p className="font-bold text-gray-300 mb-1">💬 WhatsApp + Videos</p><p className="text-gray-400">Número: <span className="text-emerald-300 font-mono font-bold">{previewCampana.whatsappNumero || "⚠️ sin número"}</span></p><p className="text-gray-400">{previewCampana.whatsapp?.verified_name || ""}</p><p className="text-gray-400 mt-1">Videos diferentes: <span className="text-purple-300 font-bold">{previewCampana.videos?.length || 0} de {previewCampana.numAnuncios}</span>{previewCampana.videosFaltantes > 0 && <span className="text-amber-400"> • faltan {previewCampana.videosFaltantes}</span>}</p><p className="text-[9px] text-gray-500 mt-1">Campañas únicamente dirigidas a WhatsApp, nada de Messenger ni demás plataformas, solo WhatsApp.</p></div>
                  </div>
                  {accountInfo && (<div className="p-2 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-[11px] text-emerald-200">💳 Saldo actual de la cuenta: <span className="font-bold">{accountInfo.saldo_disponible_formatted || accountInfo.balance_formatted}</span> • Gastado hoy: <span className="font-bold">{accountInfo.spend_today_formatted}</span></div>)}
                </div>
              ) : (
                <div className="p-3 rounded-xl border border-dashed border-border text-center text-[11px] text-gray-500">Completa presupuesto y fecha de inicio para ver la vista previa completa con valores, segmentación, fechas con hora y copy del anuncio (video o agente)</div>
              )}

              <div className="pt-2 flex gap-2 sticky bottom-0 bg-surface">
                <button type="button" onClick={()=>setShowCrearCampModal(false)} disabled={guardandoCampana} className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-gray-300 hover:bg-surfaceHover text-xs font-medium transition-colors disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={guardandoCampana} className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">{guardandoCampana?<RefreshCw className="w-4 h-4 animate-spin" />:<Plus className="w-4 h-4" />}{guardandoCampana?"Creando en Meta...":`Crear ${nuevaCampNumAnuncios} anuncio${nuevaCampNumAnuncios>1?'s':''} WhatsApp`}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EDITAR CAMPAÑA EXISTENTE / MODIFICAR PRESUPUESTO */}
      {/* MODAL EDITAR CAMPAÑA EXISTENTE / MODIFICAR PRESUPUESTO */}
      {campanaEditando && (
        <div className="fixed inset-0 z-50 bg-scrim flex justify-center overflow-y-auto p-3 sm:p-4 pt-[calc(0.75rem_+_var(--safe-area-inset-top))] pb-[calc(0.75rem_+_var(--safe-area-inset-bottom))] backdrop-blur-md">
          <div className="w-full max-w-md my-auto bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-purple-400">
                <Edit2 className="w-5 h-5" />
                <h3 className="text-base font-bold text-gray-100">Modificar Campaña Meta Ads</h3>
              </div>
              <button
                type="button"
                onClick={() => setCampanaEditando(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={guardarEdicionCampana} className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1 font-semibold">
                  Nombre de la Campaña
                </label>
                <input
                  type="text"
                  required
                  value={editCampNombre}
                  onChange={(e) => setEditCampNombre(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1 font-semibold">
                  Modalidad de Presupuesto
                </label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setEditCampTipoPresupuesto("lifetime")}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      editCampTipoPresupuesto === "lifetime"
                        ? "bg-purple-950/60 border-purple-600 text-purple-200 shadow-sm"
                        : "bg-surface border-border text-gray-400 hover:text-white"
                    }`}
                  >
                    <p className="text-xs font-bold">Presupuesto Total</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Ej: 4 días $40k → 8 días $80k</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCampTipoPresupuesto("daily")}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      editCampTipoPresupuesto === "daily"
                        ? "bg-purple-950/60 border-purple-600 text-purple-200 shadow-sm"
                        : "bg-surface border-border text-gray-400 hover:text-white"
                    }`}
                  >
                    <p className="text-xs font-bold">Presupuesto Diario</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Gasto constante por día</p>
                  </button>
                </div>
              </div>

              {editCampTipoPresupuesto === "lifetime" && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-400 font-semibold">
                      Extender Duración a (Días Totales)
                    </label>
                    <span className="text-[10px] text-purple-400 font-mono">Fin: 23:59</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {[4, 6, 8, 10, 14, 21, 30, 45, 60].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setEditCampDias(d)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                          editCampDias === d
                            ? "bg-purple-600 border-purple-500 text-white"
                            : "bg-surface border-border text-gray-400 hover:text-white"
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">O ingresa días personalizados:</span>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={editCampDias}
                      onChange={(e) => setEditCampDias(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 bg-background border border-border rounded px-2 py-1 text-xs text-gray-200 text-center"
                    />
                    <span className="text-[11px] text-gray-400">días (termina 23:59)</span>
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-gray-400 block mb-1 font-semibold">
                  {editCampTipoPresupuesto === "lifetime" ? "Nuevo Presupuesto Total (COP)" : "Nuevo Presupuesto Diario (COP)"}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-xs text-gray-500 font-mono">$</span>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    placeholder="Ej: 80000"
                    value={editCampPresupuesto}
                    onChange={(e) => setEditCampPresupuesto(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg pl-7 pr-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>
                {Number(editCampPresupuesto) > 0 && (
                  <div className="mt-2 p-2 rounded-lg bg-surface/50 border border-border text-[11px] text-gray-400 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Inversión neta:</span>
                      <span className="text-gray-200 font-semibold">${Number(editCampPresupuesto).toLocaleString("es-CO")} COP</span>
                    </div>
                    <div className="flex justify-between">
                      <span>IVA Meta (19% Colombia):</span>
                      <span className="text-amber-400 font-semibold">+${Math.round(Number(editCampPresupuesto) * 0.19).toLocaleString("es-CO")} COP</span>
                    </div>
                    <div className="flex justify-between border-t border-border/50 pt-1 font-bold text-gray-200">
                      <span>Total tarjeta/factura:</span>
                      <span className="text-emerald-400">${Math.round(Number(editCampPresupuesto) * 1.19).toLocaleString("es-CO")} COP</span>
                    </div>
                    {editCampTipoPresupuesto === "lifetime" && (
                      <div className="text-[10px] text-purple-300 pt-0.5">
                        Ritmo diario: ≈ ${Math.round(Number(editCampPresupuesto) / (editCampDias || 8)).toLocaleString("es-CO")} COP netos/día durante {editCampDias} días.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1 font-semibold">
                  Estado
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditCampEstado("ACTIVE")}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                      editCampEstado === "ACTIVE"
                        ? "bg-emerald-950/60 border-emerald-800 text-emerald-300"
                        : "bg-surface border-border text-gray-400 hover:text-white"
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> Activa
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCampEstado("PAUSED")}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                      editCampEstado === "PAUSED"
                        ? "bg-amber-950/60 border-amber-800 text-amber-300"
                        : "bg-surface border-border text-gray-400 hover:text-white"
                    }`}
                  >
                    <Pause className="w-3.5 h-3.5 fill-current" /> Pausada
                  </button>
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setCampanaEditando(null)}
                  disabled={guardandoCampana}
                  className="flex-1 py-2.5 rounded-xl bg-surface border border-border text-gray-300 hover:bg-surfaceHover text-xs font-medium transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoCampana}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {guardandoCampana ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {guardandoCampana ? "Guardando en Meta..." : "Guardar Cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL MEMORIA Y APRENDIZAJE DEL AGENTE DE ADS */}
      {adsMemoriaModal && (
        <div className="fixed inset-0 z-50 bg-scrim flex justify-center overflow-y-auto p-3 sm:p-4 pt-[calc(0.75rem_+_var(--safe-area-inset-top))] pb-[calc(0.75rem_+_var(--safe-area-inset-bottom))] backdrop-blur-md">
          <div className="w-full max-w-2xl my-auto max-h-[92dvh] bg-surface border border-border rounded-2xl p-6 space-y-5 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2 text-amber-400">
                <Brain className="w-5 h-5" />
                <h3 className="text-base font-bold text-gray-100">Memoria de Aprendizaje del Agente de Ads</h3>
              </div>
              <button
                type="button"
                onClick={() => setAdsMemoriaModal(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-5 pr-1">
              {/* SECCIÓN TOP 3 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> Top 3 Campañas Ganadoras (Estrategias a Replicar)
                  </h4>
                  <span className="text-[10px] text-gray-500">{topCampanasGuardadas.length}/3 guardadas</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-tight">
                  El Agente analiza estas campañas con el CPL más bajo para extraer sus ángulos psicológicos, creativos y copys ganadores al diseñar nuevas pruebas.
                </p>

                {topCampanasGuardadas.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-gray-500">
                    Aún no has fijado campañas ganadoras. Abre cualquier campaña en el listado y haz clic en <span className="text-amber-400 font-semibold">⭐ Aprender (Top 3)</span>.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {topCampanasGuardadas.map((c, idx) => (
                      <div key={c.id || idx} className="p-3 rounded-xl bg-amber-950/20 border border-amber-800/40 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold text-xs flex items-center justify-center">#{idx + 1}</span>
                            <span className="font-bold text-xs text-gray-200 truncate">{c.name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-1 pl-7">
                            <span>CPL: <strong className="text-emerald-400">${Number(c.cpl || 0).toLocaleString("es-CO")} COP</strong></span>
                            <span>Leads: <strong className="text-purple-300">{c.leads || 0}</strong></span>
                            <span>Invertido: ${Number(c.spend || 0).toLocaleString("es-CO")} COP</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => eliminarDeMemoriaAds(c.id, "top")}
                          className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg text-xs"
                          title="Quitar del Top"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SECCIÓN CAMPAÑAS FALLIDAS / ANTI-PATRONES */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                    🚫 Lo que ya se probó y NO funcionó (Anti-Patrones)
                  </h4>
                  <span className="text-[10px] text-gray-500">{campanasFallidasGuardadas.length} registradas</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-tight">
                  Campañas con CPL inflado o sin conversiones. El agente lee esta lista negra para no volver a cometer los mismos errores creativos o de segmentación.
                </p>

                {campanasFallidasGuardadas.length === 0 ? (
                  <div className="p-3 rounded-xl border border-dashed border-border text-center text-xs text-gray-500">
                    No hay campañas descartadas registradas. En cualquier campaña con pérdidas puedes tocar <span className="text-red-400 font-semibold">🚫 Descartar (Error)</span>.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {campanasFallidasGuardadas.map((c, idx) => (
                      <div key={c.id || idx} className="p-2.5 rounded-xl bg-red-950/20 border border-red-800/40 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-semibold text-xs text-gray-300 truncate block">{c.name}</span>
                          <span className="text-[10px] text-red-400">CPL: ${Number(c.cpl || 0).toLocaleString("es-CO")} COP • Invertido: ${Number(c.spend || 0).toLocaleString("es-CO")} COP</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => eliminarDeMemoriaAds(c.id, "fail")}
                          className="text-gray-500 hover:text-red-400 p-1 rounded-lg text-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SECCIÓN VIDEOS DE LA FAN PAGE */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                    <Video className="w-4 h-4" /> Videos Disponibles en Fan Page ({pageVideos.length})
                  </h4>
                  <button
                    type="button"
                    onClick={fetchVideosFanPage}
                    className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingVideos ? 'animate-spin' : ''}`} /> Sincronizar
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 leading-tight">
                  El agente selecciona los videos subidos a tu página oficial de Facebook con mayor interacción o vistas para apalancar el tráfico orgánico y la autoridad de marca.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                  {pageVideos.map((v) => (
                    <div key={v.id} className="p-2 rounded-xl bg-surface/50 border border-border flex items-center gap-2.5">
                      {v.picture ? (
                        <img src={v.picture} alt="Miniatura" className="w-10 h-10 object-cover rounded-md border border-border shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-purple-950 flex items-center justify-center shrink-0 text-purple-400 font-bold text-xs">VID</div>
                      )}
                      <div className="min-w-0 text-[11px]">
                        <p className="font-semibold text-gray-200 truncate">{v.title}</p>
                        <p className="text-[10px] text-gray-400">{v.views ? `${v.views.toLocaleString()} vistas • ` : ''}{v.length ? `${v.length}s` : 'Video'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* REGLAS DE TIEMPO DEL AGENTE */}
              <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-800/40 text-[11px] text-purple-300 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-purple-200">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                  Reglas de Horario y Extensión Ilimitada
                </div>
                <p>• <strong>Inicio exacto:</strong> 00:01 del día inicial de pauta.</p>
                <p>• <strong>Cierre exacto:</strong> 23:59 del último día del ciclo.</p>
                <p>• <strong>Extensión continua:</strong> Puedes extender la duración todos los días que quieras (8, 14, 21, 30+ días) sin reiniciar el aprendizaje del algoritmo.</p>
              </div>

              {/* BOTÓN DISPARAR ESTRATEGIA EVOLUTIVA */}
              <div className="pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setAdsMemoriaModal(false);
                    generarCampanaConIA();
                  }}
                  disabled={generandoEstrategia}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-amber-600 hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-900/30 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {generandoEstrategia ? "Generando con IA..." : "Crear Nueva Estrategia Reutilizando Videos de la Fan Page"}
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-2">
                  La IA elegirá el mejor video de Facebook, diseñará copys ganadores y programará el presupuesto de 00:01 a 23:59.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
