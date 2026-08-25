// =====================================================
// LEER ESTADO DEL LEAD
// Punto unico de lectura antes de que Luna hable:
//   1) Supabase: conversacion + cliente (etapa del pipeline, grupo, telefono)
//   2) Supabase: pipeline_etapas (para poder MOVER la etapa con la clave real)
//   3) Chatwoot: custom_attributes (checklist persistente) + labels
// Siempre devuelve UN item, aunque Supabase o Chatwoot fallen.
// =====================================================
const SUPABASE_URL = "https://qrrkokfmbdtodrqbfehs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmtva2ZtYmR0b2RycWJmZWhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5NTU0NSwiZXhwIjoyMTAyNzcxNTQ1fQ.bFwt6pAidvSEEuv3UNuKeZYwkfB-d2OPgMHM8MmwcD8";
const CHATWOOT_URL = "https://crmesteban.duckdns.org";
const CHATWOOT_TOKEN = "KKaF2gF4bJZvnSkqKnR42zD8";
const ACCOUNT_ID = "1";

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json"
};

const upstream = $input.first().json || {};
const body = upstream.body || {};
const conv = body.conversation || {};
const conversationId = conv.id || body.conversation_id || 0;

// -----------------------------------------------------
// NORMALIZADOR DE ETAPAS (tolerante a las claves del CRM)
// -----------------------------------------------------
function normalizar(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[\s\-]+/g, "_");
}

const MAPA_ETAPAS = {
  lead_nuevo: ["nuevo_lead", "nuevo_lead_templo", "lead_nuevo", "leadnuevo", "nuevo", "nuevo_cliente", "nuevo_templo"],
  sin_respuesta: ["sin_respuesta", "sin_respuesta_templo", "sinrespuesta", "no_contesta", "no_contesta_templo", "nocontesta", "no_responde", "sin_contacto"],
  datos: ["datos", "datos_templo", "solicitar_datos", "solicitud_datos", "en_datos", "pedir_datos", "recoger_datos"],
  por_consulta: ["por_consulta", "por_consulta_templo", "porconsulta", "en_consulta", "en_consulta_templo", "espera_consulta", "consulta_pendiente", "esperando_maestro"]
};

const ETAPAS_LUNA = ["lead_nuevo", "sin_respuesta", "datos", "por_consulta"];

function canonEtapa(clave) {
  const k = normalizar(clave);
  if (!k) return "lead_nuevo";
  for (const canon of Object.keys(MAPA_ETAPAS)) {
    if (MAPA_ETAPAS[canon].indexOf(k) !== -1) return canon;
  }
  // Coincidencia parcial (ej: "datos_2", "lead_datos")
  for (const canon of Object.keys(MAPA_ETAPAS)) {
    if (k.indexOf(canon) !== -1) return canon;
  }
  return "otra";
}

const NOMBRE_ETAPA = {
  lead_nuevo: "Lead Nuevo",
  sin_respuesta: "Sin respuesta",
  datos: "Datos",
  por_consulta: "Por consulta"
};

// -----------------------------------------------------
// 1) SUPABASE: conversacion + cliente
// -----------------------------------------------------
let clienteId = null;
let conversacionDbId = null;
let estadoCliente = "";
let grupo = "templo";
let esSpam = false;
let telefono = "";
let nombreContacto = "";
let fuente = "";
let errorSupabase = null;

try {
  const q = SUPABASE_URL + "/rest/v1/conversaciones?chatwoot_conversation_id=eq." +
    encodeURIComponent(conversationId) +
    "&select=id,cliente_id,numero_whatsapp,fuente,clientes(id,estado,grupo,nombre,es_spam,tipo_trabajo,nombre_otra_persona)";
  const res = await this.helpers.httpRequest({ method: "GET", url: q, headers: sbHeaders, json: true });
  const fila = Array.isArray(res) ? res[0] : null;
  if (fila) {
    conversacionDbId = fila.id || null;
    clienteId = fila.cliente_id || null;
    telefono = fila.numero_whatsapp || "";
    fuente = fila.fuente || "";
    const cli = fila.clientes || fila.cliente || null;
    if (cli) {
      estadoCliente = cli.estado || "";
      grupo = cli.grupo || grupo;
      esSpam = cli.es_spam === true;
      nombreContacto = cli.nombre || "";
    }
  }
} catch (e) {
  errorSupabase = e.message || "error supabase";
}

// -----------------------------------------------------
// 2) SUPABASE: pipeline_etapas (claves reales para mover la etapa)
// -----------------------------------------------------
let etapasPipeline = [];
try {
  const res = await this.helpers.httpRequest({
    method: "GET",
    url: SUPABASE_URL + "/rest/v1/pipeline_etapas?select=clave,nombre,orden,grupo&order=orden.asc",
    headers: sbHeaders,
    json: true
  });
  if (Array.isArray(res)) etapasPipeline = res;
} catch (e) {
  etapasPipeline = [];
}

// -----------------------------------------------------
// 3) CHATWOOT: conversacion (custom_attributes + labels)
// -----------------------------------------------------
let attrs = conv.custom_attributes || {};
let labels = Array.isArray(conv.labels) ? conv.labels.slice() : [];
let errorChatwoot = null;

try {
  const resConv = await this.helpers.httpRequest({
    method: "GET",
    url: CHATWOOT_URL + "/api/v1/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId,
    headers: { api_access_token: CHATWOOT_TOKEN },
    json: true
  });
  attrs = resConv.custom_attributes || attrs || {};
  if (Array.isArray(resConv.labels)) labels = resConv.labels;
} catch (e) {
  errorChatwoot = e.message || "error chatwoot";
}

// Telefono / nombre de respaldo desde el webhook
const sender = body.sender || conv.meta?.sender || {};
if (!telefono) telefono = sender.phone_number || conv.meta?.sender?.phone_number || "";
if (!nombreContacto) nombreContacto = sender.name || conv.meta?.sender?.name || "Cliente";

// La etapa mandatoria es la del CRM (clientes.estado); el atributo luna_etapa
// solo sirve de respaldo si el cliente aun no tiene estado.
const etapaClave = estadoCliente || attrs.luna_etapa || "";
const etapa = canonEtapa(etapaClave);
const etapaNombre = NOMBRE_ETAPA[etapa] || (etapaClave ? String(etapaClave) : "Lead Nuevo");
const lunaActua = ETAPAS_LUNA.indexOf(etapa) !== -1;

return [{
  json: {
    body: body,
    conversationId: conversationId,
    conversacionDbId: conversacionDbId,
    clienteId: clienteId,
    grupo: grupo,
    fuente: fuente,
    esSpam: esSpam,
    telefono: telefono,
    nombreContacto: nombreContacto,
    etapa: etapa,
    etapaClave: etapaClave,
    etapaNombre: etapaNombre,
    lunaActua: lunaActua,
    etapasPipeline: etapasPipeline,
    attrs: attrs,
    labels: labels,
    chatwootUrl: CHATWOOT_URL + "/app/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId,
    _debug: { errorSupabase, errorChatwoot, totalEtapas: etapasPipeline.length }
  }
}];
