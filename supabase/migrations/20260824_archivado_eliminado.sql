-- ============================================================================
-- 📦 ARCHIVADOS Y ELIMINADOS — Templo Místico CRM (FIXED)
-- Versión corregida que no falla en Supabase
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='archivada') THEN
    ALTER TABLE public.conversaciones ADD COLUMN archivada boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='fecha_archivado') THEN
    ALTER TABLE public.conversaciones ADD COLUMN fecha_archivado timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='motivo_archivado') THEN
    ALTER TABLE public.conversaciones ADD COLUMN motivo_archivado text;
  END IF;
  -- Asegurar valores por defecto
  EXECUTE 'UPDATE public.conversaciones SET archivada = false WHERE archivada IS NULL';
  BEGIN
    ALTER TABLE public.conversaciones ALTER COLUMN archivada SET NOT NULL;
  EXCEPTION WHEN others THEN NULL;
  END;
  ALTER TABLE public.conversaciones ALTER COLUMN archivada SET DEFAULT false;
END $$;

CREATE INDEX IF NOT EXISTS conversaciones_archivada_idx ON public.conversaciones (archivada);
CREATE INDEX IF NOT EXISTS conversaciones_fecha_archivado_idx ON public.conversaciones (fecha_archivado DESC) WHERE archivada = true;

CREATE OR REPLACE VIEW public.v_conversaciones_activas AS SELECT * FROM public.conversaciones WHERE archivada = false;
CREATE OR REPLACE VIEW public.v_conversaciones_archivadas AS SELECT * FROM public.conversaciones WHERE archivada = true;

CREATE OR REPLACE FUNCTION public.archivar_conversaciones_inactivas(dias int DEFAULT 7)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE filas integer;
BEGIN
  UPDATE public.conversaciones SET archivada = true, fecha_archivado = now(), motivo_archivado = 'inactivo_' || dias || 'd'
  WHERE archivada = false AND ultimo_mensaje_en < now() - (dias || ' days')::interval;
  GET DIAGNOSTICS filas = ROW_COUNT; RETURN filas;
END; $$;
