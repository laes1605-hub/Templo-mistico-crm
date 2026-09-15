/**
 * Helpers de TIEMPO DEL CHAT.
 *
 *  1) Ventana de 24 h de WhatsApp API (Meta / "meta_business").
 *     Regla de Meta: la ventana de atención al cliente se cuenta desde el
 *     último mensaje que envió EL CLIENTE (no desde el nuestro). Dentro de esa
 *     ventana se puede responder con texto libre; fuera de ella la API solo
 *     acepta plantillas aprobadas.
 *
 *  2) Etiquetas de día para los divisores de fecha del historial
 *     ("Hoy", "Ayer", "lunes", "15 de septiembre", …).
 *
 * Todo lo de este archivo es puro (sin React ni Supabase) para poder probarlo
 * con `node scripts/prueba-tiempo-chat.mjs`.
 */

export const VENTANA_WHATSAPP_MS = 24 * 60 * 60 * 1000;

/** A partir de aquí el aviso pasa a ámbar y luego a rojo. */
const AVISO_ATENCION_MS = 6 * 60 * 60 * 1000; // quedan menos de 6 h
const AVISO_URGENTE_MS = 60 * 60 * 1000; // queda menos de 1 h

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export type TonoVentana = "ok" | "atencion" | "urgente" | "cerrada";

export interface EstadoVentana {
  /** false cuando todavía no hay ningún mensaje entrante (nunca escribió). */
  hayDato: boolean;
  abierta: boolean;
  /** Milisegundos que quedan de ventana (0 si ya cerró). */
  restanteMs: number;
  /** Milisegundos transcurridos desde que cerró (0 si sigue abierta). */
  cerradaHaceMs: number;
  /** Momento exacto en el que se cierra (o cerró). */
  expira: Date | null;
  tono: TonoVentana;
  /** Texto corto para chips: "3 h 12 min" o "cerrada hace 3 h". */
  corto: string;
  /** Frase completa para la cabecera del chat. */
  largo: string;
  /** Explicación para el tooltip. */
  detalle: string;
}

/** Chat del WhatsApp API (Meta). Los de WhatsApp Personal no tienen ventana. */
export function esChatWhatsAppApi(conv: any): boolean {
  return Boolean(conv && conv.fuente === "meta_business");
}

/** Momento del último mensaje que envió el cliente dentro de una lista de mensajes. */
export function ultimoEntranteDeMensajes(mensajes: any[] | null | undefined): string | null {
  let mejor = 0;
  for (const m of mensajes || []) {
    if (!m || m.tipo === "enviado") continue;
    const t = Date.parse(m.creado_en || "");
    if (Number.isFinite(t) && t > mejor) mejor = t;
  }
  return mejor > 0 ? new Date(mejor).toISOString() : null;
}

function aFecha(valor: string | number | Date | null | undefined): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === "number") return Number.isFinite(valor) ? new Date(valor) : null;
  const texto = String(valor).trim();
  if (!texto) return null;
  // Las fechas sin hora ("2026-09-15") se interpretan en hora local.
  const d = new Date(texto.length <= 10 ? `${texto}T00:00:00` : texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

function p2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Duración legible: "menos de 1 min", "12 min", "3 h 12 min", "2 días 4 h".
 * `corto` deja fuera la parte que no aporta (p. ej. "3 h" en vez de "3 h 0 min").
 */
export function duracionCorta(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return "menos de 1 min";
  const minutos = Math.floor(total / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const minRestantes = minutos % 60;
  if (horas < 24) return minRestantes > 0 ? `${horas} h ${minRestantes} min` : `${horas} h`;
  const dias = Math.floor(horas / 24);
  const hRestantes = horas % 24;
  const diasTexto = dias === 1 ? "1 día" : `${dias} días`;
  return hRestantes > 0 ? `${diasTexto} ${hRestantes} h` : diasTexto;
}

/** "15/09 a las 14:35" (con año si es de otro año). */
export function fechaHoraCorta(valor: string | number | Date | null | undefined, ahora: Date = new Date()): string {
  const d = aFecha(valor);
  if (!d) return "";
  const base = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
  const conAnio = d.getFullYear() === ahora.getFullYear() ? base : `${base}/${d.getFullYear()}`;
  return `${conAnio} a las ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/**
 * Estado de la ventana de 24 h a partir del último mensaje ENTRANTE.
 * Sin dato (`null`) devuelve `hayDato: false`: el cliente todavía no escribió.
 */
export function calcularVentana(
  ultimoEntrante: string | number | Date | null | undefined,
  ahoraMs: number = Date.now(),
): EstadoVentana {
  const entrada = aFecha(ultimoEntrante);
  if (!entrada) {
    return {
      hayDato: false,
      abierta: false,
      restanteMs: 0,
      cerradaHaceMs: 0,
      expira: null,
      tono: "cerrada",
      corto: "sin mensajes del cliente",
      largo: "Sin mensajes del cliente",
      detalle: "El cliente todavía no ha escrito: la ventana de 24 h empieza con su primer mensaje.",
    };
  }

  const expira = new Date(entrada.getTime() + VENTANA_WHATSAPP_MS);
  const restanteMs = expira.getTime() - ahoraMs;
  const abierta = restanteMs > 0;

  if (abierta) {
    const tono: TonoVentana =
      restanteMs <= AVISO_URGENTE_MS ? "urgente" : restanteMs <= AVISO_ATENCION_MS ? "atencion" : "ok";
    const queda = duracionCorta(restanteMs);
    return {
      hayDato: true,
      abierta: true,
      restanteMs,
      cerradaHaceMs: 0,
      expira,
      tono,
      corto: queda,
      largo: `${queda} para responder`,
      detalle:
        `Puedes responder con texto libre hasta las ${p2(expira.getHours())}:${p2(expira.getMinutes())} ` +
        `(el cliente escribió el ${fechaHoraCorta(entrada, new Date(ahoraMs))}). ` +
        `Después WhatsApp API solo acepta plantillas aprobadas.`,
    };
  }

  const cerradaHaceMs = -restanteMs;
  const hace = duracionCorta(cerradaHaceMs);
  return {
    hayDato: true,
    abierta: false,
    restanteMs: 0,
    cerradaHaceMs,
    expira,
    tono: "cerrada",
    corto: `cerrada hace ${hace}`,
    largo: `Ventana cerrada hace ${hace}`,
    detalle:
      `La ventana se cerró el ${fechaHoraCorta(expira, new Date(ahoraMs))} (último mensaje del cliente: ` +
      `${fechaHoraCorta(entrada, new Date(ahoraMs))}). WhatsApp API puede rechazar un mensaje libre: se necesita una plantilla aprobada.`,
  };
}

// ---------------------------------------------------------------------------
// Divisores de fecha del historial
// ---------------------------------------------------------------------------

/** Clave comparable de día local (2026-09-15) para saber dónde cambia la fecha. */
export function claveDia(valor: string | number | Date | null | undefined): string {
  const d = aFecha(valor);
  if (!d) return "";
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function inicioDelDia(d: Date): number {
  const copia = new Date(d);
  copia.setHours(0, 0, 0, 0);
  return copia.getTime();
}

function capitalizar(texto: string): string {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

/**
 * Etiqueta del divisor de fecha, estilo WhatsApp:
 * "Hoy" · "Ayer" · "Lunes" (últimos 7 días) · "15 de septiembre" (mismo año) ·
 * "15 de septiembre de 2025" (otro año).
 */
export function etiquetaDia(valor: string | number | Date | null | undefined, ahora: Date = new Date()): string {
  const d = aFecha(valor);
  if (!d) return "";
  const dias = Math.round((inicioDelDia(ahora) - inicioDelDia(d)) / 86_400_000);
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "Ayer";
  if (dias < 7) return capitalizar(DIAS_SEMANA[d.getDay()]);
  const base = `${d.getDate()} de ${MESES[d.getMonth()]}`;
  return d.getFullYear() === ahora.getFullYear() ? base : `${base} de ${d.getFullYear()}`;
}

/** Fecha larga para el tooltip del divisor: "lunes, 15 de septiembre de 2025". */
export function fechaCompletaDia(valor: string | number | Date | null | undefined): string {
  const d = aFecha(valor);
  if (!d) return "";
  return `${DIAS_SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** "14:35" — hora corta local, con el idioma fijado para no variar entre equipos. */
export function horaCorta(valor: string | number | Date | null | undefined): string {
  const d = aFecha(valor);
  if (!d) return "";
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
