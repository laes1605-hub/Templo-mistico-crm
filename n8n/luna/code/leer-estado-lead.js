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

// Claves semilla del CRM (las etapas creadas a mano traen clave
// "etapa_<grupo>_<timestamp>", por eso el reconocimiento real es por NOMBRE).
const MAPA_ETAPAS = {
  lead_nuevo: ["nuevo_lead", "nuevo_lead_templo", "lead_nuevo", "leadnuevo", "nuevo", "nuevo_cliente", "nuevo_templo"],
  sin_respuesta: ["sin_respuesta", "sin_respuesta_templo", "sinrespuesta", "no_contesta", "no_contesta_templo", "nocontesta", "no_responde", "sin_contacto"],
  datos: ["datos", "datos_templo", "solicitar_datos", "solicitud_datos", "en_datos", "pedir_datos", "recoger_datos"],
  por_consulta: ["por_consulta", "por_consulta_templo", "porconsulta", "en_consulta", "en_consulta_templo", "espera_consulta", "consulta_pendiente", "esperando_maestro"]
};

// NOMBRES de etapa (lo que ves en el CRM). Esta es la via principal:
// da igual que la clave sea "etapa_templo_1787627846123".
const NOMBRES_ETAPA = {
  lead_nuevo: ["nuevo_lead", "lead_nuevo", "nuevo", "nuevo_cliente", "lead", "primer_contacto", "nuevo_contacto"],
  sin_respuesta: ["sin_respuesta", "no_contesta", "sin_responder", "no_responde", "sin_contacto", "no_ha_respondido"],
  datos: ["datos", "solicitar_datos", "pedir_datos", "en_datos", "datos_cliente", "datos_del_cliente", "recoleccion_datos", "solicitud_datos"],
  por_consulta: ["por_consulta", "en_consulta", "espera_consulta", "consulta_pendiente", "esperando_maestro", "listo_para_consulta", "por_llamar", "espera_llamada"]
};

// =====================================================
// ⚙️ CONFIGURACION RAPIDA (lo unico que suele haber que tocar)
// =====================================================
// Si tu etapa se llama de otra forma, agregala aqui con el NOMBRE tal como lo
// ves en el CRM (o su clave). Minusculas, sin tildes, espacios como guion bajo.
// Ejemplo:  "clientes_interesados": "datos",
const ETAPAS_EXTRA = {
};

// Si la etapa NO se reconoce y esto esta en true, Luna responde en modo
// retencion (confirma y retiene, no pide datos). En false se queda callada.
const ACTUAR_EN_ETAPA_NO_RECONOCIDA = false;

// Etapas posteriores a la consulta: Luna no habla ahi, pero son conocidas
// (no son un error de configuracion, asi que no generan alerta).
const ETAPAS_TARDIAS = [
  "consulta_hecha", "consulta_hecha_templo", "consulta_realizada",
  "pago_recibido", "pago_recibido_templo", "pago_pendiente",
  "trabajo_proceso", "trabajo_proceso_templo", "trabajo_en_proceso",
  "trabajo_completado", "trabajo_completado_templo", "trabajo_terminado",
  "perdido", "perdido_templo", "abandono",
  "spam_personal", "spam_templo", "archivado_personal", "archivado_templo",
  "cliente", "cliente_activo", "atendido"
];

const ETAPAS_LUNA = ["lead_nuevo", "sin_respuesta", "datos", "por_consulta"];
const ORDEN_ETAPA = { lead_nuevo: 1, sin_respuesta: 2, datos: 3, por_consulta: 4 };

// Reconocimiento por NOMBRE (via principal)
function canonPorNombre(nombre) {
  const n = normalizar(nombre);
  if (!n) return null;
  if (ETAPAS_EXTRA[n] && ETAPAS_LUNA.indexOf(ETAPAS_EXTRA[n]) !== -1) return ETAPAS_EXTRA[n];
  for (const canon of Object.keys(NOMBRES_ETAPA)) {
    if (NOMBRES_ETAPA[canon].indexOf(n) !== -1) return canon;
  }
  if (/sin[_ ]?respuesta|no[_ ]?contesta|sin[_ ]?responder/.test(n)) return "sin_respuesta";
  if (/(^|_)datos/.test(n) || /solicitar_datos|pedir_datos|recoger_datos/.test(n)) return "datos";
  if (/por_consulta|en_consulta|espera.*consulta|consulta_pendiente|esperando_maestro|por_llamar/.test(n)) return "por_consulta";
  if (/nuevo|lead/.test(n)) return "lead_nuevo";
  if (/consulta_hecha|pago|trabajo|perdido|spam|archiv|cliente|atendido/.test(n)) return "tardia";
  return null;
}

// Reconocimiento de la etapa guardada en clientes.estado
function canonEtapa(clave, etapas) {
  const k = normalizar(clave);
  if (!k) return "lead_nuevo";

  // 1) configuracion manual del usuario
  if (ETAPAS_EXTRA[k] && ETAPAS_LUNA.indexOf(ETAPAS_EXTRA[k]) !== -1) return ETAPAS_EXTRA[k];

  // 2) claves semilla del CRM
  for (const canon of Object.keys(MAPA_ETAPAS)) {
    if (MAPA_ETAPAS[canon].indexOf(k) !== -1) return canon;
  }

  // 3) LA CLAVE ES UN TIMESTAMP: se busca la etapa en el pipeline y se
  //    reconoce por su NOMBRE (que es lo que el usuario edita).
  const lista = Array.isArray(etapas) ? etapas : [];
  const fila = lista.find(e => normalizar(e.clave) === k);
  if (fila) {
    const porNombre = canonPorNombre(fila.nombre);
    if (porNombre) return porNombre;
    if (ETAPAS_TARDIAS.indexOf(normalizar(fila.nombre)) !== -1) return "tardia";
  }

  // 4) por si clientes.estado guarda el nombre en vez de la clave
  const directo = canonPorNombre(k);
  if (directo) return directo;
  if (ETAPAS_TARDIAS.indexOf(k) !== -1) return "tardia";

  // 5) coincidencias parciales
  for (const canon of Object.keys(MAPA_ETAPAS)) {
    if (k.indexOf(canon) !== -1) return canon;
  }
  if (fila && canonPorNombre(normalizar(fila.nombre))) return canonPorNombre(fila.nombre);
  if (ETAPAS_TARDIAS.some(t => k.indexOf(t) !== -1)) return "tardia";

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
// La etapa del CRM manda. Pero si Luna no pudo moverla en el CRM
// (luna_etapa_crm_sync=false), se respeta el avance interno de Luna para que
// no vuelva a empezar la conversacion.
const etapaDesdeCrm = canonEtapa(estadoCliente, etapasPipeline);
const etapaDesdeAttr = canonEtapa(attrs.luna_etapa, etapasPipeline);
const attrNoSincronizada = String(attrs.luna_etapa_crm_sync) === "false";
const crmVaAdelante = (ORDEN_ETAPA[etapaDesdeAttr] || 0) > (ORDEN_ETAPA[etapaDesdeCrm] || 0);
const usarAttr = attrNoSincronizada && crmVaAdelante;

const etapaClave = usarAttr ? String(attrs.luna_etapa) : (estadoCliente || attrs.luna_etapa || "");
const etapaDetectada = usarAttr ? etapaDesdeAttr : etapaDesdeCrm;
const etapaReconocida = etapaDetectada !== "otra";
const etapa = (etapaDetectada === "otra" && ACTUAR_EN_ETAPA_NO_RECONOCIDA) ? "por_consulta" : etapaDetectada;
const etapaNombre = NOMBRE_ETAPA[etapa] || (etapaClave ? String(etapaClave) : "Lead Nuevo");
const lunaActua = ETAPAS_LUNA.indexOf(etapa) !== -1;

// Las etapas que si existen en el CRM, para ver de un vistazo que clave agregar
const etapasDelGrupo = etapasPipeline
  .filter(e => !e.grupo || String(e.grupo) === String(grupo))
  .map(e => String(e.clave) + " (" + String(e.nombre || "") + ")");

if (!lunaActua) {
  console.log("🔕 Luna no responde. Etapa del lead: '" + etapaClave +
    "' → " + (etapaReconocida ? "etapa fuera de las cuatro (correcto)" : "ETAPA NO RECONOCIDA") +
    ". Etapas del CRM: " + (etapasDelGrupo.join(", ") || "sin pipeline_etapas"));
}

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
    etapaReconocida: etapaReconocida,
    lunaActua: lunaActua,
    etapasPipeline: etapasPipeline,
    etapasDelGrupo: etapasDelGrupo,
    attrs: attrs,
    labels: labels,
    chatwootUrl: CHATWOOT_URL + "/app/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId,
    _debug: {
      etapaLeidaDelCrm: estadoCliente || "(vacia)",
      etapaInterpretada: etapa,
      nombreEtapaEnCrm: (etapasPipeline.find(e => normalizar(e.clave) === normalizar(estadoCliente)) || {}).nombre || null,
      usoAvanceInterno: usarAttr,
      etapaReconocida: etapaReconocida,
      lunaActua: lunaActua,
      etapasDelGrupo: etapasDelGrupo,
      errorSupabase,
      errorChatwoot,
      totalEtapas: etapasPipeline.length
    }
  }
}];
