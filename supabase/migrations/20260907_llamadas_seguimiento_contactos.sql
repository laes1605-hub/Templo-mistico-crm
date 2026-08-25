-- ============================================================================
-- 📞 WhatsApp Personal + etapa fija "En seguimiento"
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
--
-- Esta migración solo crea la etapa de seguimiento del grupo Personal. Las
-- llamadas y la verificación de contactos ocurren de forma local en la APK,
-- porque la agenda y WhatsApp pertenecen al teléfono del operador.
-- ============================================================================

-- "En seguimiento" es una etapa real del pipeline Personal: los clientes se
-- pueden mover desde la ficha, se ven en Pipeline y se filtran desde el chip
-- especial al lado de "Por leer". La clave es estable aunque luego se cambie
-- el nombre visible desde Configurar Pipeline.
DO $$
DECLARE
  v_orden integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pipeline_etapas
    WHERE clave = 'en_seguimiento'
  ) THEN
    SELECT COALESCE(MAX(orden), 0) + 1
      INTO v_orden
      FROM public.pipeline_etapas
     WHERE grupo = 'personal'
       AND COALESCE(es_spam, false) = false
       AND COALESCE(es_archivado, false) = false;

    INSERT INTO public.pipeline_etapas
      (clave, nombre, orden, color, bg_color, text_color, grupo, es_spam, es_archivado)
    VALUES
      ('en_seguimiento', 'En seguimiento', v_orden,
       'border-cyan-500', 'bg-cyan-500/15', 'text-cyan-300',
       'personal', false, false);
  END IF;
END $$;

COMMENT ON TABLE public.pipeline_etapas IS
  'Etapas configurables del CRM. La clave en_seguimiento pertenece al WhatsApp Personal y activa el aviso local diario de la APK cuando hay clientes en esa etapa.';

-- ============================================================================
-- ✅ LISTO
--
-- En la APK:
--   • La etiqueta "En seguimiento" aparece junto a "Por leer" solo en Personal.
--   • A las 9:00 a. m. el teléfono avisa cada día mientras haya clientes allí.
--   • El horario se programa localmente al abrir/sincronizar la APK y requiere
--     que "Avisos en el teléfono" esté activado en Tema/Ajustes.
-- ============================================================================
