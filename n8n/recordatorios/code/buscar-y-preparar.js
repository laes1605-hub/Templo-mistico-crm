// ============================================================================
// RECORDATORIOS DE WHATSAPP API · nodo "Buscar clientes y preparar recordatorio"
// ----------------------------------------------------------------------------
// QUÉ HACE
//   Cada 15 minutos revisa los chats ABIERTOS que llegaron por el WhatsApp API
//   (Chatwoot, bandeja de Meta) y están en una etapa de recordatorio. Según el
//   tiempo que lleve el cliente sin escribir, prepara hasta 4 recordatorios:
//   30 min · 3 h · 12 h · 23 h 30 min.
//
// QUÉ SE ARREGLÓ (2026-09-19, migración al Supabase nuevo)
//   1. Las etapas se reconocen SOLO por su NOMBRE, en todo el pipeline. Antes se
//      pedía además grupo = 'templo' y el CRM ahora crea/edita las etapas con
//      grupo = 'general' ("Datos" quedó en general): el workflow no encontraba
//      la etapa y por eso dejó de enviar recordatorios desde el 10/09.
//   2. Ya no se exige clientes.grupo = 'templo'. El canal lo decide la
//      conversación (fuente = 'meta_business'), así que un chat del API que el
//      operador movió a la cartera Personal también recibe su recordatorio.
//   3. Si falta una etapa, NO revienta: lo informa en el ítem de diagnóstico
//      (el último de la salida, con _diagnostico: true).
//   4. Las credenciales van escritas aquí adentro (esta instancia de n8n no
//      permite variables de entorno). Cambiar de proyecto Supabase = editar
//      SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el bloque de abajo.
// ============================================================================

// ---------------------------------------------------------------------------
// 1) CREDENCIALES (escritas aquí adentro)
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

const chatHeaders = { api_access_token: TOKEN, 'Content-Type': 'application/json' };
const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
};
const getJson = (url, headers) => this.helpers.httpRequest({ method: 'GET', url, headers, json: true });

const ahora = Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// 2) ETAPAS QUE GENERAN RECORDATORIO (se buscan por NOMBRE, nunca por clave)
// ---------------------------------------------------------------------------
// Para agregar otro nombre visible (por ejemplo "Sin respuesta (API)") basta
// con añadirlo a la lista del tipo que corresponda.
const ETAPAS_RECORDATORIO = {
  datos: ['datos'],
  noContesta: ['sin respuesta', 'no contesta', 'no contesto', 'no responde', 'sin contestar']
};

// Variantes históricas del tipo en la tabla de auditoría: sirven para contar
// los recordatorios ya enviados a ese cliente aunque la tabla tenga registros
// antiguos escritos con otro nombre.
const VARIANTES_TIPO = {
  datos: ['datos'],
  noContesta: ['noContesta', 'sinRespuesta', 'no_contesta']
};

// Etiquetas que APAGAN los recordatorios de ese chat. Se comparan sin acentos y
// con cualquier separador: "recordatorios-pausados" y "Recordatorios Pausados"
// son la misma etiqueta.
//
// OJO con "bot-pausado": NO está en esta lista a propósito. Luna deja esa
// etiqueta justo cuando envía la lista de requisitos y pasa el chat a "Datos",
// así que vetarla silenciaba precisamente a los clientes que deben recibir el
// recordatorio de datos (en el CRM había 102 chats abiertos con esa etiqueta).
// Si algún día quieres que "bot-pausado" también silencie el recordatorio,
// basta con agregarla aquí.
const ETIQUETAS_SILENCIO = ['recordatorios_pausados', 'lead_perdido', 'perdido', 'spam'];

// Minutos/horas desde la ÚLTIMA respuesta del cliente para cada intento.
const UMBRALES_HORAS = [0.5, 3, 12, 23.5];

// WhatsApp API solo deja responder texto libre dentro de las 24 h siguientes al
// último mensaje del cliente. Pasado ese plazo Meta rechaza el envío, así que no
// se intenta: ese chat se atiende por el WhatsApp Personal (etapa Vencidos).
const VENTANA_API_HORAS = 24;

const normalizar = (valor) =>
  String(valor === null || valor === undefined ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const coincide = (nombreNormalizado, objetivo) =>
  nombreNormalizado === objetivo || nombreNormalizado.startsWith(objetivo + ' ');

// Las etiquetas de Chatwoot se normalizan con guion bajo (bot-pausado).
const normalizarEtiqueta = (valor) =>
  String(valor === null || valor === undefined ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const tipoDeNombre = (nombre) => {
  const n = normalizar(nombre);
  if (!n) return null;
  for (const tipo of Object.keys(ETAPAS_RECORDATORIO)) {
    if (ETAPAS_RECORDATORIO[tipo].some((objetivo) => coincide(n, objetivo))) return tipo;
  }
  return null;
};

// Se leen TODAS las etapas del pipeline, sin filtrar por grupo: el CRM crea y
// edita las etapas con grupo = 'general' y exigir grupo = 'templo' dejaba a
// "Datos" fuera (era la causa de que no llegara ningún recordatorio).
let etapasPipeline = [];
let errorEtapas = null;
try {
  const respuesta = await getJson(SUPABASE_URL + '/rest/v1/pipeline_etapas?select=*&order=orden.asc', sbHeaders);
  if (Array.isArray(respuesta)) etapasPipeline = respuesta;
} catch (error) {
  errorEtapas = (error && error.message) || 'error leyendo pipeline_etapas';
}

const tipoPorClave = new Map();
const tipoPorNombre = new Map();
const etapasReconocidas = {};
for (const etapa of etapasPipeline) {
  if (!etapa || etapa.es_spam === true || etapa.es_archivado === true) continue;
  const tipo = tipoDeNombre(etapa.nombre);
  if (!tipo) continue;
  const clave = String(etapa.clave || '').trim();
  if (clave) tipoPorClave.set(clave, tipo);
  const nombreNormalizado = normalizar(etapa.nombre);
  if (nombreNormalizado && !tipoPorNombre.has(nombreNormalizado)) tipoPorNombre.set(nombreNormalizado, tipo);
  if (!etapasReconocidas[tipo]) {
    etapasReconocidas[tipo] = {
      nombre: String(etapa.nombre || ''),
      clave: clave,
      grupo: etapa.grupo || null,
      cuenta_responsable: etapa.cuenta_responsable || null
    };
  }
}

// clientes.estado guarda la clave de la etapa; si algún día guardara el nombre,
// el segundo mapa lo resuelve igual.
const etapaDe = (valor) => {
  const v = String(valor === null || valor === undefined ? '' : valor).trim();
  if (!v) return null;
  return tipoPorClave.get(v) || tipoPorNombre.get(normalizar(v)) || null;
};

const plantillas = {
  datos: [
    'Hola {{nombre}}. Para avanzar con tu consulta gratuita estamos esperando los datos solicitados. Cuando puedas, envíanos los nombres y las fotos que te pedimos.',
    'Hola {{nombre}}, recuerda que la consulta es gratuita. Nos faltan los datos, nombres o fotos solicitados para poder continuar. ¿Puedes enviarlos por aquí?',
    'Hola {{nombre}}. Seguimos atentos a los datos de tu consulta. Envíanos las fotos y los nombres solicitados cuando te quede cómodo; la consulta continúa siendo gratuita y sin compromiso.',
    'Hola {{nombre}}. Este es nuestro último recordatorio sobre los datos pendientes. Cuando nos envíes los nombres o fotos podremos continuar con tu consulta gratuita.'
  ],
  noContesta: [
    'Hola {{nombre}}. Queríamos saber en cuánto tiempo puedes atender la llamada. ¿Qué hora te queda mejor?',
    'Hola {{nombre}}, seguimos pendientes de poder hablar contigo. ¿Puedes indicarnos a qué hora te queda mejor atender la llamada?',
    'Hola {{nombre}}. Cuando tengas disponibilidad, dinos qué día y a qué hora podemos llamarte. Así coordinamos la atención contigo.',
    'Hola {{nombre}}. Aprovechamos que todavía estamos dentro del horario de atención para coordinar tu llamada. ¿A qué hora te queda mejor que te atendamos?'
  ]
};

// ---------------------------------------------------------------------------
// 3) CHATS ABIERTOS DE CHATWOOT
// ---------------------------------------------------------------------------
const conteo = {
  chatsAbiertosChatwoot: 0,
  vinculadosAlApi: 0,
  llamadasChatwoot: 0,
  recordatoriosPreparados: 0,
  omitidas: {
    etiquetaSilencio: 0,
    porEtiqueta: {},
    sinVinculoApi: 0,
    archivada: 0,
    spam: 0,
    etapaSinRecordatorio: 0,
    sinMensajesEntrantes: 0,
    yaCompletos: 0,
    esperandoTiempo: 0,
    ventanaCerrada: 0,
    sinTelefono: 0,
    error: 0
  }
};
const avisos = [];
const errores = [];

const conversaciones = [];
try {
  for (let pagina = 1; pagina <= 5; pagina++) {
    const respuesta = await getJson(
      CHATWOOT_URL + '/api/v1/accounts/' + ACCOUNT_ID + '/conversations?status=open&per_page=100&page=' + pagina,
      chatHeaders
    );
    conteo.llamadasChatwoot++;
    const lote = (respuesta && respuesta.data && respuesta.data.payload) || [];
    conversaciones.push(...lote);
    if (lote.length < 100) break;
  }
} catch (error) {
  errores.push('No se pudo leer Chatwoot (' + ((error && error.message) || 'error') + '). Revisa CHATWOOT_URL y CHATWOOT_API_TOKEN.');
}
conteo.chatsAbiertosChatwoot = conversaciones.length;

// ---------------------------------------------------------------------------
// 4) POR CADA CHAT: ¿toca recordatorio?
// ---------------------------------------------------------------------------
const salidas = [];

for (const conv of conversaciones) {
  try {
    const etiquetas = Array.isArray(conv.labels) ? conv.labels.map(normalizarEtiqueta) : [];
    const vetada = etiquetas.find((etiqueta) => ETIQUETAS_SILENCIO.indexOf(etiqueta) !== -1);
    if (vetada) {
      conteo.omitidas.etiquetaSilencio++;
      conteo.omitidas.porEtiqueta[vetada] = (conteo.omitidas.porEtiqueta[vetada] || 0) + 1;
      continue;
    }

    const cwId = conv.id;
    const vinculadas = await getJson(
      SUPABASE_URL +
        '/rest/v1/conversaciones?chatwoot_conversation_id=eq.' +
        encodeURIComponent(cwId) +
        '&fuente=eq.meta_business&select=id,cliente_id,numero_whatsapp,fuente,archivada,clientes!inner(*)',
      sbHeaders
    );
    const dbConv = Array.isArray(vinculadas) ? vinculadas[0] : null;
    const cliente = dbConv && dbConv.clientes ? dbConv.clientes : null;
    if (!dbConv || !cliente) {
      conteo.omitidas.sinVinculoApi++;
      continue;
    }
    conteo.vinculadosAlApi++;
    if (dbConv.archivada === true) {
      conteo.omitidas.archivada++;
      continue;
    }
    if (cliente.es_spam === true) {
      conteo.omitidas.spam++;
      continue;
    }

    const tipo = etapaDe(cliente.estado);
    if (!tipo) {
      conteo.omitidas.etapaSinRecordatorio++;
      continue;
    }

    // Última respuesta REAL del cliente, aunque el agente haya escrito después.
    const mensajesData = await getJson(
      CHATWOOT_URL +
        '/api/v1/accounts/' +
        ACCOUNT_ID +
        '/conversations/' +
        cwId +
        '/messages?per_page=100',
      chatHeaders
    );
    const mensajes = (mensajesData && (mensajesData.payload || (mensajesData.data && mensajesData.data.payload))) || [];
    const entrantes = mensajes.filter((m) => m.message_type === 0 || m.message_type === 'incoming');
    if (!entrantes.length) {
      conteo.omitidas.sinMensajesEntrantes++;
      continue;
    }
    const ultimaRespuesta = Math.max(...entrantes.map((m) => Number(m.created_at || 0)).filter(Boolean));
    if (!ultimaRespuesta) {
      conteo.omitidas.sinMensajesEntrantes++;
      continue;
    }
    const horasDesdeRespuesta = (ahora - ultimaRespuesta) / 3600;

    // Fuera de la ventana de 24 h de WhatsApp API el texto libre no se entrega.
    if (horasDesdeRespuesta >= VENTANA_API_HORAS) {
      conteo.omitidas.ventanaCerrada++;
      continue;
    }

    // Intentos ya enviados a este cliente en esta etapa (incluye los registros
    // antiguos escritos con la otra variante de tipo).
    const variantes = VARIANTES_TIPO[tipo].map((v) => encodeURIComponent(v)).join(',');
    const logs = await getJson(
      SUPABASE_URL +
        '/rest/v1/recordatorios_whatsapp?cliente_id=eq.' +
        cliente.id +
        '&etapa=eq.' +
        encodeURIComponent(cliente.estado) +
        '&tipo=in.(' +
        variantes +
        ')&select=plantilla,enviado_en&order=enviado_en.desc&limit=10',
      sbHeaders
    );
    const intentos = Array.isArray(logs) ? logs.length : 0;
    if (intentos >= UMBRALES_HORAS.length) {
      conteo.omitidas.yaCompletos++;
      continue;
    }
    if (horasDesdeRespuesta < UMBRALES_HORAS[intentos]) {
      conteo.omitidas.esperandoTiempo++;
      continue;
    }

    const nombre = String((conv.meta && conv.meta.sender && conv.meta.sender.name) || '').trim();
    const primerNombre = nombre && normalizar(nombre) !== 'cliente' ? nombre.split(' ')[0] : '';
    const mensaje = plantillas[tipo][intentos].replace('{{nombre}}', primerNombre).replace('Hola .', 'Hola');
    const telefono = String(
      dbConv.numero_whatsapp ||
        (conv.meta && conv.meta.sender && (conv.meta.sender.phone_number || conv.meta.sender.identifier)) ||
        ''
    ).replace(/[^0-9]/g, '');
    if (!telefono || !mensaje) {
      conteo.omitidas.sinTelefono++;
      continue;
    }

    conteo.recordatoriosPreparados++;
    salidas.push({
      json: {
        conversationId: cwId,
        conversacionId: dbConv.id,
        clienteId: cliente.id,
        etapa: tipo,
        estado: cliente.estado,
        telefono: telefono,
        mensaje: mensaje,
        intento: intentos + 1,
        nombre: primerNombre,
        ultimaRespuestaCliente: ultimaRespuesta,
        horasDesdeRespuesta: Math.floor(horasDesdeRespuesta)
      }
    });
  } catch (error) {
    conteo.omitidas.error++;
    const detalle = (error && error.message) || 'error';
    if (errores.length < 5) errores.push('Chatwoot #' + conv.id + ': ' + detalle);
  }
}

// ---------------------------------------------------------------------------
// 5) AVISOS DE CONFIGURACIÓN (lo que impide que lleguen los recordatorios)
// ---------------------------------------------------------------------------
if (errorEtapas) avisos.push('No se pudo leer pipeline_etapas en Supabase: ' + errorEtapas);
if (!etapasPipeline.length && !errorEtapas) avisos.push('pipeline_etapas está vacío: no hay etapas configuradas.');
if (etapasPipeline.length && !etapasReconocidas.datos) {
  avisos.push('No hay ninguna etapa llamada "Datos": revisa Pipeline → Configurar etapas.');
}
if (etapasPipeline.length && !etapasReconocidas.noContesta) {
  avisos.push('No hay ninguna etapa llamada "Sin respuesta" o "No contesta": revisa Pipeline → Configurar etapas.');
}
if (conteo.chatsAbiertosChatwoot === 0) {
  avisos.push('Chatwoot no devolvió chats abiertos: revisa el token (CHATWOOT_API_TOKEN).');
}
if (conteo.chatsAbiertosChatwoot > 0 && conteo.vinculadosAlApi === 0) {
  avisos.push('Ningún chat abierto está vinculado en Supabase con fuente = meta_business: el CRM no está sincronizando el WhatsApp API.');
}
if (conteo.omitidas.ventanaCerrada > 0) {
  avisos.push(
    'Hay ' + conteo.omitidas.ventanaCerrada + ' chat(s) cuya ventana de 24 h del WhatsApp API ya venció: ' +
    'esos se atienden por el WhatsApp Personal (etapa Vencidos), porque Meta rechaza el texto libre fuera de la ventana.'
  );
}
if (conteo.recordatoriosPreparados === 0 && conteo.omitidas.esperandoTiempo > 0) {
  avisos.push('Hay ' + conteo.omitidas.esperandoTiempo + ' chat(s) en etapa de recordatorio, pero todavía no cumple el tiempo del siguiente intento.');
}

// Ítem de diagnóstico: siempre se envía al final para poder ver en n8n por qué
// no se envió nada. Los nodos de envío y registro lo ignoran.
salidas.push({
  json: {
    _diagnostico: true,
    ejecutadoEn: new Date().toISOString(),
    estadosDeLaEtapa: 'Se buscan por NOMBRE en todo el pipeline (ya no se exige grupo = templo).',
    etapasReconocidas: etapasReconocidas,
    etapasDelPipeline: etapasPipeline.map((e) => ({
      clave: e.clave || null,
      nombre: e.nombre || null,
      grupo: e.grupo || null,
      cuenta_responsable: e.cuenta_responsable || null
    })),
    umbralesHoras: UMBRALES_HORAS,
    etiquetasQueApagan: ETIQUETAS_SILENCIO,
    conteo: conteo,
    avisos: avisos,
    errores: errores
  }
});

return salidas;
