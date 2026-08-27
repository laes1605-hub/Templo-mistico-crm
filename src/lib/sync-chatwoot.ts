/**
 * Sincronización Chatwoot → Supabase (sólo servidor / route handlers).
 *
 * ¿Por qué existe? El dashboard lee los mensajes de Supabase, pero hasta ahora
 * la ÚNICA cosa que escribía ahí era el nodo "Sincronizar Supabase" del
 * workflow de n8n. Si n8n se cae, se desactiva o falla (por ejemplo por una
 * migración pendiente: cualquier columna desconocida abortaba TODO el evento),
 * los mensajes siguen llegando al chat de Chatwoot pero nunca aparecen en el
 * dashboard.
 *
 * Esta librería invierte la dependencia: el propio dashboard pregunta
 * directamente a Chatwoot (la fuente de la verdad) y repara Supabase.
 * Se usa desde:
 *   - GET  /api/chatwoot/sync    (sondeo del dashboard + botón 🔄)
 *   - POST /api/chatwoot/webhook (webhook directo de Chatwoot a Vercel,
 *                                 opcional pero recomendado)
 *
 * Es tolerante a fallos por diseño:
 *   - Antes de escribir, consulta las columnas reales de cada tabla
 *     (OpenAPI de PostgREST) y descarta las que no existan → una migración
 *     pendiente ya no rompe la sincronización.
 *   - Deduplica por chatwoot_message_id y, como respaldo, por huella
 *     (tipo + contenido + ventana de tiempo) → puede coexistir con n8n
 *     sin crear mensajes repetidos.
 */

import { chatwootConfig } from "./chatwoot";

// ---------------------------------------------------------------------------
// Supabase por REST (mismo patrón que el workflow de n8n)
// ---------------------------------------------------------------------------

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://qrrkokfmbdtodrqbfehs.supabase.co"
).replace(/\/$/, "");

// Service role: env en Vercel → si no está, la misma llave que ya usa el
// workflow de n8n (ya vive en este repo) → si tampoco, anon.
const SERVICE_ROLE_N8N =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmtva2ZtYmR0b2RycWJmZWhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5NTU0NSwiZXhwIjoyMTAyNzcxNTQ1fQ.bFwt6pAidvSEEuv3UNuKeZYwkfB-d2OPgMHM8MmwcD8";

const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  SERVICE_ROLE_N8N
).trim();

function sbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

type SbResp = { status: number; ok: boolean; json: any; texto: string };

async function sbFetch(
  ruta: string,
  init: RequestInit = {},
  timeoutMs = 25000
): Promise<SbResp> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const respuesta = await fetch(`${SUPABASE_URL}/rest/v1${ruta}`, {
      ...init,
      headers: sbHeaders(init.headers as Record<string, string>),
      signal: controlador.signal,
    });
    const texto = await respuesta.text();
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { status: respuesta.status, ok: respuesta.ok, json, texto };
  } catch (e: any) {
    const motivo =
      e?.name === "AbortError" ? "tiempo de espera agotado" : e?.message || "error de red";
    return { status: 0, ok: false, json: null, texto: motivo };
  } finally {
    clearTimeout(temporizador);
  }
}

// ---------------------------------------------------------------------------
// Introspección de columnas (para sobrevivir a migraciones pendientes)
// ---------------------------------------------------------------------------

let cacheColumnas: { expira: number; tablas: Record<string, Set<string>> } | null = null;

async function columnasDe(tabla: string): Promise<Set<string> | null> {
  const ahora = Date.now();
  if (!cacheColumnas || cacheColumnas.expira < ahora) {
    const spec = await sbFetch("/", { headers: { Prefer: "count=none" } }, 15000);
    const tablas: Record<string, Set<string>> = {};
    if (spec.ok && spec.json) {
      const definiciones =
        spec.json?.definitions ||
        spec.json?.components?.schemas ||
        {};
      for (const [nombre, def] of Object.entries<any>(definiciones)) {
        tablas[nombre.toLowerCase()] = new Set(
          Object.keys(def?.properties || {}).map((c) => c.toLowerCase())
        );
      }
    }
    cacheColumnas = { expira: ahora + 5 * 60_000, tablas };
  }
  return cacheColumnas.tablas[tabla.toLowerCase()] || null;
}

/** Quita del payload las columnas que no existen en la tabla (si se conocen). */
async function depurar<T extends Record<string, any>>(tabla: string, payload: T): Promise<T> {
  const columnas = await columnasDe(tabla);
  if (!columnas || columnas.size === 0) return payload; // sin info: no filtrar
  const salida: any = {};
  for (const [clave, valor] of Object.entries(payload)) {
    if (columnas.has(clave.toLowerCase())) salida[clave] = valor;
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Chatwoot
// ---------------------------------------------------------------------------

async function cwGet(ruta: string, timeoutMs = 20000): Promise<SbResp> {
  const cfg = chatwootConfig();
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const respuesta = await fetch(`${cfg.url}/api/v1/accounts/${cfg.accountId}${ruta}`, {
      headers: { "Content-Type": "application/json", api_access_token: cfg.token },
      signal: controlador.signal,
    });
    const texto = await respuesta.text();
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { status: respuesta.status, ok: respuesta.ok, json, texto };
  } catch (e: any) {
    const motivo =
      e?.name === "AbortError" ? "tiempo de espera agotado" : e?.message || "error de red";
    return { status: 0, ok: false, json: null, texto: motivo };
  } finally {
    clearTimeout(temporizador);
  }
}

// ---------------------------------------------------------------------------
// Teléfonos (misma normalización del workflow de n8n)
// ---------------------------------------------------------------------------

function soloDigitos(v: any): string {
  return String(v || "").replace(/\D/g, "");
}

function pareceTelefonoReal(v: any): boolean {
  const d = soloDigitos(v);
  if (d.length < 8 || d.length > 15) return false;
  if (/^0{2,}/.test(d)) return false;
  return true;
}

function normalizarTelefono(v: any): string {
  let d = soloDigitos(v);
  if (!d) return "";
  if (d.length === 10 && d.startsWith("3")) d = "57" + d;
  return "+" + d;
}

function telefonoDe(sender: any, conv: any): { telefono: string; display: string } {
  const candidatos = [
    sender?.phone_number,
    conv?.meta?.sender?.phone_number,
    sender?.identifier,
    conv?.meta?.sender?.identifier,
  ];
  for (const c of candidatos) {
    if (pareceTelefonoReal(c)) return { telefono: normalizarTelefono(c), display: normalizarTelefono(c) };
  }
  return { telefono: `revisar_${conv?.id || Date.now()}`, display: "Sin teléfono" };
}

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

export type ResultadoSync = {
  ok: boolean;
  conversaciones_recorridas: number;
  conversaciones_nuevas: number;
  clientes_nuevos: number;
  mensajes_nuevos: number;
  /** Adjuntos existentes a los que se completó URL o pie de foto. */
  mensajes_actualizados: number;
  mensajes_vinculados: number;
  errores: string[];
  tardo_ms: number;
};

function nuevoResultado(): ResultadoSync {
  return {
    ok: true,
    conversaciones_recorridas:0,
    conversaciones_nuevas: 0,
    clientes_nuevos: 0,
    mensajes_nuevos: 0,
    mensajes_actualizados: 0,
    mensajes_vinculados: 0,
    errores: [],
    tardo_ms: 0,
  };
}

// ---------------------------------------------------------------------------
// Upserts
// ---------------------------------------------------------------------------

async function upsertCliente(
  telefono: string,
  telefonoDisplay: string,
  nombre: string | null,
  fotoUrl: string | null,
  attrs: Record<string, any>,
  res: ResultadoSync
): Promise<string | null> {
  const busqueda = await sbFetch(
    `/clientes?telefono=eq.${encodeURIComponent(telefono)}&select=id`,
    { headers: { Prefer: "count=exact" } }
  );
  let clienteId: string | null = null;
  const encontrados = Array.isArray(busqueda.json) ? busqueda.json : [];
  if (busqueda.ok && encontrados.length > 0) {
    clienteId = encontrados[0].id;
    // Sólo valores presentes: nunca borrar datos del CRM con vacíos.
    const cambios: Record<string, any> = { actualizado_en: new Date().toISOString() };
    if (nombre) cambios.nombre = nombre;
    if (fotoUrl) cambios.foto_url = fotoUrl;
    if (attrs.tipo_trabajo) cambios.tipo_trabajo = attrs.tipo_trabajo;
    if (attrs.nombre_otra_persona) cambios.nombre_otra_persona = attrs.nombre_otra_persona;
    // Luna guardó las fotos con dos nombres distintos según la versión del
    // workflow (foto_otra_persona / foto_otra_persona_url): se aceptan ambos.
    const fotoOtra = attrs.foto_otra_persona || attrs.foto_otra_persona_url;
    const fotoMano = attrs.foto_mano || attrs.foto_mano_url;
    if (fotoOtra) cambios.foto_otra_persona = fotoOtra;
    if (fotoMano) cambios.foto_mano = fotoMano;
    if (telefonoDisplay && telefonoDisplay !== "Sin teléfono") cambios.telefono_display = telefonoDisplay;
    await sbFetch(`/clientes?id=eq.${clienteId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(await depurar("clientes", cambios)),
    });
    return clienteId;
  }

  const nuevoPayload = await depurar("clientes", {
    telefono,
    telefono_display: telefonoDisplay,
    nombre: nombre || "Cliente WhatsApp",
    foto_url: fotoUrl,
    estado: "nuevo_lead",
    ...(attrs.tipo_trabajo ? { tipo_trabajo: attrs.tipo_trabajo } : {}),
    ...(attrs.nombre_otra_persona ? { nombre_otra_persona: attrs.nombre_otra_persona } : {}),
    ...(attrs.foto_otra_persona || attrs.foto_otra_persona_url
      ? { foto_otra_persona: attrs.foto_otra_persona || attrs.foto_otra_persona_url }
      : {}),
    ...(attrs.foto_mano || attrs.foto_mano_url
      ? { foto_mano: attrs.foto_mano || attrs.foto_mano_url }
      : {}),
  });
  const creacion = await sbFetch("/clientes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([nuevoPayload]),
  });
  if (creacion.ok && Array.isArray(creacion.json) && creacion.json.length > 0) {
    res.clientes_nuevos += 1;
    return creacion.json[0].id;
  }
  // Carrera con el workflow de n8n: ambos creamos a la vez → único → rebuscar.
  const rebusqueda = await sbFetch(
    `/clientes?telefono=eq.${encodeURIComponent(telefono)}&select=id`
  );
  if (rebusqueda.ok && Array.isArray(rebusqueda.json) && rebusqueda.json.length > 0) {
    return rebusqueda.json[0].id;
  }
  res.errores.push(`cliente no se pudo crear (${creacion.status}): ${creacion.texto.slice(0, 160)}`);
  return null;
}

type ConvExistente = {
  id: string;
  ultimo_mensaje_en: string | null;
  no_leidos: number | null;
  ultimo_leido_en: string | null;
};

async function buscarConversacion(chatwootConvId: string | number): Promise<ConvExistente | null> {
  const r = await sbFetch(
    `/conversaciones?chatwoot_conversation_id=eq.${encodeURIComponent(
      String(chatwootConvId)
    )}&select=id,ultimo_mensaje_en,no_leidos,ultimo_leido_en`
  );
  if (r.ok && Array.isArray(r.json) && r.json.length > 0) {
    return r.json[0];
  }
  return null;
}

async function upsertConversacion(
  convCw: any,
  clienteId: string,
  telefono: string,
  ultimoMensaje: string,
  ultimoMensajeEn: string,
  res: ResultadoSync
): Promise<ConvExistente | null> {
  let existente = await buscarConversacion(convCw.id);
  // Si no se encuentra por chatwoot_conversation_id, buscar si el cliente ya tiene una conversación existente en el CRM
  if (!existente && clienteId) {
    const porCli = await sbFetch(
      `/conversaciones?cliente_id=eq.${encodeURIComponent(clienteId)}&select=id,ultimo_mensaje_en,no_leidos,ultimo_leido_en&order=ultimo_mensaje_en.desc&limit=1`
    );
    if (porCli.ok && Array.isArray(porCli.json) && porCli.json.length > 0) {
      existente = porCli.json[0];
    }
  }

  const datos = await depurar("conversaciones", {
    cliente_id: clienteId,
    chatwoot_conversation_id: String(convCw.id),
    numero_whatsapp: telefono,
    fuente: convCw.inbox_id === 5 ? "meta_business" : "evolution",
    ultimo_mensaje: ultimoMensaje,
    ultimo_mensaje_en: ultimoMensajeEn,
    actualizado_en: new Date().toISOString(),
  });

  if (existente) {
    // No se tocan archivada / no_leidos / ultimo_leido_en / agente_activo:
    // eso lo maneja el operador desde el dashboard.
    await sbFetch(`/conversaciones?id=eq.${existente.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(datos),
    });
    return { ...existente, ultimo_mensaje_en: ultimoMensajeEn };
  }

  const creacion = await sbFetch("/conversaciones", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([datos]),
  });
  if (creacion.ok && Array.isArray(creacion.json) && creacion.json.length > 0) {
    res.conversaciones_nuevas += 1;
    return creacion.json[0];
  }
  // Carrera con n8n: rebuscar antes de rendirse.
  const rebusqueda = await buscarConversacion(convCw.id);
  if (rebusqueda) return rebusqueda;
  res.errores.push(
    `conversación ${convCw.id} no se pudo crear (${creacion.status}): ${creacion.texto.slice(0, 160)}`
  );
  return null;
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

type MensajeMapeado = {
  chatwoot_message_id: string;
  tipo: "recibido" | "enviado";
  contenido: string;
  tipo_contenido: string;
  url_archivo: string | null;
  creado_en: string;
};

function fechaISO(valor: any): string {
  if (typeof valor === "number") return new Date(valor * (valor > 1e12 ? 1 : 1000)).toISOString();
  if (typeof valor === "string") {
    if (/^\d+$/.test(valor)) {
      const n = Number(valor);
      return new Date(n * (n > 1e12 ? 1 : 1000)).toISOString();
    }
    const t = Date.parse(valor);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

/** Convierte un mensaje de Chatwoot al formato del CRM. null = ignorar. */
export function mapMensajeCw(m: any): MensajeMapeado | null {
  if (!m || m.private === true) return null;
  const message_type = Number(m.message_type);
  // 0=entrante, 1=saliente, 2=actividad, 3=plantilla → sólo 0 y 1.
  if (message_type !== 0 && message_type !== 1) return null;

  let tipoContenido = "texto";
  let urlArchivo: string | null = null;
  const att = Array.isArray(m.attachments) && m.attachments.length > 0 ? m.attachments[0] : null;
  if (att) {
    urlArchivo = att.data_url || att.file_url || null;
    if (att.file_type === "audio") tipoContenido = "audio";
    else if (att.file_type === "image") tipoContenido = "imagen";
    else if (att.file_type === "video") tipoContenido = "video";
    else tipoContenido = "archivo";
  }

  const contenidoOriginal = String(m.content || "").trim();
  // Algunas integraciones entregan el pie en el adjunto en vez de content.
  // Si content es el marcador técnico [imagen], el pie real tiene prioridad.
  const pieAdjunto = String(att?.caption || att?.caption_text || "").trim();
  const contenido = (!contenidoOriginal || esMarcadorMultimedia(contenidoOriginal)) && pieAdjunto
    ? pieAdjunto
    : contenidoOriginal;
  if (!contenido && !urlArchivo) return null; // actividad sin contenido

  return {
    chatwoot_message_id: String(m.id),
    tipo: message_type === 0 ? "recibido" : "enviado",
    contenido: contenido || `[${tipoContenido}]`,
    tipo_contenido: tipoContenido,
    url_archivo: urlArchivo,
    creado_en: fechaISO(m.created_at),
  };
}

type MensajeExistente = {
  id: string;
  chatwoot_message_id: string | null;
  tipo: string | null;
  tipo_contenido: string | null;
  contenido: string | null;
  url_archivo: string | null;
  creado_en: string;
};

const MARCADORES_MULTIMEDIA = new Set([
  "", "[audio]", "[nota_de_voz]", "[imagen]", "[image]", "[archivo]", "[video]", "[documento]", "[sticker]",
]);

function esMarcadorMultimedia(contenido: string | null | undefined): boolean {
  return MARCADORES_MULTIMEDIA.has(String(contenido || "").trim().toLowerCase());
}

/** Un pie de foto real nunca debe ser reemplazado por el marcador de un webhook. */
function debeActualizarContenido(existente: MensajeExistente, entrante: MensajeMapeado): boolean {
  const previo = String(existente.contenido || "").trim();
  const nuevo = String(entrante.contenido || "").trim();
  return Boolean(nuevo) && !esMarcadorMultimedia(nuevo) && (esMarcadorMultimedia(previo) || !previo);
}

function mismoArchivo(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = String(a || "").trim();
  const bb = String(b || "").trim();
  return Boolean(aa && bb && aa === bb);
}

/** ¿Misma huella? (tipo + tipo de contenido + contenido/archivo ± ventana). */
function mismaHuella(a: MensajeMapeado, b: MensajeExistente, ventanaMs = 150_000): boolean {
  if ((b.tipo || "") !== a.tipo) return false;
  if ((b.tipo_contenido || "texto") !== a.tipo_contenido) return false;
  const tA = Date.parse(a.creado_en);
  const tB = Date.parse(b.creado_en);
  const diferencia = Math.abs(tA - tB);
  if (Number.isNaN(tA) || Number.isNaN(tB) || diferencia > ventanaMs) return false;
  const cA = (a.contenido || "").trim();
  const cB = (b.contenido || "").trim();
  if (cA === cB) return true;

  // Para adjuntos, la URL es la huella más fiable. Esto evita duplicar una foto
  // que n8n guardó como [imagen] y que Chatwoot trae después con su pie real.
  if (a.tipo_contenido !== "texto" && mismoArchivo(a.url_archivo, b.url_archivo)) return true;

  // Algunos webhooks guardaron antes el marcador sin URL. Se acepta esa pareja
  // solo en una ventana corta, suficiente para la carrera n8n ↔ sincronización
  // directa sin fusionar dos fotos diferentes enviadas minutos después.
  return a.tipo_contenido !== "texto" &&
    diferencia <= 30_000 &&
    (esMarcadorMultimedia(cA) || esMarcadorMultimedia(cB));
}

/**
 * Inserta en `mensajes` lo que falte de una conversación.
 * Devuelve {nuevos, vinculados, entrantes: timestamps de mensajes entrantes};
 * además incrementa mensajes_actualizados cuando completa un adjunto existente.
 */
async function sincronizarMensajes(
  convSupabaseId: string,
  mensajesCw: any[],
  res: ResultadoSync
): Promise<{ nuevos: number; vinculados: number; entrantes: string[] }> {
  const mapeados = mensajesCw
    .map(mapMensajeCw)
    .filter((m): m is MensajeMapeado => Boolean(m))
    .sort((a, b) => Date.parse(a.creado_en) - Date.parse(b.creado_en));
  if (mapeados.length === 0) return { nuevos: 0, vinculados: 0, entrantes: [] };

  const existentesResp = await sbFetch(
    `/mensajes?conversacion_id=eq.${convSupabaseId}&select=id,chatwoot_message_id,tipo,tipo_contenido,contenido,url_archivo,creado_en&order=creado_en.desc&limit=400`
  );
  const existentes: MensajeExistente[] = Array.isArray(existentesResp.json)
    ? existentesResp.json
    : [];

  const porInsertar: MensajeMapeado[] = [];
  let vinculados = 0;

  /** Completa URL, id y, sobre todo, el pie de foto que antes quedó como [imagen]. */
  async function actualizarExistente(existente: MensajeExistente, msg: MensajeMapeado, vincularId: boolean) {
    const seVincula = Boolean(vincularId && !existente.chatwoot_message_id);
    const cambios: Record<string, any> = {
      ...(seVincula ? { chatwoot_message_id: msg.chatwoot_message_id } : {}),
      ...(msg.url_archivo && !existente.url_archivo ? { url_archivo: msg.url_archivo } : {}),
      ...(debeActualizarContenido(existente, msg) ? { contenido: msg.contenido } : {}),
    };
    if (Object.keys(cambios).length === 0) return { seVincula: false, actualizado: false };
    const respuesta = await sbFetch(`/mensajes?id=eq.${existente.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(await depurar("mensajes", cambios)),
    });
    return { seVincula: seVincula && respuesta.ok, actualizado: respuesta.ok };
  }

  for (const msg of mapeados) {
    // Incluso si el mensaje ya tiene id de Chatwoot, sincronizamos el pie de
    // foto: versiones previas pudieron haber guardado solamente [imagen].
    const existenteConId = existentes.find((e) => e.chatwoot_message_id === msg.chatwoot_message_id);
    if (existenteConId) {
      const actualizacion = await actualizarExistente(existenteConId, msg, false);
      if (actualizacion.actualizado) res.mensajes_actualizados += 1;
      continue;
    }

    // ¿Ya está guardado por n8n o por send-message (sin id de Chatwoot)?
    const gemelo = existentes.find((e) => mismaHuella(msg, e));
    if (gemelo) {
      const actualizacion = await actualizarExistente(gemelo, msg, true);
      if (actualizacion.seVincula) vinculados += 1;
      if (actualizacion.actualizado) res.mensajes_actualizados += 1;
      continue;
    }
    porInsertar.push(msg);
  }

  if (porInsertar.length > 0) {
    const filaBase = await depurar("mensajes", {
      conversacion_id: convSupabaseId,
      chatwoot_message_id: "0",
      tipo: "recibido",
      contenido: "",
      tipo_contenido: "texto",
      url_archivo: null,
      creado_en: new Date().toISOString(),
    });
    const conIdChatwoot = "chatwoot_message_id" in filaBase;

    const filas = porInsertar.map((m) => {
      const fila: Record<string, any> = {
        conversacion_id: convSupabaseId,
        tipo: m.tipo,
        contenido: m.contenido,
        tipo_contenido: m.tipo_contenido,
        url_archivo: m.url_archivo,
        creado_en: m.creado_en,
      };
      if (conIdChatwoot) fila.chatwoot_message_id = m.chatwoot_message_id;
      return fila;
    });

    for (let i = 0; i < filas.length; i += 100) {
      const lote = filas.slice(i, i + 100);
      let insert = await sbFetch("/mensajes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(lote),
      });
      if (!insert.ok) {
        const texto = (insert.texto || "").toLowerCase();
        const duplicado = insert.status === 409 || texto.includes("duplicate") || texto.includes("unique");
        if (duplicado) {
          // Carrera con n8n: mensaje ya insertado por el otro camino → bien.
          continue;
        }
        if (conIdChatwoot && /chatwoot_message_id|pgrst204|does not exist/i.test(insert.texto || "")) {
          // Columna ausente (migración pendiente): reintentar sin el id.
          const sinId = lote.map(({ chatwoot_message_id, ...resto }) => resto);
          insert = await sbFetch("/mensajes", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(sinId),
          });
        }
      }
      if (insert.ok) {
        res.mensajes_nuevos += lote.length;
      } else {
        res.errores.push(`mensajes lote ${i / 100}: (${insert.status}) ${insert.texto.slice(0, 160)}`);
      }
    }
  }

  return {
    nuevos: porInsertar.length,
    vinculados,
    entrantes: mapeados.filter((m) => m.tipo === "recibido").map((m) => m.creado_en),
  };
}

/** Recalcula no_leidos. RPC si existe; si no, cálculo manual por conversación. */
async function recalcularNoLeidos(
  tocadas: Array<{ convId: string; no_leidos: number | null; ultimo_leido_en: string | null; entrantes: string[] }>
): Promise<void> {
  const rpc = await sbFetch("/rpc/sincronizar_no_leidos", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: "{}",
  });
  if (rpc.ok) return;

  // Respaldo manual (función aún no creada en Supabase).
  for (const t of tocadas) {
    const limite = Date.parse(t.ultimo_leido_en || "1970-01-01T00:00:00Z") || 0;
    const cuenta = t.entrantes.filter((iso) => Date.parse(iso) > limite).length;
    if ((t.no_leidos || 0) !== cuenta) {
      await sbFetch(`/conversaciones?id=eq.${t.convId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(await depurar("conversaciones", { no_leidos: cuenta })),
      });
    }
  }
}

function resumenUltimoMensaje(mensajesCw: any[]): { contenido: string; en: string } | null {
  const mapeados = mensajesCw
    .map(mapMensajeCw)
    .filter((m): m is MensajeMapeado => Boolean(m))
    .sort((a, b) => Date.parse(a.creado_en) - Date.parse(b.creado_en));
  const ultimo = mapeados[mapeados.length - 1];
  if (!ultimo) return null;
  const vista =
    ultimo.tipo_contenido === "audio"
      ? "[audio]"
      : ultimo.tipo_contenido === "imagen"
        ? (esMarcadorMultimedia(ultimo.contenido) ? "[imagen]" : `📷 ${ultimo.contenido}`)
        : ultimo.contenido;
  return { contenido: vista, en: ultimo.creado_en };
}

// ---------------------------------------------------------------------------
// Sincronización completa (sondeo)
// ---------------------------------------------------------------------------

export type OpcionesSync = {
  /** Traer historial de TODAS las conversaciones, no sólo las con novedades. */
  completa?: boolean;
  /** Sincronizar una sola conversación de Chatwoot. */
  chatwootConversationId?: string | number;
  /** Máximo de conversaciones por pasada (por defecto 100). */
  maxConversaciones?: number;
};

export async function sincronizarTodo(opciones: OpcionesSync = {}): Promise<ResultadoSync> {
  const res = nuevoResultado();
  const inicio = Date.now();
  const maxConversaciones = opciones.maxConversaciones || 100;

  try {
    // 1) Listar conversaciones de Chatwoot (abiertas; las resueltas se reabren
    //    solas cuando el cliente vuelve a escribir).
    let conversacionesCw: any[] = [];
    if (opciones.chatwootConversationId) {
      const detalle = await cwGet(`/conversations/${opciones.chatwootConversationId}`);
      if (detalle.ok && detalle.json) {
        conversacionesCw = [detalle.json];
      } else if (detalle.status === 404) {
        res.errores.push("la conversación no existe en Chatwoot (¿se borró?)");
        res.tardo_ms = Date.now() - inicio;
        return res;
      }
    } else {
      for (let pagina = 1; pagina <= 5; pagina += 1) {
        const listado = await cwGet(
          `/conversations?status=open&per_page=25&page=${pagina}`
        );
        if (!listado.ok && pagina === 1) {
          res.errores.push(
            `Chatwoot no respondió el listado (${listado.status}): ${listado.texto.slice(0, 160)}`
          );
          break;
        }
        const lote = listado.json?.data?.payload || listado.json?.payload || [];
        conversacionesCw = conversacionesCw.concat(lote);
        if (!listado.ok || lote.length < 25) break;
        if (conversacionesCw.length >= maxConversaciones) break;
      }
      // Ordenar por actividad más reciente primero (prioriza lo urgente).
      conversacionesCw.sort(
        (a, b) => (b.last_non_activity_message_at || b.last_activity_at || 0) -
          (a.last_non_activity_message_at || a.last_activity_at || 0)
      );
      conversacionesCw = conversacionesCw.slice(0, maxConversaciones);
    }

    res.conversaciones_recorridas = conversacionesCw.length;
    const tocadas: Array<{
      convId: string; no_leidos: number | null; ultimo_leido_en: string | null; entrantes: string[];
    }> = [];

    for (const convCw of conversacionesCw) {
      const sender = convCw?.meta?.sender || {};
      const attrs = convCw?.custom_attributes || sender?.custom_attributes || {};
      const { telefono, display } = telefonoDe(sender, convCw);

      const clienteId = await upsertCliente(
        telefono,
        display,
        sender?.name || null,
        sender?.avatar_url || null,
        attrs,
        res
      );
      if (!clienteId) continue;

      const existente = await buscarConversacion(convCw.id);
      const ultimaActividadCwMs =
        (convCw.last_non_activity_message_at || convCw.last_activity_at || 0) * 1000;
      const ultimoEnMs = existente?.ultimo_mensaje_en
        ? Date.parse(existente.ultimo_mensaje_en)
        : 0;

      // ¿Vale la pena bajar los mensajes? Sólo si hay novedades (o modo completo).
      const hayNovedades =
        opciones.completa ||
        opciones.chatwootConversationId ||
        !existente ||
        ultimaActividadCwMs > ultimoEnMs - 3000;

      if (!hayNovedades) continue;

      const mensajesResp = await cwGet(
        `/conversations/${convCw.id}/messages?per_page=100`,
        25000
      );
      const mensajesCw: any[] = mensajesResp.json?.payload || [];
      if (!mensajesResp.ok) {
        res.errores.push(
          `historial ${convCw.id}: (${mensajesResp.status}) ${mensajesResp.texto.slice(0, 120)}`
        );
      }

      const ultimo = resumenUltimoMensaje(mensajesCw);
      const ultimoEn = ultimo
        ? ultimo.en
        : convCw.last_non_activity_message_at
          ? fechaISO(convCw.last_non_activity_message_at)
          : new Date().toISOString();
      const ultimoTexto = ultimo
        ? ultimo.contenido
        : String(
            Array.isArray(convCw?.messages) && convCw.messages.length > 0
              ? convCw.messages[convCw.messages.length - 1]?.content || ""
              : ""
          );

      const convRow = await upsertConversacion(convCw, clienteId, telefono, ultimoTexto, ultimoEn, res);
      if (!convRow) continue;

      if (mensajesCw.length > 0) {
        const sync = await sincronizarMensajes(convRow.id, mensajesCw, res);
        tocadas.push({
          convId: convRow.id,
          no_leidos: convRow.no_leidos,
          ultimo_leido_en: convRow.ultimo_leido_en,
          entrantes: sync.entrantes,
        });
      }
    }

    if (tocadas.length > 0) {
      await recalcularNoLeidos(tocadas);
    }
  } catch (e: any) {
    res.ok = false;
    res.errores.push(e?.message || "error inesperado");
  }

  res.tardo_ms = Date.now() - inicio;
  res.ok = res.ok && res.errores.length === 0;
  return res;
}

// ---------------------------------------------------------------------------
// Webhook directo de Chatwoot (evento único, estilo "Sincronizar Supabase")
// ---------------------------------------------------------------------------

export async function procesarEventoWebhook(body: any): Promise<ResultadoSync> {
  const res = nuevoResultado();
  const inicio = Date.now();
  try {
    if (!body || (!body.conversation && !body.id)) {
      res.errores.push("evento sin conversación");
      res.tardo_ms = Date.now() - inicio;
      return res;
    }
    const conv = body.conversation || {};
    const sender = body.sender || conv?.meta?.sender || {};
    const attrs = conv?.custom_attributes || {};
    const { telefono, display } = telefonoDe(sender, conv);

    const clienteId = await upsertCliente(
      telefono,
      display,
      sender?.name || null,
      sender?.avatar_url || null,
      attrs,
      res
    );
    if (!clienteId) throw new Error("no se pudo garantizar el cliente");

    const mensaje = mapMensajeCw({
      id: body.id,
      content: body.content,
      message_type: body.message_type,
      attachments: body.attachments,
      private: body.private,
      created_at: body.created_at || Date.now() / 1000,
    });

    const ultimoTexto = mensaje
      ? mensaje.tipo_contenido === "audio"
        ? "[audio]"
        : mensaje.tipo_contenido === "imagen"
          ? (esMarcadorMultimedia(mensaje.contenido) ? "[imagen]" : `📷 ${mensaje.contenido}`)
          : mensaje.contenido
      : "";
    const ultimoEn = mensaje ? mensaje.creado_en : fechaISO(conv.last_non_activity_message_at || Date.now() / 1000);

    const convRow = await upsertConversacion(conv, clienteId, telefono, ultimoTexto, ultimoEn, res);
    if (!convRow) throw new Error("no se pudo garantizar la conversación");

    if (mensaje) {
      const cwMsg = {
        id: body.id,
        content: body.content,
        message_type: body.message_type,
        attachments: body.attachments,
        private: body.private,
        created_at: body.created_at || Date.now() / 1000,
      };
      const sync = await sincronizarMensajes(convRow.id, [cwMsg], res);
      await recalcularNoLeidos([
        {
          convId: convRow.id,
          no_leidos: convRow.no_leidos,
          ultimo_leido_en: convRow.ultimo_leido_en,
          entrantes: sync.entrantes,
        },
      ]);
    }
  } catch (e: any) {
    res.ok = false;
    res.errores.push(e?.message || "error inesperado");
  }
  res.tardo_ms = Date.now() - inicio;
  res.ok = res.ok && res.errores.length === 0;
  return res;
}
