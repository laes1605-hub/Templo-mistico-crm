// =====================================================
// APLICAR TRANSICION DE ETAPA
// Unico lugar donde Luna mueve el lead en el CRM:
//   Lead Nuevo   -> Sin respuesta   (siempre, despues de saludar)
//   Sin respuesta-> Datos           (cuando ya sabe motivo + tipo de trabajo)
//   Datos        -> Por consulta    (cuando el archivo dice que no falta nada)
//   Por consulta -> se queda        (Luna solo retiene hasta que llame el Maestro)
// Ademas: etiquetas, atributos y expediente al Maestro por WhatsApp.
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
const fusion = $("Fusionar Memoria").first().json;
const checklist = fusion.checklist || pulir.checklist || {};
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
  sin_respuesta: ["sin_respuesta", "sin_respuesta_templo", "sinrespuesta", "no_contesta", "no_contesta_templo", "nocontesta", "no_responde"],
  datos: ["datos", "datos_templo", "solicitar_datos", "solicitud_datos", "en_datos", "pedir_datos"],
  por_consulta: ["por_consulta", "por_consulta_templo", "porconsulta", "en_consulta", "en_consulta_templo", "espera_consulta", "consulta_pendiente"]
};
// NOMBRES de etapa: es la via principal porque el CRM crea las etapas con
// clave "etapa_<grupo>_<timestamp>" y lo unico estable es el nombre.
const NOMBRES_ETAPA = {
  lead_nuevo: ["nuevo_lead", "lead_nuevo", "nuevo", "nuevo_cliente", "lead", "primer_contacto", "nuevo_contacto"],
  sin_respuesta: ["sin_respuesta", "no_contesta", "sin_responder", "no_responde", "sin_contacto", "no_ha_respondido"],
  datos: ["datos", "solicitar_datos", "pedir_datos", "en_datos", "datos_cliente", "datos_del_cliente", "recoleccion_datos", "solicitud_datos"],
  por_consulta: ["por_consulta", "en_consulta", "espera_consulta", "consulta_pendiente", "esperando_maestro", "listo_para_consulta", "por_llamar", "espera_llamada"]
};

const TOKENS_NOMBRE = {
  lead_nuevo: ["nuevo lead", "lead nuevo", "nuevo"],
  sin_respuesta: ["sin respuesta", "no contesta", "sin responder"],
  datos: ["datos"],
  por_consulta: ["por consulta", "en consulta", "espera consulta", "esperando"]
};

function resolverClave(canon) {
  const candidatasClave = MAPA_ETAPAS[canon] || [];
  const candidatasNombre = NOMBRES_ETAPA[canon] || [];
  const tokens = TOKENS_NOMBRE[canon] || [];
  const delGrupo = etapasPipeline.filter(e => String(e.grupo || "") === String(grupo));
  const universo = delGrupo.length ? delGrupo : etapasPipeline;
  if (!universo.length) return candidatasClave[0] || null;

  // 1) por NOMBRE exacto (las claves son timestamps, el nombre es lo estable)
  for (const n of candidatasNombre) {
    const e = universo.find(x => normalizar(x.nombre) === n);
    if (e) return e.clave;
  }
  // 2) por clave semilla
  for (const c of candidatasClave) {
    const e = universo.find(x => normalizar(x.clave) === c);
    if (e) return e.clave;
  }
  // 3) por nombre parcial
  for (const t of tokens) {
    const e = universo.find(x => normalizar(x.nombre).indexOf(normalizar(t)) !== -1);
    if (e) return e.clave;
  }
  return null;
}

// -----------------------------------------------------
// 1) DECIDIR DESTINO
// -----------------------------------------------------
let destino = null;
let razon = "sin_cambio";
let forzado = false;

// Resguardo anti-atasco: si despues de varios mensajes aun no hay tipo de
// trabajo, se asume personal para que el lead no quede congelado.
let mensajesCliente = 0;
try {
  const hist = $("Historial").first().json.payload || [];
  mensajesCliente = hist.filter(m => m.message_type === 0 || m.message_type === "incoming").length;
} catch (e) { mensajesCliente = 0; }

if (etapa === "lead_nuevo") {
  destino = "sin_respuesta";
  razon = "saludo_realizado";
} else if (etapa === "sin_respuesta") {
  if (pulir.motivoOk) {
    destino = "datos";
    razon = "motivo_y_tipo_definidos";
  } else if (!checklist.tipo_trabajo && mensajesCliente >= 5) {
    checklist.tipo_trabajo = "personal";
    if (!checklist.motivo_resumen) checklist.motivo_resumen = "Motivo pendiente de detalle, se asume trabajo personal.";
    forzado = true;
    destino = "datos";
    razon = "anti_atasco_tipo_personal";
  }
} else if (etapa === "datos") {
  if (pulir.consultaLista) {
    destino = "por_consulta";
    razon = "datos_completos";
  }
}

// -----------------------------------------------------
// 2) MOVER LA ETAPA EN EL CRM (Supabase clientes.estado)
// -----------------------------------------------------
let nuevaClave = null;
let etapaMovida = false;
let errorEstado = null;

// El cliente puede no existir cuando se leyo el estado (lead recien creado):
// "Sincronizar Supabase" lo crea en paralelo, asi que se vuelve a buscar.
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
    errorEstado = nuevaClave ? "sin cliente en supabase" : "no existe la etapa '" + destino + "' en pipeline_etapas del grupo " + grupo;
  }
}

// -----------------------------------------------------
// 3) ATRIBUTOS EN CHATWOOT
// -----------------------------------------------------
const attrs = { luna_etapa: destino || etapa, luna_etapa_crm_sync: etapaMovida };
let errorAttrs = null;
if (destino === "por_consulta") {
  attrs.consulta_lista_enviada = true;
  attrs.tiempo_consulta_lista = Math.floor(Date.now() / 1000);
}
if (forzado) attrs.tipo_trabajo = checklist.tipo_trabajo;

try {
  await this.helpers.httpRequest({
    method: "POST",
    url: CHATWOOT_URL + "/api/v1/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId + "/custom_attributes",
    headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
    body: { custom_attributes: attrs },
    json: true
  });
} catch (e) { errorAttrs = e.message || "error attrs"; }

// -----------------------------------------------------
// 4) ETIQUETAS (conserva las que no son de etapa)
// -----------------------------------------------------
let etiquetasFinales = [];
let errorLabels = null;
try {
  const actuales = Array.isArray(pulir.labels) ? pulir.labels : (Array.isArray(fusion.labels) ? fusion.labels : []);
  const conservadas = actuales.filter(l => !/^etapa-/.test(String(l)));
  const etapaActiva = destino || etapa;
  etiquetasFinales = [...new Set(conservadas.concat(["etapa-" + etapaActiva]))];
  if (destino === "por_consulta") etiquetasFinales = [...new Set(etiquetasFinales.concat(["consulta-pendiente"]))];
  await this.helpers.httpRequest({
    method: "POST",
    url: CHATWOOT_URL + "/api/v1/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId + "/labels",
    headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
    body: { labels: etiquetasFinales },
    json: true
  });
} catch (e) { errorLabels = e.message || "error labels"; }

// -----------------------------------------------------
// 5) EXPEDIENTE AL MAESTRO
// -----------------------------------------------------
function dossier(titulo) {
  const lineas = [];
  lineas.push(titulo);
  lineas.push("");
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
  lineas.push("📷 *Fotos:* " + (fotos.length ? fotos.join(" | ") : "sin fotos"));
  lineas.push("🏷️ *Etapa:* " + (destino ? NOMBRES_ETAPA[destino][0] : etapa));
  lineas.push("");
  lineas.push("🔗 " + (pulir.chatwootUrl || CHATWOOT_URL));
  return lineas.join("\n");
}

let notificacion = null;
let errorNotif = null;
const hayNovedadDeDatos = novedades.some(n => /^(foto_|nombre_|tipo_|motivo_)/.test(n));

if (destino === "por_consulta") {
  notificacion = dossier("🔔 *CONSULTA LISTA PARA LLAMAR* 🔔\nEl cliente completo todos los datos y espera tu llamada.");
} else if (etapa === "por_consulta" && hayNovedadDeDatos) {
  notificacion = dossier("🔄 *EXPEDIENTE ACTUALIZADO*\nEl cliente envio informacion nueva mientras espera tu llamada.");
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
    consultaLista: pulir.consultaLista || destino === "por_consulta",
    etiquetas: etiquetasFinales,
    _debug: {
      ...(pulir._debug || {}),
      destino,
      razon,
      forzado,
      nuevaClave,
      etapaMovida,
      mensajesCliente,
      notificacionEnviada: Boolean(notificacion && !errorNotif),
      errorEstado,
      errorAttrs,
      errorLabels,
      errorNotif
    }
  }
}];
