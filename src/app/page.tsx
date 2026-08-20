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
  ArrowDown,
  Wallet,
  Target,
  TrendingDown,
  Award,
  Calendar
} from "lucide-react";

export default function CRMApp() {
  const [tab, setTab] = useState<"chats" | "pipeline" | "cartera" | "ads" | "cerebro">("chats");
  const [conversaciones, setConversaciones] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any | null>(null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [clienteActual, setClienteActual] = useState<any | null>(null);
  const [pagosCliente, setPagosCliente] = useState<any[]>([]);
  const [todosPagos, setTodosPagos] = useState<any[]>([]);
  const [todosClientes, setTodosClientes] = useState<any[]>([]);
  
  // Pipeline dinámico
  const [pipelineEtapas, setPipelineEtapas] = useState<any[]>([]);
  const [isEditingPipeline, setIsEditingPipeline] = useState(false);

  // Formulario de pago avanzado
  const [tipoPago, setTipoPago] = useState<"unico" | "cuotas">("unico");
  const [montoTotal, setMontoTotal] = useState("");
  const [numeroCuotas, setNumeroCuotas] = useState("2");
  const [fechaInicial, setFechaInicial] = useState("");
  const [metodoPago, setMetodoPago] = useState("Nequi");
  const [notaPago, setNotaPago] = useState("");

  const [loadingChats, setLoadingChats] = useState(true);
  const [filtroCanal, setFiltroCanal] = useState<"todos" | "evolution" | "meta_business" | "spam">("todos");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. CARGA INICIAL
  useEffect(() => {
    fetchConversaciones();
    fetchPipelineEtapas();
    fetchTodosPagos();
    fetchTodosClientes();

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
        fetchTodosClientes();
      })
      .subscribe();

    const pagosSub = supabase
      .channel("realtime-pagos")
      .on("postgres_changes", { event: "*", schema: "public", table: "pagos" }, () => {
        fetchTodosPagos();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(convSub);
      supabase.removeChannel(clientesSub);
      supabase.removeChannel(pagosSub);
    };
  }, []);

  async function fetchConversaciones() {
    const { data } = await supabase
      .from("conversaciones")
      .select("*, clientes(*)")
      .order("ultimo_mensaje_en", { ascending: false });
    if (data) setConversaciones(data);
    setLoadingChats(false);
  }

  async function fetchPipelineEtapas() {
    const { data } = await supabase
      .from("pipeline_etapas")
      .select("*")
      .order("orden", { ascending: true });
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
    await supabase.from("clientes").update({ es_spam: esSpamAhora }).eq("id", clienteActual.id);
    if (esSpamAhora) {
      await supabase.from("conversaciones").update({ agente_activo: false }).eq("id", selectedConv.id);
      setSelectedConv({ ...selectedConv, agente_activo: false });
    }
    setClienteActual({ ...clienteActual, es_spam: esSpamAhora });
    if (esSpamAhora && filtroCanal !== "spam") setSelectedConv(null);
    fetchConversaciones();
  }

  // 5. PIPELINE
  async function actualizarEstadoCliente(clienteId: string, nuevoEstado: string) {
    await supabase.from("clientes").update({ estado: nuevoEstado, actualizado_en: new Date().toISOString() }).eq("id", clienteId);
    if (clienteActual?.id === clienteId) setClienteActual({ ...clienteActual, estado: nuevoEstado });
    fetchConversaciones();
    fetchTodosClientes();
  }

  // 6. PAGOS - AGREGAR (Único o en Cuotas)
  async function agregarPagos(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteActual || !montoTotal) return;

    const total = parseFloat(montoTotal);
    const fechaBase = fechaInicial ? new Date(fechaInicial) : new Date();

    const pagosACrear = [];

    if (tipoPago === "unico") {
      pagosACrear.push({
        cliente_id: clienteActual.id,
        monto: total,
        fecha_vencimiento: fechaBase.toISOString().split("T")[0],
        estado: "pendiente",
        metodo_pago: metodoPago,
        notas: notaPago || "Pago único"
      });
    } else {
      const nCuotas = parseInt(numeroCuotas);
      const montoPorCuota = total / nCuotas;
      for (let i = 0; i < nCuotas; i++) {
        const fechaCuota = new Date(fechaBase);
        fechaCuota.setMonth(fechaCuota.getMonth() + i);
        pagosACrear.push({
          cliente_id: clienteActual.id,
          monto: montoPorCuota,
          fecha_vencimiento: fechaCuota.toISOString().split("T")[0],
          estado: "pendiente",
          metodo_pago: metodoPago,
          notas: `Cuota ${i + 1} de ${nCuotas} ${notaPago ? "- " + notaPago : ""}`
        });
      }
    }

    // Actualizar total_cobro del cliente
    await supabase.from("clientes").update({ total_cobro: total }).eq("id", clienteActual.id);
    
    const { data } = await supabase.from("pagos").insert(pagosACrear).select();
    if (data) {
      setPagosCliente([...pagosCliente, ...data]);
      // Reset form
      setMontoTotal("");
      setFechaInicial("");
      setNotaPago("");
      setNumeroCuotas("2");
      setTipoPago("unico");
    }
  }

  async function marcarPago(pagoId: string, estadoActual: string) {
    const nuevoEstado = estadoActual === "pagado" ? "pendiente" : "pagado";
    await supabase.from("pagos").update({
      estado: nuevoEstado,
      fecha_pago: nuevoEstado === "pagado" ? new Date().toISOString().split("T")[0] : null,
    }).eq("id", pagoId);
    setPagosCliente(pagosCliente.map((p) => p.id === pagoId ? { ...p, estado: nuevoEstado } : p));
    fetchTodosPagos();
  }

  async function eliminarPago(pagoId: string) {
    await supabase.from("pagos").delete().eq("id", pagoId);
    setPagosCliente(pagosCliente.filter(p => p.id !== pagoId));
  }

  // 7. EDICIÓN PIPELINE
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
    for (const etapa of nuevas) {
      await supabase.from("pipeline_etapas").update({ orden: etapa.orden }).eq("id", etapa.id);
    }
  }

  // 8. FILTROS
  const conversacionesFiltradas = conversaciones.filter((c) => {
    const esSpam = c.clientes?.es_spam === true;
    if (filtroCanal === "spam") return esSpam;
    if (esSpam) return false;
    if (filtroCanal === "todos") return true;
    return c.fuente === filtroCanal;
  });

  // 9. CÁLCULO DE MÉTRICAS DE NEGOCIO
  const ahora = new Date();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  const clientesNoSpam = todosClientes.filter(c => !c.es_spam);
  const totalAtendidos = clientesNoSpam.length;
  const totalConvertidos = clientesNoSpam.filter(c => c.estado === "pago_recibido" || c.estado === "trabajo_proceso" || c.estado === "trabajo_completado").length;
  const efectividad = totalAtendidos > 0 ? ((totalConvertidos / totalAtendidos) * 100).toFixed(1) : "0";
  
  const totalCobradoMes = todosPagos
    .filter(p => p.estado === "pagado" && p.fecha_pago && new Date(p.fecha_pago) >= inicioMes)
    .reduce((sum, p) => sum + Number(p.monto), 0);
  
  const totalCobradoHistorico = todosPagos
    .filter(p => p.estado === "pagado")
    .reduce((sum, p) => sum + Number(p.monto), 0);
  
  const totalPendiente = todosPagos
    .filter(p => p.estado === "pendiente")
    .reduce((sum, p) => sum + Number(p.monto), 0);

  const totalVencido = todosPagos
    .filter(p => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora)
    .reduce((sum, p) => sum + Number(p.monto), 0);

  const leadsEnConsulta = clientesNoSpam.filter(c => c.estado === "en_consulta" || c.estado === "consulta_hecha").length;
  const leadsPerdidos = clientesNoSpam.filter(c => c.estado === "perdido").length;
  const leadsNuevos = clientesNoSpam.filter(c => c.estado === "nuevo_lead" || !c.estado).length;

  return (
    <div className="flex h-screen w-screen bg-background text-gray-200 overflow-hidden font-sans">
      {/* SIDEBAR */}
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
              <button key={item.id} onClick={() => setTab(item.id as any)}
                className={`p-3.5 rounded-xl flex flex-col items-center gap-1 transition-all ${
                  tab === item.id ? "bg-purple-600 text-white shadow-md shadow-purple-900/30" : "text-gray-400 hover:bg-surfaceHover hover:text-gray-200"
                }`}>
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

      {/* CHATS */}
      {tab === "chats" && (
        <div className="flex-1 flex overflow-hidden">
          {/* BANDEJA */}
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
                  <button key={f} onClick={() => setFiltroCanal(f as any)}
                    className={`flex-1 py-1 px-2 rounded-md transition-all capitalize ${
                      filtroCanal === f ? (f === 'spam' ? "bg-red-900/50 text-red-400" : "bg-surfaceHover text-white font-medium") : "text-gray-400"
                    }`}>
                    {f === "evolution" ? "Personal" : f === "meta_business" ? "Business" : f}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border/50">
              {loadingChats ? (
                <div className="p-6 text-center text-sm text-gray-500">Cargando...</div>
              ) : conversacionesFiltradas.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">Bandeja vacía</div>
              ) : (
                conversacionesFiltradas.map((conv) => {
                  const isSelected = selectedConv?.id === conv.id;
                  const cliente = conv.clientes;
                  const displayName = cliente?.nombre || cliente?.telefono_display || conv.numero_whatsapp;
                  return (
                    <button key={conv.id} onClick={() => selectConversation(conv)}
                      className={`w-full p-4 flex items-start gap-3 text-left transition-all hover:bg-surfaceHover ${isSelected ? "bg-surfaceHover border-l-4 border-purple-500" : ""}`}>
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

          {/* VENTANA CHAT */}
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
                      <span>{clienteActual.es_spam ? "Quitar Spam" : "Marcar Spam"}</span>
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
                  <input type="text" value={nuevoMensaje} onChange={(e) => setNuevoMensaje(e.target.value)} placeholder="Escribe un mensaje..." disabled={clienteActual.es_spam} className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 disabled:opacity-50" />
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

          {/* FICHA TÉCNICA MEJORADA CON PAGOS */}
          {selectedConv && clienteActual && (
            <aside className="w-96 border-l border-border bg-surface/50 overflow-y-auto p-6 space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto rounded-full bg-surface border-2 border-purple-500 flex items-center justify-center text-2xl font-bold text-purple-300 mb-3 overflow-hidden shadow-lg shadow-purple-900/20">
                  {clienteActual.foto_url ? <img src={clienteActual.foto_url} alt="" className="w-full h-full object-cover" /> : <span>{clienteActual.nombre?.charAt(0) || "W"}</span>}
                </div>
                <h3 className="text-base font-bold text-gray-100">{clienteActual.nombre || "Sin Nombre"}</h3>
                <p className="text-xs text-gray-400">{clienteActual.telefono_display || clienteActual.telefono}</p>
              </div>

              {/* Estado del Lead */}
              <div className="bg-surface p-4 rounded-xl border border-border space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase block">Estado del Lead</label>
                <select value={clienteActual.estado || "nuevo_lead"} onChange={(e) => actualizarEstadoCliente(clienteActual.id, e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500">
                  {pipelineEtapas.map(etapa => (
                    <option key={etapa.clave} value={etapa.clave}>{etapa.nombre}</option>
                  ))}
                </select>
              </div>

              {/* PLAN DE COBROS MEJORADO */}
              <div className="bg-surface p-4 rounded-xl border border-border space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5" /> Plan de Cobros
                  </h4>
                  <span className="text-xs text-purple-400 font-bold">
                    ${pagosCliente.reduce((acc, p) => acc + (p.estado === "pagado" ? Number(p.monto) : 0), 0).toLocaleString()} / ${pagosCliente.reduce((acc, p) => acc + Number(p.monto), 0).toLocaleString()}
                  </span>
                </div>

                {/* Lista de cuotas actuales */}
                {pagosCliente.length > 0 && (
                  <div className="space-y-2">
                    {pagosCliente.map((pago) => (
                      <div key={pago.id} className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${pago.estado === "pagado" ? "bg-emerald-950/30 border-emerald-800/40" : "bg-background border-border"}`}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <button onClick={() => marcarPago(pago.id, pago.estado)}>
                            {pago.estado === "pagado" ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium ${pago.estado === "pagado" ? "line-through text-gray-500" : "text-gray-200"}`}>
                              ${Number(pago.monto).toLocaleString()}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate">
                              {pago.notas || pago.metodo_pago} • {pago.fecha_vencimiento}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => eliminarPago(pago.id)} className="text-red-500/60 hover:text-red-400 p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Formulario nuevo cobro */}
                <div className="border-t border-border/50 pt-3 space-y-2">
                  <label className="text-[11px] text-gray-400 font-semibold uppercase">Registrar Cobro</label>
                  
                  {/* Toggle Único / Cuotas */}
                  <div className="flex bg-background p-1 rounded-lg border border-border text-xs">
                    <button type="button" onClick={() => setTipoPago("unico")}
                      className={`flex-1 py-1.5 rounded-md transition-all ${tipoPago === "unico" ? "bg-purple-600 text-white font-medium" : "text-gray-400"}`}>
                      Pago Único
                    </button>
                    <button type="button" onClick={() => setTipoPago("cuotas")}
                      className={`flex-1 py-1.5 rounded-md transition-all ${tipoPago === "cuotas" ? "bg-purple-600 text-white font-medium" : "text-gray-400"}`}>
                      En Cuotas
                    </button>
                  </div>

                  <form onSubmit={agregarPagos} className="space-y-2">
                    <input type="number" placeholder="Monto total ($)" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500" required />
                    
                    {tipoPago === "cuotas" && (
                      <div className="flex gap-2 items-center">
                        <span className="text-xs text-gray-400">Dividir en</span>
                        <input type="number" min="2" max="12" value={numeroCuotas} onChange={(e) => setNumeroCuotas(e.target.value)}
                          className="w-16 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-gray-200 text-center focus:outline-none focus:border-purple-500" />
                        <span className="text-xs text-gray-400">cuotas mensuales</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input type="date" value={fechaInicial} onChange={(e) => setFechaInicial(e.target.value)}
                        className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500" />
                      <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}
                        className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500">
                        <option value="Nequi">Nequi</option>
                        <option value="Daviplata">Daviplata</option>
                        <option value="Bancolombia">Bancolombia</option>
                        <option value="Efectivo">Efectivo</option>
                        <option value="Transferencia">Transferencia</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </div>

                    <input type="text" placeholder="Nota (opcional): amarre, limpieza, etc." value={notaPago} onChange={(e) => setNotaPago(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500" />

                    <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium py-2 rounded-lg flex items-center justify-center gap-2">
                      <Plus className="w-4 h-4" />
                      {tipoPago === "unico" ? "Agregar Cobro" : `Crear ${numeroCuotas} Cuotas`}
                    </button>
                  </form>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* PIPELINE */}
      {tab === "pipeline" && (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
          <header className="p-6 border-b border-border flex items-center justify-between bg-surface/30">
            <div>
              <h1 className="text-2xl font-bold text-gray-100">Pipeline de Clientes</h1>
              <p className="text-sm text-gray-400">Organiza el estado de tus trabajos</p>
            </div>
            <button onClick={() => setIsEditingPipeline(!isEditingPipeline)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${isEditingPipeline ? "bg-purple-600 text-white" : "bg-surface border border-border text-gray-300 hover:bg-surfaceHover"}`}>
              <Settings className="w-4 h-4" /> {isEditingPipeline ? "Cerrar" : "Configurar"}
            </button>
          </header>

          <div className="flex-1 flex overflow-x-auto p-6 gap-4">
            {isEditingPipeline && (
              <div className="w-80 flex-shrink-0 bg-surface border border-border rounded-2xl p-4 flex flex-col gap-4 shadow-xl">
                <h2 className="text-sm font-bold text-purple-300 flex items-center gap-2 border-b border-border pb-2"><Edit2 className="w-4 h-4" /> Editar Etapas</h2>
                <div className="flex-1 overflow-y-auto space-y-2">
                  {pipelineEtapas.map((etapa, idx) => (
                    <div key={etapa.id} className="flex items-center gap-2 bg-background p-2 rounded-lg border border-border">
                      <div className="flex flex-col gap-1">
                        <button onClick={() => moverEtapa(idx, -1)} className="text-gray-500 hover:text-white"><ArrowUp className="w-3 h-3" /></button>
                        <button onClick={() => moverEtapa(idx, 1)} className="text-gray-500 hover:text-white"><ArrowDown className="w-3 h-3" /></button>
                      </div>
                      <input type="text" value={etapa.nombre} onChange={(e) => actualizarNombreEtapa(etapa.id, e.target.value)}
                        className="flex-1 bg-transparent text-sm focus:outline-none focus:text-purple-300" />
                      <button onClick={() => eliminarEtapa(etapa.id)} className="text-red-500/70 hover:text-red-400 p-1"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
                <button onClick={agregarEtapaPipeline} className="w-full py-2 bg-surfaceHover border border-dashed border-gray-600 rounded-lg text-xs text-gray-400 hover:text-white flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Agregar Etapa
                </button>
              </div>
            )}

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
                      <div key={c.id} onClick={() => { selectConversation(c); setTab("chats"); }}
                        className="p-3 bg-surface rounded-xl border border-border/80 hover:border-purple-500/80 cursor-pointer shadow-sm group">
                        <h3 className="text-xs font-bold text-gray-200 group-hover:text-purple-300 truncate">
                          {c.clientes?.nombre || c.clientes?.telefono_display || c.numero_whatsapp}
                        </h3>
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

      {/* CARTERA CON MÉTRICAS REALES */}
      {tab === "cartera" && (
        <div className="flex-1 p-8 overflow-y-auto space-y-8 bg-background">
          <header>
            <h1 className="text-2xl font-bold text-gray-100">Cartera y Métricas del Negocio</h1>
            <p className="text-sm text-gray-400">Rendimiento, conversión y estado financiero</p>
          </header>

          {/* MÉTRICAS PRINCIPALES */}
          <div>
            <h2 className="text-sm font-bold text-purple-300 mb-3 uppercase tracking-wider">Rendimiento</h2>
            <div className="grid grid-cols-4 gap-4">
              <div className="p-5 bg-surface border border-border rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <Users className="w-5 h-5 text-blue-400" />
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Total</span>
                </div>
                <p className="text-3xl font-extrabold text-gray-100">{totalAtendidos}</p>
                <p className="text-xs text-gray-400 mt-1">Clientes atendidos</p>
              </div>

              <div className="p-5 bg-surface border border-border rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <Award className="w-5 h-5 text-emerald-400" />
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Ganados</span>
                </div>
                <p className="text-3xl font-extrabold text-emerald-400">{totalConvertidos}</p>
                <p className="text-xs text-gray-400 mt-1">Clientes convertidos</p>
              </div>

              <div className="p-5 bg-surface border border-border rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <Target className="w-5 h-5 text-purple-400" />
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Ratio</span>
                </div>
                <p className="text-3xl font-extrabold text-purple-400">{efectividad}%</p>
                <p className="text-xs text-gray-400 mt-1">Efectividad de cierre</p>
              </div>

              <div className="p-5 bg-surface border border-border rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <TrendingDown className="w-5 h-5 text-red-400" />
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Perdidos</span>
                </div>
                <p className="text-3xl font-extrabold text-red-400">{leadsPerdidos}</p>
                <p className="text-xs text-gray-400 mt-1">Leads no convertidos</p>
              </div>
            </div>
          </div>

          {/* MÉTRICAS FINANCIERAS */}
          <div>
            <h2 className="text-sm font-bold text-emerald-300 mb-3 uppercase tracking-wider">Finanzas</h2>
            <div className="grid grid-cols-4 gap-4">
              <div className="p-5 bg-surface border border-border rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <Calendar className="w-5 h-5 text-emerald-400" />
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Este Mes</span>
                </div>
                <p className="text-2xl font-extrabold text-emerald-400">${totalCobradoMes.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">Cobrado en {ahora.toLocaleString('es', { month: 'long' })}</p>
              </div>

              <div className="p-5 bg-surface border border-border rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <DollarSign className="w-5 h-5 text-green-400" />
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Histórico</span>
                </div>
                <p className="text-2xl font-extrabold text-green-400">${totalCobradoHistorico.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">Total cobrado</p>
              </div>

              <div className="p-5 bg-surface border border-border rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <Clock className="w-5 h-5 text-amber-400" />
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Pendiente</span>
                </div>
                <p className="text-2xl font-extrabold text-amber-400">${totalPendiente.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">Por cobrar</p>
              </div>

              <div className="p-5 bg-surface border border-border rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <TrendingDown className="w-5 h-5 text-red-400" />
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Vencido</span>
                </div>
                <p className="text-2xl font-extrabold text-red-400">${totalVencido.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">Pagos atrasados</p>
              </div>
            </div>
          </div>

          {/* EMBUDO DE CONVERSIÓN */}
          <div>
            <h2 className="text-sm font-bold text-purple-300 mb-3 uppercase tracking-wider">Embudo de Conversión</h2>
            <div className="bg-surface border border-border rounded-2xl p-6 space-y-3">
              {[
                { label: "Leads Nuevos", valor: leadsNuevos, color: "bg-blue-500" },
                { label: "En Consulta", valor: leadsEnConsulta, color: "bg-amber-500" },
                { label: "Convertidos", valor: totalConvertidos, color: "bg-emerald-500" }
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

          {/* PAGOS VENCIDOS (LISTA) */}
          {todosPagos.filter(p => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora).length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-red-300 mb-3 uppercase tracking-wider">⚠️ Pagos Vencidos</h2>
              <div className="bg-surface border border-red-800/50 rounded-2xl divide-y divide-border">
                {todosPagos.filter(p => p.estado === "pendiente" && new Date(p.fecha_vencimiento) < ahora).map(pago => {
                  const cliente = todosClientes.find(c => c.id === pago.cliente_id);
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

      {tab === "ads" && (<div className="flex-1 p-8 flex items-center justify-center text-center"><TrendingUp className="w-16 h-16 text-purple-500 mb-4" /></div>)}
      {tab === "cerebro" && (<div className="flex-1 p-8 flex items-center justify-center text-center"><Brain className="w-16 h-16 text-purple-500 mb-4" /></div>)}
    </div>
  );
}