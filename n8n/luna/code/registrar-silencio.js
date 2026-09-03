// =====================================================
// REGISTRAR SILENCIO DE LUNA
// Rama falsa de "Luna Actua en esta Etapa?": cuando Luna no responde, deja
// rastro para que nunca parezca que el bot se murio.
//  • Siempre: log en la ejecucion de n8n (visible al abrir el nodo).
//  • Si la etapa NO se reconoce: ademas deja nota privada en la conversacion,
//    porque eso significa que falta mapear una clave del CRM.
// =====================================================
const CHATWOOT_URL = "https://TU-CHATWOOT.duckdns.org";
const CHATWOOT_TOKEN = "AQUI_CHATWOOT_API_TOKEN";
const ACCOUNT_ID = "1";

const estado = $input.first().json || {};
const etapaClave = estado.etapaClave || "(el cliente no tiene etapa asignada)";
const reconocida = estado.etapaReconocida === true;
const conversationId = estado.conversationId;

const motivo = reconocida
  ? "El lead esta en la etapa '" + etapaClave + "', que no es Lead Nuevo ni Datos. Luna no interviene en esa etapa."
  : "El lead esta en la etapa '" + etapaClave + "', que Luna NO reconoce. Agregala en ETAPAS_EXTRA del nodo 'Leer Estado del Lead' o mueve el lead a Lead Nuevo o Datos.";

console.log("🔕 Luna no responde: " + motivo);
console.log("   Etapas del CRM en este grupo: " + ((estado.etapasDelGrupo || []).join(", ") || "no se pudo leer pipeline_etapas"));

let notaEnviada = false;
let errorNota = null;

if (!reconocida && conversationId) {
  const texto = "🔕 *Luna no respondio este mensaje*\n" +
    "El lead esta en la etapa *" + etapaClave + "* y Luna no la reconoce.\n" +
    "Etapas donde Luna atiende: Lead Nuevo y Datos.\n" +
    "Etapas que si existen en el CRM: " + ((estado.etapasDelGrupo || []).join(", ") || "sin datos") + "\n" +
    "Para que Luna atienda esta etapa, agrega su clave en ETAPAS_EXTRA del nodo 'Leer Estado del Lead' del workflow.";
  try {
    await this.helpers.httpRequest({
      method: "POST",
      url: CHATWOOT_URL + "/api/v1/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId + "/messages",
      headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
      body: { content: texto, message_type: "outgoing", private: true },
      json: true
    });
    notaEnviada = true;
  } catch (e) {
    errorNota = e.message || "error nota";
  }
}

return [{
  json: {
    ...estado,
    lunaRespondio: false,
    motivoSilencio: motivo,
    notaPrivada: notaEnviada,
    _debug: {
      ...(estado._debug || {}),
      lunaRespondio: false,
      etapaNoReconocida: !reconocida,
      errorNota: errorNota
    }
  }
}];
