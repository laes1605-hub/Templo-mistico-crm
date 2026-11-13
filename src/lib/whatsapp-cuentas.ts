/**
 * SEGUNDO WHATSAPP PERSONAL (respaldo manual)
 * ---------------------------------------------------------------------------
 * El CRM ya trabajaba con dos canales:
 *   · WhatsApp API (Meta/Chatwoot)  → fuente = 'meta_business'
 *   · WhatsApp Personal (Evolution) → fuente = 'evolution'
 *
 * Cuando el WhatsApp Personal principal recibe demasiadas llamadas/mensajes en
 * un día, WhatsApp lo bloquea temporalmente y el operador se queda sin canal.
 * Para eso existe una SEGUNDA cuenta personal (no API), con su propio número,
 * su propia instancia de Evolution y su propia bandeja de Chatwoot. Funciona
 * exactamente igual (texto, adjuntos, notas de voz, llamadas y seguimientos de
 * Luna), pero es una opción MANUAL: el operador elige con cuál cuenta responde.
 *
 * Este módulo es puro (sin Supabase ni red) para poder importarlo desde el
 * cliente, el servidor y las pruebas.
 */

/** Cuentas por las que puede salir un mensaje. */
export type CuentaEnvio = "meta_business" | CuentaPersonal;

/** Las dos cuentas de WhatsApp Personal (Baileys / Evolution). */
export type CuentaPersonal = "personal" | "personal_2";

export const CUENTAS_PERSONALES: CuentaPersonal[] = ["personal", "personal_2"];

export const ETIQUETAS_CUENTA: Record<CuentaEnvio, string> = {
  meta_business: "WhatsApp API",
  personal: "WhatsApp 1",
  personal_2: "WhatsApp 2",
};

/** Instancia por defecto en Evolution para cada cuenta personal. */
export const INSTANCIAS_POR_DEFECTO: Record<CuentaPersonal, string> = {
  personal: "personal",
  personal_2: "personal2",
};

export function esCuentaPersonal(valor: unknown): valor is CuentaPersonal {
  return valor === "personal" || valor === "personal_2";
}

/**
 * Acepta los nombres que aparecen en el código viejo o en la configuración
 * (`evolution`, `personal`, `2`, `personal2`, `secundaria`…) y devuelve la
 * cuenta canónica, o null si no reconoce nada.
 */
export function normalizarCuentaPersonal(valor: unknown): CuentaPersonal | null {
  const v = String(valor ?? "").trim().toLowerCase();
  if (!v) return null;
  if (["personal_2", "personal2", "personal-2", "2", "dos", "segunda", "secundaria", "second"].includes(v)) {
    return "personal_2";
  }
  if (["personal", "evolution", "personal_1", "personal1", "1", "primera", "principal"].includes(v)) {
    return "personal";
  }
  return null;
}

/** Cuenta de envío a partir de cualquier valor conocido (incluye la API). */
export function normalizarCuentaEnvio(valor: unknown): CuentaEnvio | null {
  const v = String(valor ?? "").trim().toLowerCase();
  if (!v) return null;
  if (["meta_business", "meta", "api", "templo", "cloud"].includes(v)) return "meta_business";
  return normalizarCuentaPersonal(v);
}

/** Etiqueta visible. Si el operador renombró la cuenta, se respeta. */
export function etiquetaCuenta(
  cuenta: CuentaEnvio,
  etiquetas?: Partial<Record<CuentaEnvio, string>>,
): string {
  const personalizada = etiquetas?.[cuenta];
  return (personalizada && personalizada.trim()) || ETIQUETAS_CUENTA[cuenta];
}

/** Quita tildes y signos para comparar nombres de bandejas de Chatwoot. */
function normalizarTexto(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type PistasInbox = {
  /** ID de la bandeja de Chatwoot del segundo WhatsApp (config o entorno). */
  inboxIdPersonal2?: string | number | null;
  /** Nombre exacto configurado para la bandeja del segundo WhatsApp. */
  nombreBandejaPersonal2?: string | null;
};

/**
 * Deduce a qué cuenta personal pertenece una conversación de Chatwoot.
 *
 * Primero manda el ID de bandeja configurado (exacto). Si no hay ID, se usan
 * los nombres: cualquier bandeja que mencione «personal», «evolution» o
 * «maestro» es una cuenta personal; si además lleva «2», «dos», «segunda»,
 * «respaldo», «backup» o «alterna», es la cuenta de respaldo.
 */
export function cuentaDeInboxChatwoot(
  inboxId: unknown,
  nombreInbox: unknown,
  pistas: PistasInbox = {},
): CuentaPersonal {
  const configurado = String(pistas.inboxIdPersonal2 ?? "").trim();
  if (configurado && inboxId != null && String(inboxId).trim() === configurado) {
    return "personal_2";
  }

  const nombre = normalizarTexto(nombreInbox);
  const nombreConfigurado = normalizarTexto(pistas.nombreBandejaPersonal2);
  if (nombreConfigurado && nombre === nombreConfigurado) return "personal_2";

  if (/(personal|evolution|maestro|baileys)/.test(nombre)) {
    if (/(^|[^0-9])(2|dos)([^0-9]|$)|segund|secund|respaldo|backup|altern/.test(nombre)) {
      return "personal_2";
    }
    return "personal";
  }
  // Sin pistas suficientes se asume la cuenta principal (comportamiento previo).
  return "personal";
}

export type PistasInstancia = {
  instanciaPersonal?: string | null;
  instanciaPersonal2?: string | null;
};

/** Nombre de la instancia de Evolution que corresponde a cada cuenta. */
export function instanciaDeCuenta(cuenta: CuentaPersonal, pistas: PistasInstancia = {}): string {
  const elegida =
    cuenta === "personal_2"
      ? pistas.instanciaPersonal2
      : pistas.instanciaPersonal;
  const valor = String(elegida ?? "").trim();
  return valor || INSTANCIAS_POR_DEFECTO[cuenta];
}

/**
 * ¿El error de Evolution huele a bloqueo/desconexión? Sirve para que la app no
 * muestre un «error 500» crudo sino un aviso accionable: cambiar de cuenta.
 */
export function pareceErrorDeBloqueo(status: number, detalle: string): boolean {
  const texto = String(detalle || "").toLowerCase();
  if (status === 401 || status === 403 || status === 429 || status === 463) return true;
  return /banned|ban\b|blocked|bloquead|forbidden|not authorized|unauthorized|connection closed|not connected|instance .* not|session|logged ?out|restricted|spam/i.test(
    texto,
  );
}

/**
 * Mensaje de error en español cuando una cuenta personal no pudo enviar.
 * No reintenta sola (el modo es manual): explica qué hacer.
 */
export function mensajeErrorCuenta(
  cuenta: CuentaPersonal,
  status: number,
  detalle: string,
  etiquetas?: Partial<Record<CuentaEnvio, string>>,
): string {
  const nombre = etiquetaCuenta(cuenta, etiquetas);
  const otra = etiquetaCuenta(cuenta === "personal_2" ? "personal" : "personal_2", etiquetas);
  const base = `${nombre} no aceptó el mensaje (${status || "sin estado"}). ${detalle || ""}`.trim();
  if (!pareceErrorDeBloqueo(status, detalle)) return base;
  return (
    `${base}\n\n` +
    `Parece que ${nombre} está bloqueado, desconectado o limitado por WhatsApp. ` +
    `Puedes seguir atendiendo este chat desde ${otra}: en la cabecera del chat toca la cuenta ` +
    `y elige ${otra}. Revisa la sesión en Ajustes → WhatsApp Personal.`
  );
}
