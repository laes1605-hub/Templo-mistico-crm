// ============================================================================
// RECORDATORIOS DE WHATSAPP API · nodo "Buscar clientes y preparar recordatorio"
// ----------------------------------------------------------------------------
// VERSIÓN 5 · 2026-09-19 · los candidatos salen de SUPABASE, no del listado de
// Chatwoot (era lo que dejaba la pasada en uno o dos clientes), «No contesta»
// cuenta desde que el chat ENTRA a la etapa y se envía por el WhatsApp Personal.
//
// QUÉ HACE
//   Cada 15 minutos revisa los chats del WhatsApp API (bandeja de Meta) que
//   están en una etapa de recordatorio y arma un mensaje por cada cliente que
//   ya cumplió su tiempo sin contestar:
//       30 min → variante 1 · 3 h → 2 · 12 h → 3 · 23 h 30 → 4.
//   La misma variante no se repite dentro de las 24 h siguientes.
//
// POR QUÉ CAMBIÓ LA FUENTE DE DATOS (esto era «solo envía a uno»)
//   Antes la lista de chats salía de Chatwoot:
//   /api/v1/accounts/1/conversations?status=open (por páginas) y después una
//   consulta por chat. Con 271 chats abiertos eso significa cientos de llamadas
//   seguidas y varias formas de quedarse a medias: si Chatwoot devuelve menos
//   chats de los pedidos la lectura se corta, y si una llamada falla a mitad de
//   la pasada los chats que faltaban no se revisan. Resultado: la pasada
//   terminaba enviando a uno o dos clientes y los demás (con 8, 14 o 20 horas
//   sin contestar) nunca entraban.
//   Ahora los candidatos salen de la propia base del CRM (Supabase), que es la
//   que se actualiza con cada mensaje del cliente:
//     · UNA consulta trae todos los chats del API con su cliente
//       (`conversaciones` con fuente = meta_business + `clientes.estado`);
//     · el tiempo sin contestar sale de `conversaciones.ultimo_entrante_api_en`;
//     · el teléfono y el nombre salen de la misma fila (`numero_whatsapp`,
//       `clientes.nombre`).
//   Chatwoot se usa solo para dos cosas: enviar el mensaje (otro nodo) y
//   verificar la hora del último mensaje del cliente cuando el CRM registró
//   actividad posterior. Esas verificaciones son pocas (las cuentas que hacen
//   falta), no una por chat.
//
// CÓMO SE CUENTA EL TIEMPO EN CADA ETAPA (v5)
//   · «Datos» → desde el último mensaje del cliente. Esa marca es también la que
//     decide la ventana de 24 h del WhatsApp API (regla de Meta).
//   · «No contesta» → desde que el chat ENTRÓ a la etapa: `clientes.estado_desde`,
//     que mantiene el trigger de la migración 20260921000002. Así el reloj cuenta
//     desde que se le intentó llamar, no desde el último mensaje. Si esa columna
//     todavía no existe, se usa el último mensaje del cliente (y el diagnóstico lo
//     avisa en `avisos` / `estadoDesdeDisponible`).
//   · El recordatorio de «No contesta» se envía por el chat de WhatsApp Personal
//     del cliente (fuente = evolution), porque esa etapa la atiende el personal y
//     ahí NO existe la ventana de 24 h de Meta. Si el cliente no tiene chat
//     personal, se usa el del API (con su ventana de 24 h).
//
// QUÉ MÁS SE ARREGLÓ HOY
//   1. Salía UN recordatorio por pasada: los nodos Code leían «$input.item»
//      (el primer ítem) en vez de la tanda completa. Ahora los tres nodos
//      recorren TODOS los ítems que reciben. Además el workflow ya no lleva el
//      nodo «Procesar uno a uno» ni el bucle.
//   2. La variante se elige por el TIEMPO sin contestar (antes por cuántos
//      avisos llevaba: a alguien de 14 h le tocaba el texto del primero).
//   3. Las etapas se reconocen SOLO por su NOMBRE en todo el pipeline. Antes se
//      pedía además grupo = 'templo' y el CRM ahora crea las etapas con
//      grupo = 'general' («Datos» quedó en general): el workflow no encontraba
//      la etapa y por eso dejó de enviar desde el 10/09.
//   4. Ya no se exige clientes.grupo = 'templo'. El canal lo decide la
//      conversación (fuente = 'meta_business').
//   5. Si falta una etapa, NO revienta: lo informa en el ítem de diagnóstico
//      (el último de la salida, con _diagnostico: true).
//   6. Las credenciales van escritas aquí adentro (esta instancia de n8n no
//      permite variables de entorno). Cambiar de proyecto Supabase = editar
//      SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el bloque de abajo.
//   7. «bot-pausado» ya NO silencia: Luna la pone justo cuando pasa el chat a
//      Datos, así que vetaba a los clientes que deben recibir el aviso. Ahora el
//      silencio lo decide el CRM: `conversaciones.silenciado = true`, el cliente
//      marcado como spam o una etapa que no es de recordatorio.
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
const VERSION = 'recordatorios-api · 2026-09-19 · v5 (No contesta por etapa + WhatsApp Personal)';

// ---------------------------------------------------------------------------
// 2) ETAPAS QUE GENERAN RECORDATORIO (se buscan por NOMBRE, nunca por clave)
// ---------------------------------------------------------------------------
// Para agregar otro nombre visible (por ejemplo "Sin respuesta (API)") basta
// con añadirlo a la lista del tipo que corresponda.
const ETAPAS_RECORDATORIO = {
  datos: ['datos'],
  noContesta: ['sin respuesta', 'no contesta', 'no contesto', 'no responde', 'sin contestar']
};

// Minutos/horas desde la ÚLTIMA respuesta del cliente para cada variante.
// La variante se elige por TIEMPO, no por cuántos recordatorios lleve: quien
// lleva 14 h sin contestar recibe el tercero, y quien lleva 1 h el primero.
const UMBRALES_HORAS = [0.5, 3, 12, 23.5];

// Tope de seguridad por ejecución: con esto una tanda enorme no se dispara de
// golpe (los que queden fuera salen en la siguiente pasada, 15 min después).
// Se ordenan primero los que llevan MÁS tiempo esperando (son los que están más
// cerca de perder la ventana de 24 h).
const LIMITE_ENVIOS_POR_EJECUCION = 60;

// WhatsApp API solo deja responder texto libre dentro de las 24 h siguientes al
// último mensaje del cliente. Pasado ese plazo Meta rechaza el envío, así que no
// se intenta: ese chat se atiende por el WhatsApp Personal (etapa Vencidos).
const VENTANA_API_HORAS = 24;

// Si el CRM registró actividad en el chat DESPUÉS del último mensaje del cliente
// que tiene guardado (puede ser un mensaje nuestro o uno del cliente que aún no
// se sincronizó), se confirma la hora real contra Chatwoot. Son pocas llamadas.
const MARGEN_VERIFICACION_SEGUNDOS = 120;

const normalizar = (valor) =>
  String(valor === null || valor === undefined ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const coincide = (nombreNormalizado, objetivo) =>
  nombreNormalizado === objetivo || nombreNormalizado.startsWith(objetivo + ' ');

// Qué variante (1 a 4) le toca según las horas sin contestar: la última franja
// que ya se cumplió. Menos de 30 min todavía no cumple ninguna.
const variantePorTiempo = (horas) => {
  let variante = 0;
  for (let i = 0; i < UMBRALES_HORAS.length; i++) {
    if (horas >= UMBRALES_HORAS[i]) variante = i + 1;
  }
  return variante || null;
};

const tipoDeNombre = (nombre) => {
  const n = normalizar(nombre);
  if (!n) return null;
  for (const tipo of Object.keys(ETAPAS_RECORDATORIO)) {
    if (ETAPAS_RECORDATORIO[tipo].some((objetivo) => coincide(n, objetivo))) return tipo;
  }
  return null;
};

const enSegundos = (valor) => {
  const ms = Date.parse(valor === null || valor === undefined ? '' : valor);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
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
// 3) CANDIDATOS: una sola consulta a la base del CRM
// ---------------------------------------------------------------------------
const conteo = {
  candidatasRevisadas: 0,
  llamadasChatwoot: 0,
  verificadosEnChatwoot: 0,
  recordatoriosPreparados: 0,
  enviadosPorApi: 0,
  enviadosPorPersonal: 0,
  enviosGuardados24h: 0,
  errorChatPersonal: null,
  omitidas: {
    sinVinculoApi: 0,
    archivada: 0,
    silenciado: 0,
    spam: 0,
    etapaSinRecordatorio: 0,
    sinConversacionChatwoot: 0,
    sinMensajesEntrantes: 0,
    sinChatPersonal: 0,
    varianteYaEnviada: 0,
    porLimite: 0,
    esperandoTiempo: 0,
    ventanaCerrada: 0,
    sinTelefono: 0,
    verificacionFallida: 0,
    error: 0
  }
};
const avisos = [];
const errores = [];
const omitidasPorChat = [];
const omitir = (motivo, fila, horas) => {
  if (omitidasPorChat.length >= 25) return;
  omitidasPorChat.push({
    chat: fila.chat,
    nombre: fila.nombre || '',
    motivo: motivo,
    horas: horas === null || horas === undefined ? null : Number(horas.toFixed(1))
  });
};

const COLUMNAS_CANDIDATAS =
  '/rest/v1/conversaciones?select=id,cliente_id,chatwoot_conversation_id,chatwoot_conversation_ids,numero_whatsapp,estado,archivada,silenciado,ultimo_entrante_api_en,ultimo_mensaje_en,clientes!inner(id,nombre,nombre_manual,telefono,estado,es_spam';
const colaCandidatas =
  '&fuente=eq.meta_business&order=ultimo_entrante_api_en.asc.nullslast&limit=1000';

let candidatas = [];
let errorConversaciones = null;
let sinEstadoDesde = false;
try {
  // `clientes.estado_desde` (fecha de entrada a la etapa) lo agrega la migración
  // 20260921000002. Si todavía no se corrió, se reintenta sin esa columna para
  // que el workflow siga funcionando (y el diagnóstico lo avisa).
  const respuesta = await getJson(SUPABASE_URL + COLUMNAS_CANDIDATAS + ',estado_desde)' + colaCandidatas, sbHeaders);
  if (Array.isArray(respuesta)) candidatas = respuesta;
} catch (error) {
  try {
    const respaldo = await getJson(SUPABASE_URL + COLUMNAS_CANDIDATAS + ')' + colaCandidatas, sbHeaders);
    if (Array.isArray(respaldo)) candidatas = respaldo;
    sinEstadoDesde = true;
  } catch (error2) {
    errorConversaciones = (error2 && error2.message) || (error && error.message) || 'error leyendo conversaciones';
  }
}

// «No contesta» se atiende por el WhatsApp Personal: ahí no existe la ventana de
// 24 h de Meta. Se busca, en UNA consulta, el chat de WhatsApp Personal
// (fuente = evolution) de los clientes que están en esa etapa.
const clientesSinContesta = [];
for (const fila of candidatas) {
  if (!fila || !fila.clientes || !fila.cliente_id) continue;
  if (etapaDe(fila.clientes.estado) !== 'noContesta') continue;
  if (clientesSinContesta.indexOf(fila.cliente_id) === -1) clientesSinContesta.push(fila.cliente_id);
}
const chatPersonalPorCliente = new Map();
if (clientesSinContesta.length) {
  try {
    const filas = await getJson(
      SUPABASE_URL +
        '/rest/v1/conversaciones?select=cliente_id,chatwoot_conversation_id,chatwoot_conversation_ids,archivada,silenciado,ultimo_entrante_en&fuente=eq.evolution&cliente_id=in.(' +
        clientesSinContesta.join(',') +
        ')&limit=200',
      sbHeaders
    );
    for (const fila of Array.isArray(filas) ? filas : []) {
      if (!fila || fila.archivada === true || fila.silenciado === true) continue;
      const ids = Array.isArray(fila.chatwoot_conversation_ids) ? fila.chatwoot_conversation_ids : [];
      const id = fila.chatwoot_conversation_id || (ids.length ? ids[ids.length - 1] : null);
      if (id && !chatPersonalPorCliente.has(fila.cliente_id)) {
        chatPersonalPorCliente.set(fila.cliente_id, Number(id) || id);
      }
    }
  } catch (error) {
    conteo.errorChatPersonal = (error && error.message) || 'error buscando el chat personal';
  }
}

// Envíos de las últimas 24 h, en UNA consulta: sirve para no repetir la misma
// variante. Si esta consulta falla NO se envía nada (mejor esperar 15 minutos
// que mandar el mismo mensaje dos veces).
const desdeIso = new Date((ahora - VENTANA_API_HORAS * 3600) * 1000).toISOString();
const claveEnvio = (clienteId, etapa, plantilla) =>
  String(clienteId) + '|' + String(etapa) + '|' + String(plantilla);
const enviosRecientes = new Set();
let errorEnvios = null;
try {
  const respuesta = await getJson(
    SUPABASE_URL +
      '/rest/v1/recordatorios_whatsapp?enviado_en=gte.' +
      encodeURIComponent(desdeIso) +
      '&select=cliente_id,etapa,plantilla,enviado_en&limit=1000',
    sbHeaders
  );
  if (Array.isArray(respuesta)) {
    conteo.enviosGuardados24h = respuesta.length;
    for (const fila of respuesta) {
      if (!fila || fila.plantilla === null || fila.plantilla === undefined) continue;
      enviosRecientes.add(claveEnvio(fila.cliente_id, fila.etapa, fila.plantilla));
    }
  }
} catch (error) {
  errorEnvios = (error && error.message) || 'error leyendo recordatorios_whatsapp';
}

// Último mensaje REAL del cliente en Chatwoot (solo para verificar). Con esto se
// corrige la hora cuando el CRM registró actividad posterior al último entrante
// que tiene guardado.
const ultimaEntranteDeChatwoot = async (conversationId) => {
  const datos = await getJson(
    CHATWOOT_URL +
      '/api/v1/accounts/' +
      ACCOUNT_ID +
      '/conversations/' +
      conversationId +
      '/messages?per_page=100',
    chatHeaders
  );
  conteo.llamadasChatwoot++;
  const mensajes = (datos && (datos.payload || (datos.data && datos.data.payload))) || [];
  const entrantes = mensajes.filter((m) => m && (m.message_type === 0 || m.message_type === 'incoming'));
  const tiempos = entrantes.map((m) => Number(m.created_at || 0)).filter(Boolean);
  return tiempos.length ? Math.max.apply(null, tiempos) : null;
};

// ---------------------------------------------------------------------------
// 4) POR CADA CHAT DEL API: ¿toca recordatorio?
// ---------------------------------------------------------------------------
const listas = [];

for (const fila of candidatas) {
  const cliente = fila && fila.clientes ? fila.clientes : null;
  const ids = Array.isArray(fila && fila.chatwoot_conversation_ids) ? fila.chatwoot_conversation_ids : [];
  const chat =
    (fila && fila.chatwoot_conversation_id) ||
    (ids.length ? ids[ids.length - 1] : null);
  const nombre = String((cliente && (cliente.nombre_manual || cliente.nombre)) || '').trim();
  const etiqueta = { chat: chat ? Number(chat) || String(chat) : null, nombre: nombre };

  conteo.candidatasRevisadas++;
  try {
    // Sin la lista de envíos de las últimas 24 h no se puede saber qué variante
    // ya salió: mejor no enviar nada en esta pasada (en 15 minutos se reintenta)
    // que arriesgarse a repetir el mismo mensaje.
    if (errorEnvios) {
      conteo.omitidas.error++;
      omitir('no se pudieron leer los envíos de las últimas 24 h', etiqueta, null);
      continue;
    }
    if (!cliente) {
      conteo.omitidas.sinVinculoApi++;
      omitir('sin cliente vinculado', etiqueta, null);
      continue;
    }
    if (fila.archivada === true) {
      conteo.omitidas.archivada++;
      omitir('conversación archivada', etiqueta, null);
      continue;
    }
    if (fila.silenciado === true) {
      conteo.omitidas.silenciado++;
      omitir('silenciado en el CRM', etiqueta, null);
      continue;
    }
    if (cliente.es_spam === true) {
      conteo.omitidas.spam++;
      omitir('cliente marcado como spam', etiqueta, null);
      continue;
    }

    const tipo = etapaDe(cliente.estado);
    if (!tipo) {
      conteo.omitidas.etapaSinRecordatorio++;
      omitir('etapa sin recordatorio (' + String(cliente.estado || 'sin etapa') + ')', etiqueta, null);
      continue;
    }
    // Canal por el que se atiende la etapa: «No contesta» va por el WhatsApp
    // Personal (fuente = evolution), donde NO existe la ventana de 24 h de Meta.
    // Las demás etapas siguen por el chat del WhatsApp API.
    const chatPersonal = tipo === 'noContesta' ? chatPersonalPorCliente.get(cliente.id) || null : null;
    const canal = chatPersonal ? 'personal' : 'api';
    const chatDestino = canal === 'personal' ? chatPersonal : chat;
    if (!chatDestino) {
      conteo.omitidas.sinConversacionChatwoot++;
      omitir('sin número de chat de Chatwoot', etiqueta, null);
      continue;
    }

    // Hora del último mensaje del cliente: la del CRM y, si hubo actividad
    // después, confirmada contra Chatwoot. Esta marca es la que decide la
    // ventana de 24 h del API (regla de Meta).
    let marca = enSegundos(fila.ultimo_entrante_api_en);
    let fuenteTiempo = 'crm';
    const ultimoMensaje = enSegundos(fila.ultimo_mensaje_en);
    const actividadDespues =
      marca !== null && ultimoMensaje !== null && ultimoMensaje > marca + MARGEN_VERIFICACION_SEGUNDOS;

    if (chat && (marca === null || actividadDespues)) {
      try {
        const verificada = await ultimaEntranteDeChatwoot(chat);
        if (verificada) {
          marca = verificada;
          fuenteTiempo = 'chatwoot';
          conteo.verificadosEnChatwoot++;
        }
      } catch (error) {
        conteo.omitidas.verificacionFallida++;
        if (errores.length < 5) {
          errores.push(
            'Chatwoot #' + chat + ': ' + ((error && error.message) || 'error') + ' (se usó la hora guardada en el CRM)'
          );
        }
      }
    }
    if (marca === null) {
      conteo.omitidas.sinMensajesEntrantes++;
      omitir('el cliente todavía no ha escrito', etiqueta, null);
      continue;
    }
    const horasDelMensaje = (ahora - marca) / 3600;

    // Fuera de la ventana de 24 h el WhatsApp API no deja enviar texto libre.
    // Por el WhatsApp Personal no hay ese límite.
    if (canal === 'api' && tipo === 'noContesta' && horasDelMensaje >= VENTANA_API_HORAS) {
      conteo.omitidas.sinChatPersonal++;
      omitir('No contesta sin WhatsApp Personal y la ventana de 24 h del API ya venció', etiqueta, horasDelMensaje);
      continue;
    }
    if (canal === 'api' && horasDelMensaje >= VENTANA_API_HORAS) {
      conteo.omitidas.ventanaCerrada++;
      omitir('ventana de 24 h vencida', etiqueta, horasDelMensaje);
      continue;
    }

    // Reloj de la variante:
    //   · Datos → desde el último mensaje del cliente.
    //   · No contesta → desde que el chat ENTRÓ a la etapa (clientes.estado_desde),
    //     porque ahí lo que importa es cuánto lleva esperando desde que se le
    //     intentó llamar. Si la migración aún no está, se usa el último mensaje.
    const marcaEtapa = tipo === 'noContesta' ? enSegundos(cliente.estado_desde) : null;
    const reloj = marcaEtapa !== null ? 'etapa' : 'mensaje';
    const horas = reloj === 'etapa' ? (ahora - marcaEtapa) / 3600 : horasDelMensaje;

    // Variante que le toca por el tiempo que lleva sin contestar.
    const variante = variantePorTiempo(horas);
    if (!variante) {
      conteo.omitidas.esperandoTiempo++;
      omitir('todavía no cumple los 30 min', etiqueta, horas);
      continue;
    }

    // Guardia contra repetir: si ESA misma variante ya salió en las últimas 24 h
    // para este cliente en esta etapa, se omite. Así el ciclo de 15 minutos no
    // repite el mismo mensaje mientras la ventana siga abierta.
    if (enviosRecientes.has(claveEnvio(cliente.id, cliente.estado, variante))) {
      conteo.omitidas.varianteYaEnviada++;
      omitir('la variante ' + variante + ' ya se envió en las últimas 24 h', etiqueta, horas);
      continue;
    }

    const primerNombre = nombre && normalizar(nombre) !== 'cliente' ? nombre.split(' ')[0] : '';
    const mensaje = plantillas[tipo][variante - 1].replace('{{nombre}}', primerNombre).replace('Hola .', 'Hola');
    const telefono = String(
      (fila && fila.numero_whatsapp) || (cliente && cliente.telefono) || ''
    ).replace(/[^0-9]/g, '');
    if (!telefono || !mensaje) {
      conteo.omitidas.sinTelefono++;
      omitir('sin teléfono', etiqueta, horas);
      continue;
    }

    if (canal === 'personal') conteo.enviadosPorPersonal++;
    else conteo.enviadosPorApi++;

    listas.push({
      json: {
        conversationId: Number(chatDestino) || chatDestino,
        conversacionId: fila.id,
        clienteId: cliente.id,
        etapa: tipo,
        estado: cliente.estado,
        canal: canal,
        telefono: telefono,
        mensaje: mensaje,
        intento: variante,
        nombre: primerNombre,
        horasDesdeRespuesta: Number(horas.toFixed(1)),
        reloj: reloj,
        fuenteTiempo: fuenteTiempo
      }
    });
  } catch (error) {
    conteo.omitidas.error++;
    const detalle = (error && error.message) || 'error';
    if (errores.length < 5) errores.push('Chatwoot #' + (chat || '?') + ': ' + detalle);
    omitir('error procesando el chat', etiqueta, null);
  }
}

// Los que llevan MÁS tiempo esperando van primero (están más cerca de perder la
// ventana de 24 h). El tope por ejecución se aplica después de ordenar.
listas.sort((a, b) => b.json.horasDesdeRespuesta - a.json.horasDesdeRespuesta);
const salidas = listas.slice(0, LIMITE_ENVIOS_POR_EJECUCION);
conteo.recordatoriosPreparados = salidas.length;
conteo.omitidas.porLimite = listas.length - salidas.length;
if (conteo.omitidas.porLimite > 0) {
  for (const fuera of listas.slice(LIMITE_ENVIOS_POR_EJECUCION)) {
    omitir('quedó para la siguiente pasada (tope de ' + LIMITE_ENVIOS_POR_EJECUCION + ')', {
      chat: fuera.json.conversationId,
      nombre: fuera.json.nombre
    }, fuera.json.horasDesdeRespuesta);
  }
}

// ---------------------------------------------------------------------------
// 5) AVISOS (lo que impide que lleguen los recordatorios) y RESUMEN
// ---------------------------------------------------------------------------
if (errorEtapas) avisos.push('No se pudo leer pipeline_etapas en Supabase: ' + errorEtapas);
if (!etapasPipeline.length && !errorEtapas) avisos.push('pipeline_etapas está vacío: no hay etapas configuradas.');
if (etapasPipeline.length && !etapasReconocidas.datos) {
  avisos.push('No hay ninguna etapa llamada "Datos": revisa Pipeline → Configurar etapas.');
}
if (etapasPipeline.length && !etapasReconocidas.noContesta) {
  avisos.push('No hay ninguna etapa llamada "Sin respuesta" o "No contesta": revisa Pipeline → Configurar etapas.');
}
if (errorConversaciones) {
  avisos.push('No se pudo leer la tabla conversaciones de Supabase: ' + errorConversaciones);
}
if (errorEnvios) {
  avisos.push('No se pudo leer los envíos de las últimas 24 h: ' + errorEnvios + '. Por seguridad NO se envió nada.');
}
if (!errorConversaciones && conteo.candidatasRevisadas === 0) {
  avisos.push('No hay chats del WhatsApp API en conversaciones (fuente = meta_business): el CRM no los está sincronizando.');
}
if (conteo.omitidas.ventanaCerrada > 0) {
  avisos.push(
    'Hay ' + conteo.omitidas.ventanaCerrada + ' chat(s) cuya ventana de 24 h del WhatsApp API ya venció: ' +
    'esos se atienden por el WhatsApp Personal (etapa Vencidos), porque Meta rechaza el texto libre fuera de la ventana.'
  );
}
if (conteo.omitidas.esperandoTiempo > 0 && conteo.recordatoriosPreparados === 0) {
  avisos.push('Hay ' + conteo.omitidas.esperandoTiempo + ' chat(s) en etapa de recordatorio, pero todavía no cumple el tiempo del siguiente intento.');
}
if (conteo.omitidas.porLimite > 0) {
  avisos.push(
    'Se prepararon ' + LIMITE_ENVIOS_POR_EJECUCION + ' recordatorios (el tope por ejecución) y quedaron ' +
    conteo.omitidas.porLimite + ' para la siguiente pasada, dentro de 15 minutos.'
  );
}
if (sinEstadoDesde) {
  avisos.push(
    'Falta la columna clientes.estado_desde (migración 20260921000002): «No contesta» todavía cuenta desde el último mensaje del cliente.'
  );
}
if (conteo.errorChatPersonal) {
  avisos.push('No se pudo buscar el chat de WhatsApp Personal de los clientes de «No contesta»: ' + conteo.errorChatPersonal);
}
if (conteo.omitidas.sinChatPersonal > 0) {
  avisos.push(
    'Hay ' + conteo.omitidas.sinChatPersonal + ' chat(s) de «No contesta» sin WhatsApp Personal y con la ventana del API cerrada: ' +
    'esos no tienen por dónde recibir el recordatorio.'
  );
}
if (conteo.omitidas.silenciado > 0) {
  avisos.push('Hay ' + conteo.omitidas.silenciado + ' chat(s) silenciados en el CRM: no reciben recordatorio hasta que los reactives.');
}
if (conteo.omitidas.verificacionFallida > 0) {
  avisos.push(
    'En ' + conteo.omitidas.verificacionFallida + ' chat(s) no se pudo confirmar la hora con Chatwoot; se usó la hora guardada en el CRM.'
  );
}

const resumen =
  'Revisé ' + conteo.candidatasRevisadas + ' chat(s) del WhatsApp API · ' +
  'recordatorios listos: ' + conteo.recordatoriosPreparados +
  ' · ya enviados en 24 h: ' + conteo.omitidas.varianteYaEnviada +
  ' · ventana de 24 h vencida: ' + conteo.omitidas.ventanaCerrada +
  ' · en espera (<30 min): ' + conteo.omitidas.esperandoTiempo +
  ' · fuera de etapa: ' + conteo.omitidas.etapaSinRecordatorio +
  ' · pausados/archivados/spam: ' + (conteo.omitidas.silenciado + conteo.omitidas.archivada + conteo.omitidas.spam) +
  ' · por WhatsApp Personal: ' + conteo.enviadosPorPersonal +
  ' · enviados guardados (24 h): ' + conteo.enviosGuardados24h;

// Ítem de diagnóstico: siempre se envía al final para poder ver en n8n por qué
// no se envió nada. Los nodos de envío y registro lo ignoran.
salidas.push({
  json: {
    _diagnostico: true,
    version: VERSION,
    resumen: resumen,
    ejecutadoEn: new Date().toISOString(),
    fuenteDeDatos:
      'Supabase: conversaciones (fuente = meta_business) + clientes.estado. ' +
      'Ya no depende del listado de Chatwoot, así que ni su paginación ni sus páginas pueden cortar la pasada.',
    canalPorEtapa:
      'Datos → WhatsApp API (ventana de 24 h de Meta). ' +
      'No contesta → WhatsApp Personal (sin ventana), y si el cliente no tiene chat personal se usa el del API.',
    relojPorEtapa:
      'Datos → desde el último mensaje del cliente. ' +
      'No contesta → desde que el chat entró a la etapa (clientes.estado_desde); si falta esa fecha, desde el último mensaje.',
    estadoDesdeDisponible: !sinEstadoDesde,
    estadosDeLaEtapa: 'Se buscan por NOMBRE en todo el pipeline (ya no se exige grupo = templo).',
    pausasQueApagan: [
      'conversaciones.silenciado = true',
      'clientes.es_spam = true',
      'conversación archivada',
      'etapa distinta de Datos / No contesta'
    ],
    etapasReconocidas: etapasReconocidas,
    etapasDelPipeline: etapasPipeline.map((e) => ({
      clave: e.clave || null,
      nombre: e.nombre || null,
      grupo: e.grupo || null,
      cuenta_responsable: e.cuenta_responsable || null
    })),
    umbralesHoras: UMBRALES_HORAS,
    limiteEnviosPorEjecucion: LIMITE_ENVIOS_POR_EJECUCION,
    ventanaApiHoras: VENTANA_API_HORAS,
    conteo: conteo,
    omitidasPorChat: omitidasPorChat,
    avisos: avisos,
    errores: errores
  }
});

return salidas;
