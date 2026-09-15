"use client";

import { CalendarDays } from "lucide-react";
import { etiquetaDia, fechaCompletaDia } from "../lib/tiempo-chat";

/**
 * Divisor de día del historial (estilo WhatsApp): una línea horizontal con la
 * fecha centrada y, debajo, el chat sigue como siempre. La app lo dibuja solo
 * cuando el mensaje cambia de día respecto al anterior.
 *
 * Textos: "Hoy" · "Ayer" · "Lunes" (últimos 7 días) · "15 de septiembre" ·
 * "15 de septiembre de 2025". El tooltip lleva la fecha larga completa.
 */
export default function DivisorFecha({ fecha }: { fecha: string | number | Date | null | undefined }) {
  const etiqueta = etiquetaDia(fecha);
  const titulo = fechaCompletaDia(fecha);
  if (!etiqueta) return null;
  return (
    <div
      role="separator"
      aria-label={titulo || etiqueta}
      title={titulo || etiqueta}
      className="flex items-center gap-3 py-1 select-none"
    >
      <span className="h-px flex-1 bg-border/70" />
      <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        <CalendarDays className="w-3 h-3 flex-shrink-0 text-purple-400" />
        {etiqueta}
      </span>
      <span className="h-px flex-1 bg-border/70" />
    </div>
  );
}
