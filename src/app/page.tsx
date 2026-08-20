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
} from "lucide-react";

export default function CRMApp() {
  const [tab, setTab] = useState<"chats" | "pipeline" | "cartera" | "ads" | "cerebro">("chats");
  const [conversaciones, setConversaciones] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any | null>(null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [clienteActual, setClienteActual] = useState<any | null>(null);
  const [pagosCliente, setPagosCliente] = useState<any[]>([]);
  const [nuevoPagoMonto, setNuevoPagoMonto] = useState("");
  const [nuevoPagoFecha, setNuevoPagoFecha] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);
  const [filtroCanal, setFiltroCanal] = useState<"todos" | "evolution" | "meta_business">("todos");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Cargar Conversaciones iniciales
  useEffect(() => {
    fetchConversaciones();

    // Suscripción Realtime a Conversaciones
    const convSub = supabase
      .channel("realtime-conversaciones")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversaciones" },
        () => {
          fetchConversaciones();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(convSub);
    };
  }, []);

  async function fetchConversaciones() {
    const { data } = await supabase
      .from("conversaciones")
      .select("*, clientes(*)")
      .order("ultimo_mensaje_en", { ascending: false });

    if (data) {
      setConversaciones(data);
      if (!selectedConv && data.length > 0) {
        selectConversation(data[0]);
      }
    }
    setLoadingChats(false);
  }

  // 2. Seleccionar Conversación y Cargar Mensajes
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

  // 3. Suscripción Realtime a Mensajes de la conversación activa
  useEffect(() => {
    if (!selectedConv) return;

    const msgSub = supabase
      .channel(`realtime-mensajes-${selectedConv.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mensajes",
          filter: `conversacion_id=eq.${selectedConv.id}`,
        },
        (payload) => {
          setMensajes((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgSub);
    };
  }, [selectedConv]);

  // Scroll automático al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  // 4. Enviar Mensaje
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

  // 5. Alternar Agente IA (Pausa/Activar)
  async function toggleAgenteIA() {
    if (!selectedConv) return;
    const nuevoEstado = !selectedConv.agente_activo;

    await supabase
      .from("conversaciones")
      .update({ agente_activo: nuevoEstado })
      .eq("id", selectedConv.id);

    setSelectedConv({ ...selectedConv, agente_activo: nuevoEstado });
  }

  // 6. Actualizar Estado del Cliente (Pipeline)
  async function actualizarEstadoCliente(clienteId: string, nuevoEstado: string) {
    await supabase
      .from("clientes")
      .update({ estado: nuevoEstado, actualizado_en: new Date().toISOString() })
      .eq("id", clienteId);

    if (clienteActual && clienteActual.id === clienteId) {
      setClienteActual({ ...clienteActual, estado: nuevoEstado });
    }
    fetchConversaciones();
  }

  // 7. Agregar Pago / Cuota
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
      setNuevoPagoMonto("");
      setNuevoPagoFecha("");
    }
  }

  // 8. Marcar Pago como Pagado
  async function marcarPago(pagoId: string, estadoActual: string) {
    const nuevoEstado = estadoActual === "pagado" ? "pendiente" : "pagado";
    await supabase
      .from("pagos")
      .update({
        estado: nuevoEstado,
        fecha_pago: nuevoEstado === "pagado" ? new Date().toISOString().split("T")[0] : null,
      })
      .eq("id", pagoId);

    setPagosCliente(
      pagosCliente.map((p) =>
        p.id === pagoId ? { ...p, estado: nuevoEstado } : p
      )
    );
  }

  // Filtrado de conversaciones por canal
  const conversacionesFiltradas = conversaciones.filter((c) => {
    if (filtroCanal === "todos") return true;
    return c.fuente === filtroCanal;
  });

  return (
    <div className="flex h-screen w-screen bg-background text-gray-200 overflow-hidden font-sans">
      {/* 1. BARRA LATERAL PRINCIPAL */}
      <aside className="w-20 bg-surface border-r border-border flex flex-col items-center py-6 justify-between select-none">
        <div className="flex flex-col items-center gap-8 w-full">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-900/40">
            <span className="text-xl font-bold text-white">🔮</span>
          </div>

          <nav className="flex flex-col gap-3 w-full px-3">
            <button
              onClick={() => setTab("chats")}
              className={`p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all ${
                tab === "chats"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-900/30"
                  : "text-gray-400 hover:bg-surfaceHover hover:text-gray-200"
              }`}
              title="Conversaciones"
            >
              <MessageSquare className="w-5 h-5" />
              <span className="text-[10px] font-medium">Chats</span>
            </button>

            <button
              onClick={() => setTab("pipeline")}
              className={`p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all ${
                tab === "pipeline"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-900/30"
                  : "text-gray-400 hover:bg-surfaceHover hover:text-gray-200"
              }`}
              title="Pipeline de Clientes"
            >
              <Users className="w-5 h-5" />
              <span className="text-[10px] font-medium">Pipeline</span>
            </button>

            <button
              onClick={() => setTab("cartera")}
              className={`p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all ${
                tab === "cartera"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-900/30"
                  : "text-gray-400 hover:bg-surfaceHover hover:text-gray-200"
              }`}
              title="Cartera y Pagos"
            >
              <DollarSign className="w-5 h-5" />
              <span className="text-[10px] font-medium">Cartera</span>
            </button>

            <button
              onClick={() => setTab("ads")}
              className={`p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all ${
                tab === "ads"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-900/30"
                  : "text-gray-400 hover:bg-surfaceHover hover:text-gray-200"
              }`}
              title="Campañas Ads"
            >
              <TrendingUp className="w-5 h-5" />
              <span className="text-[10px] font-medium">Ads</span>
            </button>

            <button
              onClick={() => setTab("cerebro")}
              className={`p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all ${
                tab === "cerebro"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-900/30"
                  : "text-gray-400 hover:bg-surfaceHover hover:text-gray-200"
              }`}
              title="Cerebro IA"
            >
              <Brain className="w-5 h-5" />
              <span className="text-[10px] font-medium">Cerebro</span>
            </button>
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
          {/* Lista de Conversaciones */}
          <section className="w-80 border-r border-border bg-surface/50 flex flex-col">
            <div className="p-4 border-b border-border flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold text-gray-100">Bandeja de Entrada</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 font-medium">
                  {conversacionesFiltradas.length}
                </span>
              </div>

              <div className="flex bg-background p-1 rounded-lg border border-border text-xs">
                <button
                  onClick={() => setFiltroCanal("todos")}
                  className={`flex-1 py-1 rounded-md transition-all ${
                    filtroCanal === "todos" ? "bg-surfaceHover text-white font-medium" : "text-gray-400"
                  }`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFiltroCanal("evolution")}
                  className={`flex-1 py-1 rounded-md transition-all ${
                    filtroCanal === "evolution" ? "bg-surfaceHover text-emerald-400 font-medium" : "text-gray-400"
                  }`}
                >
                  Personal
                </button>
                <button
                  onClick={() => setFiltroCanal("meta_business")}
                  className={`flex-1 py-1 rounded-md transition-all ${
                    filtroCanal === "meta_business" ? "bg-surfaceHover text-blue-400 font-medium" : "text-gray-400"
                  }`}
                >
                  Business
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border/50">
              {loadingChats ? (
                <div className="p-6 text-center text-sm text-gray-500">Cargando chats...</div>
              ) : conversacionesFiltradas.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">No hay conversaciones activas</div>
              ) : (
                conversacionesFiltradas.map((conv) => {
                  const isSelected = selectedConv?.id === conv.id;
                  const cliente = conv.clientes;
                  return (
                    <button
                      key={conv.id}
                      onClick={() => selectConversation(conv)}
                      className={`w-full p-4 flex items-start gap-3 text-left transition-all hover:bg-surfaceHover ${
                        isSelected ? "bg-surfaceHover border-l-4 border-purple-500" : ""
                      }`}
                    >
                      <div className="relative flex-shrink-0">
                        <div className="w-11 h-11 rounded-full bg-surface border border-border flex items-center justify-center text-purple-400 font-semibold overflow-hidden">
                          {cliente?.foto_url ? (
                            <img src={cliente.foto_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span>{cliente?.nombre?.charAt(0) || "W"}</span>
                          )}
                        </div>
                        {conv.agente_activo && (
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-purple-600 border-2 border-surface flex items-center justify-center" title="Agente Activo">
                            <Bot className="w-2.5 h-2.5 text-white" />
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h2 className="text-sm font-semibold text-gray-200 truncate">
                            {cliente?.nombre || conv.numero_whatsapp}
                          </h2>
                          <span className="text-[10px] text-gray-500">
                            {new Date(conv.ultimo_mensaje_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>

                        <p className="text-xs text-gray-400 truncate mb-1">
                          {conv.ultimo_mensaje || "Sin mensajes"}
                        </p>

                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                              conv.fuente === "evolution"
                                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                                : "bg-blue-950/60 text-blue-400 border border-blue-800/40"
                            }`}
                          >
                            {conv.fuente === "evolution" ? "WhatsApp Personal" : "Meta Cloud"}
                          </span>
                          {cliente?.tipo_trabajo && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40 truncate">
                              {cliente.tipo_trabajo}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Ventana de Chat */}
          <section className="flex-1 flex flex-col bg-background">
            {selectedConv ? (
              <>
                <header className="h-16 px-6 border-b border-border bg-surface/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center text-purple-400 font-semibold">
                      {clienteActual?.nombre?.charAt(0) || "W"}
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-gray-100 flex items-center gap-2">
                        {clienteActual?.nombre || selectedConv.numero_whatsapp}
                      </h2>
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {selectedConv.numero_whatsapp}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={toggleAgenteIA}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                        selectedConv.agente_activo
                          ? "bg-purple-950/50 border-purple-700 text-purple-300 shadow-sm shadow-purple-900/30"
                          : "bg-surfaceHover border-border text-gray-400"
                      }`}
                    >
                      <Bot className="w-4 h-4" />
                      <span>{selectedConv.agente_activo ? "Agente Luna: ON" : "Agente Pausado"}</span>
                    </button>
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {mensajes.map((msg) => {
                    const isMe = msg.tipo === "enviado";
                    return (
                      <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[70%] rounded-2xl px-4 py-3 shadow-md ${
                            isMe
                              ? "bg-purple-600 text-white rounded-br-none"
                              : "bg-surface border border-border text-gray-200 rounded-bl-none"
                          }`}
                        >
                          {msg.tipo_contenido === "audio" && msg.url_archivo ? (
                            <audio controls src={msg.url_archivo} className="max-w-xs" />
                          ) : msg.tipo_contenido === "imagen" && msg.url_archivo ? (
                            <img src={msg.url_archivo} alt="Foto enviada" className="rounded-lg max-h-60 object-cover" />
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
                  <input
                    type="text"
                    value={nuevoMensaje}
                    onChange={(e) => setNuevoMensaje(e.target.value)}
                    placeholder="Escribe un mensaje al cliente..."
                    className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-all"
                  />
                  <button
                    type="submit"
                    className="bg-purple-600 hover:bg-purple-700 text-white p-3 rounded-xl transition-all shadow-md shadow-purple-900/30 flex items-center justify-center"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                <MessageSquare className="w-12 h-12 mb-2 stroke-[1.5]" />
                <p className="text-sm">Selecciona una conversación para ver los mensajes</p>
              </div>
            )}
          </section>

          {/* Ficha Técnica del Cliente */}
          {selectedConv && clienteActual && (
            <aside className="w-96 border-l border-border bg-surface/50 overflow-y-auto p-6 space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto rounded-full bg-surface border-2 border-purple-500 flex items-center justify-center text-2xl font-bold text-purple-300 mb-3 overflow-hidden shadow-lg shadow-purple-900/20">
                  {clienteActual.foto_url ? (
                    <img src={clienteActual.foto_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span>{clienteActual.nombre?.charAt(0) || "W"}</span>
                  )}
                </div>
                <h3 className="text-base font-bold text-gray-100">{clienteActual.nombre || "Sin Nombre"}</h3>
                <p className="text-xs text-gray-400">{clienteActual.telefono}</p>
              </div>

              <div className="bg-surface p-4 rounded-xl border border-border space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                  Estado del Lead
                </label>
                <select
                  value={clienteActual.estado || "nuevo_lead"}
                  onChange={(e) => actualizarEstadoCliente(clienteActual.id, e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                >
                  <option value="nuevo_lead">📥 Nuevo Lead</option>
                  <option value="en_consulta">🔮 En Consulta</option>
                  <option value="consulta_hecha">📞 Consulta Hecha</option>
                  <option value="trabajo_proceso">🕯️ Trabajo en Proceso</option>
                  <option value="trabajo_completado">✨ Trabajo Completado</option>
                  <option value="pago_recibido">💰 Pago Recibido</option>
                  <option value="perdido">❌ Lead Perdido</option>
                </select>
              </div>

              <div className="bg-surface p-4 rounded-xl border border-border space-y-3">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Checklist del Trabajo
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between border-b border-border/50 pb-1.5">
                    <span className="text-gray-400">Tipo de Trabajo:</span>
                    <span className="font-medium text-purple-300">{clienteActual.tipo_trabajo || "Pendiente"}</span>
                  </div>
                  <div className="flex justify-between border-b border-border/50 pb-1.5">
                    <span className="text-gray-400">Otra Persona:</span>
                    <span className="font-medium text-gray-200">{clienteActual.nombre_otra_persona || "N/A"}</span>
                  </div>
                </div>

                <div className="pt-2">
                  <span className="text-[11px] text-gray-400 block mb-2 font-medium">Fotos Recibidas:</span>
                  <div className="grid grid-cols-3 gap-2">
                    {clienteActual.foto_url && (
                      <a href={clienteActual.foto_url} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-background border border-border overflow-hidden group relative">
                        <img src={clienteActual.foto_url} alt="Cliente" className="w-full h-full object-cover" />
                        <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white">Cliente</span>
                      </a>
                    )}
                    {clienteActual.foto_otra_persona && (
                      <a href={clienteActual.foto_otra_persona} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-background border border-border overflow-hidden group relative">
                        <img src={clienteActual.foto_otra_persona} alt="Pareja" className="w-full h-full object-cover" />
                        <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white">Pareja</span>
                      </a>
                    )}
                    {clienteActual.foto_mano && (
                      <a href={clienteActual.foto_mano} target="_blank" rel="noreferrer" className="aspect-square rounded-lg bg-background border border-border overflow-hidden group relative">
                        <img src={clienteActual.foto_mano} alt="Mano" className="w-full h-full object-cover" />
                        <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white">Palma</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-surface p-4 rounded-xl border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Plan de Cobros
                  </h4>
                  <span className="text-xs text-purple-400 font-bold">
                    ${pagosCliente.reduce((acc, p) => acc + (p.estado === "pagado" ? Number(p.monto) : 0), 0)} / $
                    {pagosCliente.reduce((acc, p) => acc + Number(p.monto), 0)}
                  </span>
                </div>

                <div className="space-y-2">
                  {pagosCliente.map((pago) => (
                    <div key={pago.id} className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border text-xs">
                      <div className="flex items-center gap-2">
                        <button onClick={() => marcarPago(pago.id, pago.estado)} title="Marcar Pagado">
                          {pago.estado === "pagado" ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Clock className="w-4 h-4 text-amber-400" />
                          )}
                        </button>
                        <span className={pago.estado === "pagado" ? "line-through text-gray-500" : "text-gray-200 font-medium"}>
                          ${pago.monto}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-500">{pago.fecha_vencimiento}</span>
                    </div>
                  ))}
                </div>

                <form onSubmit={agregarPago} className="flex gap-2 pt-2">
                  <input
                    type="number"
                    placeholder="$ Monto"
                    value={nuevoPagoMonto}
                    onChange={(e) => setNuevoPagoMonto(e.target.value)}
                    className="w-1/2 bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                  />
                  <input
                    type="date"
                    value={nuevoPagoFecha}
                    onChange={(e) => setNuevoPagoFecha(e.target.value)}
                    className="w-1/2 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                  />
                  <button type="submit" className="bg-purple-600 text-white p-1.5 rounded-lg hover:bg-purple-700">
                    <Plus className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* 3. PESTAÑA: PIPELINE KANBAN */}
      {tab === "pipeline" && (
        <div className="flex-1 p-8 overflow-x-auto flex flex-col gap-6">
          <header>
            <h1 className="text-2xl font-bold text-gray-100">Pipeline de Clientes</h1>
            <p className="text-sm text-gray-400">Embudo visual del estado de todos los trabajos</p>
          </header>

          <div className="flex gap-4 flex-1 items-start min-w-[1200px]">
            {[
              { id: "nuevo_lead", title: "📥 Nuevos Leads", color: "border-blue-500" },
              { id: "en_consulta", title: "🔮 En Consulta", color: "border-purple-500" },
              { id: "consulta_hecha", title: "📞 Consulta Hecha", color: "border-amber-500" },
              { id: "trabajo_proceso", title: "🕯️ En Proceso", color: "border-indigo-500" },
              { id: "trabajo_completado", title: "✨ Completado", color: "border-emerald-500" },
              { id: "pago_recibido", title: "💰 Pagado", color: "border-green-500" },
            ].map((col) => {
              const clientesEnCol = conversaciones.filter((c) => (c.clientes?.estado || "nuevo_lead") === col.id);
              return (
                <div key={col.id} className="flex-1 bg-surface/60 border border-border rounded-2xl p-4 flex flex-col gap-3 min-h-[500px]">
                  <div className={`flex items-center justify-between pb-2 border-b-2 ${col.color}`}>
                    <h2 className="text-xs font-bold text-gray-200">{col.title}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surfaceHover text-gray-400 font-semibold">
                      {clientesEnCol.length}
                    </span>
                  </div>

                  <div className="space-y-3 overflow-y-auto flex-1">
                    {clientesEnCol.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => {
                          selectConversation(c);
                          setTab("chats");
                        }}
                        className="p-3 bg-surface rounded-xl border border-border/80 hover:border-purple-500/80 cursor-pointer transition-all shadow-sm group"
                      >
                        <h3 className="text-xs font-bold text-gray-200 group-hover:text-purple-300">
                          {c.clientes?.nombre || c.numero_whatsapp}
                        </h3>
                        <p className="text-[11px] text-gray-400 mt-1 truncate">{c.clientes?.tipo_trabajo || "Sin clasificar"}</p>
                        <span className="text-[10px] text-gray-500 block mt-2">{c.numero_whatsapp}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. PESTAÑA: CARTERA Y PAGOS */}
      {tab === "cartera" && (
        <div className="flex-1 p-8 overflow-y-auto space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-gray-100">Cartera y Finanzas</h1>
            <p className="text-sm text-gray-400">Resumen de cobros, pagos recibidos y cuotas pendientes</p>
          </header>

          <div className="grid grid-cols-3 gap-6">
            <div className="p-6 bg-surface border border-border rounded-2xl">
              <span className="text-xs text-gray-400 font-semibold uppercase">Total Cobrado (Mes)</span>
              <p className="text-3xl font-extrabold text-emerald-400 mt-2">$0 USD</p>
            </div>
            <div className="p-6 bg-surface border border-border rounded-2xl">
              <span className="text-xs text-gray-400 font-semibold uppercase">Cartera por Cobrar</span>
              <p className="text-3xl font-extrabold text-amber-400 mt-2">$0 USD</p>
            </div>
            <div className="p-6 bg-surface border border-border rounded-2xl">
              <span className="text-xs text-gray-400 font-semibold uppercase">Clientes con Trabajos Activos</span>
              <p className="text-3xl font-extrabold text-purple-400 mt-2">{conversaciones.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* 5. PESTAÑA: GESTOR DE ADS */}
      {tab === "ads" && (
        <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
          <TrendingUp className="w-16 h-16 text-purple-500 mb-4 stroke-[1.5]" />
          <h2 className="text-xl font-bold text-gray-200">Gestor de Meta Ads con IA</h2>
          <p className="text-sm text-gray-400 max-w-md mt-2">
            Módulo preparado para conectar con la API de Marketing de Meta. Aquí podrás ver el costo por lead, pausar anuncios y optimizar presupuestos.
          </p>
        </div>
      )}

      {/* 6. PESTAÑA: CEREBRO IA */}
      {tab === "cerebro" && (
        <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
          <Brain className="w-16 h-16 text-purple-500 mb-4 stroke-[1.5]" />
          <h2 className="text-xl font-bold text-gray-200">Cerebro de Auto-Aprendizaje</h2>
          <p className="text-sm text-gray-400 max-w-md mt-2">
            Módulo preparado para analizar las conversaciones exitosas de tus agentes y sugerir mejoras automáticas en los prompts y flujos de cierre.
          </p>
        </div>
      )}
    </div>
  );
}