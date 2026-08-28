// =====================================================
// CANDADO DEFINITIVO DE LUNA POR NÚMERO Y CANAL
// + KILL SWITCH GLOBAL (botón 🌙 "Apagar Luna" del CRM)
// + VALIDACION POR NOMBRE DE ETAPA (Nuevo Lead y Datos)
// =====================================================
// Luna debe estar ACTIVA y responder en etapas "Nuevo Lead" y "Datos",
// validando por el NOMBRE visible, no por la clave (etapa_xxx_timestamp).
const SUPABASE_URL = "https://qrrkokfmbdtodrqbfehs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmtva2ZtYmR0b2RycWJmZWhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5NTU0NSwiZXhwIjoyMTAyNzcxNTQ1fQ.bFwt6pAidvSEEuv3UNuKeZYwkfB-d2OPgMHM8MmwcD8";
const CHATWOOT_URL = "https://crmesteban.duckdns.org";
const CHATWOOT_TOKEN = "KKaF2gF4bJZvnSkqKnR42zD8";
const ACCOUNT_ID = "1";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};
const sbHeadersPatch = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal"
};

const rawInput = $input.first().json;
const body = rawInput.body || rawInput;

if (!body || (!body.conversation && !body.id)) {
  return [{
    json: {
      ...rawInput,
      botPuedeContestar: false,
      motivo: "evento_invalido_sin_conversacion"
    }
  }];
}

const conv = body.conversation || {};
const inbox = body.inbox || conv.inbox || {};
const inboxId = String(body.inbox_id || conv.inbox_id || inbox.id || "").trim();
const inboxName = String(inbox.name || body.channel?.name || conv.channel || "").toLowerCase();
const atributosWebhook = conv.custom_attributes || {};
const etiquetasWebhook = Array.isArray(conv.labels) ? conv.labels : [];
let lunaPausadaWebhook = atributosWebhook.luna_pausada === true || String(atributosWebhook.luna_pausada).toLowerCase() === "true" || etiquetasWebhook.includes("bot-pausado");
let listaEnviadaWebhook = atributosWebhook.lista_requisitos_enviada === true || String(atributosWebhook.lista_requisitos_enviada).toLowerCase() === "true";

const sender = body.sender || conv.meta?.sender || {};
const contact = body.contact || conv.meta?.sender || {};

// Normalizar teléfonos
function soloDigitos(v) { return String(v || "").replace(/\D/g, ""); }
function pareceTelefonoReal(v) {
  const d = soloDigitos(v);
  if (d.length < 8 || d.length > 15) return false;
  if (/^0{2,}/.test(d)) return false;
  return true;
}
function normalizarTelefono(v) {
  let d = soloDigitos(v);
  if (!d) return "";
  if (d.length === 10 && d.startsWith("3")) d = "57" + d;
  return "+" + d;
}
function normalizarEtapa(v) {
  return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[\s\-]+/g, "_");
}
// Validacion por NOMBRE (no por clave) — lo que pide el usuario
function esEtapaPorNombre(nombre, objetivo) {
  const n = normalizarEtapa(nombre);
  const nOrig = String(nombre || "").toLowerCase();
  if (!n) return false;
  if (objetivo === "lead_nuevo") {
    if (n.includes("datos")) return false;
    if ((n.includes("nuevo") && n.includes("lead")) || n === "nuevo_lead" || n === "lead_nuevo" || n === "nuevo" || n === "lead" || n.includes("nuevo_cliente") || n.includes("primer_contacto")) return true;
    if (nOrig.includes("nuevo lead") || nOrig.includes("lead nuevo")) return true;
  }
  if (objetivo === "datos") {
    if (n.includes("datos")) return true;
    if (nOrig.includes("datos")) return true;
  }
  return false;
}
function canonPorNombre(nombre) {
  const n = normalizarEtapa(nombre);
  if (!n) return null;
  if (n.includes("datos")) return "datos";
  if ((n.includes("nuevo") && n.includes("lead")) || n === "nuevo_lead" || n === "lead_nuevo" || n === "nuevo" || n === "lead") return "lead_nuevo";
  if (/sin[_ ]?respuesta|no[_ ]?contesta|sin[_ ]?responder/.test(n)) return "sin_respuesta";
  if (/por_consulta|en_consulta|espera.*consulta|consulta_pendiente|esperando_maestro|por_llamar/.test(n)) return "por_consulta";
  if (/consulta_hecha|pago|trabajo|perdido|spam|archiv|cliente|atendido/.test(n)) return "tardia";
  return null;
}

const candidatos = [
  sender.phone_number,
  contact.phone_number,
  conv?.meta?.sender?.phone_number,
  body?.conversation?.meta?.sender?.phone_number,
  sender.identifier,
  contact.identifier,
];

let telefono = "";
for (const c of candidatos) {
  if (pareceTelefonoReal(c)) {
    telefono = normalizarTelefono(c);
    break;
  }
}

const senderDigits = soloDigitos(telefono);

// NÚMEROS DEL MAESTRO Y PERSONAL (JAMÁS SERÁN ATENDIDOS POR LUNA)
const NUMEROS_EXCLUIDOS = ["573102309818", "573054021111", "3102309818", "3054021111"];
const esMaestroOPersonal = NUMEROS_EXCLUIDOS.some(num => senderDigits.includes(num));

// DETECTAR SI ES CANAL PERSONAL (Evolution API / Personal Inbox)
// NOTA: Si el inbox es "personal" pero la etapa es "Nuevo Lead" o "Datos" por NOMBRE,
// Luna DEBE responder (validacion por nombre). El bloqueo de canal personal solo
// aplica si la etapa NO es de Luna.
let esCanalPersonal = inboxName.includes("personal") || inboxName.includes("evolution") || inboxName.includes("maestro");

// REGLAS CANDADO DE LUNA:
let botPuedeContestar = true;
let motivo = "ok";

if (esMaestroOPersonal) {
  botPuedeContestar = false;
  motivo = "numero_maestro_o_personal_excluido";
}

// =====================================================
// 🌙 KILL SWITCH GLOBAL (botón "Apagar Luna" del CRM)
// =====================================================
let lunaGlobalActiva = true;
if (botPuedeContestar) {
  try {
    const cfgRes = await this.helpers.httpRequest({
      method: "GET",
      url: `${SUPABASE_URL}/rest/v1/config_general?clave=eq.luna_global_activa&select=valor`,
      headers,
      json: true
    });
    if (Array.isArray(cfgRes) && cfgRes.length > 0 &&
        String(cfgRes[0].valor || "").trim().toLowerCase() === "false") {
      lunaGlobalActiva = false;
      // No bloqueamos aun: verificaremos si esta en etapa de Luna por NOMBRE
      // Si esta en Nuevo Lead o Datos, Luna debe estar activa (reactivamos global)
      console.log("⚠️ Luna global apagada, pero se verificara etapa por NOMBRE antes de bloquear");
    }
  } catch (e) {
    lunaGlobalActiva = true;
  }
}

// Consultar Supabase (Spam, Agente Activo y ETAPA por NOMBRE)
let esSpam = false;
let agenteActivo = true;
let clienteId = null;
let conversacionId = null;
let estadoCliente = "";
let estadoClienteNombre = "";
let etapasPipeline = [];
let etapaCanon = "lead_nuevo";
let etapaReconocida = false;
let lunaPausada = lunaPausadaWebhook;
let listaEnviada = listaEnviadaWebhook;
const chatwootConversationId = conv.id;

if (botPuedeContestar && chatwootConversationId) {
  // 1) Leer pipeline_etapas para validar por NOMBRE
  try {
    const pipeRes = await this.helpers.httpRequest({
      method: "GET",
      url: `${SUPABASE_URL}/rest/v1/pipeline_etapas?select=clave,nombre,grupo&order=orden.asc`,
      headers,
      json: true
    });
    if (Array.isArray(pipeRes)) etapasPipeline = pipeRes;
  } catch (e) { etapasPipeline = []; }

  // 2) Leer Chatwoot conversacion actualizada (pausa inmediata)
  let attrsChatwoot = atributosWebhook;
  let labelsChatwoot = etiquetasWebhook;
  try {
    const chatwoot = await this.helpers.httpRequest({
      method: "GET",
      url: `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${chatwootConversationId}`,
      headers: { api_access_token: CHATWOOT_TOKEN },
      json: true
    });
    attrsChatwoot = chatwoot.custom_attributes || attrsChatwoot || {};
    labelsChatwoot = Array.isArray(chatwoot.labels) ? chatwoot.labels : labelsChatwoot;
    lunaPausada = lunaPausada || attrsChatwoot.luna_pausada === true || String(attrsChatwoot.luna_pausada).toLowerCase() === "true" || labelsChatwoot.includes("bot-pausado");
    listaEnviada = listaEnviada || attrsChatwoot.lista_requisitos_enviada === true || String(attrsChatwoot.lista_requisitos_enviada).toLowerCase() === "true";
  } catch (e) {}

  // 3) Leer Supabase conversacion + cliente estado
  try {
    const convRes = await this.helpers.httpRequest({
      method: "GET",
      url: `${SUPABASE_URL}/rest/v1/conversaciones?chatwoot_conversation_id=eq.${chatwootConversationId}&select=id,agente_activo,cliente_id,clientes(id,estado,es_spam)`,
      headers,
      json: true,
    });
    if (Array.isArray(convRes) && convRes.length > 0) {
      conversacionId = convRes[0].id;
      agenteActivo = convRes[0].agente_activo !== false;
      clienteId = convRes[0].cliente_id;
      const cli = convRes[0].clientes || convRes[0].cliente || null;
      if (cli) {
        estadoCliente = cli.estado || "";
        esSpam = cli.es_spam === true;
        // Buscar nombre de etapa por clave en pipeline
        const fila = etapasPipeline.find(e => normalizarEtapa(e.clave) === normalizarEtapa(estadoCliente));
        estadoClienteNombre = fila ? fila.nombre : estadoCliente;
      }
    }
  } catch (e) {}

  // 4) Determinar etapa canonica VALIDANDO POR NOMBRE (no por clave)
  //    Prioridad: nombre de la etapa en pipeline > estado directo
  if (estadoClienteNombre) {
    etapaCanon = canonPorNombre(estadoClienteNombre) || canonPorNombre(estadoCliente) || "otra";
  } else if (estadoCliente) {
    // Si no hay pipeline, intentar por nombre directo
    const filaPorClave = etapasPipeline.find(e => normalizarEtapa(e.clave) === normalizarEtapa(estadoCliente));
    if (filaPorClave) {
      etapaCanon = canonPorNombre(filaPorClave.nombre) || canonPorNombre(estadoCliente) || "otra";
      estadoClienteNombre = filaPorClave.nombre;
    } else {
      etapaCanon = canonPorNombre(estadoCliente) || "otra";
      estadoClienteNombre = estadoCliente;
    }
  } else {
    etapaCanon = "lead_nuevo"; // sin etapa = nuevo lead
    estadoClienteNombre = "(sin etapa)";
  }
  etapaReconocida = etapaCanon !== "otra" && etapaCanon !== "tardia";

  // 5) Si es canal personal, pero etapa es de Luna por NOMBRE, NO bloquear
  if (esCanalPersonal) {
    if (etapaCanon === "lead_nuevo" || etapaCanon === "datos") {
      console.log("✅ Canal personal detectado pero etapa es '" + estadoClienteNombre + "' (" + etapaCanon + ") por NOMBRE → Luna SI responde (validacion por nombre)");
      esCanalPersonal = false;
    } else {
      botPuedeContestar = false;
      motivo = `canal_personal_detectado_inbox_${inboxId}_name_${inboxName}_etapa_${estadoClienteNombre}`;
    }
  }

  // 6) Kill switch global: si esta apagada globalmente pero estamos en etapa de Luna por NOMBRE, reactivar
  if (!lunaGlobalActiva) {
    if (etapaCanon === "lead_nuevo" || (etapaCanon === "datos" && !listaEnviada)) {
      console.log("♻️ Luna global apagada pero lead en '" + estadoClienteNombre + "' por NOMBRE (" + etapaCanon + ") → reactivando global y permitiendo respuesta");
      try {
        await this.helpers.httpRequest({
          method: "PATCH",
          url: `${SUPABASE_URL}/rest/v1/config_general?clave=eq.luna_global_activa`,
          headers: sbHeadersPatch,
          body: { valor: "true", actualizado_en: new Date().toISOString() },
          json: true
        });
      } catch (e) {}
      lunaGlobalActiva = true;
      botPuedeContestar = true;
      motivo = "luna_reactivada_por_etapa_nombre_" + etapaCanon;
    } else {
      botPuedeContestar = false;
      motivo = "luna_apagada_globalmente";
    }
  }

  // 7) Spam
  if (esSpam) {
    botPuedeContestar = false;
    motivo = "spam";
  }

  // 8) Agente pausado / Luna pausada — REACTIVAR si esta en Nuevo Lead por NOMBRE
  if (botPuedeContestar) {
    if (etapaCanon === "lead_nuevo") {
      // En Nuevo Lead Luna DEBE estar activa por NOMBRE, limpiar pausa
      if (!agenteActivo || lunaPausada) {
        console.log("♻️ Reactivando Luna en 'Nuevo Lead' por NOMBRE: agente_activo=" + agenteActivo + " luna_pausada=" + lunaPausada + " → forzando activo");
        try {
          await this.helpers.httpRequest({
            method: "PATCH",
            url: `${SUPABASE_URL}/rest/v1/conversaciones?chatwoot_conversation_id=eq.${chatwootConversationId}`,
            headers: sbHeadersPatch,
            body: { agente_activo: true },
            json: true
          });
          await this.helpers.httpRequest({
            method: "POST",
            url: `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${chatwootConversationId}/custom_attributes`,
            headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
            body: { custom_attributes: { luna_pausada: false, lista_requisitos_enviada: false, luna_etapa: "lead_nuevo" } },
            json: true
          });
        } catch (e) {}
        agenteActivo = true;
        lunaPausada = false;
        listaEnviada = false;
      }
      botPuedeContestar = true;
      motivo = "ok_nuevo_lead_por_nombre_activa";
    } else if (etapaCanon === "datos") {
      // En Datos, activa si no ha enviado lista
      if (listaEnviada) {
        botPuedeContestar = false;
        motivo = "luna_pausada_en_este_chat_lista_ya_enviada";
      } else {
        if (!agenteActivo) {
          console.log("♻️ Reactivando Luna en 'Datos' por NOMBRE (lista no enviada): agente_activo false → true");
          try {
            await this.helpers.httpRequest({
              method: "PATCH",
              url: `${SUPABASE_URL}/rest/v1/conversaciones?chatwoot_conversation_id=eq.${chatwootConversationId}`,
              headers: sbHeadersPatch,
              body: { agente_activo: true },
              json: true
            });
          } catch (e) {}
          agenteActivo = true;
        }
        botPuedeContestar = true;
        motivo = "ok_datos_por_nombre_activa";
      }
    } else {
      // Otras etapas: respetar pausa
      if (lunaPausada) {
        botPuedeContestar = false;
        motivo = "luna_pausada_en_este_chat";
      } else if (!agenteActivo) {
        botPuedeContestar = false;
        motivo = "agente_pausado";
      }
    }
  }
}

return [{
  json: {
    ...rawInput,
    botPuedeContestar,
    motivo,
    lunaGlobalActiva,
    crmEsSpam: esSpam,
    crmAgenteActivo: agenteActivo,
    crmTelefono: telefono,
    crmEtapa: estadoCliente,
    crmEtapaNombre: estadoClienteNombre,
    crmEtapaCanon: etapaCanon,
    etapaReconocida: etapaReconocida,
    lunaPausada: lunaPausada,
    listaEnviada: listaEnviada,
    inboxId,
    inboxName,
    esCanalPersonal: esCanalPersonal,
    validacionPorNombre: true,
    debugInfo: {
      inboxId,
      inboxName,
      senderPhone: telefono,
      botPuedeContestar,
      lunaGlobalActiva,
      lunaPausada,
      listaEnviada,
      etapaNombre: estadoClienteNombre,
      etapaCanon: etapaCanon,
      etapaReconocida: etapaReconocida,
      motivo,
      validacionPorNombre: true
    }
  }
}];
