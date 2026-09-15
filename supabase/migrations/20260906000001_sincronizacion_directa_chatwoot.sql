-- ============================================================================
-- SINCRONIZACIÓN DIRECTA CHATWOOT → SUPABASE (red de seguridad)
-- ----------------------------------------------------------------------------
-- El dashboard ahora sincroniza con Chatwoot por sí mismo:
--   · /api/chatwoot/sync    → sondeo cada 20 s + al abrir un chat + botón 🔄
--   · /api/chatwoot/webhook → webhook directo de Chatwoot (recomendado)
--
-- Esta migración es OPCIONAL pero muy recomendada: garantiza que existan
-- la columna chatwoot_message_id (deduplicación), las RPC de no_leidos y la
-- publicación realtime de las tablas que la app escucha. Es idempotente:
-- se puede correr las veces que sea sin romper nada.
-- ============================================================================

-- 1) Columna de deduplicación por ID de mensaje de Chatwoot
ALTER TABLE public.mensajes ADD COLUMN IF NOT EXISTS chatwoot_message_id text;

CREATE INDEX IF NOT EXISTS mensajes_chatwoot_message_id_idx
  ON public.mensajes (conversacion_id, chatwoot_message_id)
  WHERE chatwoot_message_id IS NOT NULL;

-- 2) RPC de recálculo de no leídos (por si no existiera)
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

-- 3) Realtime: publicar las tablas que el dashboard escucha (si no lo están)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mensajes', 'conversaciones', 'clientes'] LOOP
    BEGIN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- ya estaba publicada
    END;
  END LOOP;
END $$;
