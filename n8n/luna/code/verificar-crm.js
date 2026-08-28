// =====================================================
// CANDADO DEFINITIVO DE LUNA POR NÚMERO Y CANAL
// + KILL SWITCH GLOBAL (botón 🌙 "Apagar Luna" del CRM)
// =====================================================
const SUPABASE_URL = "https://qrrkokfmbdtodrqbfehs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmtva2ZtYmR0b2RycWJmZWhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5NTU0NSwiZXhwIjoyMTAyNzcxNTQ1fQ.bFwt6pAidvSEEuv3UNuKeZYwkfB-d2OPgMHM8MmwcD8";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
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
let lunaPausada = atributosWebhook.luna_pausada === true || String(atributosWebhook.luna_pausada).toLowerCase() === "true" || etiquetasWebhook.includes("bot-pausado");

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
const esCanalPersonal = inboxName.includes("personal") || inboxName.includes("evolution") || inboxName.includes("maestro");

// REGLAS CANDADO DE LUNA:
let botPuedeContestar = true;
let motivo = "ok";

if (esMaestroOPersonal) {
  botPuedeContestar = false;
  motivo = "numero_maestro_o_personal_excluido";
} else if (esCanalPersonal) {
  botPuedeContestar = false;
  motivo = `canal_personal_detectado_inbox_${inboxId}_name_${inboxName}`;
}

// =====================================================
// 🌙 NUEVO: KILL SWITCH GLOBAL (botón "Apagar Luna" del CRM)
// Consulta config_general.luna_global_activa en Supabase.
// Cubre TAMBIÉN a los leads nuevos (conversaciones que aún
// no existen o que quedaron con agente_activo=true).
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
      botPuedeContestar = false;
      motivo = "luna_apagada_globalmente";
    }
  } catch (e) {
    // Si Supabase no responde, se asume ENCENDIDA (no romper el negocio)
    lunaGlobalActiva = true;
  }
}

// Consultar Supabase (Spam y Agente Activo)
let esSpam = false;
let agenteActivo = true;
let clienteId = null;
let conversacionId = null;
const chatwootConversationId = conv.id;

// Consultar Chatwoot para que la pausa sea inmediata aunque el webhook no
// traiga los custom_attributes actualizados.
if (botPuedeContestar && chatwootConversationId) {
  try {
    const chatwoot = await this.helpers.httpRequest({
      method: "GET",
      url: `https://crmesteban.duckdns.org/api/v1/accounts/1/conversations/${chatwootConversationId}`,
      headers: { api_access_token: "KKaF2gF4bJZvnSkqKnR42zD8" },
      json: true
    });
    const attrs = chatwoot.custom_attributes || {};
    const labels = Array.isArray(chatwoot.labels) ? chatwoot.labels : [];
    lunaPausada = lunaPausada || attrs.luna_pausada === true || String(attrs.luna_pausada).toLowerCase() === "true" || labels.includes("bot-pausado");
  } catch (e) {
    // El candado de Supabase sigue siendo la fuente de verdad si Chatwoot no responde.
  }
  if (lunaPausada) {
    botPuedeContestar = false;
    motivo = "luna_pausada_en_este_chat";
  }
}

if (botPuedeContestar && chatwootConversationId) {
  try {
    const convRes = await this.helpers.httpRequest({
      method: "GET",
      url: `${SUPABASE_URL}/rest/v1/conversaciones?chatwoot_conversation_id=eq.${chatwootConversationId}&select=id,agente_activo,cliente_id`,
      headers,
      json: true,
    });

    if (Array.isArray(convRes) && convRes.length > 0) {
      conversacionId = convRes[0].id;
      if (convRes[0].agente_activo === false) {
        agenteActivo = false;
      }
      clienteId = convRes[0].cliente_id;
    }

    let cliente = null;
    if (clienteId) {
      const cliRes = await this.helpers.httpRequest({
        method: "GET",
        url: `${SUPABASE_URL}/rest/v1/clientes?id=eq.${clienteId}&select=id,es_spam`,
        headers,
        json: true,
      });
      if (Array.isArray(cliRes) && cliRes.length > 0) cliente = cliRes[0];
    }

    if (cliente && cliente.es_spam === true) {
      esSpam = true;
    }
  } catch (e) {}

  if (esSpam) {
    botPuedeContestar = false;
    motivo = "spam";
  } else if (!agenteActivo) {
    botPuedeContestar = false;
    motivo = "agente_pausado";
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
    inboxId,
    inboxName,
    debugInfo: {
      inboxId,
      inboxName,
      senderPhone: telefono,
      botPuedeContestar,
      lunaGlobalActiva,
      lunaPausada,
      motivo
    }
  }
}];
