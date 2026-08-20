"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  MessageSquare,
  Users,
  DollarSign,
  TrendingUp,
  Brain,
  Send,
  Bot,
  Phone,
  CheckCircle2,
  Clock,
  Plus,
  Ban,
  Settings,
  Edit2,
  Trash2,
  ArrowUp,
  ArrowDown
} from "lucide-react";

export default function CRMApp() {
  const [tab, setTab] = useState<"chats" | "pipeline" | "cartera" | "ads" | "cerebro">("chats");
  const [conversaciones, setConversaciones] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any | null>(null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [clienteActual, setClienteActual] = useState<any | null>(null);
  const [pagosCliente, setPagosCliente] = useState<any[]>([]);
  
  // Pipeline dinámico
  const [pipelineEtapas, setPipelineEtapas] = useState<any[]>([]);
  const [isEditingPipeline, setIsEditingPipeline] = useState(false);

  // Formularios
  const [nuevoPagoMonto, setNuevoPagoMonto] = useState("");
  const [nuevoPagoFecha, setNuevoPagoFecha] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);
  const [filtroCanal, setFiltroCanal] = useState<"todos" | "evolution" | "meta_business" | "spam">("todos");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. CARGA INICIAL
  useEffect(() => {
    fetchConversaciones();
    fetchPipelineEtapas();

    const convSub = supabase
      .channel("realtime-conversaciones")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversaciones" }, () => {
        fetchConversaciones();
      })
      .subscribe();

    const clientesSub = supabase
      .channel("realtime-clientes")
      .on("postgres_changes", { event: "*", schema: "public", table: "clientes" }, () => {
        fetchConversaciones();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(convSub);
      supabase.removeChannel(clientesSub);
    };
  }, []);

  async function fetchConversaciones() {
    const { data } = await supabase
      .from("conversaciones")
      .select("*, clientes(*)")
      .order("ultimo_mensaje_en", { ascending: false });

    if (data) {
      setConversaciones(data);
    }
    setLoadingChats(false);
  }

  async function fetchPipelineEtapas() {
    const { data } = await supabase
      .from("pipeline_etapas")
      .select("*")
      .order("orden", { ascending: true });
    if (data) setPipelineEtapas(data);
  }

  // 2. SELECCIONAR CHAT
  async function selectConversation(conv: any) {
    setSelectedConv(conv);
    setClienteActual(conv.clientes);
    fetchMensajes(conv.id);
    fetchPagos(conv.cliente_id);
  }

  async function fetchMensajes(convId: string) {
    const { data } = await supabase
      .from("mensajes")
      .select("*")
      .eq("conversacion_id", convId)
      .order("creado_en", { ascending: true });
    if (data) setMensajes(data);
  }

  async function fetchPagos(clienteId: string) {
    if (!clienteId) return;
    const { data } = await supabase
      .from("pagos")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("fecha_vencimiento", { ascending: true });
    if (data) setPagosCliente(data);
  }

  // 3. SUSCRIPCIÓN MENSAJES
  useEffect(() => {
    if (!selectedConv) return;
    const msgSub = supabase
      .channel(`realtime-mensajes-${selectedConv.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: `conversacion_id=eq.${selectedConv.id}` },
        (payload) => setMensajes((prev) => [...prev, payload.new])
      ).subscribe();

    return () => { supabase.removeChannel(msgSub); };
  }, [selectedConv]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  // 4. ACCIONES DE CHAT
  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevoMensaje.trim() || !selectedConv) return;
    const textoAEnviar = nuevoMensaje;
    setNuevoMensaje("");

    await fetch("/api/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversacionId: selectedConv.id,
        clienteId: selectedConv.cliente_id,
        numeroWhatsApp: selectedConv.numero_whatsapp,
        texto: textoAEnviar,
      }),
    });
  }

  async function toggleAgenteIA() {
    if (!selectedConv) return;
    const nuevoEstado = !selectedConv.agente_activo;
    await supabase.from("conversaciones").update({ agente_activo: nuevoEstado }).eq("id", selectedConv.id);
    setSelectedConv({ ...selectedConv, agente_activo: nuevoEstado });
  }

  async function toggleSpam() {
    if (!clienteActual || !selectedConv) return;
    const esSpamAhora = !clienteActual.es_spam;
    
    // Marcar cliente como spam
    await supabase.from("clientes").update({ es_spam: esSpamAhora }).eq("id", clienteActual.id);
    
    // Si lo marco como spam, pauso al agente inmediatamente
    if (esSpamAhora) {
      await supabase.from("conversaciones").update({ agente_activo: false }).eq("id", selectedConv.id);
      setSelectedConv({ ...selectedConv, agente_activo: false });
    }
    
    setClienteActual({ ...clienteActual, es_spam: esSpamAhora });
    
    // Si lo mandamos a spam y no estamos en la pestaña spam, deseleccionar
    if (esSpamAhora && filtroCanal !== "spam") {
      setSelectedConv(null);
    }
    fetchConversaciones();
  }

  // 5. ACCIONES DE PIPELINE Y PAGOS
  async function actualizarEstadoCliente(clienteId: string, nuevoEstado: string) {
    await supabase.from("clientes").update({ estado: nuevoEstado, actualizado_en: new Date().toISOString() }).eq("id", clienteId);
    if (clienteActual?.id === clienteId) setClienteActual({ ...clienteActual, estado: nuevoEstado });
    fetchConversaciones();
  }

  async function agregarPago(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteActual || !nuevoPagoMonto) return;
    const nuevo = {
      cliente_id: clienteActual.id,
      monto: parseFloat(nuevoPagoMonto),
      fecha_vencimiento: nuevoPagoFecha || new Date().toISOString().split("T")[0],
      estado: "pendiente",
    };
    const { data } = await supabase.from("pagos").insert([nuevo]).select();
    if (data) {
      setPagosCliente([...pagosCliente, data[0]]);
      setNuevoPagoMonto(""); setNuevoPagoFecha("");
    }
  }

  async function marcarPago(pagoId: string, estadoActual: string) {
    const nuevoEstado = estadoActual === "pagado" ? "pendiente" : "pagado";
    await supabase.from("pagos").update({
      estado: nuevoEstado,
      fecha_pago: nuevoEstado === "pagado" ? new Date().toISOString().split("T")[0] : null,
    }).eq("id", pagoId);
    setPagosCliente(pagosCliente.map((p) => p.id === pagoId ? { ...p, estado: nuevoEstado } : p));
  }

  // EDICIÓN DE PIPELINE
  async function agregarEtapaPipeline() {
    const nuevaClave = `etapa_${Date.now()}`;
    const nuevaEtapa = { clave: nuevaClave, nombre: "Nueva Etapa", orden: pipelineEtapas.length + 1 };
    const { data } = await supabase.from("pipeline_etapas").insert([nuevaEtapa]).select();
    if (data) setPipelineEtapas([...pipelineEtapas, data[0]]);
  }

  async function actualizarNombreEtapa(id: string, nuevoNombre: string) {
    setPipelineEtapas(pipelineEtapas.map(e => e.id === id ? { ...e, nombre: nuevoNombre } : e));
    await supabase.from("pipeline_etapas").update({ nombre: nuevoNombre }).eq("id", id);
  }

  async function eliminarEtapa(id: string) {
    await supabase.from("pipeline_etapas").delete().eq("id", id);
    setPipelineEtapas(pipelineEtapas.filter(e => e.id !== id));
  }

  async function moverEtapa(index: number, direccion: -1 | 1) {
    if (index + direccion < 0 || index + direccion >= pipelineEtapas.length) return;
    const nuevas = [...pipelineEtapas];
    const temp = nuevas[index].orden;
    nuevas[index].orden = nuevas[index + direccion].orden;
    nuevas[index + direccion].orden = temp;
    nuevas.sort((a, b) => a.orden - b.orden);
    setPipelineEtapas(nuevas);
    // Guardar en DB
    for (const etapa of nuevas) {
      await supabase.from("pipeline_etapas").update({ orden: etapa.orden }).eq("id", etapa.id);
    }
  }

  // 6. FILTROS
  const conversacionesFiltradas = conversaciones.filter((c) => {
    const esSpam = c.clientes?.es_spam === true;
    if (filtroCanal === "spam") return esSpam;
    if (esSpam) return false; // Ocultar spam de las otras pestañas
    if (filtroCanal === "todos") return true;
    return c.fuente === filtroCanal;
  });

  return (
    <div className="flex h-screen w-screen bg-background text-gray-200 overflow-hidden font-sans">
      {/* 1. BARRA LATERAL PRINCIPAL */}
      <aside className="w-20 bg-surface border-r border-border flex flex-col items-center py-6 justify-between select-none z-10">
        <div className="flex flex-col items-center gap-8 w-full">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-900/40">
            <span className="text-xl font-bold text-white">🔮</span>
          </div>

          <nav className="flex flex-col gap-3 w-full px-3">
            {[
              { id: "chats", icon: MessageSquare, label: "Chats" },
              { id: "pipeline", icon: Users, label: "Pipeline" },
              { id: "cartera", icon: DollarSign, label: "Cartera" },
              { id: "ads", icon: TrendingUp, label: "Ads" },
              { id: "cerebro", icon: Brain, label: "Cerebro" }
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id as any)}
                className={`p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all ${
                  tab === item.id ? "bg-purple-600 text-white shadow-md shadow-purple-900/30" : "text-gray-400 hover:bg-surfaceHover hover:text-gray-200"
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="flex flex-col items-center gap-1 text-[10px] text-emerald-400">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Online</span>
        </div>
      </aside>

      {/* 2. PESTAÑA: CONVERSACIONES */}
      {tab === "chats" && (
        <div className="flex-1 flex overflow-hidden">
          {/* BANDEJA DE ENTRADA */}
          <section className="w-80 border-r border-border bg-surface/50 flex flex-col">
            <div className="p-4 border-b border-border flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold text-gray-100">Bandeja</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 font-medium">
                  {conversacionesFiltradas.length}
                </span>
              </div>
              <div className="flex bg-background p-1 rounded-lg border border-border text-xs flex-wrap">
                {["todos", "evolution", "meta_business", "spam"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFiltroCanal(f as any)}
                    className={`flex-1 py-1 px-2 rounded-md transition-all capitalize ${
                      filtroCanal === f ? (f === 'spam' ? "bg-red-900/50 text-red-400" : "bg-surfaceHover text-white font-medium") : "text-gray-400"
                    }`}
                  >
                    {f === "evolution" ? "Personal" : f === "meta_business" ? "Business" : f}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border/50">
              {loadingChats ? (
                <div className="p-6 text-center text-sm text-gray-500">Cargando chats...</div>
              ) : conversacionesFiltradas.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">Bandeja vacía</div>
              ) : (
                conversacionesFiltradas.map((conv) => {
                  const isSelected = selectedConv?.id === conv.id;
                  const cliente = conv.clientes;
                  const displayName = cliente?.nombre || cliente?.telefono_display || conv.numero_whatsapp;
                  return (
                    <button
                      key={conv.id}
                      onClick={() => selectConversation(conv)}
                      className={`w-full p-4 flex items-start gap-3 text-left transition-all hover:bg-surfaceHover ${isSelected ? "bg-surfaceHover border-l-4 border-purple-500" : ""}`}
                    >
                      <div className="relative flex-shrink-0">
                        <div className="w-11 h-11 rounded-full bg-surface border border-border flex items-center justify-center text-purple-400 font-semibold overflow-hidden">
                          {cliente?.foto_url ? <img src={cliente.foto_url} alt="" className="w-full h-full object-cover" /> : <span>{displayName.charAt(0)}</span>}
                        </div>
                        {conv.agente_activo && !cliente?.es_spam && (
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-purple-600 border-2 border-surface flex items-center justify-center">
                            <Bot className="w-2.5 h-2.5 text-white" />
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h2 className="text-sm font-semibold text-gray-200 truncate">{displayName}</h2>
                          <span className="text-[10px] text-gray-500">{new Date(conv.ultimo_mensaje_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <p className="text-xs text-gray-400 truncate mb-1">{conv.ultimo_mensaje || "Sin mensajes"}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* VENTANA DE CHAT */}
          <section className="flex-1 flex flex-col bg-background">
            {selectedConv && clienteActual ? (
              <>
                <header className="h-16 px-6 border-b border-border bg-surface/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-purple-400 font-semibold">
                      {clienteActual.nombre?.charAt(0) || "W"}
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-gray-100">{clienteActual.nombre || "Sin nombre"}</h2>
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {clienteActual.telefono_display || clienteActual.telefono}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={toggleSpam} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${clienteActual.es_spam ? "bg-red-950/50 border-red-700 text-red-400" : "bg-surfaceHover border-border text-gray-400 hover:text-red-400"}`}>
                      <Ban className="w-4 h-4" />
                      <span>{clienteActual.es_spam ? "Quitar de Spam" : "Marcar Spam"}</span>
                    </button>
                    {!clienteActual.es_spam && (
                      <button onClick={toggleAgenteIA} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${selectedConv.agente_activo ? "bg-purple-950/50 border-purple-700 text-purple-300" : "bg-surfaceHover border-border text-gray-400"}`}>
                        <Bot className="w-4 h-4" />
                        <span>{selectedConv.agente_activo ? "IA: ON" : "IA: Pausada"}</span>
                      </button>
                    )}
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {mensajes.map((msg) => {
                    const isMe = msg.tipo === "enviado";
                    return (
                      <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[70%] rounded-2xl px-4 py-3 shadow-md ${isMe ? "bg-purple-600 text-white rounded-br-none" : "bg-surface border border-border text-gray-200 rounded-bl-none"}`}>
                          {msg.tipo_contenido === "audio" && msg.url_archivo ? (
                            <audio controls src={msg.url_archivo} className="max-w-xs" />
                          ) : msg.tipo_contenido === "imagen" && msg.url_archivo ? (
                            <img src={msg.url_archivo} alt="" className="rounded-lg max-h-60 object-cover" />
                          ) : (
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.contenido}</p>
                          )}
                          <span className={`block text-[10px] mt-1.5 ${isMe ? "text-purple-200 text-right" : "text-gray-400"}`}>
                            {new Date(msg.creado_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                <form onSubmit={handleSendMessage} className="p-4 border-t border-border bg-surface/30 flex items-center gap-3">
                  <input type="text" value={nuevoMensaje} onChange={(e) => setNuevoMensaje(e.target.value)} placeholder="Escribe un mensaje al cliente..." disabled={clienteActual.es_spam} className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50" />
                  <button type="submit" disabled={clienteActual.es_spam} className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white p-3 rounded-xl shadow-md flex items-center justify-center">
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                <MessageSquare className="w-12 h-12 mb-2 stroke-[1.5]" />
                <p className="text-sm">Selecciona una conversación</p>
              </div>
            )}
          </section>

          {/* FICHA TÉCNICA LATERAL */}
          {selectedConv && clienteActual && (
            <aside className="w-96 border-l border-border bg-surface/50 overflow-y-auto p-6 space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto rounded-full bg-surface border-2 border-purple-500 flex items-center justify-center text-2xl font-bold text-purple-300 mb-3 overflow-hidden shadow-lg shadow-purple-900/20">
                  {clienteActual.foto_url ? <img src={clienteActual.foto_url} alt="" className="w-full h-full object-cover" /> : <span>{clienteActual.nombre?.charAt(0) || "W"}</span>}
                </div>
                <h3 className="text-base font-bold text-gray-100">{clienteActual.nombre || "Sin Nombre"}</h3>
                <p className="text-xs text-gray-400">{clienteActual.telefono_display || clienteActual.telefono}</p>
              </div>

              <div className="bg-surface p-4 rounded-xl border border-border space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase block">Estado del Lead</label>
                <select
                  value={clienteActual.estado || "nuevo_lead"}
                  onChange={(e) => actualizarEstadoCliente(clienteActual.id, e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                >
                  {pipelineEtapas.map(etapa => (
                    <option key={etapa.clave} value={etapa.clave}>{etapa.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Pagos reducidos para espacio */}
              <div className="bg-surface p-4 rounded-xl border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase">Plan de Cobros</h4>
                  <span className="text-xs text-purple-400 font-bold">
                    ${pagosCliente.reduce((acc, p) => acc + (p.estado === "pagado" ? Number(p.monto) : 0), 0)} / ${pagosCliente.reduce((acc, p) => acc + Number(p.monto), 0)}
                  </span>
                </div>
                <div className="space-y-2">
                  {pagosCliente.map((pago) => (
                    <div key={pago.id} className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border text-xs">
                      <div className="flex items-center gap-2">
                        <button onClick={() => marcarPago(pago.id, pago.estado)}>
                          {pago.estado === "pagado" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Clock className="w-4 h-4 text-amber-400" />}
                        </button>
                        <span className={pago.estado === "pagado" ? "line-through text-gray-500" : "text-gray-200 font-medium"}>${pago.monto}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={agregarPago} className="flex gap-2 pt-2">
                  <input type="number" placeholder="$" value={nuevoPagoMonto} onChange={(e) => setNuevoPagoMonto(e.target.value)} className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none" />
                  <button type="submit" className="bg-purple-600 text-white p-1.5 rounded-lg"><Plus className="w-4 h-4" /></button>
                </form>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* 3. PESTAÑA: PIPELINE KANBAN */}
      {tab === "pipeline" && (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
          <header className="p-6 border-b border-border flex items-center justify-between bg-surface/30">
            <div>
              <h1 className="text-2xl font-bold text-gray-100">Pipeline de Clientes</h1>
              <p className="text-sm text-gray-400">Organiza y visualiza el estado de tus trabajos</p>
            </div>
            <button onClick={() => setIsEditingPipeline(!isEditingPipeline)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${isEditingPipeline ? "bg-purple-600 text-white" : "bg-surface border border-border text-gray-300 hover:bg-surfaceHover"}`}>
              <Settings className="w-4 h-4" /> {isEditingPipeline ? "Cerrar Edición" : "Configurar Etapas"}
            </button>
          </header>

          <div className="flex-1 flex overflow-x-auto p-6 gap-4">
            {/* VISTA DE EDICIÓN */}
            {isEditingPipeline && (
              <div className="w-80 flex-shrink-0 bg-surface border border-border rounded-2xl p-4 flex flex-col gap-4 shadow-xl">
                <h2 className="text-sm font-bold text-purple-300 flex items-center gap-2 border-b border-border pb-2"><Edit2 className="w-4 h-4" /> Editar Pipeline</h2>
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
                <button onClick={agregarEtapaPipeline} className="w-full py-2 bg-surfaceHover border border-dashed border-gray-600 rounded-lg text-xs text-gray-400 hover:text-white hover:border-gray-400 flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Agregar Etapa
                </button>
              </div>
            )}

            {/* TABLERO KANBAN DINÁMICO */}
            {pipelineEtapas.filter(e => e.clave !== "spam").map((col) => {
              const clientesEnCol = conversaciones.filter((c) => (c.clientes?.estado || "nuevo_lead") === col.clave && !c.clientes?.es_spam);
              return (
                <div key={col.id} className="w-72 flex-shrink-0 bg-surface/60 border border-border rounded-2xl p-4 flex flex-col gap-3 min-h-full">
                  <div className={`flex items-center justify-between pb-2 border-b-2 ${col.color || 'border-purple-500'}`}>
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

      {/* 4. CARTERA */}
      {tab === "cartera" && (
        <div className="flex-1 p-8 overflow-y-auto space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-gray-100">Cartera y Finanzas</h1>
          </header>
          <div className="grid grid-cols-3 gap-6">
            <div className="p-6 bg-surface border border-border rounded-2xl">
              <span className="text-xs text-gray-400 font-semibold uppercase">En Construcción</span>
            </div>
          </div>
        </div>
      )}
      
      {/* DEMÁS TABS... */}
      {tab === "ads" && (<div className="flex-1 p-8 flex items-center justify-center text-center"><TrendingUp className="w-16 h-16 text-purple-500 mb-4" /></div>)}
      {tab === "cerebro" && (<div className="flex-1 p-8 flex items-center justify-center text-center"><Brain className="w-16 h-16 text-purple-500 mb-4" /></div>)}
    </div>
  );
}