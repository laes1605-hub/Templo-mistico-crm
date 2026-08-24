-- ============================================================================
-- 📩 MENSAJES NO LEÍDOS + CLIENTES ATENDIDOS + SPAM COMO PIPELINE NEGRO
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- 1. Conversaciones: contador de mensajes no leídos (no_leidos) que SOLO se
--    limpia cuando el operador abre/revisa el chat (no cuando responde la agente).
-- 2. Clientes: columna atendido (pasó por la etapa "Consulta Hecha" alguna vez).
--    El contador de "Clientes atendidos" se mantiene aunque salga del pipeline.
-- 3. Spam: etapa del pipeline fija de color negro, no editable, no eliminable,
--    sin agente ni recordatorios.
-- ============================================================================

-- 1. CONTADOR DE MENSAJES NO LEÍDOS POR CONVERSACIÓN
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='no_leidos') THEN
    ALTER TABLE public.conversaciones ADD COLUMN no_leidos integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='ultimo_leido_en') THEN
    ALTER TABLE public.conversaciones ADD COLUMN ultimo_leido_en timestamptz;
  END IF;
END $$;

-- Nada queda como "no leído" retroactivamente: lo anterior ya fue revisado
UPDATE public.conversaciones SET ultimo_leido_en = now() WHERE ultimo_leido_en IS NULL;

CREATE INDEX IF NOT EXISTS mensajes_no_leidos_idx ON public.mensajes (conversacion_id, tipo, creado_en);

-- RPC: marcar una conversación como leída (solo el operador la limpia al revisar)
CREATE OR REPLACE FUNCTION public.marcar_leido(p_conv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversaciones
  SET no_leidos = 0, ultimo_leido_en = now()
  WHERE id = p_conv_id;
END $$;

-- RPC: recalcular no_leidos desde la tabla de mensajes
-- (cubre mensajes que llegaron con la app cerrada; la respuesta de la agente
--  es tipo 'enviado', no cuenta y NO limpia lo pendiente por revisar)
CREATE OR REPLACE FUNCTION public.sincronizar_no_leidos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversaciones c
  SET no_leidos = (
    SELECT count(*)::int
    FROM public.mensajes m
    WHERE m.conversacion_id = c.id
      AND m.tipo <> 'enviado'
      AND m.creado_en > COALESCE(c.ultimo_leido_en, '1970-01-01'::timestamptz)
  );
END $$;

-- 2. CLIENTES ATENDIDOS (pasaron por la etapa "Consulta Hecha" alguna vez)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='atendido') THEN
    ALTER TABLE public.clientes ADD COLUMN atendido boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Backfill: los que ya pasaron por consulta_hecha (o están más allá) cuentan
UPDATE public.clientes
SET atendido = true
WHERE estado IN (
  'consulta_hecha', 'consulta_hecha_templo',
  'pago_recibido', 'pago_recibido_templo',
  'trabajo_proceso', 'trabajo_proceso_templo',
  'trabajo_completado', 'trabajo_completado_templo'
);

-- Trigger: al pasar a "Consulta Hecha" queda atendido para siempre,
-- aunque después salga del pipeline (perdido, abandonado, etc.)
CREATE OR REPLACE FUNCTION public.marcar_atendido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado LIKE 'consulta_hecha%' THEN
    NEW.atendido := true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clientes_atendido ON public.clientes;
CREATE TRIGGER trg_clientes_atendido
  BEFORE INSERT OR UPDATE OF estado ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.marcar_atendido();

-- 3. SPAM COMO PIPELINE FIJO DE COLOR NEGRO (no editable, no eliminable)
--    El CRM ya no permite editar ni eliminar etapas con es_spam = true.
UPDATE public.pipeline_etapas
SET color = 'border-black', bg_color = 'bg-black/40', text_color = 'text-gray-300'
WHERE es_spam = true;
