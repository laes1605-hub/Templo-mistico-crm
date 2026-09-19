// ============================================================================
// RECORDATORIOS DE WHATSAPP API · nodo "Registrar envío e impedir duplicados"
// ----------------------------------------------------------------------------
// Guarda el envío en public.recordatorios_whatsapp para que el siguiente ciclo
// no repita el mismo intento. Credenciales: variables de entorno de n8n con
// respaldo escrito aquí (mismo Supabase que el nodo de búsqueda).
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

const SUPABASE_URL = env('SUPABASE_URL', 'https://zcljlddtcoyfyvshlyfk.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = env(
  'SUPABASE_SERVICE_ROLE_KEY',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjbGpsZGR0Y295Znl2c2hseWZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQ0NTQ4NCwiZXhwIjoyMTA0MDIxNDg0fQ._iG5UHv6fUc4QvhA56WbJ_P7WhIg1vyz1R3B5EWUU90'
);

const d = $input.item.json;
if (!d || d._diagnostico === true) return [{ json: d || {} }];
if (d.enviado !== true) return [{ json: d }];

const fecha = new Date().toISOString().slice(0, 10);
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
  return [{ json: { ...d, registrado: true } }];
} catch (e) {
  return [{ json: { ...d, registrado: false, errorRegistro: (e && e.message) || 'error registrando' } }];
}
