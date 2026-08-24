-- ============================================================================
-- FIX MIGRACION ARCHIVADOS + NOTAS PERSONALES + DIVISAS
-- Esta migración es 100% compatible y no falla si las columnas ya existen
-- Ejecutar en Supabase SQL Editor
-- ============================================================================

-- 1. ARCHIVADOS (versión corregida, sin NOT NULL inmediato)
-- Primero agregamos la columna nullable, luego la llenamos, luego ponemos default
DO $$
BEGIN
  -- archivada
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='archivada') THEN
    ALTER TABLE public.conversaciones ADD COLUMN archivada boolean DEFAULT false;
  END IF;
  
  -- fecha_archivado
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='fecha_archivado') THEN
    ALTER TABLE public.conversaciones ADD COLUMN fecha_archivado timestamptz;
  END IF;

  -- motivo_archivado
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversaciones' AND column_name='motivo_archivado') THEN
    ALTER TABLE public.conversaciones ADD COLUMN motivo_archivado text;
  END IF;

  -- Actualizar nulls a false
  EXECUTE 'UPDATE public.conversaciones SET archivada = false WHERE archivada IS NULL';

  -- Ahora poner NOT NULL si no lo tiene
  BEGIN
    ALTER TABLE public.conversaciones ALTER COLUMN archivada SET NOT NULL;
  EXCEPTION WHEN others THEN
    -- Si ya es NOT NULL o falla, ignorar
    NULL;
  END;

  ALTER TABLE public.conversaciones ALTER COLUMN archivada SET DEFAULT false;
END $$;

-- Indices
CREATE INDEX IF NOT EXISTS conversaciones_archivada_idx ON public.conversaciones (archivada);
CREATE INDEX IF NOT EXISTS conversaciones_fecha_archivado_idx ON public.conversaciones (fecha_archivado DESC) WHERE archivada = true;

-- Vistas (reemplazables)
CREATE OR REPLACE VIEW public.v_conversaciones_activas AS
SELECT * FROM public.conversaciones WHERE archivada = false;

CREATE OR REPLACE VIEW public.v_conversaciones_archivadas AS
SELECT * FROM public.conversaciones WHERE archivada = true;

-- Función helper auto-archivar
CREATE OR REPLACE FUNCTION public.archivar_conversaciones_inactivas(dias int DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  filas integer;
BEGIN
  UPDATE public.conversaciones
  SET archivada = true,
      fecha_archivado = now(),
      motivo_archivado = 'inactivo_' || dias || 'd'
  WHERE archivada = false
    AND ultimo_mensaje_en < now() - (dias || ' days')::interval;
  
  GET DIAGNOSTICS filas = ROW_COUNT;
  RETURN filas;
END;
$$;

-- 2. NOTAS PERSONALES PARA CLIENTES
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='notas_personales') THEN
    ALTER TABLE public.clientes ADD COLUMN notas_personales text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='detalles_caso') THEN
    ALTER TABLE public.clientes ADD COLUMN detalles_caso text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='notas_actualizado_en') THEN
    ALTER TABLE public.clientes ADD COLUMN notas_actualizado_en timestamptz;
  END IF;
END $$;

COMMENT ON COLUMN public.clientes.notas_personales IS 'Notas privadas del operador sobre el cliente, detalles del caso, preferencias, etc';
COMMENT ON COLUMN public.clientes.detalles_caso IS 'Detalles específicos del trabajo esotérico solicitado';

-- 3. DIVISAS Y COMISIONES EN PAGOS
DO $$
BEGIN
  -- moneda: COP, PYG, USD, EUR, BRL, etc
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='moneda') THEN
    ALTER TABLE public.pagos ADD COLUMN moneda text DEFAULT 'COP';
  END IF;

  -- comision_porcentaje: comisión de cambio (ej: 7%)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='comision_porcentaje') THEN
    ALTER TABLE public.pagos ADD COLUMN comision_porcentaje numeric DEFAULT 0;
  END IF;

  -- tasa_cambio: tasa usada para conversión a COP en ese momento
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='tasa_cambio') THEN
    ALTER TABLE public.pagos ADD COLUMN tasa_cambio numeric DEFAULT 1;
  END IF;

  -- monto_convertido_cop: monto final en COP después de comisión y conversión
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='monto_convertido_cop') THEN
    ALTER TABLE public.pagos ADD COLUMN monto_convertido_cop numeric;
  END IF;

  -- monto_original: guardar monto en moneda original si se quiere auditoría
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos' AND column_name='monto_original') THEN
    ALTER TABLE public.pagos ADD COLUMN monto_original numeric;
  END IF;

  -- Actualizar existentes
  EXECUTE 'UPDATE public.pagos SET moneda = ''COP'' WHERE moneda IS NULL';
  EXECUTE 'UPDATE public.pagos SET comision_porcentaje = 0 WHERE comision_porcentaje IS NULL';
  EXECUTE 'UPDATE public.pagos SET tasa_cambio = 1 WHERE tasa_cambio IS NULL';
  EXECUTE 'UPDATE public.pagos SET monto_original = monto WHERE monto_original IS NULL';
  EXECUTE 'UPDATE public.pagos SET monto_convertido_cop = monto WHERE monto_convertido_cop IS NULL';
END $$;

-- Indices para cartera
CREATE INDEX IF NOT EXISTS pagos_moneda_idx ON public.pagos (moneda);
CREATE INDEX IF NOT EXISTS pagos_fecha_pago_idx ON public.pagos (fecha_pago);
CREATE INDEX IF NOT EXISTS pagos_monto_convertido_idx ON public.pagos (monto_convertido_cop);

COMMENT ON COLUMN public.pagos.moneda IS 'Divisa original: COP, PYG, USD, EUR, etc';
COMMENT ON COLUMN public.pagos.comision_porcentaje IS 'Comisión de cambio en %, normalmente 7% para PYG';
COMMENT ON COLUMN public.pagos.tasa_cambio IS 'Tasa de cambio usada: ej 0.55 COP por 1 PYG, 4100 COP por 1 USD';
COMMENT ON COLUMN public.pagos.monto_convertido_cop IS 'Monto final convertido a COP después de quitar comisión';

-- 4. TABLA DE CONFIGURACION GLOBAL DE DIVISAS (opcional, para guardar tasas)
CREATE TABLE IF NOT EXISTS public.config_divisas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text UNIQUE NOT NULL, -- COP, PYG, USD, etc
  nombre text NOT NULL,
  tasa_a_cop numeric NOT NULL DEFAULT 1, -- Cuánto vale 1 unidad de esta moneda en COP
  simbolo text,
  activo boolean DEFAULT true,
  actualizado_en timestamptz DEFAULT now()
);

-- Insertar tasas por defecto si no existen
INSERT INTO public.config_divisas (codigo, nombre, tasa_a_cop, simbolo) VALUES
  ('COP', 'Peso Colombiano', 1, '$'),
  ('PYG', 'Guaraní Paraguayo', 0.55, '₲'),
  ('USD', 'Dólar Americano', 4100, 'US$'),
  ('EUR', 'Euro', 4500, '€'),
  ('BRL', 'Real Brasileño', 800, 'R$'),
  ('MXN', 'Peso Mexicano', 230, '$')
ON CONFLICT (codigo) DO NOTHING;

-- Config global de comisión
CREATE TABLE IF NOT EXISTS public.config_general (
  clave text PRIMARY KEY,
  valor text NOT NULL,
  descripcion text,
  actualizado_en timestamptz DEFAULT now()
);

INSERT INTO public.config_general (clave, valor, descripcion) VALUES
  ('comision_cambio_default', '7', 'Comisión por defecto para cambio de divisa en %'),
  ('tasa_pyg_cop', '0.55', 'Tasa de conversión PYG a COP'),
  ('tasa_usd_cop', '4100', 'Tasa de conversión USD a COP')
ON CONFLICT (clave) DO NOTHING;

-- RLS para nuevas tablas (lectura pública)
ALTER TABLE public.config_divisas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_general ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "config_divisas_lectura_publica" ON public.config_divisas;
CREATE POLICY "config_divisas_lectura_publica" ON public.config_divisas FOR SELECT USING (true);

DROP POLICY IF EXISTS "config_general_lectura_publica" ON public.config_general;
CREATE POLICY "config_general_lectura_publica" ON public.config_general FOR SELECT USING (true);

-- 5. COMENTARIOS FINALES
COMMENT ON TABLE public.config_divisas IS 'Tasas de cambio configurables para conversión a COP';
COMMENT ON TABLE public.config_general IS 'Configuraciones globales del CRM';
