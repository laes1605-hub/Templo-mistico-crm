-- ============================================================================
-- FECHA DE ENTRADA A LA ETAPA · recordatorios de «No contesta»
-- ----------------------------------------------------------------------------
-- El recordatorio de «No contesta» cuenta desde que el chat ENTRA a esa etapa
-- (normalmente después de una llamada sin respuesta), no desde el último
-- mensaje del cliente. Para eso el CRM necesita guardar ese momento: esta
-- migración agrega `clientes.estado_desde` y un trigger que lo actualiza cada
-- vez que cambia la etapa del cliente.
--
-- Córrela UNA vez en Supabase (SQL Editor) o con `supabase db push`.
-- Es idempotente: se puede correr las veces que sea sin romper nada.
-- ============================================================================

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS estado_desde timestamptz;

COMMENT ON COLUMN public.clientes.estado_desde IS
  'Momento en el que el cliente entró en su etapa actual (lo mantiene el trigger trg_marcar_estado_desde). Base del tiempo sin contestar de la etapa «No contesta».';

-- Relleno inicial: los clientes que ya existen toman la fecha de su último
-- mensaje por el WhatsApp API (o la fecha de alta si nunca escribió), así los
-- recordatorios que ya estaban contando no cambian de golpe.
UPDATE public.clientes c
SET estado_desde = COALESCE(
  (SELECT max(conv.ultimo_entrante_api_en) FROM public.conversaciones conv WHERE conv.cliente_id = c.id),
  c.creado_en,
  now()
)
WHERE c.estado_desde IS NULL;

CREATE OR REPLACE FUNCTION public.marcar_estado_desde()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.estado_desde := COALESCE(NEW.estado_desde, now());
  ELSIF NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.estado_desde := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_marcar_estado_desde ON public.clientes;
CREATE TRIGGER trg_marcar_estado_desde
BEFORE INSERT OR UPDATE ON public.clientes
FOR EACH ROW EXECUTE FUNCTION public.marcar_estado_desde();

-- Comprobación rápida (opcional):
--   SELECT nombre, estado, estado_desde FROM public.clientes
--    WHERE estado = 'etapa_templo_1787618330816' ORDER BY estado_desde DESC LIMIT 10;
