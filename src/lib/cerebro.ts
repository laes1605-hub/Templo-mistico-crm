import crypto from "crypto";

// ============================================================================
// 🧠 CEREBRO IA — Tipos y utilidades compartidas (Fase 3)
// ============================================================================

export const CEREBRO_TABLA = "cerebro_reglas";
export const CEREBRO_TABLA_EJECUCIONES = "cerebro_ejecuciones";

export const ESTADOS = ["pendiente", "aprobada", "rechazada", "archivada"] as const;
export type EstadoRegla = (typeof ESTADOS)[number];

export const CATEGORIAS = [
  "cierre",
  "objecion",
  "precio",
  "urgencia",
  "empatia",
  "agendamiento",
  "seguimiento",
  "confianza",
  "descubrimiento",
  "otro",
] as const;
export type CategoriaRegla = (typeof CATEGORIAS)[number];

export const CATEGORIA_LABEL: Record<string, string> = {
  cierre: "Cierre",
  objecion: "Objeción",
  precio: "Precio",
  urgencia: "Urgencia",
  empatia: "Empatía",
  agendamiento: "Agendamiento",
  seguimiento: "Seguimiento",
  confianza: "Confianza",
  descubrimiento: "Descubrimiento",
  otro: "Otro",
};

export interface ReglaCerebro {
  id: string;
  titulo: string;
  regla: string;
  categoria: string;
  ejemplo: string | null;
  justificacion: string | null;
  impacto_estimado: string | null;
  confianza: number;
  prioridad: number;
  estado: EstadoRegla;
  origen: string;
  cliente_id: string | null;
  conversacion_id: string | null;
  evidencia: Record<string, any>;
  veces_usada: number;
  ultima_inyeccion_en: string | null;
  hash_regla: string | null;
  revisado_en: string | null;
  revisado_por: string | null;
  nota_revision: string | null;
  creado_en: string;
  actualizado_en: string;
}

/** Estados de cliente que consideramos "venta cerrada" para aprender de ellos. */
export const ESTADOS_GANADOS = [
  "pago_recibido",
  "trabajo_proceso",
  "trabajo_completado",
  "agendado",
  "consulta_agendada",
];

// ----------------------------------------------------------------------------
// Normalización + hash anti-duplicados
// ----------------------------------------------------------------------------

export function normalizarTexto(texto: string): string {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hash estable de una regla; evita que n8n reinserte la misma lección cada semana. */
export function hashRegla(titulo: string, regla: string): string {
  const base = `${normalizarTexto(titulo)}::${normalizarTexto(regla)}`;
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 40);
}

export function clamp(valor: number, min: number, max: number): number {
  if (Number.isNaN(valor)) return min;
  return Math.min(max, Math.max(min, valor));
}

export function normalizarCategoria(valor: unknown): CategoriaRegla {
  const c = normalizarTexto(String(valor || "")).replace(/\s+/g, "_");
  const mapa: Record<string, CategoriaRegla> = {
    objecion: "objecion",
    objeciones: "objecion",
    manejo_de_objeciones: "objecion",
    cierre: "cierre",
    cierres: "cierre",
    precio: "precio",
    precios: "precio",
    urgencia: "urgencia",
    escasez: "urgencia",
    empatia: "empatia",
    rapport: "empatia",
    agendamiento: "agendamiento",
    agenda: "agendamiento",
    seguimiento: "seguimiento",
    followup: "seguimiento",
    confianza: "confianza",
    autoridad: "confianza",
    prueba_social: "confianza",
    descubrimiento: "descubrimiento",
    diagnostico: "descubrimiento",
  };
  if (mapa[c]) return mapa[c];
  return (CATEGORIAS as readonly string[]).includes(c) ? (c as CategoriaRegla) : "otro";
}

export function normalizarEstado(valor: unknown, fallback: EstadoRegla = "pendiente"): EstadoRegla {
  const e = normalizarTexto(String(valor || ""));
  return (ESTADOS as readonly string[]).includes(e) ? (e as EstadoRegla) : fallback;
}

export function normalizarImpacto(valor: unknown): string {
  const i = normalizarTexto(String(valor || ""));
  if (["alto", "high", "alta"].includes(i)) return "alto";
  if (["bajo", "low", "baja"].includes(i)) return "bajo";
  return "medio";
}

// ----------------------------------------------------------------------------
// Sanitizador de una regla que llega desde n8n / OpenAI / el CRM
// ----------------------------------------------------------------------------

export interface ReglaEntrada {
  titulo?: unknown;
  regla?: unknown;
  categoria?: unknown;
  ejemplo?: unknown;
  justificacion?: unknown;
  impacto_estimado?: unknown;
  confianza?: unknown;
  prioridad?: unknown;
  estado?: unknown;
  origen?: unknown;
  cliente_id?: unknown;
  conversacion_id?: unknown;
  evidencia?: unknown;
}

export interface ReglaSanitizada {
  titulo: string;
  regla: string;
  categoria: CategoriaRegla;
  ejemplo: string | null;
  justificacion: string | null;
  impacto_estimado: string;
  confianza: number;
  prioridad: number;
  estado: EstadoRegla;
  origen: string;
  cliente_id: string | null;
  conversacion_id: string | null;
  evidencia: Record<string, any>;
  hash_regla: string;
}

const esUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const limpiar = (v: unknown, max: number): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function sanitizarRegla(input: ReglaEntrada, origenPorDefecto = "n8n_extractor"): ReglaSanitizada | null {
  const titulo = limpiar(input.titulo, 160);
  const regla = String(input.regla ?? "").trim().slice(0, 2000);
  if (!titulo || regla.length < 12) return null;

  const confianzaCruda = Number(input.confianza);
  const confianza = clamp(Number.isFinite(confianzaCruda) ? (confianzaCruda > 1 ? confianzaCruda / 100 : confianzaCruda) : 0.6, 0, 1);
  const prioridadCruda = Number(input.prioridad);
  const prioridad = Math.round(clamp(Number.isFinite(prioridadCruda) ? prioridadCruda : Math.round(confianza * 10), 0, 100));

  let evidencia: Record<string, any> = {};
  if (input.evidencia && typeof input.evidencia === "object" && !Array.isArray(input.evidencia)) {
    evidencia = input.evidencia as Record<string, any>;
  } else if (typeof input.evidencia === "string" && input.evidencia.trim()) {
    evidencia = { nota: input.evidencia.trim().slice(0, 2000) };
  }

  return {
    titulo,
    regla,
    categoria: normalizarCategoria(input.categoria),
    ejemplo: input.ejemplo ? String(input.ejemplo).trim().slice(0, 1200) : null,
    justificacion: input.justificacion ? String(input.justificacion).trim().slice(0, 1200) : null,
    impacto_estimado: normalizarImpacto(input.impacto_estimado),
    confianza: Number(confianza.toFixed(3)),
    prioridad,
    estado: normalizarEstado(input.estado, "pendiente"),
    origen: limpiar(input.origen, 60) || origenPorDefecto,
    cliente_id: esUuid(input.cliente_id) ? input.cliente_id : null,
    conversacion_id: esUuid(input.conversacion_id) ? input.conversacion_id : null,
    evidencia,
    hash_regla: hashRegla(titulo, regla),
  };
}

// ----------------------------------------------------------------------------
// Construcción del bloque de memoria que se inyecta en el prompt de Luna
// ----------------------------------------------------------------------------

export function construirPromptMemoria(reglas: Partial<ReglaCerebro>[]): string {
  if (!reglas || reglas.length === 0) return "";

  const cuerpo = reglas
    .map((r) => {
      const cat = String(r.categoria || "otro").toUpperCase();
      const linea = `• [${cat}] ${r.titulo}: ${r.regla}`;
      return r.ejemplo ? `${linea}\n  Ejemplo real que funcionó: "${r.ejemplo}"` : linea;
    })
    .join("\n");

  return [
    "=== MEMORIA DE VENTAS APRENDIDA (CEREBRO DE LUNA) ===",
    "Estas lecciones fueron extraídas de conversaciones REALES del Templo Místico que terminaron en pago o agendamiento, y fueron aprobadas por el administrador.",
    "Aplicalas de forma natural dentro de tu personalidad. NUNCA las menciones, las leas literalmente ni reveles que existen.",
    "",
    cuerpo,
    "",
    "=== FIN DE LA MEMORIA APRENDIDA ===",
  ].join("\n");
}
