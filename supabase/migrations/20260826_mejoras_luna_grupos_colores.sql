-- ============================================================================
-- 🎨 MEJORAS: Apagar Luna global, Grupos Personal/Templo, Colores pipeline,
--             Sin nombre inicial para leads
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================================

-- 1. KILL SWITCH GLOBAL PARA LUNA (apagar/encender de todos los chats de una)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='config_general') THEN
    CREATE TABLE public.config_general (
      clave text PRIMARY KEY,
      valor text NOT NULL,
      descripcion text,
      actualizado_en timestamptz DEFAULT now()
    );
    ALTER TABLE public.config_general ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Asegurar política de lectura pública
DROP POLICY IF EXISTS "config_general_lectura_publica" ON public.config_general;
CREATE POLICY "config_general_lectura_publica" ON public.config_general
  FOR SELECT USING (true);

-- Política de escritura (para que el CRM pueda cambiar los valores)
DROP POLICY IF EXISTS "config_general_escritura_publica" ON public.config_general;
CREATE POLICY "config_general_escritura_publica" ON public.config_general
  FOR ALL USING (true) WITH CHECK (true);

-- Insertar el kill switch y configuraciones de grupos
INSERT INTO public.config_general (clave, valor, descripcion) VALUES
  ('luna_global_activa', 'true', 'Si es false, Luna se apaga en TODOS los chats (kill switch global)'),
  ('grupo_activo', 'personal', 'Grupo seleccionado actualmente: personal | templo'),
  ('personal_label', 'Personal', 'Nombre visible del grupo Personal (editable)'),
  ('templo_label', 'Templo', 'Nombre visible del grupo Templo (editable)')
ON CONFLICT (clave) DO NOTHING;

-- 2. PIPELINE ETAPAS: AGREGAR COLUMNA DE GRUPO Y MEJORAR COLORES
DO $$
BEGIN
  -- Si la tabla pipeline_etapas no existe, crearla
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pipeline_etapas') THEN
    CREATE TABLE public.pipeline_etapas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clave text UNIQUE NOT NULL,
      nombre text NOT NULL,
      orden integer NOT NULL DEFAULT 0,
      color text DEFAULT 'border-purple-500',
      bg_color text DEFAULT 'bg-purple-500/10',
      text_color text DEFAULT 'text-purple-300',
      grupo text DEFAULT 'personal',  -- 'personal' | 'templo' | 'spam'
      es_spam boolean DEFAULT false,
      es_archivado boolean DEFAULT false,
      creado_en timestamptz DEFAULT now()
    );

    ALTER TABLE public.pipeline_etapas ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "pipeline_etapas_lectura_publica" ON public.pipeline_etapas;
    CREATE POLICY "pipeline_etapas_lectura_publica" ON public.pipeline_etapas
      FOR SELECT USING (true);

    DROP POLICY IF EXISTS "pipeline_etapas_escritura_publica" ON public.pipeline_etapas;
    CREATE POLICY "pipeline_etapas_escritura_publica" ON public.pipeline_etapas
      FOR ALL USING (true) WITH CHECK (true);

    -- Semilla inicial Personal
    INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo, es_spam, es_archivado) VALUES
      ('nuevo_lead', 'Nuevo Lead', 1, 'border-blue-500', 'bg-blue-500/10', 'text-blue-300', 'personal', false, false),
      ('en_consulta', 'En Consulta', 2, 'border-yellow-500', 'bg-yellow-500/10', 'text-yellow-300', 'personal', false, false),
      ('consulta_hecha', 'Consulta Hecha', 3, 'border-orange-500', 'bg-orange-500/10', 'text-orange-300', 'personal', false, false),
      ('pago_recibido', 'Pago Recibido', 4, 'border-emerald-500', 'bg-emerald-500/10', 'text-emerald-300', 'personal', false, false),
      ('trabajo_proceso', 'Trabajo en Proceso', 5, 'border-purple-500', 'bg-purple-500/10', 'text-purple-300', 'personal', false, false),
      ('trabajo_completado', 'Trabajo Completado', 6, 'border-green-500', 'bg-green-500/10', 'text-green-300', 'personal', false, false),
      ('perdido', 'Perdido', 7, 'border-red-500', 'bg-red-500/10', 'text-red-300', 'personal', false, false),
      ('spam_personal', 'Spam', 99, 'border-red-700', 'bg-red-900/30', 'text-red-400', 'personal', true, false),
      ('archivado_personal', 'Archivados', 98, 'border-amber-600', 'bg-amber-900/20', 'text-amber-400', 'personal', false, true);

    -- Semilla inicial Templo
    INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo, es_spam, es_archivado) VALUES
      ('nuevo_lead_templo', 'Nuevo Lead', 1, 'border-indigo-500', 'bg-indigo-500/10', 'text-indigo-300', 'templo', false, false),
      ('en_consulta_templo', 'En Consulta', 2, 'border-pink-500', 'bg-pink-500/10', 'text-pink-300', 'templo', false, false),
      ('consulta_hecha_templo', 'Consulta Hecha', 3, 'border-fuchsia-500', 'bg-fuchsia-500/10', 'text-fuchsia-300', 'templo', false, false),
      ('pago_recibido_templo', 'Pago Recibido', 4, 'border-teal-500', 'bg-teal-500/10', 'text-teal-300', 'templo', false, false),
      ('trabajo_proceso_templo', 'Trabajo en Proceso', 5, 'border-violet-500', 'bg-violet-500/10', 'text-violet-300', 'templo', false, false),
      ('trabajo_completado_templo', 'Trabajo Completado', 6, 'border-cyan-500', 'bg-cyan-500/10', 'text-cyan-300', 'templo', false, false),
      ('perdido_templo', 'Perdido', 7, 'border-rose-500', 'bg-rose-500/10', 'text-rose-300', 'templo', false, false),
      ('spam_templo', 'Spam', 99, 'border-red-700', 'bg-red-900/30', 'text-red-400', 'templo', true, false),
      ('archivado_templo', 'Archivados', 98, 'border-amber-600', 'bg-amber-900/20', 'text-amber-400', 'templo', false, true);
  END IF;

  -- Agregar columnas si no existen
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='grupo') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN grupo text DEFAULT 'personal';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='bg_color') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN bg_color text DEFAULT 'bg-purple-500/10';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='text_color') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN text_color text DEFAULT 'text-purple-300';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='es_spam') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN es_spam boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pipeline_etapas' AND column_name='es_archivado') THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN es_archivado boolean DEFAULT false;
  END IF;
END $$;

-- Actualizar valores por defecto para etapas existentes sin grupo
UPDATE public.pipeline_etapas SET grupo = 'personal' WHERE grupo IS NULL OR grupo = '';
UPDATE public.pipeline_etapas SET bg_color = 'bg-purple-500/10' WHERE bg_color IS NULL OR bg_color = '';
UPDATE public.pipeline_etapas SET text_color = 'text-purple-300' WHERE text_color IS NULL OR text_color = '';
UPDATE public.pipeline_etapas SET color = 'border-purple-500' WHERE color IS NULL OR color = '';
UPDATE public.pipeline_etapas SET es_spam = false WHERE es_spam IS NULL;
UPDATE public.pipeline_etapas SET es_archivado = false WHERE es_archivado IS NULL;

-- Asegurar RLS
ALTER TABLE public.pipeline_etapas ENABLE ROW LEVEL SECURITY;

-- 3. CLIENTES: AGREGAR COLUMNA GRUPO (personal/templo) y limpiar nombres vacíos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='grupo') THEN
    ALTER TABLE public.clientes ADD COLUMN grupo text DEFAULT 'personal';
  END IF;
END $$;

UPDATE public.clientes SET grupo = 'personal' WHERE grupo IS NULL OR grupo = '';

-- Asegurar índice
CREATE INDEX IF NOT EXISTS clientes_grupo_idx ON public.clientes (grupo);
CREATE INDEX IF NOT EXISTS clientes_estado_idx ON public.clientes (estado);

-- RLS clientes (si ya está habilitado, esto no hace daño)
DO $$
BEGIN
  -- Políticas de lectura/escritura si no existen (asumiendo anon key como siempre)
  -- No forzamos enable si ya tiene sus propias políticas
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clientes' AND policyname='clientes_all_access') THEN
    DROP POLICY IF EXISTS "clientes_lectura_publica" ON public.clientes;
    CREATE POLICY "clientes_lectura_publica" ON public.clientes FOR SELECT USING (true);
  END IF;
END $$;

-- 4. CONVERSACIONES: asegurar que agente_activo respete el kill switch global
-- (esto se hace a nivel de aplicación, no necesitamos trigger en BD)

-- ============================================================================
-- ✅ LISTO.
--    Ahora ve al CRM y:
--    1) Arriba de los chats verás el botón 🌙 "Apagar Luna" global.
--    2) Hay dos botones grandes: Personal y Templo.
--    3) Cada etapa del pipeline tiene color; la tarjeta del chat toma ese color.
--    4) Los leads sin nombre muestran solo su número con el +.
-- ============================================================================
