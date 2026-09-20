-- ============================================================================
-- RESTAURAR LOS TRIGGERS QUE LA MIGRACIÓN «fix_migraciones_duplicadas» BORRÓ
-- ----------------------------------------------------------------------------
-- QUÉ PASÓ (causa raíz del error al sincronizar las respuestas rápidas)
--
-- `20260920000001_fix_migraciones_duplicadas_idempotentes.sql` hacía
-- `DROP TRIGGER` de seis triggers para poder re-aplicar las migraciones viejas
-- sin el error «trigger already exists»… pero sólo volvía a crear las POLICIES.
-- Los triggers quedaban borrados y sin recrear. Como esa migración es la última
-- por fecha, la base terminaba así:
--
--   · respuestas_rapidas_calcular_huella  → `respuestas_rapidas.huella` es
--     NOT NULL y nadie la calcula: TODA inserción falla con
--     «null value in column "huella" of relation "respuestas_rapidas"
--      violates not-null constraint». Ese es el error que se veía al pulsar
--     «Sincronizar» en el panel de respuestas rápidas.
--   · trg_actualizar_ultimo_entrante      → `conversaciones.ultimo_entrante_en`
--     y `ultimo_entrante_api_en` se quedan congeladas en la última fecha buena
--     (comprobado: mensajes entrantes del 19/09 y marcas del 15/09).
--   · trg_incrementar_no_leidos_entrante  → los contadores de no leídos dejan
--     de subir con cada mensaje nuevo.
--   · clientes_enrutar_por_numero         → los leads nuevos no se enlazan solos
--     por número.
--   · conversaciones_enrutar_cliente      → una conversación nueva no arrastra
--     al cliente de su número.
--   · trg_clientes_atendido               → la marca `atendido` no se actualiza
--     al pasar a «consulta hecha».
--
-- ESTA MIGRACIÓN deja la base como estaba: vuelve a crear los seis triggers
-- (con DROP IF EXISTS previo, así se puede correr las veces que haga falta) y
-- recalcula las marcas que quedaron viejas. Es idempotente.
--
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Red de seguridad: funciones que deben existir para poder crear el trigger.
--    Si alguna falta, se avisa con un NOTICE y se salta ese trigger (no rompe
--    el resto). Las funciones no las borraba la migración del problema.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1) respuestas_rapidas.huella — la huella anti-duplicados (el error de sync)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'respuestas_rapidas' AND column_name = 'huella'
  ) THEN
    RAISE NOTICE 'respuestas_rapidas.huella no existe: falta correr 20260915000001_sincronizacion_respuestas_rapidas_unica.sql';
    RETURN;
  END IF;

  -- Versión con hash_bytes (la de 20260917000001): deduplica por contenido del
  -- archivo y no por la URL de Storage.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'respuestas_rapidas' AND column_name = 'hash_bytes'
  ) THEN
    CREATE OR REPLACE FUNCTION public.calcular_huella_respuesta_rapida()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public
    AS $fn$
    BEGIN
      NEW.huella := md5(NEW.tipo || chr(31) || COALESCE(NEW.hash_bytes, NEW.contenido));
      RETURN NEW;
    END;
    $fn$;
  ELSE
    CREATE OR REPLACE FUNCTION public.calcular_huella_respuesta_rapida()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public
    AS $fn$
    BEGIN
      NEW.huella := md5(NEW.tipo || chr(31) || NEW.contenido);
      RETURN NEW;
    END;
    $fn$;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS respuestas_rapidas_calcular_huella ON public.respuestas_rapidas';
  EXECUTE 'CREATE TRIGGER respuestas_rapidas_calcular_huella '
       || 'BEFORE INSERT OR UPDATE OF tipo, contenido ON public.respuestas_rapidas '
       || 'FOR EACH ROW EXECUTE FUNCTION public.calcular_huella_respuesta_rapida()';
END $$;

-- ----------------------------------------------------------------------------
-- 2) conversaciones.ultimo_entrante_en / ultimo_entrante_api_en (ventana 24 h)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.actualizar_ultimo_entrante()') IS NULL THEN
    RAISE NOTICE 'Falta la función actualizar_ultimo_entrante(): corre 20260918000001_ventana_24h_whatsapp_api.sql';
    RETURN;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_actualizar_ultimo_entrante ON public.mensajes';
  EXECUTE 'CREATE TRIGGER trg_actualizar_ultimo_entrante '
       || 'AFTER INSERT OR UPDATE OR DELETE ON public.mensajes '
       || 'FOR EACH ROW EXECUTE FUNCTION public.actualizar_ultimo_entrante()';
END $$;

-- ----------------------------------------------------------------------------
-- 3) contador de no leídos
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.incrementar_no_leidos_entrante()') IS NULL THEN
    RAISE NOTICE 'Falta la función incrementar_no_leidos_entrante(): corre 20260831000001_fix_no_leidos_realtime.sql';
    RETURN;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_incrementar_no_leidos_entrante ON public.mensajes';
  EXECUTE 'CREATE TRIGGER trg_incrementar_no_leidos_entrante '
       || 'AFTER INSERT ON public.mensajes '
       || 'FOR EACH ROW EXECUTE FUNCTION public.incrementar_no_leidos_entrante()';
END $$;

-- ----------------------------------------------------------------------------
-- 4) enrutado de leads por número (clientes y conversaciones)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.clientes_enrutar_por_numero_trg()') IS NULL THEN
    RAISE NOTICE 'Falta la función clientes_enrutar_por_numero_trg(): corre 20260830000001_enrutar_leads_por_numero.sql';
  ELSE
    EXECUTE 'DROP TRIGGER IF EXISTS clientes_enrutar_por_numero ON public.clientes';
    EXECUTE 'CREATE TRIGGER clientes_enrutar_por_numero '
         || 'AFTER INSERT OR UPDATE OF estado, grupo ON public.clientes '
         || 'FOR EACH ROW WHEN (pg_trigger_depth() < 2) '
         || 'EXECUTE FUNCTION public.clientes_enrutar_por_numero_trg()';
  END IF;

  IF to_regprocedure('public.conversaciones_enrutar_cliente_trg()') IS NULL THEN
    RAISE NOTICE 'Falta la función conversaciones_enrutar_cliente_trg(): corre 20260830000001_enrutar_leads_por_numero.sql';
  ELSE
    EXECUTE 'DROP TRIGGER IF EXISTS conversaciones_enrutar_cliente ON public.conversaciones';
    EXECUTE 'CREATE TRIGGER conversaciones_enrutar_cliente '
         || 'AFTER INSERT OR UPDATE OF fuente, cliente_id ON public.conversaciones '
         || 'FOR EACH ROW WHEN (pg_trigger_depth() < 2) '
         || 'EXECUTE FUNCTION public.conversaciones_enrutar_cliente_trg()';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5) marca `atendido` al pasar a «consulta hecha»
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.marcar_atendido()') IS NULL THEN
    RAISE NOTICE 'Falta la función marcar_atendido(): corre 20260828000001_no_leidos_atendidos_spam_negro.sql';
    RETURN;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_clientes_atendido ON public.clientes';
  EXECUTE 'CREATE TRIGGER trg_clientes_atendido '
       || 'BEFORE INSERT OR UPDATE OF estado ON public.clientes '
       || 'FOR EACH ROW EXECUTE FUNCTION public.marcar_atendido()';
END $$;

-- ----------------------------------------------------------------------------
-- 6) Reparar las marcas que quedaron congeladas mientras el trigger no estaba.
--    `recalcular_ultimos_entrantes()` rellena ultimo_entrante_en/_api_en desde
--    los mensajes y `sincronizar_no_leidos()` recalcula los no leídos.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_filas integer;
BEGIN
  IF to_regprocedure('public.recalcular_ultimos_entrantes()') IS NOT NULL THEN
    SELECT public.recalcular_ultimos_entrantes() INTO v_filas;
    RAISE NOTICE 'Conversaciones con marcas de entrante reparadas: %', v_filas;
  END IF;

  IF to_regprocedure('public.sincronizar_no_leidos()') IS NOT NULL THEN
    PERFORM public.sincronizar_no_leidos();
    RAISE NOTICE 'Contadores de no leídos recalculados.';
  END IF;
END $$;

-- Comprobación rápida (opcional): deben aparecer los 6 triggers.
--   SELECT c.relname AS tabla, t.tgname AS trigger
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE NOT t.tgisinternal
--      AND t.tgname IN ('respuestas_rapidas_calcular_huella','trg_actualizar_ultimo_entrante',
--                       'trg_incrementar_no_leidos_entrante','clientes_enrutar_por_numero',
--                       'conversaciones_enrutar_cliente','trg_clientes_atendido')
--    ORDER BY 1, 2;
