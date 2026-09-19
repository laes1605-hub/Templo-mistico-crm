// ============================================================================
// RECORDATORIOS DE WHATSAPP API · nodo "Registrar envío e impedir duplicados"
// ----------------------------------------------------------------------------
// Guarda el envío en public.recordatorios_whatsapp para que el siguiente ciclo
// no repita el mismo intento. Las credenciales van escritas aquí adentro, en el
// mismo proyecto Supabase que el nodo de búsqueda.
//
// IMPORTANTE · la cadena
//   El workflow va en línea: Buscar → Enviar → Registrar. Este nodo registra de
//   una sola pasada todos los envíos que le lleguen (antes solo guardaba el
//   primero, porque leía $input.item en vez de la tanda completa).
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
// Se recorre $input.all() para registrar TODOS los envíos de la pasada, no solo
// el primero (era el mismo fallo del nodo de envío).
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

const fecha = new Date().toISOString().slice(0, 10);
const resultados = [];

for (const item of itemsDeEntrada()) {
  const d = (item && item.json) || {};

  if (d._diagnostico === true || d.enviado !== true) {
    resultados.push({ json: d });
    continue;
  }

  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: `${SUPABASE_URL}/rest/v1/recordatorios_whatsapp`,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      },
      body: {
        cliente_id: d.clienteId,
        conversacion_id: d.conversacionId,
        etapa: d.estado,
        tipo: d.etapa,
        plantilla: d.intento,
        fecha: fecha,
        mensaje: d.mensaje,
        proveedor: 'chatwoot'
      },
      json: true
    });
    resultados.push({ json: { ...d, registrado: true } });
  } catch (e) {
    resultados.push({ json: { ...d, registrado: false, errorRegistro: (e && e.message) || 'error registrando' } });
  }
}

return resultados;
