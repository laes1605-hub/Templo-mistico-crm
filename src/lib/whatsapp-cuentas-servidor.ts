/**
 * Configuración y estado de las cuentas de WhatsApp Personal (servidor).
 *
 * La fuente de la verdad es la tabla `config_general` (claves que empiezan por
 * `whatsapp_personal`), con variables de entorno como respaldo para los datos
 * sensibles/de infraestructura:
 *
 *   · instancia de Evolution de cada cuenta
 *   · número visible de cada cuenta
 *   · bandeja de Chatwoot del segundo WhatsApp
 *   · cuál es la cuenta activa (elección MANUAL del operador)
 *
 * Este módulo sólo se usa en route handlers (server). El cliente consume los
 * tipos puros de ./whatsapp-cuentas y la API /api/whatsapp-cuentas.
 */

import { supabaseAdmin } from "./supabase-admin";
import {
  CuentaPersonal,
  ETIQUETAS_CUENTA,
  INSTANCIAS_POR_DEFECTO,
  instanciaDeCuenta,
} from "./whatsapp-cuentas";

export const CLAVES_CONFIG = {
  activa: "whatsapp_personal_activo",
  numero1: "whatsapp_personal_numero",
  etiqueta1: "whatsapp_personal_etiqueta",
  numero2: "whatsapp_personal2_numero",
  etiqueta2: "whatsapp_personal2_etiqueta",
  instancia1: "whatsapp_personal_instancia",
  instancia2: "whatsapp_personal2_instancia",
  inbox2: "whatsapp_personal2_inbox_id",
} as const;

export type ConfigCuentaPersonal = {
  cuenta: CuentaPersonal;
  etiqueta: string;
  /** Número visible (sólo informativo; el envío lo resuelve Evolution). */
  numero: string;
  instancia: string;
  /** Bandeja de Chatwoot: sin ella no entran los mensajes de esa cuenta. */
  inboxId: string;
  /** true cuando la cuenta tiene datos suficientes para usarse. */
  configurada: boolean;
};

export type ConfigWhatsAppPersonal = {
  /** Cuenta personal elegida por el operador. */
  activa: CuentaPersonal;
  personal: ConfigCuentaPersonal;
  personal2: ConfigCuentaPersonal;
  etiquetas: Record<CuentaPersonal, string>;
};

const LIMPIO = (valor: unknown) => String(valor ?? "").trim();

export function evolutionConfig(): { url: string; key: string } {
  return {
    // DuckDNS no admite puntos en el subdominio: el host viejo
    // evo.crmesteban ya no existe (es evo-crmesteban).
    url: (process.env.EVOLUTION_API_URL || "https://evo-crmesteban.duckdns.org").replace(/\/$/, ""),
    key: (process.env.EVOLUTION_API_KEY || "").trim(),
  };
}

/** Lee las claves de configuración (una sola consulta). */
async function leerConfig(): Promise<Record<string, string>> {
  const claves = Object.values(CLAVES_CONFIG);
  const salida: Record<string, string> = {};
  try {
    const { data } = await supabaseAdmin
      .from("config_general")
      .select("clave, valor")
      .in("clave", claves);
    (data || []).forEach((fila: any) => {
      salida[fila.clave] = LIMPIO(fila.valor);
    });
  } catch (e: any) {
    console.warn("[whatsapp-cuentas] No se pudo leer config_general:", e?.message || e);
  }
  return salida;
}

export async function cargarConfigWhatsAppPersonal(): Promise<ConfigWhatsAppPersonal> {
  const filas = await leerConfig();

  const instancia1 = LIMPIO(
    process.env.EVOLUTION_INSTANCE || filas[CLAVES_CONFIG.instancia1] || INSTANCIAS_POR_DEFECTO.personal,
  );
  const instancia2 = LIMPIO(
    process.env.EVOLUTION_INSTANCE_PERSONAL2 ||
      filas[CLAVES_CONFIG.instancia2] ||
      INSTANCIAS_POR_DEFECTO.personal_2,
  );
  const numero1 = LIMPIO(filas[CLAVES_CONFIG.numero1] || process.env.WHATSAPP_PERSONAL_NUMERO);
  const numero2 = LIMPIO(filas[CLAVES_CONFIG.numero2] || process.env.WHATSAPP_PERSONAL2_NUMERO);
  const inbox2 = LIMPIO(
    filas[CLAVES_CONFIG.inbox2] || process.env.CHATWOOT_INBOX_PERSONAL2_ID,
  );
  const etiqueta1 = LIMPIO(filas[CLAVES_CONFIG.etiqueta1]) || ETIQUETAS_CUENTA.personal;
  const etiqueta2 = LIMPIO(filas[CLAVES_CONFIG.etiqueta2]) || ETIQUETAS_CUENTA.personal_2;

  const activaCruda = LIMPIO(filas[CLAVES_CONFIG.activa]).toLowerCase();
  const activa: CuentaPersonal = activaCruda === "personal_2" ? "personal_2" : "personal";

  return {
    activa,
    personal: {
      cuenta: "personal",
      etiqueta: etiqueta1,
      numero: numero1,
      instancia: instancia1,
      inboxId: "",
      configurada: true,
    },
    personal2: {
      cuenta: "personal_2",
      etiqueta: etiqueta2,
      numero: numero2,
      instancia: instancia2,
      inboxId: inbox2,
      configurada: Boolean(numero2 || inbox2),
    },
    etiquetas: { personal: etiqueta1, personal_2: etiqueta2 },
  };
}

/** Instancias de Evolution resueltas (env tiene prioridad sobre config). */
export async function instanciasEvolution(cfg?: ConfigWhatsAppPersonal) {
  const config = cfg || (await cargarConfigWhatsAppPersonal());
  return {
    personal: instanciaDeCuenta("personal", {
      instanciaPersonal: config.personal.instancia,
      instanciaPersonal2: config.personal2.instancia,
    }),
    personal_2: instanciaDeCuenta("personal_2", {
      instanciaPersonal: config.personal.instancia,
      instanciaPersonal2: config.personal2.instancia,
    }),
  };
}

export type EstadoCuenta = {
  cuenta: CuentaPersonal;
  etiqueta: string;
  numero: string;
  instancia: string;
  inboxId: string;
  configurada: boolean;
  /** null = no se pudo determinar (sin llave, red, versión de Evolution…). */
  conectado: boolean | null;
  estado: string | null;
  /** Número que reporta Evolution (ownerJid), si está disponible. */
  numeroEvolution: string | null;
  detalle: string | null;
  activa: boolean;
};

const fetchConTiempo = async (url: string, init: RequestInit = {}, ms = 4500) => {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controlador.signal });
  } finally {
    clearTimeout(temporizador);
  }
};

function numeroDeJid(jid: unknown): string | null {
  const texto = String(jid || "");
  const digitos = texto.split("@")[0].replace(/\D/g, "");
  return digitos.length >= 8 ? digitos : null;
}

/**
 * Consulta `/instance/connectionState/{instancia}` y, si se puede, el dueño de
 * la instancia. Nunca lanza: devuelve el detalle del fallo.
 */
export async function estadoCuentaEvolution(
  instancia: string,
): Promise<{ conectado: boolean | null; estado: string | null; numeroEvolution: string | null; detalle: string | null }> {
  const { url, key } = evolutionConfig();
  if (!key) {
    return {
      conectado: null,
      estado: null,
      numeroEvolution: null,
      detalle: "Falta EVOLUTION_API_KEY en el servidor. Sin ella no se puede consultar ni enviar por WhatsApp Personal.",
    };
  }
  const cabeceras = { apikey: key };
  let estado: string | null = null;
  let detalle: string | null = null;

  const rutas = [`/instance/connectionState/${encodeURIComponent(instancia)}`];
  for (const ruta of rutas) {
    try {
      const respuesta = await fetchConTiempo(`${url}${ruta}`, { headers: cabeceras });
      const texto = await respuesta.text();
      let json: any = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        json = null;
      }
      const bruto = String(json?.instance?.state || json?.state || json?.status || "").trim();
      if (bruto) estado = bruto.toLowerCase();
      if (!respuesta.ok) {
        detalle = `Evolution respondió ${respuesta.status}: ${texto.replace(/\s+/g, " ").slice(0, 200)}`;
      }
    } catch (e: any) {
      detalle = e?.name === "AbortError" ? "Evolution no respondió (tiempo de espera agotado)." : e?.message || "error de red";
    }
  }

  // Dueño de la instancia (para mostrar el número real, si Evolution lo expone).
  let numeroEvolution: string | null = null;
  try {
    const respuesta = await fetchConTiempo(
      `${url}/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`,
      { headers: cabeceras },
      3000,
    );
    if (respuesta.ok) {
      const json: any = await respuesta.json().catch(() => null);
      const lista = Array.isArray(json) ? json : json?.instance ? [json.instance] : [];
      const fila: any = lista[0] || {};
      numeroEvolution =
        numeroDeJid(fila?.ownerJid) ||
        numeroDeJid(fila?.owner) ||
        numeroDeJid(fila?.instance?.ownerJid) ||
        numeroDeJid(fila?.instance?.owner) ||
        null;
      if (!estado) {
        const bruto = String(fila?.connectionStatus || fila?.instance?.state || "").toLowerCase();
        if (bruto) estado = bruto;
      }
    }
  } catch {
    /* informativo: no bloquea el estado */
  }

  // Sin estado pero con un fallo explícito (404, red, instancia inexistente) se
  // informa «desconectado»: es más útil que dejarlo en «sin verificar».
  const conectado = estado
    ? estado.includes("open") || estado.includes("connected")
    : detalle
      ? false
      : null;
  if (!estado && !detalle) detalle = "Evolution devolvió un estado vacío.";
  if (estado && !conectado) {
    detalle =
      `La instancia «${instancia}» está en estado «${estado}» (debe ser «open»). ` +
      "Escanea el QR con la cuenta correcta para reconectarla.";
  }
  return { conectado, estado, numeroEvolution, detalle };
}

export async function estadoCuentasPersonales(cfg?: ConfigWhatsAppPersonal): Promise<EstadoCuenta[]> {
  const config = cfg || (await cargarConfigWhatsAppPersonal());
  const cuentas: ConfigCuentaPersonal[] = [config.personal, config.personal2];
  // En paralelo: la pantalla no debe esperar dos veces por Evolution.
  const estados = await Promise.all(cuentas.map((cuenta) => estadoCuentaEvolution(cuenta.instancia)));
  return cuentas.map((cuenta, indice) => ({
    ...cuenta,
    ...estados[indice],
    activa: config.activa === cuenta.cuenta,
  }));
}

export type CambiosConfig = {
  activa?: CuentaPersonal;
  numero1?: string;
  etiqueta1?: string;
  numero2?: string;
  etiqueta2?: string;
  instancia2?: string;
  inbox2?: string;
  instancia1?: string;
};

/** Guarda sólo las claves enviadas (upsert en config_general). */
export async function guardarConfigWhatsAppPersonal(
  cambios: CambiosConfig,
): Promise<{ ok: boolean; error?: string; config?: ConfigWhatsAppPersonal }> {
  const filas: Array<{ clave: string; valor: string; actualizado_en: string }> = [];
  const ahora = new Date().toISOString();
  const agregar = (clave: string, valor: string | undefined) => {
    if (valor === undefined) return;
    filas.push({ clave, valor: String(valor), actualizado_en: ahora });
  };

  agregar(CLAVES_CONFIG.activa, cambios.activa);
  agregar(CLAVES_CONFIG.numero1, cambios.numero1);
  agregar(CLAVES_CONFIG.etiqueta1, cambios.etiqueta1);
  agregar(CLAVES_CONFIG.numero2, cambios.numero2);
  agregar(CLAVES_CONFIG.etiqueta2, cambios.etiqueta2);
  agregar(CLAVES_CONFIG.instancia1, cambios.instancia1);
  agregar(CLAVES_CONFIG.instancia2, cambios.instancia2);
  agregar(CLAVES_CONFIG.inbox2, cambios.inbox2);

  if (!filas.length) {
    return { ok: true, config: await cargarConfigWhatsAppPersonal() };
  }

  try {
    const { error } = await supabaseAdmin.from("config_general").upsert(filas);
    if (error) return { ok: false, error: error.message };
  } catch (e: any) {
    return { ok: false, error: e?.message || "No se pudo guardar la configuración." };
  }
  return { ok: true, config: await cargarConfigWhatsAppPersonal() };
}

/**
 * Resuelve por qué cuenta personal debe salir un mensaje.
 *
 * Orden (modo manual):
 *   1. lo que pida el operador para ESTE envío (`solicitada`)
 *   2. la cuenta guardada en la conversación (la que atendió el chat)
 *   3. la cuenta activa elegida en el CRM
 */
export async function resolverCuentaPersonal(opts: {
  solicitada?: unknown;
  cuentaConversacion?: unknown;
  cfg?: ConfigWhatsAppPersonal;
  /** Si la cuenta elegida no está configurada, se cae a la principal. */
}): Promise<{ cuenta: CuentaPersonal; cfg: ConfigWhatsAppPersonal; instancia: string }> {
  const cfg = opts.cfg || (await cargarConfigWhatsAppPersonal());
  const normalizar = (valor: unknown): CuentaPersonal | null => {
    const v = String(valor ?? "").trim().toLowerCase();
    if (v === "personal_2" || v === "personal2") return "personal_2";
    if (v === "personal" || v === "evolution") return "personal";
    return null;
  };

  let cuenta = normalizar(opts.solicitada) || normalizar(opts.cuentaConversacion) || cfg.activa;
  if (cuenta === "personal_2" && !cfg.personal2.configurada) cuenta = "personal";
  const instancia = instanciaDeCuenta(cuenta, {
    instanciaPersonal: cfg.personal.instancia,
    instanciaPersonal2: cfg.personal2.instancia,
  });
  return { cuenta, cfg, instancia };
}
