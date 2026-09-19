// ============================================================================
// RECORDATORIOS DE WHATSAPP API · nodo "Enviar por WhatsApp API"
// ----------------------------------------------------------------------------
// Manda el mensaje por la conversación de Chatwoot (bandeja del WhatsApp API).
// Los ítems de diagnóstico (_diagnostico: true) solo pasan de largo.
// Las credenciales van escritas aquí adentro (esta instancia de n8n no permite
// variables de entorno).
//
// IMPORTANTE · la cadena
//   El workflow va en línea: Buscar → Enviar → Registrar (ya no hay nodo
//   «Procesar uno a uno» ni bucle que pueda cortar la pasada en el primer
//   cliente). Este nodo envía de a uno, en orden, todos los ítems que recibe.
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

// ---------------------------------------------------------------------------
// ÍTEMS DE ENTRADA (tanda completa, no solo el primero)
// ---------------------------------------------------------------------------
// OJO · aquí estaba el motivo de que saliera UN solo recordatorio por pasada.
// El nodo «Buscar clientes y preparar recordatorio» entrega todos los clientes
// de golpe, pero este código leía «$input.item» (un único ítem) y enviaba solo
// ese. Lo correcto es recorrer la tanda completa con $input.all(), que es lo que
// usa el modo por defecto del nodo Code («Run Once for All Items»).
function itemsDeEntrada() {
  try {
    const todos = $input.all();
    if (Array.isArray(todos) && todos.length) return todos;
  } catch (error) {
    // Sin $input.all() (modos raros del nodo): se sigue con los otros caminos.
  }
  try {
    const primero = $input.first();
    if (primero && primero.json) return [primero];
  } catch (error) {}
  try {
    const actual = $input.item;
    if (actual && actual.json) return [actual];
  } catch (error) {}
  return [];
}

const resultados = [];

for (const item of itemsDeEntrada()) {
  const d = (item && item.json) || {};

  if (d._diagnostico === true) {
    resultados.push({ json: { ...d, enviado: false, omitido: 'diagnostico', error: null } });
    continue;
  }
  if (!d.conversationId || !d.mensaje) {
    resultados.push({ json: { ...d, enviado: false, error: 'Sin conversationId o mensaje: no se envió nada.' } });
    continue;
  }

  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${d.conversationId}/messages`,
      headers: { api_access_token: TOKEN, 'Content-Type': 'application/json' },
      body: { content: d.mensaje, message_type: 'outgoing', private: false },
      json: true
    });
    resultados.push({ json: { ...d, enviado: true, error: null } });
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
    resultados.push({ json: { ...d, enviado: false, error: detalle ? motivo + ' · ' + detalle.slice(0, 300) : motivo } });
  }
}

return resultados;
