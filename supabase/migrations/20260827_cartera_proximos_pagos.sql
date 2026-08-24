-- ============================================================================
-- 💰 CARTERA POR COBRAR — Control de Próximos Pagos
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Qué hace:
--   1. Índices para que la cartera (control de próximos pagos) cargue rápido.
--   2. Documenta el estado 'cancelado' en public.pagos (pago eliminado de la
--      cartera por abandono, sin borrar el registro).
--   3. Vista v_cartera_por_cobrar con el cálculo de pendiente por cliente.
-- ============================================================================

-- 1. ÍNDICES DE CARTERA
-- Consultas típicas de la cartera: pagos pendientes ordenados por fecha.
CREATE INDEX IF NOT EXISTS pagos_estado_fecha_idx ON public.pagos (estado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS pagos_cliente_estado_idx ON public.pagos (cliente_id, estado);

-- 2. DOCUMENTAR EL ESTADO 'cancelado' (opcional pero útil para auditoría)
COMMENT ON COLUMN public.pagos.estado IS
  'Estado del pago: pendiente (por cobrar) | pagado (cobrado) | cancelado (eliminado de la cartera por abandono)';

-- 3. VISTA: CARTERA REAL POR COBRAR (por cliente)
-- Total pendiente en COP (ya convertido), próximo pago y días de vencimiento.
CREATE OR REPLACE VIEW public.v_cartera_por_cobrar AS
SELECT
  c.id AS cliente_id,
  c.nombre,
  c.telefono_display,
  c.grupo,
  -- Total del servicio: suma de pagos no cancelados convertidos a COP
  COALESCE(SUM(CASE WHEN p.estado <> 'cancelado' THEN COALESCE(p.monto_convertido_cop, p.monto) END), 0) AS total_servicio_cop,
  -- Total pendiente: suma de pagos pendientes convertidos a COP
  COALESCE(SUM(CASE WHEN p.estado = 'pendiente' THEN COALESCE(p.monto_convertido_cop, p.monto) END), 0) AS total_pendiente_cop,
  -- Próximo pago (el pendiente más antiguo)
  MIN(CASE WHEN p.estado = 'pendiente' THEN p.fecha_vencimiento END) AS proximo_pago_fecha,
  -- Días hasta el próximo pago (negativo = vencido)
  (MIN(CASE WHEN p.estado = 'pendiente' THEN p.fecha_vencimiento END) - CURRENT_DATE) AS dias_para_pago,
  COUNT(*) FILTER (WHERE p.estado = 'pendiente') AS pagos_pendientes,
  COUNT(*) FILTER (WHERE p.estado = 'pagado') AS pagos_pagados
FROM public.clientes c
LEFT JOIN public.pagos p ON p.cliente_id = c.id
WHERE c.es_spam IS NOT TRUE
GROUP BY c.id, c.nombre, c.telefono_display, c.grupo
HAVING COUNT(*) FILTER (WHERE p.estado = 'pendiente') > 0
ORDER BY MIN(CASE WHEN p.estado = 'pendiente' THEN p.fecha_vencimiento END) ASC NULLS LAST;

COMMENT ON VIEW public.v_cartera_por_cobrar IS
  'Cartera real por cobrar: clientes con al menos un pago pendiente, total pendiente en COP, próximo pago y días de vencimiento (negativo = vencido).';
