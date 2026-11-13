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

import { chatwootAuthHeaders, chatwootConfig } from "./chatwoot";
import { CuentaPersonal, cuentaDeInboxChatwoot } from "./whatsapp-cuentas";

// ---------------------------------------------------------------------------
// Supabase por REST (mismo patrón que el workflow de n8n)
// ---------------------------------------------------------------------------

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://zcljlddtcoyfyvshlyfk.supabase.co"
).replace(/\/$/, "");

// Service role: env en Vercel → si no está, la misma llave que ya usa el
// workflow de n8n (ya vive en este repo) → si tampoco, anon.
const SERVICE_ROLE_N8N =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjbGpsZGR0Y295Znl2c2hseWZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQ0NTQ4NCwiZXhwIjoyMTA0MDIxNDg0fQ._iG5UHv6fUc4QvhA56WbJ_P7WhIg1vyz1R3B5EWUU90";

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
  timeoutMs = 15000
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
      headers: chatwootAuthHeaders(cfg.token, { "Content-Type": "application/json" }),
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
    conv?.contact?.phone_number,
    sender?.identifier,
    conv?.meta?.sender?.identifier,
    conv?.contact?.identifier,
    sender?.additional_attributes?.phone_number,
  ];
  for (const c of candidatos) {
    if (pareceTelefonoReal(c)) return { telefono: normalizarTelefono(c), display: normalizarTelefono(c) };
  }
  return { telefono: `revisar_${conv?.id || Date.now()}`, display: "Sin teléfono" };
}

/** WhatsApp API (Meta) vs WhatsApp Personal (Evolution). No depende de un inbox_id fijo. */
function fuenteDeConversacion(convCw: any, fallback?: string | null): string {
  const inboxId = convCw?.inbox_id ?? convCw?.inbox?.id;
  const nombre = String(convCw?.inbox?.name || convCw?.meta?.channel || "").toLowerCase();
  const canal = String(convCw?.meta?.channel || convCw?.channel || convCw?.inbox?.channel_type || "").toLowerCase();
  if (
    nombre.includes("api") ||
    nombre.includes("cloud") ||
    nombre.includes("templo") ||
    nombre.includes("meta") ||
    canal.includes("whatsapp") && !nombre.includes("personal") && !nombre.includes("evolution")
  ) {
    if (nombre.includes("personal") || nombre.includes("evolution") || nombre.includes("maestro")) {
      return "evolution";
    }
    return "meta_business";
  }
  if (nombre.includes("personal") || nombre.includes("evolution") || nombre.includes("maestro")) {
    return "evolution";
  }
  if (inboxId != null && Number(inboxId) === 5) return "meta_business";
  return fallback || "evolution";
}

// ---------------------------------------------------------------------------
// SEGUNDO WHATSAPP PERSONAL: qué bandeja corresponde a cada cuenta
// ---------------------------------------------------------------------------
// El ID de la bandeja del WhatsApp 2 se lee de config_general (Ajustes) y, como
// respaldo, de CHATWOOT_INBOX_PERSONAL2_ID. Se cachea 60 s porque la
// sincronización recorre muchas conversaciones por pasada.
let cachePistasPersonal: { expira: number; inboxId: string; instancia2: string; numero2: string } | null = null;

async function pistasCuentasPersonales(): Promise<{ inboxId: string; instancia2: string; numero2: string }> {
  const ahora = Date.now();
  if (cachePistasPersonal && cachePistasPersonal.expira > ahora) {
    return {
      inboxId: cachePistasPersonal.inboxId,
      instancia2: cachePistasPersonal.instancia2,
      numero2: cachePistasPersonal.numero2,
    };
  }
  let inboxId = String(process.env.CHATWOOT_INBOX_PERSONAL2_ID || "").trim();
  let instancia2 = String(process.env.EVOLUTION_INSTANCE_PERSONAL2 || "").trim();
  let numero2 = String(process.env.WHATSAPP_PERSONAL2_NUMERO || "").trim();
  try {
    const r = await sbFetch(
      "/config_general?clave=in.(whatsapp_personal2_inbox_id,whatsapp_personal2_instancia,whatsapp_personal2_numero)&select=clave,valor&limit=10"
    );
    if (r.ok && Array.isArray(r.json)) {
      for (const fila of r.json) {
        const valor = String(fila?.valor || "").trim();
        if (!valor) continue;
        if (fila.clave === "whatsapp_personal2_inbox_id" && !inboxId) inboxId = valor;
        if (fila.clave === "whatsapp_personal2_instancia") instancia2 = valor;
        if (fila.clave === "whatsapp_personal2_numero" && !numero2) numero2 = valor;
      }
    }
  } catch {
    /* configuración no disponible: se usan los nombres de las bandejas */
  }
  cachePistasPersonal = { expira: ahora + 60_000, inboxId, instancia2, numero2 };
  return { inboxId, instancia2, numero2 };
}

/** Cuenta personal (WhatsApp 1 / WhatsApp 2) a la que llegó la conversación. */
async function cuentaPersonalDeConversacion(convCw: any): Promise<CuentaPersonal | null> {
  if (fuenteDeConversacion(convCw) !== "evolution") return null;
  const pistas = await pistasCuentasPersonales();
  const inboxId = convCw?.inbox_id ?? convCw?.inbox?.id ?? null;
  const nombre = convCw?.inbox?.name || convCw?.meta?.channel || "";
  return cuentaDeInboxChatwoot(inboxId, nombre, { inboxIdPersonal2: pistas.inboxId });
}

function extraerConversacionesCw(json: any): any[] {
  const candidatos = [json?.data?.payload, json?.payload, json?.data?.conversations, json?.conversations, json?.data];
  for (const c of candidatos) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function extraerMensajesCw(json: any): any[] {
  const candidatos = [json?.payload, json?.data?.payload, json?.data, json?.messages];
  for (const c of candidatos) {
    if (Array.isArray(c)) return c;
  }
  return Array.isArray(json) ? json : [];
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
  /**
   * Actividad más reciente vista en Chatwoot durante la pasada (ms epoch),
   * contando TAMBIÉN las conversaciones que se omitieron por no tener
   * novedades. El dashboard la compara con su propia lista: si Chatwoot va
   * adelantado (p. ej. el webhook ya guardó el mensaje pero el realtime de
   * Supabase no llegó al teléfono), refresca aunque el sondeo no haya traído
   * nada nuevo. Sin esto, un APK sin realtime se queda con la bandeja vieja
   * aunque Supabase esté perfectamente al día.
   */
  actividad_maxima_ms: number;
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
    actividad_maxima_ms: 0,
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
  res: ResultadoSync,
  existente?: { id: string; nombre?: string | null; foto_url?: string | null } | null
): Promise<string | null> {
  let clienteId: string | null = existente?.id ?? null;
  let fila: any = existente;
  if (!clienteId) {
    const busqueda = await sbFetch(
      `/clientes?telefono=eq.${encodeURIComponent(telefono)}&select=id,nombre,foto_url`,
      { headers: { Prefer: "count=exact" } }
    );
    const encontrados = Array.isArray(busqueda.json) ? busqueda.json : [];
    if (busqueda.ok && encontrados.length > 0) {
      clienteId = encontrados[0].id;
      fila = encontrados[0];
    }
  }
  if (clienteId) {
    // Sólo valores presentes: nunca borrar datos del CRM con vacíos.
    // Sin cambios reales NO se hace PATCH: un write inútil dispara el
    // realtime de `clientes` y obliga al dashboard a recargar toda la lista.
    const cambios: Record<string, any> = {};
    if (nombre && nombre !== fila?.nombre) cambios.nombre = nombre;
    if (fotoUrl && fotoUrl !== fila?.foto_url) cambios.foto_url = fotoUrl;
    if (attrs.tipo_trabajo) cambios.tipo_trabajo = attrs.tipo_trabajo;
    if (attrs.nombre_otra_persona) cambios.nombre_otra_persona = attrs.nombre_otra_persona;
    // Luna guardó las fotos con dos nombres distintos según la versión del
    // workflow (foto_otra_persona / foto_otra_persona_url): se aceptan ambos.
    const fotoOtra = attrs.foto_otra_persona || attrs.foto_otra_persona_url;
    const fotoMano = attrs.foto_mano || attrs.foto_mano_url;
    if (fotoOtra) cambios.foto_otra_persona = fotoOtra;
    if (fotoMano) cambios.foto_mano = fotoMano;
    if (telefonoDisplay && telefonoDisplay !== "Sin teléfono") cambios.telefono_display = telefonoDisplay;
    if (Object.keys(cambios).length > 0) {
      cambios.actualizado_en = new Date().toISOString();
      await sbFetch(`/clientes?id=eq.${clienteId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(await depurar("clientes", cambios)),
      });
    }
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
  cliente_id?: string | null;
  ultimo_mensaje?: string | null;
  numero_whatsapp?: string | null;
  fuente?: string | null;
  chatwoot_conversation_id?: string | null;
  chatwoot_conversation_ids?: string[] | null;
  /** Último mensaje del cliente POR EL WHATSAPP API (ventana de 24 h). */
  ultimo_entrante_api_en?: string | null;
  /** Cuenta personal que atiende el chat: 'personal' | 'personal_2'. */
  cuenta_whatsapp?: string | null;
};

const SELECT_CONV =
  "id,chatwoot_conversation_id,chatwoot_conversation_ids,ultimo_mensaje_en,no_leidos,ultimo_leido_en,cliente_id,ultimo_mensaje,numero_whatsapp,fuente,ultimo_entrante_api_en,cuenta_whatsapp";

async function fetchConversacionesSb(rutaBase: string): Promise<any[] | null> {
  const r = await sbFetch(rutaBase);
  if (r.ok && Array.isArray(r.json)) return r.json;
  // Columna ausente (migración pendiente): reintentar sin el array de ids.
  if (/chatwoot_conversation_ids|ultimo_entrante_api_en|cuenta_whatsapp|pgrst204|does not exist/i.test(r.texto || "")) {
    const sinArray = rutaBase
      .replace("chatwoot_conversation_ids,", "")
      .replace(",ultimo_entrante_api_en", "")
      .replace(",cuenta_whatsapp", "");
    const rAlt = await sbFetch(sinArray);
    if (rAlt.ok && Array.isArray(rAlt.json)) return rAlt.json;
  }
  const r2 = await sbFetch(
    `${rutaBase.split("&select=")[0]}&select=id,chatwoot_conversation_id,ultimo_mensaje_en,no_leidos,ultimo_leido_en,cliente_id,ultimo_mensaje,numero_whatsapp,fuente`
  );
  return r2.ok && Array.isArray(r2.json) ? r2.json : null;
}

function idsChatwootDe(row: ConvExistente | null | undefined): string[] {
  if (!row) return [];
  const out = new Set<string>();
  if (row.chatwoot_conversation_id) out.add(String(row.chatwoot_conversation_id));
  for (const id of row.chatwoot_conversation_ids || []) {
    if (id) out.add(String(id));
  }
  return Array.from(out);
}

async function buscarConversacion(chatwootConvId: string | number): Promise<ConvExistente | null> {
  const id = String(chatwootConvId);
  const encontrados = await fetchConversacionesSb(
    `/conversaciones?chatwoot_conversation_id=eq.${encodeURIComponent(id)}&select=${SELECT_CONV}`
  );
  if (encontrados && encontrados.length > 0) return encontrados[0];
  const porArray = await sbFetch(
    `/conversaciones?chatwoot_conversation_ids=cs.{${encodeURIComponent(id)}}&select=${SELECT_CONV}&limit=1`
  );
  if (porArray.ok && Array.isArray(porArray.json) && porArray.json.length > 0) return porArray.json[0];
  return null;
}

async function buscarConversacionPorCliente(clienteId: string): Promise<ConvExistente | null> {
  const rows = await fetchConversacionesSb(
    `/conversaciones?cliente_id=eq.${encodeURIComponent(clienteId)}&select=${SELECT_CONV}&order=ultimo_mensaje_en.desc.nullslast&limit=5`
  );
  if (!rows || rows.length === 0) return null;
  const personal = rows.find((r) => r.fuente === "evolution");
  return personal || rows[0];
}

let cacheMapaConversaciones: { expira: number; mapa: Map<string, ConvExistente> } | null = null;

/**
 * Mapa de conversaciones conocidas por id de Chatwoot.
 * En modo rápido limita a las más recientes y cachea en memoria 10s
 * para que múltiples pestañas del dashboard no multipliquen el Egress.
 */
async function mapaDeConversaciones(rapido = false): Promise<Map<string, ConvExistente>> {
  const ahora = Date.now();
  if (cacheMapaConversaciones && cacheMapaConversaciones.expira > ahora) {
    return cacheMapaConversaciones.mapa;
  }

  const limit = rapido ? 150 : 800;
  const rows = await fetchConversacionesSb(
    `/conversaciones?select=${SELECT_CONV}&order=ultimo_mensaje_en.desc.nullslast&limit=${limit}`
  );
  const mapa = new Map<string, ConvExistente>();
  if (rows) {
    for (const row of rows) {
      for (const id of idsChatwootDe(row)) mapa.set(id, row);
    }
  }
  cacheMapaConversaciones = { expira: ahora + 10_000, mapa };
  return mapa;
}

async function upsertConversacion(
  convCw: any,
  clienteId: string,
  telefono: string,
  ultimoMensaje: string,
  ultimoMensajeEn: string,
  res: ResultadoSync,
  existentePrevio?: ConvExistente | null,
  /** Fecha ISO del último mensaje del CLIENTE en esta conversación de Chatwoot. */
  ultimoEntranteApi?: string | null
): Promise<ConvExistente | null> {
  // Un solo chat por cliente: API y Personal escriben en la misma fila.
  let existente = existentePrevio !== undefined ? existentePrevio : await buscarConversacion(convCw.id);
  if (!existente && clienteId) {
    existente = await buscarConversacionPorCliente(clienteId);
  }

  const telefonoFinal =
    !pareceTelefonoReal(telefono) && existente?.numero_whatsapp
      ? existente.numero_whatsapp
      : telefono;
  // No pisar la fuente del chat unificado: el envío sigue la etapa, no el inbox de este mensaje.
  const fuenteNueva = fuenteDeConversacion(convCw, existente?.fuente);
  const fuente = existente?.fuente || fuenteNueva;
  // Segunda cuenta personal: se guarda al nacer el chat y, sólo si el chat
  // todavía no la tiene, cuando llega un mensaje de esa bandeja. Una vez que el
  // operador elige la cuenta para ese chat, la sincronización NO la pisa.
  const cuentaPersonalNueva = await cuentaPersonalDeConversacion(convCw);
  const cwId = convCw?.id != null ? String(convCw.id) : "";
  const idsUnidos = cwId ? Array.from(new Set([...idsChatwootDe(existente), cwId])) : idsChatwootDe(existente);

  // Ventana de 24 h del WhatsApp API: la sincronización es la única que sabe el
  // canal de cada conversación de Chatwoot, así que mantiene la marca del último
  // mensaje del cliente que entró POR EL API —incluso cuando la fila del CRM
  // está unificada con WhatsApp Personal—. Solo se adelanta, nunca se atrasa.
  const entranteApiNuevo = fuenteNueva === "meta_business" && ultimoEntranteApi ? ultimoEntranteApi : null;
  const subirEntranteApi = Boolean(
    entranteApiNuevo &&
      (!existente?.ultimo_entrante_api_en ||
        Date.parse(entranteApiNuevo) > Date.parse(existente.ultimo_entrante_api_en))
  );

  if (existente) {
    const idsIguales =
      idsUnidos.length === idsChatwootDe(existente).length &&
      idsUnidos.every((id) => idsChatwootDe(existente).includes(id));
    const faltaCuentaPersonal =
      Boolean(cuentaPersonalNueva) && !existente.cuenta_whatsapp && idsChatwootDe(existente).length <= 1;
    const sinCambios =
      existente.ultimo_mensaje === ultimoMensaje &&
      existente.ultimo_mensaje_en === ultimoMensajeEn &&
      existente.numero_whatsapp === telefonoFinal &&
      idsIguales &&
      !subirEntranteApi &&
      !faltaCuentaPersonal;
    if (sinCambios) return existente;

    const cambios = await depurar("conversaciones", {
      ultimo_mensaje: ultimoMensaje,
      ultimo_mensaje_en: ultimoMensajeEn,
      numero_whatsapp: telefonoFinal,
      chatwoot_conversation_ids: idsUnidos,
      ...(subirEntranteApi ? { ultimo_entrante_api_en: entranteApiNuevo } : {}),
      // Sólo rellena el id principal si aún no había ninguno.
      ...(!existente.chatwoot_conversation_id && cwId ? { chatwoot_conversation_id: cwId } : {}),
      // Relleno inicial de la cuenta personal (nunca sobrescribe una elección
      // manual). Con varios chats unificados no se adivina: queda en null.
      ...(cuentaPersonalNueva && !existente.cuenta_whatsapp && idsChatwootDe(existente).length <= 1
        ? { cuenta_whatsapp: cuentaPersonalNueva }
        : {}),
      actualizado_en: new Date().toISOString(),
    });
    let respuestaPatch = await sbFetch(`/conversaciones?id=eq.${existente.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(cambios),
    });
    // Si la migración de la segunda cuenta aún no está aplicada, la columna
    // desconocida NO debe impedir guardar el último mensaje del chat.
    if (!respuestaPatch.ok && "cuenta_whatsapp" in cambios && /cuenta_whatsapp|pgrst204/i.test(respuestaPatch.texto || "")) {
      delete (cambios as any).cuenta_whatsapp;
      respuestaPatch = await sbFetch(`/conversaciones?id=eq.${existente.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(cambios),
      });
    }
    if (respuestaPatch.ok) {
      // Mantener vivo el mapa en memoria (vale 10 s): sin esto, la segunda
      // pasada de un sondeo volvía a PATCHear lo mismo porque el mapa seguía
      // con los valores viejos → un evento realtime vacío por cada chat y
      // recargas de la lista en el teléfono sin ningún mensaje nuevo.
      existente.ultimo_mensaje = ultimoMensaje;
      existente.ultimo_mensaje_en = ultimoMensajeEn;
      existente.numero_whatsapp = telefonoFinal;
      if (subirEntranteApi && entranteApiNuevo) existente.ultimo_entrante_api_en = entranteApiNuevo;
      if (cuentaPersonalNueva && !existente.cuenta_whatsapp && idsChatwootDe(existente).length <= 1) {
        existente.cuenta_whatsapp = cuentaPersonalNueva;
      }
      if (cacheMapaConversaciones && cacheMapaConversaciones.expira > Date.now()) {
        for (const id of idsUnidos) cacheMapaConversaciones.mapa.set(id, existente);
      }
    }
    return {
      ...existente,
      ultimo_mensaje_en: ultimoMensajeEn,
      ultimo_mensaje: ultimoMensaje,
      ...(subirEntranteApi ? { ultimo_entrante_api_en: entranteApiNuevo } : {}),
    };
  }

  const datos = await depurar("conversaciones", {
    cliente_id: clienteId,
    chatwoot_conversation_id: String(convCw.id),
    chatwoot_conversation_ids: [String(convCw.id)],
    numero_whatsapp: telefono,
    fuente,
    ultimo_mensaje: ultimoMensaje,
    ultimo_mensaje_en: ultimoMensajeEn,
    ...(entranteApiNuevo ? { ultimo_entrante_api_en: entranteApiNuevo } : {}),
    ...(cuentaPersonalNueva ? { cuenta_whatsapp: cuentaPersonalNueva } : {}),
    actualizado_en: new Date().toISOString(),
  });

  const creacion = await sbFetch("/conversaciones", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([datos]),
  });
  if (creacion.ok && Array.isArray(creacion.json) && creacion.json.length > 0) {
    res.conversaciones_nuevas += 1;
    const fila = creacion.json[0];
    // También el mapa en memoria debe conocerla ya (evita re-buscarla en la
    // ventana de la caché).
    if (cacheMapaConversaciones && cacheMapaConversaciones.expira > Date.now()) {
      for (const id of idsChatwootDe(fila)) cacheMapaConversaciones.mapa.set(id, fila);
    }
    return fila;
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
  const tipoRaw = String(m.message_type ?? "").toLowerCase().trim();
  // Chatwoot API usa 0/1; el webhook usa "incoming"/"outgoing".
  const esEntrante = tipoRaw === "0" || tipoRaw === "incoming" || tipoRaw === "in";
  const esSaliente = tipoRaw === "1" || tipoRaw === "outgoing" || tipoRaw === "out";
  if (!esEntrante && !esSaliente) return null;

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
    tipo: esEntrante ? "recibido" : "enviado",
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
 *
 * `ventana=true` (caminos rápidos: webhook y sondeo): en vez de descargar los
 * últimos 400 mensajes para deduplicar, se consultan sólo los cercanos en el
 * tiempo (la huella anti-duplicados usa una ventana de ±150 s, así que nada
 * más lejos puede colisionar) y una verificación exacta por id de Chatwoot.
 * Son 2 consultas indexadas en paralelo en lugar de una pesada.
 */
async function sincronizarMensajes(
  convSupabaseId: string,
  mensajesCw: any[],
  res: ResultadoSync,
  opciones: { ventana?: boolean; soloExistentes?: boolean } = {}
): Promise<{ nuevos: number; vinculados: number; entrantes: string[] }> {
  const mapeados = mensajesCw
    .map(mapMensajeCw)
    .filter((m): m is MensajeMapeado => Boolean(m))
    .sort((a, b) => Date.parse(a.creado_en) - Date.parse(b.creado_en));
  if (mapeados.length === 0) return { nuevos: 0, vinculados: 0, entrantes: [] };

  let existentes: MensajeExistente[] = [];
  // AHORRO DE EGRESS: url_archivo puede contener adjuntos base64 de varios MB
  // (notas de voz, imágenes). Para deduplicar no hace falta descargarlos: se
  // consultan las columnas ligeras y, por separado, solo las URLs cortas y un
  // marcador de presencia para las filas con base64.
  const SEL_MSG_LIGERO = "id,chatwoot_message_id,tipo,tipo_contenido,contenido,creado_en";
  const MARCADOR_BASE64 = "data:archivo-omitido";
  async function traerExistentesLigero(filtro: string, sufijo = ""): Promise<MensajeExistente[]> {
    const [ligeros, urls, pesados] = await Promise.all([
      sbFetch(`/mensajes?${filtro}&select=${SEL_MSG_LIGERO}${sufijo}`),
      sbFetch(`/mensajes?${filtro}&url_archivo=not.like.data:*&select=id,url_archivo${sufijo}`),
      sbFetch(`/mensajes?${filtro}&url_archivo=like.data:*&select=id${sufijo}`),
    ]);
    const mapaUrl = new Map<string, string>();
    for (const r of Array.isArray(urls.json) ? urls.json : []) {
      if (r?.id && r?.url_archivo) mapaUrl.set(String(r.id), r.url_archivo);
    }
    const conBase64 = new Set<string>(
      (Array.isArray(pesados.json) ? pesados.json : []).map((r: any) => String(r.id))
    );
    const filas: MensajeExistente[] = [];
    for (const row of Array.isArray(ligeros.json) ? ligeros.json : []) {
      filas.push({
        ...row,
        url_archivo: mapaUrl.get(String(row.id)) ?? (conBase64.has(String(row.id)) ? MARCADOR_BASE64 : null),
      });
    }
    return filas;
  }
  if (opciones.ventana) {
    const tMin = Math.min(...mapeados.map((m) => Date.parse(m.creado_en)));
    const desde = new Date((Number.isFinite(tMin) ? tMin : Date.now()) - 5 * 60_000).toISOString();
    const ids = mapeados.map((m) => m.chatwoot_message_id);
    const tieneId = (await columnasDe("mensajes"))?.has("chatwoot_message_id");
    const [porVentana, porId] = await Promise.all([
      traerExistentesLigero(
        `conversacion_id=eq.${convSupabaseId}&creado_en=gte.${encodeURIComponent(desde)}`,
        `&order=creado_en.asc&limit=300`
      ),
      // La verificación por id exacto NO necesita las URLs (no compara
      // huellas): una sola consulta ligera. Si el mensaje está en la ventana
      // de tiempo, la copia de porVentana (que sí trae URLs) gana en la unión.
      ids.length > 0 && tieneId !== false
        ? sbFetch(
            `/mensajes?conversacion_id=eq.${convSupabaseId}&chatwoot_message_id=in.(${ids
              .map((x) => encodeURIComponent(String(x)))
              .join(",")})&select=${SEL_MSG_LIGERO}`
          ).then((r) => (Array.isArray(r.json) ? (r.json as MensajeExistente[]) : []))
        : Promise.resolve([] as MensajeExistente[]),
    ]);
    const vistos = new Set<string>();
    for (const lista of [porVentana, porId]) {
      for (const row of Array.isArray(lista) ? lista : []) {
        if (!vistos.has(row.id)) {
          vistos.add(row.id);
          existentes.push(row);
        }
      }
    }
  } else {
    existentes = await traerExistentesLigero(
      `conversacion_id=eq.${convSupabaseId}`,
      `&order=creado_en.desc&limit=400`
    );
  }

  const porInsertar: MensajeMapeado[] = [];
  let vinculados = 0;

  /** Completa URL, id y, sobre todo, el pie de foto que antes quedó como [imagen]. */
  async function actualizarExistente(existente: MensajeExistente, msg: MensajeMapeado, vincularId: boolean) {
    const seVincula = Boolean(vincularId && !existente.chatwoot_message_id);
    const tieneUrlExistente = Boolean(existente.url_archivo && existente.url_archivo !== "data:archivo-omitido");
    const cambios: Record<string, any> = {
      ...(seVincula ? { chatwoot_message_id: msg.chatwoot_message_id } : {}),
      ...(msg.url_archivo && !tieneUrlExistente ? { url_archivo: msg.url_archivo } : {}),
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
    // Eventos message_updated (p. ej. el tick de "leído" de un mensaje
    // enviado): no se insertan filas nuevas, sólo se completan las existentes.
    if (opciones.soloExistentes) continue;
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

function resumenUltimoMensaje(
  mensajesCw: any[]
): { contenido: string; en: string; ultimoEntrante: string | null } | null {
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
  // Último mensaje del CLIENTE dentro de esta conversación de Chatwoot: es la
  // base de la ventana de 24 h del WhatsApp API.
  const entrantes = mapeados.filter((m) => m.tipo === "recibido");
  const ultimoEntrante = entrantes.length > 0 ? entrantes[entrantes.length - 1].creado_en : null;

  return { contenido: vista, en: ultimo.creado_en, ultimoEntrante };
}

// ---------------------------------------------------------------------------
// Sincronización completa (sondeo)
// ---------------------------------------------------------------------------

export type OpcionesSync = {
  /** Traer historial de TODAS las conversaciones, no sólo las con novedades. */
  completa?: boolean;
  /** Sincronizar una sola conversación de Chatwoot (o varias, separadas por coma). */
  chatwootConversationId?: string | number;
  /** Máximo de conversaciones por pasada (por defecto 100). */
  maxConversaciones?: number;
  /**
   * Modo delta para sondeos frecuentes (cada pocos segundos):
   *   · una sola pasada de listado de Chatwoot (100 por página),
   *   · un solo mapa de Supabase para saber qué chats tienen novedades,
   *   · los chats sin cambios cuestan 2 consultas en total, no 4 por chat,
   *   · sólo se repara lo que cambió (máx. 8 conversaciones por pasada).
   */
  rapido?: boolean;
};

type TocadoNoLeidos = {
  convId: string;
  no_leidos: number | null;
  ultimo_leido_en: string | null;
  entrantes: string[];
};

/**
 * Repara una conversación concreta de Chatwoot en Supabase: cliente (si
 * hace falta), historial reciente, resumen del último mensaje y mensajes
 * nuevos. Reusa `existente` para no volver a buscarla. Devuelve si tocó algo.
 */
async function sincronizarConversacionCw(
  convCw: any,
  res: ResultadoSync,
  tocadas: TocadoNoLeidos[],
  opts: {
    existente?: ConvExistente | null;
    ventanaDedupe: boolean;
    perPageMensajes: number;
    /** Modo reparación: refresca nombre/foto/attrs del cliente aunque exista. */
    refrescarCliente?: boolean;
  }
): Promise<{ ok: boolean; nuevos: number; actualizados: number; errores: number }> {
  const antesNuevos = res.mensajes_nuevos;
  const antesAct = res.mensajes_actualizados;
  const antesErrores = res.errores.length;
  const sender = convCw?.meta?.sender || {};
  const attrs = convCw?.custom_attributes || sender?.custom_attributes || {};
  const { telefono, display } = telefonoDe(sender, convCw);
  const existente =
    opts.existente !== undefined ? opts.existente : await buscarConversacion(convCw.id);

  // Si la conversación existe en Supabase, su cliente existe también (FK):
  // se reusa sin tocar `clientes` → el sondeo no dispara realtime vacío.
  let clienteId: string | null = opts.refrescarCliente ? null : existente?.cliente_id || null;
  if (!clienteId) {
    clienteId = await upsertCliente(
      telefono,
      display,
      sender?.name || null,
      sender?.avatar_url || null,
      attrs,
      res
    );
    if (!clienteId) return { ok: false, nuevos: 0, actualizados: 0, errores: res.errores.length - antesErrores };
  }

  const mensajesResp = await cwGet(
    `/conversations/${convCw.id}/messages?per_page=${opts.perPageMensajes}`,
    15000
  );
  let mensajesCw: any[] = extraerMensajesCw(mensajesResp.json);
  if (mensajesCw.length === 0 && Array.isArray(convCw?.messages)) {
    mensajesCw = convCw.messages;
  }
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

  const convRow = await upsertConversacion(
    convCw,
    clienteId,
    telefono,
    ultimoTexto,
    ultimoEn,
    res,
    existente,
    ultimo?.ultimoEntrante ?? null
  );
  if (!convRow) return { ok: false, nuevos: 0, actualizados: 0, errores: res.errores.length - antesErrores };

  if (mensajesCw.length > 0) {
    const sync = await sincronizarMensajes(convRow.id, mensajesCw, res, {
      ventana: opts.ventanaDedupe,
    });
    if (sync.nuevos > 0) {
      tocadas.push({
        convId: convRow.id,
        no_leidos: convRow.no_leidos,
        ultimo_leido_en: convRow.ultimo_leido_en,
        entrantes: sync.entrantes,
      });
    }
  }
  return {
    ok: true,
    nuevos: res.mensajes_nuevos - antesNuevos,
    actualizados: res.mensajes_actualizados - antesAct,
    errores: res.errores.length - antesErrores,
  };
}

function actividadCwMs(convCw: any): number {
  return (convCw.last_non_activity_message_at || convCw.last_activity_at || 0) * 1000;
}

/** ¿El CRM ya tiene esa actividad (o más nueva)? Entonces no hay nada que bajar. */
function sinNovedades(convCw: any, existente: ConvExistente | null): boolean {
  if (!existente || !existente.ultimo_mensaje_en) return false;
  const actMs = actividadCwMs(convCw);
  // Sin marca de actividad en el listado de Chatwoot (0) la comparación
  // antigua daba `0 <= ultMs - 3000` = cierto → el chat quedaba saltado PARA
  // SIEMPRE aunque llegaran mensajes nuevos. Sin marca, mejor mirarlo.
  if (!actMs) return false;
  const ultMs = Date.parse(existente.ultimo_mensaje_en) || 0;
  // Tolerancia amplia (90 s) a propósito: `ultimo_mensaje_en` se escribe con
  // el reloj de VERCEL cuando el operador envía desde el CRM, pero la
  // actividad de Chatwoot lleva el reloj del VPS de Contabo. Si ese reloj va
  // atrasado, una respuesta rápida del cliente quedaba con actividad "más
  // vieja" que lo guardado y el sondeo la saltaba hasta el siguiente mensaje
  // o la pasada completa de 10 minutos. Con 90 s de margen esos mensajes se
  // traen igual. El coste (re-procesar un chat ya sincronizado una vez) lo
  // absorbe la caché de "sin novedades".
  return actMs <= ultMs - 90_000;
}

// La tolerancia de reloj de `sinNovedades` (90 s) hace que un chat "empatado"
// (actividad de Chatwoot a la par o algo por detrás de lo guardado) parezca
// siempre novedad. Para que los sondeos cada pocos segundos no descarguen el
// historial de esos chats una y otra vez, se recuerda que ya se miró y no
// había nada (se invalida sola cuando Chatwoot reporta otra actividad). La
// reparación profunda del botón 🔄 y de la app al abrir ignora esta caché.
const cacheSinNovedades = new Map<string, { actMs: number; en: number; limpio: boolean }>();
const CACHE_MS = 45_000;
// Cuando la pasada salió limpia (0 mensajes nuevos, 0 errores) no hace falta
// re-mirar el chat cada 45 s: con la marca de actividad bastará, porque el
// próximo mensaje la cambia y la caché se invalida sola. Antes, con más de 8
// chats "empatados", los 8 más recientes se re-procesaban cada 45 s y
// ocupaban TODOS los cupos del sondeo rápido (máx. 8 chats por pasada),
// dejando sin sincronizar a los demás hasta 10 minutos.
const CACHE_LIMPIO_MS = 10 * 60_000;

function sePuedeOmitir(convCw: any): boolean {
  const hit = cacheSinNovedades.get(String(convCw.id));
  if (!hit) return false;
  const ttl = hit.limpio ? CACHE_LIMPIO_MS : CACHE_MS;
  return hit.actMs === actividadCwMs(convCw) && Date.now() - hit.en < ttl;
}

function marcarSinNovedades(convCw: any, limpio = false): void {
  if (cacheSinNovedades.size > 500) cacheSinNovedades.clear();
  cacheSinNovedades.set(String(convCw.id), { actMs: actividadCwMs(convCw), en: Date.now(), limpio });
}

export async function sincronizarTodo(opciones: OpcionesSync = {}): Promise<ResultadoSync> {
  const res = nuevoResultado();
  const inicio = Date.now();
  const maxConversaciones = opciones.maxConversaciones || 100;
  const tocadas: TocadoNoLeidos[] = [];

  try {
    // ------------------------------------------------------------------
    // 1) Conversación única (abrir el chat + sondeo de 2.5 s del chat abierto)
    //    Acepta VARIOS ids separados por coma: un cliente puede tener una
    //    conversación en el inbox del WhatsApp API y OTRA en el de WhatsApp
    //    Personal (Evolution). El chat del CRM las une en una sola fila, así
    //    que hay que vigilarlas todas: si sólo se mira la principal, los
    //    mensajes que entran por la otra bandeja no se ven nunca.
    // ------------------------------------------------------------------
    if (opciones.chatwootConversationId) {
      const idsPedidos = String(opciones.chatwootConversationId)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4);
      for (const idUnico of idsPedidos) {
        const detalle = await cwGet(`/conversations/${idUnico}`, 15000);
        if (detalle.ok && detalle.json) {
          res.conversaciones_recorridas += 1;
          res.actividad_maxima_ms = Math.max(res.actividad_maxima_ms, actividadCwMs(detalle.json));
          const existente = await buscarConversacion(idUnico);
          if (!opciones.completa && (sinNovedades(detalle.json, existente) || sePuedeOmitir(detalle.json))) {
            // Nada nuevo: el sondeo rápido del chat abierto son 2 consultas y ya.
            continue;
          }
          const hec = await sincronizarConversacionCw(detalle.json, res, tocadas, {
            existente,
            ventanaDedupe: !opciones.completa,
            perPageMensajes: opciones.completa ? 100 : 40,
          });
          if (!opciones.completa && hec.ok && hec.nuevos === 0 && hec.actualizados === 0) {
            marcarSinNovedades(detalle.json, hec.errores === 0);
          }
        } else if (detalle.status === 404) {
          res.errores.push(`la conversación ${idUnico} no existe en Chatwoot (¿se borró?)`);
        }
      }
      if (tocadas.length > 0) await recalcularNoLeidos(tocadas);
      res.tardo_ms = Date.now() - inicio;
      res.ok = res.ok && res.errores.length === 0;
      return res;
    }

    // ------------------------------------------------------------------
    // 2) Bandeja. WhatsApp Personal (Evolution) suele crear chats en
    //    `pending` y/o sin asignar: si sólo pedimos status=open se pierden.
    //    Se pide `status=all` en UNA llamada y se filtra localmente a
    //    open/pending/snoozed (las resueltas sin actividad no interesan: al
    //    entrar un mensaje Chatwoot las reabre). Si el Chatwoot instalado no
    //    soporta `all`, se vuelve al bucle por estado.
    // ------------------------------------------------------------------
    let conversacionesCw: any[] = [];
    const perPage = 100;
    const maxPaginas = opciones.rapido ? 2 : 5;
    const estadosUtiles = new Set(["open", "pending", "snoozed"]);
    const vistosCw = new Set<string>();
    const listaTodoOk = await cwGet(
      `/conversations?status=all&assignee_type=all&per_page=${perPage}&page=1`,
      15000
    );
    if (listaTodoOk.ok) {
      for (const conv of extraerConversacionesCw(listaTodoOk.json)) {
        const id = String(conv?.id || "");
        const estado = String(conv?.status || "").toLowerCase();
        // Sin estado en el payload no se descarta (mejor mirar de más).
        if (!id || vistosCw.has(id)) continue;
        if (estado && !estadosUtiles.has(estado)) continue;
        vistosCw.add(id);
        conversacionesCw.push(conv);
      }
      // ¿Había más páginas? Se traen también con status=all.
      const lote1 = extraerConversacionesCw(listaTodoOk.json).length;
      if (lote1 >= perPage) {
        for (let pagina = 2; pagina <= maxPaginas; pagina += 1) {
          const listado = await cwGet(
            `/conversations?status=all&assignee_type=all&per_page=${perPage}&page=${pagina}`,
            15000
          );
          if (!listado.ok) break;
          const lote = extraerConversacionesCw(listado.json);
          for (const conv of lote) {
            const id = String(conv?.id || "");
            const estado = String(conv?.status || "").toLowerCase();
            if (!id || vistosCw.has(id)) continue;
            if (estado && !estadosUtiles.has(estado)) continue;
            vistosCw.add(id);
            conversacionesCw.push(conv);
          }
          if (lote.length < perPage || conversacionesCw.length >= maxConversaciones * 2) break;
        }
      }
    } else {
      // Respaldo: Chatwoot sin soporte de status=all → bucle por estado.
      const estados = opciones.completa
        ? ["open", "pending", "snoozed"]
        : ["open", "pending"];
      for (const estado of estados) {
        for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
          const listado = await cwGet(
            `/conversations?status=${estado}&assignee_type=all&per_page=${perPage}&page=${pagina}`,
            15000
          );
          if (!listado.ok && pagina === 1 && estado === estados[0]) {
            res.errores.push(
              `Chatwoot no respondió el listado (${listado.status}): ${listado.texto.slice(0, 160)}`
            );
          }
          const lote = extraerConversacionesCw(listado.json);
          for (const conv of lote) {
            const id = String(conv?.id || "");
            if (!id || vistosCw.has(id)) continue;
            vistosCw.add(id);
            conversacionesCw.push(conv);
          }
          if (!listado.ok || lote.length < perPage) break;
          if (conversacionesCw.length >= maxConversaciones * 2) break;
        }
      }
    }
    // Ordenar por actividad más reciente primero (prioriza lo urgente).
    conversacionesCw.sort((a, b) => actividadCwMs(b) - actividadCwMs(a));
    conversacionesCw = conversacionesCw.slice(0, maxConversaciones);
    res.conversaciones_recorridas = conversacionesCw.length;

    // ------------------------------------------------------------------
    // 3) Modo rápido: un solo mapa de Supabase decide qué chats cambiaron.
    //    Los que no cambiaron cuestan 0 consultas (antes: 4 por chat).
    // ------------------------------------------------------------------
    // El mapa de Supabase (1 consulta) decide qué chats tienen novedades en
    // CUALQUIER modo sondeo; en `completa` se repara todo igualmente.
    const mapaSb = await mapaDeConversaciones(Boolean(opciones.rapido));
    let aProcesar: Array<{ convCw: any; existente: ConvExistente | null }> = [];
    for (const convCw of conversacionesCw) {
      // La actividad vista se reporta SIEMPRE (también de los chats omitidos):
      // es la señal con la que el dashboard se da cuenta de que Chatwoot va
      // adelantado a lo que está pintando (webhook ya guardó, realtime no llegó).
      res.actividad_maxima_ms = Math.max(res.actividad_maxima_ms, actividadCwMs(convCw));
      const existente = mapaSb.get(String(convCw.id)) || null;
      if (!opciones.completa && (sinNovedades(convCw, existente) || sePuedeOmitir(convCw))) continue;
      aProcesar.push({ convCw, existente });
      // En modo rápido, poco y a menudo: máx. 8 chats por pasada (los más
      // recientes van primero; el resto se cubre en el siguiente tic).
      if (opciones.rapido && aProcesar.length >= 8) break;
    }

    for (const { convCw, existente } of aProcesar) {
      const hec = await sincronizarConversacionCw(convCw, res, tocadas, {
        existente,
        ventanaDedupe: !opciones.completa,
        perPageMensajes: opciones.completa ? 100 : 40,
        refrescarCliente: opciones.completa,
      });
      if (!opciones.completa && hec.ok && hec.nuevos === 0 && hec.actualizados === 0) {
        marcarSinNovedades(convCw, hec.errores === 0);
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
//
// Camino rápido (el 99 % de los eventos): la conversación ya existe en
// Supabase → 1 búsqueda + inserción del mensaje y PATCH del resumen EN
// PARALELO + recuento de no leídos. Nada de tocar `clientes`, nada de
// descargar 400 mensajes para deduplicar. Con esto el mensaje está visible
// en el dashboard ~1 s después de entrar a Chatwoot (Realtime lo empuja).

export async function procesarEventoWebhook(
  body: any,
  opciones: { soloActualizarExistentes?: boolean } = {}
): Promise<ResultadoSync> {
  const res = nuevoResultado();
  const inicio = Date.now();
  try {
    if (!body || (!body.conversation && !body.conversation_id && !body.id)) {
      res.errores.push("evento sin conversación");
      res.tardo_ms = Date.now() - inicio;
      return res;
    }
    const conv = {
      ...(body.conversation || {}),
      id: body.conversation?.id || body.conversation_id || body.conversation?.display_id,
      inbox_id: body.conversation?.inbox_id || body.inbox?.id || body.inbox_id,
      inbox: body.conversation?.inbox || body.inbox || body.conversation?.inbox,
    };
    const sender = body.sender || conv?.meta?.sender || body.contact || {};
    const attrs = conv?.custom_attributes || {};
    const { telefono, display } = telefonoDe(sender, conv);

    const cwMsg = {
      id: body.id,
      content: body.content,
      message_type: body.message_type,
      attachments: body.attachments,
      private: body.private,
      created_at: body.created_at || Date.now() / 1000,
    };
    const mensaje = mapMensajeCw(cwMsg);

    // --- Camino rápido: conversación ya conocida por el CRM ----------------
    if (conv?.id) {
      const existente = await buscarConversacion(conv.id);
      if (existente?.cliente_id) {
        if (!mensaje) {
          // Actividad/nota privada de un chat ya guardado: nada que hacer.
          res.tardo_ms = Date.now() - inicio;
          return res;
        }
        const ultimoTexto =
          mensaje.tipo_contenido === "audio"
            ? "[audio]"
            : mensaje.tipo_contenido === "imagen"
              ? esMarcadorMultimedia(mensaje.contenido)
                ? "[imagen]"
                : `📷 ${mensaje.contenido}`
              : mensaje.contenido;
        const esMasNuevo =
          !existente.ultimo_mensaje_en ||
          Date.parse(mensaje.creado_en) >= Date.parse(existente.ultimo_mensaje_en) - 3000;
        const [sync] = await Promise.all([
          sincronizarMensajes(existente.id, [cwMsg], res, {
            ventana: true,
            soloExistentes: opciones.soloActualizarExistentes,
          }),
          esMasNuevo
            ? upsertConversacion(
                conv,
                existente.cliente_id,
                telefono,
                ultimoTexto,
                mensaje.creado_en,
                res,
                existente,
                mensaje.tipo === "recibido" ? mensaje.creado_en : null
              )
            : Promise.resolve(null),
        ]);
        if (sync.nuevos > 0) {
          await recalcularNoLeidos([
            {
              convId: existente.id,
              no_leidos: existente.no_leidos,
              ultimo_leido_en: existente.ultimo_leido_en,
              entrantes: sync.entrantes,
            },
          ]);
        }
        res.tardo_ms = Date.now() - inicio;
        res.ok = res.ok && res.errores.length === 0;
        return res;
      }
    }

    // --- Primera vez (o conversación nueva): crear cliente + conversación --
    const clienteId = await upsertCliente(
      telefono,
      display,
      sender?.name || null,
      sender?.avatar_url || null,
      attrs,
      res
    );
    if (!clienteId) throw new Error("no se pudo garantizar el cliente");

    const ultimoTexto = mensaje
      ? mensaje.tipo_contenido === "audio"
        ? "[audio]"
        : mensaje.tipo_contenido === "imagen"
          ? (esMarcadorMultimedia(mensaje.contenido) ? "[imagen]" : `📷 ${mensaje.contenido}`)
          : mensaje.contenido
      : "";
    const ultimoEn = mensaje ? mensaje.creado_en : fechaISO(conv.last_non_activity_message_at || Date.now() / 1000);

    const convRow = await upsertConversacion(
      conv,
      clienteId,
      telefono,
      ultimoTexto,
      ultimoEn,
      res,
      undefined,
      mensaje && mensaje.tipo === "recibido" ? mensaje.creado_en : null
    );
    if (!convRow) throw new Error("no se pudo garantizar la conversación");

    if (mensaje) {
      const sync = await sincronizarMensajes(convRow.id, [cwMsg], res, {
        ventana: true,
        soloExistentes: opciones.soloActualizarExistentes,
      });
      if (sync.nuevos > 0) {
        await recalcularNoLeidos([
          {
            convId: convRow.id,
            no_leidos: convRow.no_leidos,
            ultimo_leido_en: convRow.ultimo_leido_en,
            entrantes: sync.entrantes,
          },
        ]);
      }
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
// Diagnóstico de la cadena WhatsApp Personal → Evolution → Chatwoot → Supabase
// ---------------------------------------------------------------------------
// «No me está actualizando las conversaciones del WhatsApp Personal» puede
// romperse en 4 eslabones distintos, y desde el CRM no se ve cuál. Esta
// función recorre la cadena de fuera hacia dentro y devuelve un veredicto en
// español con el primer eslabón roto y cómo arreglarlo:
//
//   1. Evolution (¿la sesión del WhatsApp Personal sigue conectada? El QR
//      caduca y es la causa típica).
//   2. Chatwoot (¿responde? ¿la bandeja del Personal registra actividad?)
//   3. Sincronización Chatwoot → Supabase (¿el último mensaje de Supabase va
//      a la zaga del de Chatwoot? → el sondeo/webhook está fallando).
//   4. Reloj del servidor (¿la actividad de Chatwoot está en el futuro? →
//      el VPS tiene el reloj atrasado y el sondeo puede saltar mensajes).

export type HallazgoDiagnostico = {
  paso: string;
  estado: "ok" | "aviso" | "error" | "desconocido";
  detalle: string;
  solucion?: string;
};

export type ResultadoDiagnostico = {
  estado: "ok" | "aviso" | "error";
  veredicto: string;
  generado_en: string;
  evolution: {
    url: string;
    instancia: string;
    estado: string | null;
    conectado: boolean;
  };
  chatwoot: {
    conectado: boolean;
    conversaciones: number;
    ultima_actividad: string | null;
    ultima_actividad_hace_s: number | null;
    inboxes: Array<{
      id: number | string | null;
      nombre: string;
      canal: string;
      es_personal: boolean;
      conversaciones: number;
      ultima_actividad: string | null;
      ultima_actividad_hace_s: number | null;
    }>;
  };
  supabase: {
    conectado: boolean;
    ultimo_mensaje_en: string | null;
    ultimo_mensaje_hace_s: number | null;
    ultima_conversacion_en: string | null;
    mensajes_ultimas_2h: number | null;
  };
  reloj_chatwoot_adelantado_s: number | null;
  hallazgos: HallazgoDiagnostico[];
};

function haceSegundos(iso: string | null | undefined, ahora = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round((ahora - t) / 1000);
}

async function estadoEvolution(nombreInstancia?: string): Promise<{
  url: string;
  instancia: string;
  estado: string | null;
  conectado: boolean;
  error: string | null;
}> {
  const url = (process.env.EVOLUTION_API_URL || "https://evo-crmesteban.duckdns.org").replace(/\/$/, "");
  const instancia = (nombreInstancia || process.env.EVOLUTION_INSTANCE || "personal").trim();
  const llave = (process.env.EVOLUTION_API_KEY || "").trim();
  if (!llave) {
    return { url, instancia, estado: null, conectado: false, error: "sin EVOLUTION_API_KEY en el servidor" };
  }
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 10000);
  try {
    const respuesta = await fetch(`${url}/instance/connectionState/${instancia}`, {
      headers: { apikey: llave },
      signal: controlador.signal,
    });
    const texto = await respuesta.text();
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    const estado = String(json?.instance?.state || json?.state || "") || null;
    return {
      url,
      instancia,
      estado,
      conectado: Boolean(estado && estado.toLowerCase() === "open"),
      error: respuesta.ok ? null : `HTTP ${respuesta.status}: ${texto.slice(0, 120)}`,
    };
  } catch (e: any) {
    return {
      url,
      instancia,
      estado: null,
      conectado: false,
      error: e?.name === "AbortError" ? "tiempo de espera agotado" : e?.message || "error de red",
    };
  } finally {
    clearTimeout(temporizador);
  }
}

export async function diagnosticoCadena(): Promise<ResultadoDiagnostico> {
  const hallazgos: HallazgoDiagnostico[] = [];
  const ahora = Date.now();

  // ------------------------- 1) Evolution (WhatsApp Personal) ----------------
  const evo = await estadoEvolution();
  const evoSinLlave = !evo.conectado && Boolean(evo.error && evo.error.includes("EVOLUTION_API_KEY"));
  if (!evo.conectado) {
    const detalle = evoSinLlave
      ? `No se pudo verificar la sesión del WhatsApp Personal: falta EVOLUTION_API_KEY en el servidor (Vercel).`
      : evo.error
        ? `No se pudo consultar Evolution (${evo.url}): ${evo.error}`
        : evo.estado
          ? `La instancia «${evo.instancia}» del WhatsApp Personal está en estado «${evo.estado}» (debe ser «open»).`
          : `No se pudo verificar la sesión del WhatsApp Personal (instancia «${evo.instancia}»).`;
    hallazgos.push({
      paso: "Evolution (WhatsApp Personal)",
      estado: evoSinLlave ? "desconocido" : "error",
      detalle,
      solucion: evoSinLlave
        ? "Define EVOLUTION_API_KEY en Vercel (la misma de /opt/templo/.env del servidor). Sin ella tampoco se puede enviar desde el CRM por el WhatsApp Personal."
        : `Abre ${evo.url}/manager (o GET ${evo.url}/instance/connect/${evo.instancia} con la cabecera apikey) y escanea el QR con el WhatsApp Personal del teléfono. Mientras no esté «open», los mensajes que te escriban al número personal NO llegan al CRM. Si WhatsApp bloqueó temporalmente el número principal, cambia a la cuenta de respaldo desde la bandeja (selector WhatsApp Personal) o en Ajustes → WhatsApp Personal.`,
    });
  } else {
    hallazgos.push({
      paso: "Evolution (WhatsApp Personal)",
      estado: "ok",
      detalle: `Instancia «${evo.instancia}» conectada (state=open).`,
    });
  }

  // --------------------- 1b) Evolution (WhatsApp 2, si existe) ---------------
  // Sólo se informa cuando el operador ya configuró la cuenta de respaldo: así
  // el diagnóstico dice de una si puede cambiar de número cuando bloquean el
  // principal.
  const pistasPersonales = await pistasCuentasPersonales();
  if (pistasPersonales.instancia2 && (pistasPersonales.numero2 || pistasPersonales.inboxId)) {
    const evo2 = await estadoEvolution(pistasPersonales.instancia2);
    const etiqueta2 = pistasPersonales.numero2 ? `WhatsApp 2 (${pistasPersonales.numero2})` : "WhatsApp 2";
    if (evo2.conectado) {
      hallazgos.push({
        paso: "Evolution (WhatsApp 2)",
        estado: "ok",
        detalle: `Instancia «${evo2.instancia}» de ${etiqueta2} conectada (state=open).`,
      });
    } else {
      hallazgos.push({
        paso: "Evolution (WhatsApp 2)",
        estado: evo2.error && evo2.error.includes("EVOLUTION_API_KEY") ? "desconocido" : "error",
        detalle: evo2.error
          ? `No se pudo consultar la instancia «${evo2.instancia}»: ${evo2.error}`
          : `La instancia «${evo2.instancia}» de ${etiqueta2} está en estado «${evo2.estado || "desconocido"}» (debe ser «open»).`,
        solucion: `Reconecta ${etiqueta2}: abre ${evo2.url}/manager (o GET ${evo2.url}/instance/connect/${evo2.instancia} con la cabecera apikey) y escanea el QR con ese número.`,
      });
    }
  }

  // ------------------------- 2) Chatwoot (listado + bandejas) ----------------
  const conversacionesCw: any[] = [];
  let chatwootConectado = false;
  for (const estado of ["open", "pending"]) {
    const listado = await cwGet(`/conversations?status=${estado}&assignee_type=all&per_page=100&page=1`, 15000);
    if (estado === "open") chatwootConectado = listado.ok;
    if (!listado.ok) continue;
    for (const conv of extraerConversacionesCw(listado.json)) {
      if (!conversacionesCw.some((c) => String(c.id) === String(conv.id))) conversacionesCw.push(conv);
    }
  }
  if (!chatwootConectado) {
    hallazgos.push({
      paso: "Chatwoot",
      estado: "error",
      detalle: "Chatwoot no respondió el listado de conversaciones (URL o token caídos).",
      solucion: "Revisa que el servidor Contabo esté arriba (docker compose ps) y que CHATWOOT_URL / CHATWOOT_API_TOKEN sigan válidos en Vercel.",
    });
  }

  const inboxes = new Map<
    string,
    {
      id: number | string | null;
      nombre: string;
      canal: string;
      es_personal: boolean;
      conversaciones: number;
      ultimaMs: number;
    }
  >();
  let ultimaActividadMs = 0;
  for (const conv of conversacionesCw) {
    const inboxId = conv?.inbox?.id ?? conv?.inbox_id ?? null;
    const clave = String(inboxId ?? conv?.inbox?.name ?? "?");
    const nombre = String(conv?.inbox?.name || `Inbox ${inboxId ?? "?"}`);
    const canal = String(conv?.meta?.channel || conv?.inbox?.channel_type || "");
    const actMs = actividadCwMs(conv);
    ultimaActividadMs = Math.max(ultimaActividadMs, actMs);
    const fila = inboxes.get(clave);
    if (fila) {
      fila.conversaciones += 1;
      fila.ultimaMs = Math.max(fila.ultimaMs, actMs);
    } else {
      inboxes.set(clave, {
        id: inboxId,
        nombre,
        canal,
        es_personal: fuenteDeConversacion(conv) === "evolution",
        conversaciones: 1,
        ultimaMs: actMs,
      });
    }
  }
  const inboxesLista = Array.from(inboxes.values())
    .map((f) => ({
      id: f.id,
      nombre: f.nombre,
      canal: f.canal,
      es_personal: f.es_personal,
      conversaciones: f.conversaciones,
      ultima_actividad: f.ultimaMs ? new Date(f.ultimaMs).toISOString() : null,
      ultima_actividad_hace_s: f.ultimaMs ? Math.round((ahora - f.ultimaMs) / 1000) : null,
    }))
    .sort((a, b) => (b.ultima_actividad_hace_s ?? Infinity) - (a.ultima_actividad_hace_s ?? Infinity));

  if (chatwootConectado) {
    const inboxPersonal = inboxesLista.find((i) => i.es_personal);
    const actHace = inboxesLista.find((i) => i.es_personal)?.ultima_actividad_hace_s ?? null;
    if (!inboxPersonal) {
      hallazgos.push({
        paso: "Bandeja WhatsApp Personal en Chatwoot",
        estado: "aviso",
        detalle: "Chatwoot responde pero no hay ninguna conversación de la bandeja Personal/Evolution en la primera página.",
        solucion: "Si el WhatsApp Personal debería tener chats, la integración Evolution→Chatwoot quedó desconfigurada (revisa el token de la bandeja en Chatwoot y que la instancia «personal» siga registrada).",
      });
    } else if (actHace != null && actHace > 3600 && evo.conectado) {
      hallazgos.push({
        paso: "Bandeja WhatsApp Personal en Chatwoot",
        estado: "aviso",
        detalle: `La bandeja «${inboxPersonal.nombre}» no registra mensajes nuevos hace ${Math.round(actHace / 60)} min aunque Evolution dice estar conectada.`,
        solucion: "Escribe un mensaje de prueba desde otro teléfono al número personal: si en Chatwoot tampoco aparece, reconecta la sesión (QR) en Evolution aunque diga «open».",
      });
    } else if (evo.conectado) {
      hallazgos.push({
        paso: "Bandeja WhatsApp Personal en Chatwoot",
        estado: "ok",
        detalle: `Bandeja «${inboxPersonal.nombre}» con ${inboxPersonal.conversaciones} conversaciones; última actividad ${inboxPersonal.ultima_actividad ? `hace ${Math.round((inboxPersonal.ultima_actividad_hace_s ?? 0) / 60)} min` : "sin datos"}.`,
      });
    }
  }

  // ------------------------- 3) Supabase (frescura) --------------------------
  const [ultimoMsg, ultimaConv, recientes] = await Promise.all([
    sbFetch("/mensajes?select=creado_en&order=creado_en.desc&limit=1"),
    sbFetch("/conversaciones?select=ultimo_mensaje_en&order=ultimo_mensaje_en.desc&limit=1"),
    sbFetch(`/mensajes?select=id&creado_en=gte.${encodeURIComponent(new Date(ahora - 2 * 3600_000).toISOString())}&limit=501`),
  ]);
  const sbUltimoMsgIso = Array.isArray(ultimoMsg.json) && ultimoMsg.json[0]?.creado_en ? ultimoMsg.json[0].creado_en : null;
  const sbUltimaConvIso =
    Array.isArray(ultimaConv.json) && ultimaConv.json[0]?.ultimo_mensaje_en ? ultimaConv.json[0].ultimo_mensaje_en : null;
  const sbRecientes = Array.isArray(recientes.json) ? recientes.json.length : null;
  const supabaseConectado = ultimoMsg.ok || ultimaConv.ok;
  if (!supabaseConectado) {
    hallazgos.push({
      paso: "Supabase",
      estado: "error",
      detalle: "Supabase no respondió las consultas de frescura (llave o caída del servicio).",
      solucion: "Revisa SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en Vercel y el estado del proyecto en supabase.com.",
    });
  }

  // ------------------------- 4) ¿La sync va a la zaga? -----------------------
  const cwUltimaIso = ultimaActividadMs ? new Date(ultimaActividadMs).toISOString() : null;
  if (chatwootConectado && supabaseConectado && cwUltimaIso && sbUltimoMsgIso) {
    const retrasoS = Math.round((Date.parse(cwUltimaIso) - Date.parse(sbUltimoMsgIso)) / 1000);
    if (retrasoS > 180) {
      hallazgos.push({
        paso: "Sincronización Chatwoot → Supabase",
        estado: "error",
        detalle: `Chatwoot tiene actividad ${Math.round(retrasoS / 60)} min más nueva que el último mensaje guardado en Supabase: el sondeo o el webhook no están guardando lo que entra.`,
        solucion: "Pulsa 🔄 Chatwoot en el CRM (reparación completa) y revisa los logs de la función /api/chatwoot/sync en Vercel. Si hay errores de columnas, aplica las migraciones pendientes de supabase/migrations.",
      });
    } else {
      hallazgos.push({
        paso: "Sincronización Chatwoot → Supabase",
        estado: "ok",
        detalle: `Al día: el último mensaje de Supabase va ${retrasoS >= 0 ? `${retrasoS} s por detrás` : `${-retrasoS} s por delante`} de la actividad de Chatwoot.`,
      });
    }
  }

  // ------------------------- 5) Reloj del servidor ---------------------------
  let relojAdelantadoS: number | null = null;
  if (cwUltimaIso) {
    const futuroS = Math.round((Date.parse(cwUltimaIso) - ahora) / 1000);
    if (futuroS > 120) {
      relojAdelantadoS = futuroS;
      hallazgos.push({
        paso: "Reloj del servidor",
        estado: "aviso",
        detalle: `La actividad más reciente de Chatwoot está ${futuroS} s EN EL FUTURO: el reloj del VPS va adelantado.`,
        solucion: "Ajusta la hora del servidor (timedatectl set-ntp true). Un reloj adelantado no pierde mensajes, pero conviene corregirlo.",
      });
    }
  }

  // ------------------------- Veredicto ---------------------------------------
  const peor = hallazgos.reduce<string>((acum, h) => {
    if (acum === "error") return acum;
    if (h.estado === "error") return "error";
    if (acum === "aviso") return acum;
    if (h.estado === "aviso" || h.estado === "desconocido") return "aviso";
    return acum;
  }, "ok");

  let veredicto: string;
  if (!evo.conectado && evo.estado) {
    veredicto = "El WhatsApp Personal está desconectado de Evolution: reconecta el QR y los chats volverán a llegar.";
  } else if (!evo.conectado && evoSinLlave) {
    veredicto = "No se pudo verificar el WhatsApp Personal: falta EVOLUTION_API_KEY en Vercel (sin ella tampoco se puede enviar por el Personal desde el CRM).";
  } else if (!evo.conectado && evo.error) {
    veredicto = `No se pudo consultar Evolution: ${evo.error}`;
  } else if (!chatwootConectado) {
    veredicto = "Chatwoot no responde: revisa el servidor Contabo y las variables CHATWOOT_* de Vercel.";
  } else if (!supabaseConectado) {
    veredicto = "Supabase no responde: revisa las llaves del proyecto en Vercel.";
  } else if (hallazgos.some((h) => h.paso === "Sincronización Chatwoot → Supabase" && h.estado === "error")) {
    veredicto = "La sincronización Chatwoot → Supabase está quedándose atrás: pulsa 🔄 Chatwoot para reparar y revisa los logs en Vercel.";
  } else if (peor === "aviso") {
    veredicto = "La cadena funciona, pero hay avisos que conviene revisar (ver hallazgos).";
  } else {
    const hace = haceSegundos(sbUltimoMsgIso ?? cwUltimaIso, ahora);
    veredicto = `Cadena sana: WhatsApp Personal → Evolution → Chatwoot → Supabase al día${hace != null ? ` (último mensaje hace ${hace < 90 ? `${hace} s` : `${Math.round(hace / 60)} min`})` : ""}.`;
  }

  return {
    estado: peor as ResultadoDiagnostico["estado"],
    veredicto,
    generado_en: new Date(ahora).toISOString(),
    evolution: { url: evo.url, instancia: evo.instancia, estado: evo.estado, conectado: evo.conectado },
    chatwoot: {
      conectado: chatwootConectado,
      conversaciones: conversacionesCw.length,
      ultima_actividad: cwUltimaIso,
      ultima_actividad_hace_s: cwUltimaIso ? Math.round((ahora - Date.parse(cwUltimaIso)) / 1000) : null,
      inboxes: inboxesLista,
    },
    supabase: {
      conectado: supabaseConectado,
      ultimo_mensaje_en: sbUltimoMsgIso,
      ultimo_mensaje_hace_s: haceSegundos(sbUltimoMsgIso, ahora),
      ultima_conversacion_en: sbUltimaConvIso,
      mensajes_ultimas_2h: sbRecientes,
    },
    reloj_chatwoot_adelantado_s: relojAdelantadoS,
    hallazgos,
  };
}
