"use client";

import { Clock, AlertTriangle } from "lucide-react";
import { type EstadoVentana, duracionCorta } from "../lib/tiempo-chat";

// Paleta por urgencia: verde (holgada) → ámbar (<6 h) → naranja (<1 h) → rojo (cerrada).
const TONOS: Record<EstadoVentana["tono"], { texto: string; borde: string; fondo: string; icono: string }> = {
  ok: {
    texto: "text-emerald-300",
    borde: "border-emerald-800/60",
    fondo: "bg-emerald-950/40",
    icono: "text-emerald-400",
  },
  atencion: {
    texto: "text-amber-300",
    borde: "border-amber-800/60",
    fondo: "bg-amber-950/40",
    icono: "text-amber-400",
  },
  urgente: {
    texto: "text-orange-300",
    borde: "border-orange-800/70",
    fondo: "bg-orange-950/50",
    icono: "text-orange-400 animate-pulse",
  },
  cerrada: {
    texto: "text-red-300",
    borde: "border-red-800/70",
    fondo: "bg-red-950/40",
    icono: "text-red-400",
  },
};

/**
 * Indicador de la ventana de 24 h de WhatsApp API (WhatsApp Business / Meta).
 *
 *   variante="lista"    → chip compacto de la bandeja ("3 h 12 min")
 *   variante="cabecera" → pastilla de la cabecera del chat ("3 h 12 min para responder")
 *   variante="barra"    → texto de la barra informativa sobre el compositor
 *
 * El tooltip explica en todos los casos de dónde sale el cálculo y a qué hora
 * se cierra la ventana.
 */
export default function VentanaWhatsApp({ estado, variante = "lista" }: {
  estado: EstadoVentana;
  variante?: "lista" | "cabecera" | "barra";
}) {
  if (!estado.hayDato) return null;
  const tono = TONOS[estado.tono];
  const titulo = estado.detalle;
  const abierta = estado.abierta;

  if (variante === "lista") {
    return (
      <span
        title={titulo}
        aria-label={titulo}
        className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0 text-[9px] font-bold ${tono.fondo} ${tono.borde} ${tono.texto}`}
      >
        {abierta ? (
          <Clock className={`w-2.5 h-2.5 flex-shrink-0 ${tono.icono}`} />
        ) : (
          <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" />
        )}
        <span className="truncate">{abierta ? estado.corto : `cerrada hace ${duracionCorta(estado.cerradaHaceMs)}`}</span>
      </span>
    );
  }

  if (variante === "cabecera") {
    return (
      <span
        title={titulo}
        aria-label={titulo}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium min-w-0 ${tono.fondo} ${tono.borde} ${tono.texto}`}
    >
      {abierta ? (
        <Clock className={`w-3.5 h-3.5 flex-shrink-0 ${tono.icono}`} />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      )}
      <span className="min-w-0 truncate">
        {/* El texto largo solo en pantallas muy anchas: así la pastilla no
            empuja los botones de la cabecera fuera de la ventana del cliente. */}
        <span className="hidden 2xl:inline">{estado.largo}</span>
        <span className="2xl:hidden">{abierta ? estado.corto : "Cerrada"}</span>
      </span>
      </span>
    );
  }

  // variante === "barra"
  return (
    <span
      title={titulo}
      aria-label={titulo}
      // min-w-0 + truncate: si la columna del chat queda estrecha, este texto
      // se recorta con "…" en vez de ensanchar la ventana del cliente y sacar
      // de la pantalla el panel de la ficha.
      className={`flex items-center gap-1 text-[11px] font-semibold min-w-0 ${tono.texto}`}
    >
      {abierta ? (
        <Clock className={`w-3 h-3 flex-shrink-0 ${tono.icono}`} />
      ) : (
        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      )}
      <span className="hidden sm:inline truncate">{abierta ? `Ventana: ${estado.corto}` : estado.largo}</span>
      <span className="sm:hidden flex-shrink-0">{abierta ? estado.corto : "Cerrada"}</span>
    </span>
  );
}
