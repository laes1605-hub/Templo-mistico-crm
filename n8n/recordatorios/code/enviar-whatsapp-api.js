// ============================================================================
// RECORDATORIOS DE WHATSAPP API · nodo "Enviar por WhatsApp API"
// ----------------------------------------------------------------------------
// Manda el mensaje por la conversación de Chatwoot (bandeja del WhatsApp API).
// Los ítems de diagnóstico (_diagnostico: true) solo pasan de largo.
// Credenciales: variables de entorno de n8n con respaldo escrito aquí.
// ============================================================================
const env = (clave, respaldo) => {
  try {
    const valor = $env[clave];
    if (valor === undefined || valor === null || String(valor).trim() === '') return respaldo;
    return String(valor).trim();
  } catch (error) {
    return respaldo;
  }
};

const CHATWOOT_URL = env('CHATWOOT_URL', 'https://crmesteban.duckdns.org').replace(/\/+$/, '');
const TOKEN = env('CHATWOOT_API_TOKEN', 'KKaF2gF4bJZvnSkqKnR42zD8');
const ACCOUNT_ID = env('CHATWOOT_ACCOUNT_ID', '1');

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
