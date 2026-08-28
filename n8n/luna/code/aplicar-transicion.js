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
const SUPABASE_URL = "https://qrrkokfmbdtodrqbfehs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmtva2ZtYmR0b2RycWJmZWhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5NTU0NSwiZXhwIjoyMTAyNzcxNTQ1fQ.bFwt6pAidvSEEuv3UNuKeZYwkfB-d2OPgMHM8MmwcD8";
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

const pulir = $input.first().json || {};
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
  lead_nuevo: ["nuevo_lead", "nuevo_lead_templo", "lead_nuevo", "leadnuevo", "nuevo", "nuevo_cliente"],
  datos: ["datos", "datos_templo", "solicitar_datos", "solicitud_datos", "en_datos", "pedir_datos", "recoger_datos"]
};
const NOMBRES_ETAPA = {
  lead_nuevo: ["nuevo_lead", "lead_nuevo", "nuevo", "nuevo_cliente", "lead", "primer_contacto", "nuevo_contacto"],
  datos: ["datos", "solicitar_datos", "pedir_datos", "en_datos", "datos_cliente", "datos_del_cliente", "recoleccion_datos", "solicitud_datos"]
};
const TOKENS_NOMBRE = {
  lead_nuevo: ["nuevo lead", "lead nuevo", "nuevo"],
  datos: ["datos", "solicitar datos", "pedir datos"]
};

function resolverClave(canon) {
  const candidatasClave = MAPA_ETAPAS[canon] || [];
  const candidatasNombre = NOMBRES_ETAPA[canon] || [];
  const tokens = TOKENS_NOMBRE[canon] || [];
  const delGrupo = etapasPipeline.filter(e => String(e.grupo || "") === String(grupo));
  const universo = delGrupo.length ? delGrupo : etapasPipeline;
  if (!universo.length) return candidatasClave[0] || null;

  for (const n of candidatasNombre) {
    const e = universo.find(x => normalizar(x.nombre) === n);
    if (e) return e.clave;
  }
  for (const c of candidatasClave) {
    const e = universo.find(x => normalizar(x.clave) === c);
    if (e) return e.clave;
  }
  for (const t of tokens) {
    const e = universo.find(x => normalizar(x.nombre).indexOf(normalizar(t)) !== -1);
    if (e) return e.clave;
  }
  return null;
}

// -----------------------------------------------------
// 1) DECIDIR DESTINO Y SI HAY QUE PAUSAR
// -----------------------------------------------------
let destino = null;
let razon = "sin_cambio";
let forzado = false;
const pausarChat = etapa === "datos" && pulir.pausarChat === true;

if (etapa === "lead_nuevo") {
  destino = "datos";
  razon = "saludo_realizado_motivo_preguntado";
}
// En Datos no hay una tercera etapa: Luna se queda en Datos. La pausa se
// activa unicamente cuando ya envio la lista de requisitos al cliente.
if (etapa === "datos" && pausarChat) {
  razon = "lista_de_requisitos_enviada_luna_pausada";
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
  } else {
    errorEstado = nuevaClave
      ? "sin cliente en supabase"
      : "no existe la etapa '" + destino + "' en pipeline_etapas del grupo " + grupo;
  }
}

// -----------------------------------------------------
// 3) GUARDAR ESTADO DE LA PAUSA EN CHATWOOT
// -----------------------------------------------------
const attrs = {
  luna_etapa: destino || etapa,
  luna_etapa_crm_sync: destino ? etapaMovida : true
};
if (pausarChat) {
  attrs.luna_pausada = true;
  attrs.lista_requisitos_enviada = true;
  attrs.luna_pausa_motivo = "Lista de requisitos enviada; continuar manualmente";
  attrs.luna_pausada_en = Math.floor(Date.now() / 1000);
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
// el flujo desde el siguiente mensaje. Se guarda tambien el atributo anterior
// como respaldo, por si el evento llega antes de que Supabase termine de crear
// la conversacion.
let pausaCRM = false;
let errorPausaCRM = null;
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
    etiquetas: etiquetasFinales,
    _debug: {
      ...(pulir._debug || {}),
      destino,
      razon,
      forzado,
      nuevaClave,
      etapaMovida,
      pausarChat,
      pausaCRM,
      errorEstado,
      errorAttrs,
      errorPausaCRM,
      errorLabels,
      notificacionEnviada: Boolean(notificacion && !errorNotif),
      errorNotif
    }
  }
}];
