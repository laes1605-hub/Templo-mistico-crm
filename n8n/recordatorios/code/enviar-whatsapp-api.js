// ============================================================================
// RECORDATORIOS DE WHATSAPP API · nodo "Enviar por WhatsApp API"
// ----------------------------------------------------------------------------
// Manda el mensaje por la conversación de Chatwoot (bandeja del WhatsApp API).
// Los ítems de diagnóstico (_diagnostico: true) solo pasan de largo.
// Credenciales: variables de entorno de n8n con respaldo escrito aquí.
// ============================================================================
// ---------------------------------------------------------------------------
// CREDENCIALES (escritas aquí adentro)
// ---------------------------------------------------------------------------
// Esta instancia de n8n NO permite variables de entorno, así que las llaves van
// escritas en el propio código. Si algún día cambias de proyecto, edita SOLO las
// dos líneas de SUPABASE (y el token de Chatwoot si rota):
const CHATWOOT_URL = 'https://crmesteban.duckdns.org';
const CHATWOOT_API_TOKEN = 'KKaF2gF4bJZvnSkqKnR42zD8';
const CHATWOOT_ACCOUNT_ID = '1';
const SUPABASE_URL = 'https://zcljlddtcoyfyvshlyfk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjbGpsZGR0Y295Znl2c2hseWZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQ0NTQ4NCwiZXhwIjoyMTA0MDIxNDg0fQ._iG5UHv6fUc4QvhA56WbJ_P7WhIg1vyz1R3B5EWUU90';

// Nombres que usa el resto del código (no tocar).
const TOKEN = CHATWOOT_API_TOKEN;
const ACCOUNT_ID = CHATWOOT_ACCOUNT_ID;
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY;

if (!TOKEN || !SUPABASE_KEY) {
  throw new Error('Faltan CHATWOOT_API_TOKEN o SUPABASE_SERVICE_ROLE_KEY');
}

const d = $input.item.json;

if (d && d._diagnostico === true) {
  return [{ json: { ...d, enviado: false, omitido: 'diagnostico', error: null } }];
}
if (!d || !d.conversationId || !d.mensaje) {
  return [{ json: { ...(d || {}), enviado: false, error: 'Sin conversationId o mensaje: no se envió nada.' } }];
}

try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${d.conversationId}/messages`,
    headers: { api_access_token: TOKEN, 'Content-Type': 'application/json' },
    body: { content: d.mensaje, message_type: 'outgoing', private: false },
    json: true
  });
  return [{ json: { ...d, enviado: true, error: null } }];
} catch (e) {
  // El motivo real (token vencido, ventana de 24 h cerrada, etc.) queda visible
  // en la salida del nodo en lugar de perderse en los logs del servidor.
  let detalle = '';
  try {
    const cuerpo = e && e.response && e.response.body;
    if (cuerpo) detalle = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  } catch (error) {
    detalle = '';
  }
  const motivo = (e && e.message) || 'error de envío';
  return [{ json: { ...d, enviado: false, error: detalle ? motivo + ' · ' + detalle.slice(0, 300) : motivo } }];
}
