// =====================================================
// APLICAR TRANSICION DE ETAPA Y PAUSA DE LUNA
//
// Flujo solicitado:
//   Lead Nuevo -> Datos (despues del saludo y la pregunta por el motivo)
//   Datos      -> se queda en Datos; clasifica el trabajo y envia la lista
//                  completa de requisitos una sola vez.
//
// Despues de enviar esa lista Luna se pausa completamente en ese chat:
// agente_activo=false, custom_attribute luna_pausada=true y etiqueta
// bot-pausado. El operador puede continuar manualmente la conversacion.
// =====================================================
const SUPABASE_URL = "https://zcljlddtcoyfyvshlyfk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjbGpsZGR0Y295Znl2c2hseWZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQ0NTQ4NCwiZXhwIjoyMTA0MDIxNDg0fQ._iG5UHv6fUc4QvhA56WbJ_P7WhIg1vyz1R3B5EWUU90";
const CHATWOOT_URL = "https://crmesteban.duckdns.org";
const CHATWOOT_TOKEN = "KKaF2gF4bJZvnSkqKnR42zD8";
const ACCOUNT_ID = "1";
const EVOLUTION_URL = "https://evo.crmesteban.duckdns.org";
const EVOLUTION_KEY = "25bbc50b8bfeb365633899951d2b9a6c4110f94e08535133d0953da151b4a1d3";
const NUMERO_MAESTRO = "573054021111";
const INSTANCIA_MAESTRO = "personal";

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json",
  Prefer: "return=minimal"
};

// Este nodo se ejecuta DESPUES de Enviar Mensaje Chatwoot o Enviar Audio
// Chatwoot. La entrada sirve para comprobar que el envio no fallo; los datos
// de la respuesta se recuperan del nodo de auditoria para que no se pierdan al
// atravesar el nodo HTTP de Chatwoot.
const resultadoEnvio = $input.first().json || {};
let pulir = resultadoEnvio;
try {
  const respuestaAuditada = $("Pulir y Auditar Respuesta").first().json || {};
  if (typeof respuestaAuditada.pausarChat === "boolean") pulir = respuestaAuditada;
} catch (e) {}

function envioTieneError(valor) {
  const data = valor || {};
  const status = Number(data.statusCode || data.status_code || data.httpCode || 0);
  return Boolean(
    data.error || data.errorMessage || data.error_message || data.success === false ||
    (Number.isFinite(status) && status >= 400)
  );
}
const envioFallido = envioTieneError(resultadoEnvio);

const fusion = $("Fusionar Memoria").first().json || {};
const checklist = pulir.checklist || fusion.checklist || {};
const etapa = pulir.etapa || fusion.etapa || "lead_nuevo";
const conversationId = pulir.conversationId || fusion.conversationId;
const clienteId = pulir.clienteId || fusion.clienteId || null;
const grupo = fusion.grupo || "templo";
const etapasPipeline = fusion.etapasPipeline || [];
const novedades = pulir.novedades || fusion.novedades || [];

function normalizar(v) {
  return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[\s\-]+/g, "_");
}

const MAPA_ETAPAS = {
  lead_nuevo: ["nuevo_lead", "nuevo_lead_templo", "lead_nuevo", "leadnuevo", "nuevo", "nuevo_cliente", "nuevo_templo", "etapa_nuevo_lead", "etapa_lead_nuevo"],
  datos: ["datos", "datos_templo", "solicitar_datos", "solicitud_datos", "en_datos", "pedir_datos", "recoger_datos", "etapa_datos"]
};
const NOMBRES_ETAPA = {
  lead_nuevo: ["nuevo_lead", "lead_nuevo", "nuevo", "nuevo_cliente", "lead", "primer_contacto", "nuevo_contacto", "nuevo lead", "lead nuevo", "nuevo cliente"],
  datos: ["datos", "solicitar_datos", "pedir_datos", "en_datos", "datos_cliente", "datos_del_cliente", "recoleccion_datos", "solicitud_datos", "solicitar datos", "pedir datos"]
};
const TOKENS_NOMBRE = {
  lead_nuevo: ["nuevo lead", "lead nuevo", "nuevo", "lead"],
  datos: ["datos", "solicitar datos", "pedir datos"]
};

// Resolver clave VALIDANDO POR NOMBRE (no por clave) — robusto a grupos.
// REGLA EXPLICITA DEL USUARIO: solo se usa una etapa que YA EXISTA en
// pipeline_etapas (la que esta creada en el CRM). Nunca se inventa una clave
// ni se crea ninguna etapa: si no hay una etapa con el NOMBRE buscado, se
// devuelve null y el cliente NO se mueve (Luna conserva su avance interno
// con luna_etapa para no repetir la conversacion).
function resolverClave(canon) {
  const candidatasClave = MAPA_ETAPAS[canon] || [];
  const candidatasNombre = NOMBRES_ETAPA[canon] || [];
  const tokens = TOKENS_NOMBRE[canon] || [];

  // Universo completo, sin filtrar por grupo al principio (validacion por nombre)
  const todas = etapasPipeline || [];
  if (!todas.length) return null;

  // Helper para buscar con preferencia de grupo
  function buscarConPreferencia(predicado) {
    // 1) Mismo grupo
    let e = todas.filter(x => String(x.grupo || "") === String(grupo)).find(predicado);
    if (e) return e;
    // 2) Grupo general / sin grupo / null / vacio
    e = todas.filter(x => !x.grupo || ["general", ""].includes(String(x.grupo))).find(predicado);
    if (e) return e;
    // 3) Cualquier grupo
    e = todas.find(predicado);
    return e || null;
  }

  // 1) Por NOMBRE exacto (via principal — validacion por nombre, no por clave)
  for (const n of candidatasNombre) {
    const norm = normalizar(n);
    const e = buscarConPreferencia(x => normalizar(x.nombre) === norm);
    if (e) return e.clave;
  }

  // 2) Por NOMBRE que contiene token (ej: "Nuevo Lead" contiene "nuevo lead")
  for (const t of tokens) {
    const normT = normalizar(t);
    const e = buscarConPreferencia(x => normalizar(x.nombre).includes(normT) || String(x.nombre || "").toLowerCase().includes(t.toLowerCase()));
    if (e) return e.clave;
  }

  // 3) Busqueda laxa por NOMBRE visible: cualquier etapa cuyo nombre
  //    contenga "datos", o "nuevo" + "lead" en cualquier orden
  if (canon === "datos") {
    const e = buscarConPreferencia(x => normalizar(x.nombre).includes("datos") || String(x.nombre || "").toLowerCase().includes("datos"));
    if (e) return e.clave;
  }
  if (canon === "lead_nuevo") {
    const e = buscarConPreferencia(x => {
      const nn = normalizar(x.nombre);
      return (nn.includes("nuevo") && nn.includes("lead")) || nn === "nuevo" || nn === "lead" || nn === "nuevo_lead" || nn === "lead_nuevo";
    });
    if (e) return e.clave;
  }

  // 4) Por CLAVE exacta — SOLO si esa fila ya existe en el pipeline
  //    (compatibilidad; la via principal sigue siendo el nombre)
  for (const c of candidatasClave) {
    const norm = normalizar(c);
    const e = buscarConPreferencia(x => normalizar(x.clave) === norm);
    if (e) return e.clave;
  }

  // 5) Por CLAVE que contiene token — solo contra filas existentes
  for (const t of tokens) {
    const normT = normalizar(t);
    const e = buscarConPreferencia(x => normalizar(x.clave).includes(normT));
    if (e) return e.clave;
  }

  // No existe ninguna etapa con ese NOMBRE en el pipeline: NO se inventa una
  // clave semilla ni se crea una etapa. Null = no mover al cliente.
  return null;
}

// -----------------------------------------------------
// 1) DECIDIR DESTINO Y SI HAY QUE PAUSAR
// -----------------------------------------------------
let destino = null;
let razon = "sin_cambio";
let forzado = false;
const pausaSolicitada = etapa === "datos" && pulir.pausarChat === true;
const pausarChat = pausaSolicitada && !envioFallido;

if (envioFallido) {
  razon = "envio_a_chatwoot_fallido_sin_transicion_ni_pausa";
} else if (etapa === "lead_nuevo") {
  destino = "datos";
  razon = "saludo_enviado_motivo_preguntado";
}
// En Datos no hay una tercera etapa: Luna se queda en Datos. La pausa se
// activa unicamente DESPUES de que Chatwoot acepta la lista de requisitos.
if (etapa === "datos" && pausarChat) {
  razon = "lista_de_requisitos_enviada_luna_pausada";
}

// Si Chatwoot rechazo el mensaje, no marcamos la lista como enviada y no
// pausamos el chat. Asi un operador o un reintento todavia puede responder.
if (envioFallido) {
  return [{
    json: {
      ...pulir,
      etapaAnterior: etapa,
      etapaNueva: etapa,
      etapaNuevaClave: null,
      transicion: false,
      razonTransicion: razon,
      chatPausado: false,
      etapaMovida: false,
      _debug: {
        ...(pulir._debug || {}),
        envioFallido: true,
        pausaSolicitada: pausaSolicitada,
        pausarChat: false
      }
    }
  }];
}

// -----------------------------------------------------
// 2) MOVER Lead Nuevo -> Datos EN EL CRM
// -----------------------------------------------------
let nuevaClave = null;
let etapaMovida = false;
let errorEstado = null;
let clienteIdReal = clienteId;

if (destino && !clienteIdReal && conversationId) {
  try {
    const res = await this.helpers.httpRequest({
      method: "GET",
      url: SUPABASE_URL + "/rest/v1/conversaciones?chatwoot_conversation_id=eq." + encodeURIComponent(conversationId) + "&select=cliente_id",
      headers: sbHeaders,
      json: true
    });
    if (Array.isArray(res) && res[0]) clienteIdReal = res[0].cliente_id || null;
  } catch (e) {}
}

const NOMBRE_DESTINO = { datos: "Datos", lead_nuevo: "Nuevo Lead" };

if (destino) {
  nuevaClave = resolverClave(destino);
  if (clienteIdReal && nuevaClave) {
    try {
      await this.helpers.httpRequest({
        method: "PATCH",
        url: SUPABASE_URL + "/rest/v1/clientes?id=eq." + clienteIdReal,
        headers: sbHeaders,
        body: { estado: nuevaClave, actualizado_en: new Date().toISOString() },
        json: true
      });
      etapaMovida = true;
    } catch (e) { errorEstado = e.message || "error estado"; }
  } else if (!nuevaClave) {
    // La etapa con ese NOMBRE no existe en el pipeline: NO se mueve al cliente
    // a una clave inventada y NO se crea ninguna etapa. Luna conserva su
    // avance interno (luna_etapa) y el operador solo tiene que usar la etapa
    // que ya esta creada en el CRM.
    errorEstado = "no existe ninguna etapa llamada '" + (NOMBRE_DESTINO[destino] || destino) +
      "' en pipeline_etapas (busqueda por NOMBRE). No se movio al cliente y no se creo ninguna etapa: utiliza la etapa que ya esta creada en el CRM.";
  } else {
    errorEstado = "sin cliente en supabase";
  }
}

// -----------------------------------------------------
// 3) GUARDAR ESTADO DE LA ETAPA Y PAUSA EN CHATWOOT
//    + REACTIVAR LUNA SI ESTA EN NUEVO LEAD O DATOS (por nombre)
// -----------------------------------------------------
const attrs = {
  luna_etapa: destino || etapa,
  luna_etapa_crm_sync: destino ? etapaMovida : true
};

// Si estamos en lead_nuevo, Luna DEBE estar activa por nombre
if (etapa === "lead_nuevo") {
  attrs.luna_pausada = false;
  attrs.lista_requisitos_enviada = false;
  attrs.luna_pausa_motivo = "";
  attrs.luna_reactivada_en = Math.floor(Date.now() / 1000);
  attrs.luna_reactivada_motivo = "Reactivada por etapa Nuevo Lead (validacion por nombre)";
}

if (pausarChat) {
  attrs.luna_pausada = true;
  attrs.lista_requisitos_enviada = true;
  attrs.luna_pausa_motivo = "Lista de requisitos enviada; continuar manualmente";
  attrs.luna_pausada_en = Math.floor(Date.now() / 1000);
} else if (destino === "datos" || etapa === "datos") {
  // En Datos, mientras no se pause, asegurar que no quede marcada como pausada
  if (!pausarChat) {
    attrs.luna_pausada = false;
  }
}

let errorAttrs = null;
try {
  await this.helpers.httpRequest({
    method: "POST",
    url: CHATWOOT_URL + "/api/v1/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId + "/custom_attributes",
    headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
    body: { custom_attributes: attrs },
    json: true
  });
} catch (e) { errorAttrs = e.message || "error attrs"; }

// La bandera agente_activo es la que usa el CRM y Verificar CRM para cortar
// el flujo desde el siguiente mensaje.
let pausaCRM = false;
let errorPausaCRM = null;
let reactivacionCRM = false;
let errorReactivacionCRM = null;

if (pausarChat && conversationId) {
  try {
    await this.helpers.httpRequest({
      method: "PATCH",
      url: SUPABASE_URL + "/rest/v1/conversaciones?chatwoot_conversation_id=eq." + encodeURIComponent(conversationId),
      headers: sbHeaders,
      body: { agente_activo: false },
      json: true
    });
    pausaCRM = true;
  } catch (e) { errorPausaCRM = e.message || "error pausando conversacion"; }
} else if ((etapa === "lead_nuevo" || destino === "datos" || etapa === "datos") && conversationId) {
  // Asegurar que Luna este ACTIVA en Nuevo Lead y Datos (por nombre)
  try {
    await this.helpers.httpRequest({
      method: "PATCH",
      url: SUPABASE_URL + "/rest/v1/conversaciones?chatwoot_conversation_id=eq." + encodeURIComponent(conversationId),
      headers: sbHeaders,
      body: { agente_activo: true },
      json: true
    });
    reactivacionCRM = true;
    // Tambien asegurar global activa
    try {
      await this.helpers.httpRequest({
        method: "PATCH",
        url: SUPABASE_URL + "/rest/v1/config_general?clave=eq.luna_global_activa",
        headers: sbHeaders,
        body: { valor: "true", actualizado_en: new Date().toISOString() },
        json: true
      });
    } catch (e2) {}
  } catch (e) { errorReactivacionCRM = e.message || "error reactivando conversacion"; }
}

// -----------------------------------------------------
// 4) ETIQUETA VISIBLE Y EXPEDIENTE AL MAESTRO
// -----------------------------------------------------
let etiquetasFinales = [];
let errorLabels = null;
try {
  const actuales = Array.isArray(pulir.labels) ? pulir.labels : (Array.isArray(fusion.labels) ? fusion.labels : []);
  const conservadas = actuales.filter(l => !/^etapa-/.test(String(l)) && String(l) !== "bot-pausado");
  const etapaActiva = destino || etapa;
  etiquetasFinales = [...new Set(conservadas.concat(["etapa-" + etapaActiva]))];
  if (pausarChat) etiquetasFinales.push("bot-pausado");
  etiquetasFinales = [...new Set(etiquetasFinales)];
  await this.helpers.httpRequest({
    method: "POST",
    url: CHATWOOT_URL + "/api/v1/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId + "/labels",
    headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
    body: { labels: etiquetasFinales },
    json: true
  });
} catch (e) { errorLabels = e.message || "error labels"; }

function dossier(titulo) {
  const lineas = [titulo, ""];
  lineas.push("👤 *Cliente:* " + (checklist.nombre_cliente || pulir.contactName || "Cliente"));
  lineas.push("📞 *Telefono:* " + (pulir.telefono || pulir.contactPhone || "sin telefono"));
  lineas.push("🔮 *Trabajo:* " + (checklist.tipo_trabajo ? checklist.tipo_trabajo.toUpperCase() : "por definir"));
  if (checklist.motivo_categoria) lineas.push("🎯 *Motivo:* " + checklist.motivo_categoria);
  if (checklist.motivo_resumen) lineas.push("📝 *Caso:* " + checklist.motivo_resumen);
  if (checklist.nombre_otra_persona) lineas.push("👥 *Persona a consultar:* " + checklist.nombre_otra_persona);
  const fotos = [];
  if (checklist.foto_cliente) fotos.push("cliente" + (checklist.foto_cliente_url ? ": " + checklist.foto_cliente_url : ""));
  if (checklist.foto_otra_persona) fotos.push("persona a consultar" + (checklist.foto_otra_persona_url ? ": " + checklist.foto_otra_persona_url : ""));
  if (checklist.foto_mano) fotos.push("palma" + (checklist.foto_mano_url ? ": " + checklist.foto_mano_url : ""));
  lineas.push("📷 *Fotos:* " + (fotos.length ? fotos.join(" | ") : "pendientes"));
  if (pulir.faltantes && pulir.faltantes.length) {
    lineas.push("📋 *Pendiente para el cliente:* " + pulir.faltantes.map(f => f.etiqueta).join(", "));
  }
  lineas.push("🏷️ *Etapa:* Datos");
  lineas.push("");
  lineas.push("🔗 " + (pulir.chatwootUrl || CHATWOOT_URL));
  return lineas.join("\n");
}

let notificacion = null;
let errorNotif = null;
if (pausarChat) {
  notificacion = dossier("🔔 *LUNA PAUSADA - DATOS IDENTIFICADOS* 🔔\nLuna envio al cliente la lista de requisitos. Continua manualmente el chat.");
}

if (notificacion) {
  try {
    await this.helpers.httpRequest({
      method: "POST",
      url: EVOLUTION_URL + "/message/sendText/" + INSTANCIA_MAESTRO,
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_KEY },
      body: { number: NUMERO_MAESTRO, text: notificacion },
      json: true
    });
  } catch (e) { errorNotif = e.message || "error notificacion"; }
}

return [{
  json: {
    ...pulir,
    etapaAnterior: etapa,
    etapaNueva: destino || etapa,
    etapaNuevaClave: nuevaClave,
    transicion: Boolean(destino),
    razonTransicion: razon,
    consultaLista: false,
    chatPausado: pausarChat,
    etapaMovida: etapaMovida,
    reactivacionCRM: reactivacionCRM,
    etiquetas: etiquetasFinales,
    validacionPorNombre: true,
    _debug: {
      ...(pulir._debug || {}),
      destino,
      razon,
      forzado,
      nuevaClave,
      etapaMovida,
      etapaResueltaPorNombre: Boolean(nuevaClave),
      sinEtapaEnPipeline: Boolean(destino && !nuevaClave),
      envioFallido,
      pausaSolicitada,
      pausarChat,
      pausaCRM,
      reactivacionCRM,
      validacionPorNombre: true,
      errorEstado,
      errorAttrs,
      errorPausaCRM,
      errorReactivacionCRM,
      errorLabels,
      notificacionEnviada: Boolean(notificacion && !errorNotif),
      errorNotif,
      etapasPipelineCount: (etapasPipeline || []).length,
      grupo: grupo
    }
  }
}];
