// =====================================================
// LEER ESTADO DEL LEAD
// Punto unico de lectura antes de que Luna hable:
//   1) Supabase: conversacion + cliente (etapa del pipeline, grupo, telefono)
//   2) Supabase: pipeline_etapas (para poder MOVER la etapa con la clave real)
//   3) Chatwoot: custom_attributes (checklist persistente) + labels
// Siempre devuelve UN item, aunque Supabase o Chatwoot fallen.
// =====================================================
const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
const SUPABASE_KEY = "AQUI_SUPABASE_SERVICE_ROLE_KEY";
const CHATWOOT_URL = "https://TU-CHATWOOT.duckdns.org";
const CHATWOOT_TOKEN = "AQUI_CHATWOOT_API_TOKEN";
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
// NORMALIZADOR DE ETAPAS — VALIDACION POR NOMBRE (no por clave)
// -----------------------------------------------------
// El usuario edita el NOMBRE visible en el CRM (ej: "Nuevo Lead", "Datos").
// La clave puede ser "nuevo_lead", "etapa_templo_1734567890123" o cualquier
// timestamp. Por eso la via principal es el NOMBRE, no la clave.
function normalizar(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[\s\-]+/g, "_");
}

// Claves semilla del CRM (compatibilidad hacia atras). No son la via principal,
// pero se mantienen por si alguna instalacion antigua aun usa claves fijas.
const MAPA_ETAPAS = {
  lead_nuevo: ["nuevo_lead", "nuevo_lead_templo", "lead_nuevo", "leadnuevo", "nuevo", "nuevo_cliente", "nuevo_templo", "etapa_nuevo_lead", "etapa_lead_nuevo"],
  sin_respuesta: ["sin_respuesta", "sin_respuesta_templo", "sinrespuesta", "no_contesta", "no_contesta_templo", "nocontesta", "no_responde", "sin_contacto"],
  datos: ["datos", "datos_templo", "solicitar_datos", "solicitud_datos", "en_datos", "pedir_datos", "recoger_datos", "etapa_datos"],
  por_consulta: ["por_consulta", "por_consulta_templo", "porconsulta", "en_consulta", "en_consulta_templo", "espera_consulta", "consulta_pendiente", "esperando_maestro"]
};

// NOMBRES de etapa (lo que ves en el CRM). VIA PRINCIPAL: validacion por nombre.
const NOMBRES_ETAPA = {
  lead_nuevo: [
    "nuevo_lead", "lead_nuevo", "nuevo", "nuevo_cliente", "lead",
    "primer_contacto", "nuevo_contacto", "nuevo_lead_templo", "lead_nuevo_templo",
    "nuevo_templo", "nuevo lead", "lead nuevo", "nuevo cliente", "nuevo contacto"
  ],
  sin_respuesta: ["sin_respuesta", "no_contesta", "sin_responder", "no_responde", "sin_contacto", "no_ha_respondido", "sin respuesta", "no contesta"],
  datos: [
    "datos", "solicitar_datos", "pedir_datos", "en_datos", "datos_cliente",
    "datos_del_cliente", "recoleccion_datos", "solicitud_datos", "recoger_datos",
    "datos_templo", "solicitar datos", "pedir datos", "recoleccion datos"
  ],
  por_consulta: ["por_consulta", "en_consulta", "espera_consulta", "consulta_pendiente", "esperando_maestro", "listo_para_consulta", "por_llamar", "espera_llamada", "por consulta", "en consulta"]
};

// =====================================================
// ⚙️ CONFIGURACION RAPIDA (lo unico que suele haber que tocar)
// =====================================================
// Si tu etapa se llama de otra forma, agregala aqui con el NOMBRE tal como lo
// ves en el CRM (o su clave). Minusculas, sin tildes, espacios como guion bajo.
// Ejemplo:  "clientes_interesados": "datos",
const ETAPAS_EXTRA = {
  // Ejemplos por si el cliente renombra las etapas:
  // "nuevo_lead": "lead_nuevo",
  // "lead_nuevo": "lead_nuevo",
  // "datos": "datos",
  // "informacion": "datos",
};

// Si la etapa NO se reconoce y esto esta en true, Luna responde en modo
// retencion. En false se queda callada. La configuracion solicitada solo
// permite actuar en Lead Nuevo y Datos.
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
  "cliente", "cliente_activo", "atendido",
  "en_consulta", "consulta_hecha", "trabajo_proceso", "trabajo_completado"
];

const ETAPAS_LUNA = ["lead_nuevo", "datos"];
const ORDEN_ETAPA = { lead_nuevo: 1, datos: 2 };

// Reconocimiento por NOMBRE (VIA PRINCIPAL — valida por nombre, no por clave)
function canonPorNombre(nombre) {
  const n = normalizar(nombre);
  if (!n) return null;
  const nOriginal = String(nombre || "").toLowerCase();

  // 0) Configuracion manual
  if (ETAPAS_EXTRA[n] && ETAPAS_LUNA.indexOf(ETAPAS_EXTRA[n]) !== -1) return ETAPAS_EXTRA[n];
  if (ETAPAS_EXTRA[nOriginal] && ETAPAS_LUNA.indexOf(ETAPAS_EXTRA[nOriginal]) !== -1) return ETAPAS_EXTRA[nOriginal];

  // 1) Exact matches en NOMBRES_ETAPA (normalizados)
  for (const canon of Object.keys(NOMBRES_ETAPA)) {
    const lista = NOMBRES_ETAPA[canon].map(normalizar);
    if (lista.indexOf(n) !== -1) return canon;
  }

  // 2) Validacion robusta por NOMBRE visible (lo que pide el usuario)
  //    Prioridad: datos > lead_nuevo > otras
  //    - Si el nombre contiene "datos" → datos
  if (n.includes("datos") || nOriginal.includes("datos")) return "datos";

  //    - Si contiene "nuevo" y "lead" en cualquier orden, o solo "nuevo" o "lead" como etapa inicial
  //      Ej: "Nuevo Lead", "Lead Nuevo", "Nuevo", "Lead", "Nuevo Cliente"
  if ((n.includes("nuevo") && n.includes("lead")) ||
      n === "nuevo_lead" || n === "lead_nuevo" ||
      n === "nuevo" || n === "lead" ||
      n.includes("nuevo_cliente") || n.includes("primer_contacto") || n.includes("nuevo_contacto")) {
    return "lead_nuevo";
  }

  // 3) Otras etapas conocidas
  if (/sin[_ ]?respuesta|no[_ ]?contesta|sin[_ ]?responder/.test(n)) return "sin_respuesta";
  if (/por_consulta|en_consulta|espera.*consulta|consulta_pendiente|esperando_maestro|por_llamar/.test(n)) return "por_consulta";
  if (/consulta_hecha|pago|trabajo|perdido|spam|archiv|cliente|atendido/.test(n)) return "tardia";

  return null;
}

// Reconocimiento de la etapa guardada en clientes.estado — VALIDA POR NOMBRE
function canonEtapa(clave, etapas) {
  const k = normalizar(clave);
  if (!k) return "lead_nuevo"; // default para leads nuevos sin etapa

  const lista = Array.isArray(etapas) ? etapas : [];

  // 1) Configuracion manual del usuario (por nombre o clave)
  if (ETAPAS_EXTRA[k] && ETAPAS_LUNA.indexOf(ETAPAS_EXTRA[k]) !== -1) return ETAPAS_EXTRA[k];

  // 2) VIA PRINCIPAL: buscar la fila por CLAVE, pero decidir por su NOMBRE visible
  //    Esto es lo que pide el usuario: validar por NOMBRE, no por clave.
  const filaPorClave = lista.find(e => normalizar(e.clave) === k);
  if (filaPorClave) {
    const porNombre = canonPorNombre(filaPorClave.nombre);
    if (porNombre) return porNombre;
    // Si el nombre no se reconoce pero es una etapa tardia conocida por nombre
    if (ETAPAS_TARDIAS.indexOf(normalizar(filaPorClave.nombre)) !== -1) return "tardia";
    // Fallback: si la clave es conocida (compatibilidad)
    for (const canon of Object.keys(MAPA_ETAPAS)) {
      if (MAPA_ETAPAS[canon].indexOf(k) !== -1) return canon;
    }
  }

  // 3) Buscar por NOMBRE exacto (por si clientes.estado guarda el nombre visible)
  const filaPorNombreExacto = lista.find(e => normalizar(e.nombre) === k);
  if (filaPorNombreExacto) {
    const porNombre = canonPorNombre(filaPorNombreExacto.nombre);
    if (porNombre) return porNombre;
  }

  // 4) Buscar por NOMBRE que contiene la clave (ej: estado = "nuevo lead" y pipeline tiene "Nuevo Lead")
  for (const e of lista) {
    const nombreNorm = normalizar(e.nombre);
    if (nombreNorm && (nombreNorm === k || k.includes(nombreNorm) || nombreNorm.includes(k))) {
      const porNombre = canonPorNombre(e.nombre);
      if (porNombre) return porNombre;
    }
  }

  // 5) Claves semilla conocidas (backward compat)
  for (const canon of Object.keys(MAPA_ETAPAS)) {
    if (MAPA_ETAPAS[canon].indexOf(k) !== -1) return canon;
  }

  // 6) Directo por nombre (cuando la clave es en realidad un nombre)
  const directo = canonPorNombre(k);
  if (directo) return directo;
  if (ETAPAS_TARDIAS.indexOf(k) !== -1) return "tardia";

  // 7) Coincidencias parciales finales
  for (const canon of Object.keys(MAPA_ETAPAS)) {
    if (k.indexOf(canon) !== -1) return canon;
  }
  if (ETAPAS_TARDIAS.some(t => k.indexOf(t) !== -1)) return "tardia";

  return "otra";
}

const NOMBRE_ETAPA = {
  lead_nuevo: "Lead Nuevo",
  datos: "Datos"
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

// Luna pausada y lista enviada — se leen de Chatwoot, pero se corrigen por nombre de etapa
const lunaPausadaRaw = attrs.luna_pausada === true || String(attrs.luna_pausada).toLowerCase() === "true";
const listaEnviadaRaw = attrs.lista_requisitos_enviada === true || String(attrs.lista_requisitos_enviada).toLowerCase() === "true";

// Regla solicitada: Luna debe estar ACTIVA en Nuevo Lead y Datos, validando por NOMBRE.
// - En "Nuevo Lead" (lead_nuevo) Luna SIEMPRE debe estar activa: si estaba pausada, se reactiva.
// - En "Datos" Luna esta activa hasta que envia la lista; despues se pausa.
let lunaPausada = lunaPausadaRaw;
let listaEnviada = listaEnviadaRaw;
let necesitaReactivar = false;

if (etapa === "lead_nuevo") {
  // En Nuevo Lead Luna debe estar activa por nombre, no por clave
  if (lunaPausadaRaw || listaEnviadaRaw) {
    necesitaReactivar = true;
    console.log("♻️ Reactivando Luna: lead en etapa 'Nuevo Lead' por nombre, limpiando pausa previa");
  }
  lunaPausada = false;
  listaEnviada = false;
}

const lunaActua = (etapa === "lead_nuevo" && ETAPAS_LUNA.indexOf(etapa) !== -1) ||
                  (etapa === "datos" && ETAPAS_LUNA.indexOf(etapa) !== -1 && !lunaPausadaRaw) ||
                  (ETAPAS_LUNA.indexOf(etapa) !== -1 && !lunaPausada);

// Las etapas que si existen en el CRM, para ver de un vistazo que clave agregar
// Se muestran TODAS las etapas, sin filtrar por grupo, para validar por nombre
const etapasDelGrupo = etapasPipeline
  .map(e => String(e.clave) + " (" + String(e.nombre || "") + ")" + (e.grupo ? " [" + e.grupo + "]" : ""));

if (!lunaActua) {
  console.log("🔕 Luna no responde. Etapa del lead: '" + etapaClave +
    "' (canon: " + etapaDetectada + ") → " + (etapaReconocida ? "etapa fuera de Lead Nuevo/Datos (correcto)" : "ETAPA NO RECONOCIDA") +
    ". Etapas del CRM por NOMBRE: " + (etapasDelGrupo.join(", ") || "sin pipeline_etapas") +
    ". Validacion por NOMBRE, no por clave.");
} else {
  console.log("✅ Luna ACTIVA por NOMBRE en etapa: '" + etapaClave + "' → canon: " + etapa + " (" + etapaNombre + "). Pausada previa: " + lunaPausadaRaw + " Lista enviada: " + listaEnviadaRaw);
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
    lunaPausada: lunaPausada,
    lunaPausadaRaw: lunaPausadaRaw,
    listaRequisitosEnviada: listaEnviada,
    listaRequisitosEnviadaRaw: listaEnviadaRaw,
    necesitaReactivar: necesitaReactivar,
    etapasPipeline: etapasPipeline,
    etapasDelGrupo: etapasDelGrupo,
    attrs: attrs,
    labels: labels,
    chatwootUrl: CHATWOOT_URL + "/app/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId,
    _debug: {
      etapaLeidaDelCrm: estadoCliente || "(vacia)",
      etapaInterpretada: etapa,
      etapaClaveOriginal: etapaClave,
      nombreEtapaEnCrm: (etapasPipeline.find(e => normalizar(e.clave) === normalizar(estadoCliente)) || {}).nombre || null,
      nombreEtapaPorClave: (etapasPipeline.find(e => normalizar(e.clave) === normalizar(estadoCliente)) || {}).nombre || null,
      // Diagnostico: la clave guardada en clientes.estado debe existir en el
      // pipeline. Si no existe, la etapa se interpreto por NOMBRE y el
      // operador debe usar la etapa que ya esta creada (no crear otra).
      estadoExisteEnPipeline: Boolean(estadoCliente && etapasPipeline.some(e => normalizar(e.clave) === normalizar(estadoCliente))),
      usoAvanceInterno: usarAttr,
      etapaReconocida: etapaReconocida,
      lunaActua: lunaActua,
      lunaPausada: lunaPausada,
      lunaPausadaRaw: lunaPausadaRaw,
      listaEnviadaRaw: listaEnviadaRaw,
      necesitaReactivar: necesitaReactivar,
      etapasDelGrupo: etapasDelGrupo,
      validacionPorNombre: true,
      errorSupabase,
      errorChatwoot,
      totalEtapas: etapasPipeline.length
    }
  }
}];
