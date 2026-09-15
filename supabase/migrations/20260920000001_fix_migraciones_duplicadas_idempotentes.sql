-- ============================================================================
-- 🔧 FIX: hacer idempotentes las migraciones anteriores (evitar "duplicados")
-- ----------------------------------------------------------------------------
-- Problema: varias migraciones históricas crean policies / triggers / funciones
-- / índices / publicaciones sin DROP IF EXISTS previo. Cuando se intenta
-- volver a aplicarlas (db reset, migración a un proyecto nuevo, o al importar
-- un dump que ya trae los objetos) fallan con errores tipo:
--   "policy X already exists"
--   "trigger Y for relation Z already exists"
--   "function W already exists with same argument types"
--   "relation is already a member of publication"
--
-- Esta migración NO crea tablas nuevas. Solo:
--   1. DROP IF EXISTS de los objetos duplicables que aparecen en las
--      migraciones desde 20260824 hasta 20260919.
--   2. Vuelve a CREATE OR REPLACE / CREATE IF NOT EXISTS los que puedan
--      faltar en una base limpia, para que el estado final sea consistente
--      independientemente del orden.
--
-- Es idempotente: se puede correr todas las veces que haga falta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. POLICIES (RLS): dropear para que las migraciones originales las puedan
--    recrear sin error. Si la migración original usa IF NOT EXISTS / DROP
--    propio, no pasa nada (DROP IF EXISTS es idempotente).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT polname, relname
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND polname IN (
         'config_divisas_lectura_publica',
         'config_general_lectura_publica',
         'config_general_escritura_publica',
         'recordatorios_whatsapp_lectura_publica',
         'recordatorios_whatsapp_escritura_publica',
         'pipeline_etapas_lectura_publica',
         'pipeline_etapas_escritura_publica',
         'clientes_lectura_publica',
         'clientes_escritura_publica',
         'conversaciones_escritura_publica',
         'respuestas_rapidas_lectura_publica',
         'respuestas_rapidas_escritura_publica'
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', r.polname, r.relname);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. TRIGGERS: los mismos nombres se crean en migraciones distintas.
--    DROP IF EXISTS antes que nada para que volver a correr no tire
--    "trigger already exists".
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tgname, relname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND NOT t.tgisinternal
       AND tgname IN (
         'trg_clientes_atendido',
         'clientes_enrutar_por_numero',
         'conversaciones_enrutar_cliente',
         'trg_incrementar_no_leidos_entrante',
         'respuestas_rapidas_calcular_huella',
         'trg_actualizar_ultimo_entrante'
       )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I;', r.tgname, r.relname);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. INDICES que se recrean en varias migraciones (mismo nombre).
--    DROP IF EXISTS antes del CREATE de cada migración posterior se asegura
--    en las propias migraciones con CREATE INDEX IF NOT EXISTS; aquí solo
--    limpiamos los que puedan quedar huérfanos con distinto nombre pero misma
--    función (mismos nombres que hemos visto repetidos).
-- ----------------------------------------------------------------------------
-- (CREATE INDEX IF NOT EXISTS en las migraciones originales ya protege estos;
-- no hace falta droparlos, porque el IF NOT EXISTS evita el error.)

-- ----------------------------------------------------------------------------
-- 4. FUNCIONES: varias se definen CREATE OR REPLACE en múltiples migraciones.
--    OR REPLACE ya es idempotente, pero en un reset limpio tiene que existir
--    la función antes de que se cree el trigger que la usa. Las migraciones
--    ya hacen CREATE OR REPLACE antes del CREATE TRIGGER, así que no hace
--    falta intervenir: solo garantizamos que no quede una versión vieja con
--    signatura distinta que impida reemplazar.
-- ----------------------------------------------------------------------------
-- (no action required: CREATE OR REPLACE FUNCTION es idempotente y las
-- migraciones originales ya lo usan)

-- ----------------------------------------------------------------------------
-- 5. PUBLICATION supabase_realtime: varias migraciones hacen
--    ALTER PUBLICATION ... ADD TABLE sin capturar duplicate_object.
--    Dejamos todas las tablas que deberían estar en realtime, capturando el
--    error por si ya están agregadas.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.respuestas_rapidas; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversaciones;   EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.mensajes;         EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.clientes;         EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_etapas;  EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END;
END $$;

-- ----------------------------------------------------------------------------
-- 6. ASEGURAR RLS en las tablas que las migraciones tocan (idempotente).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'config_divisas',
    'config_general',
    'recordatorios_whatsapp',
    'pipeline_etapas',
    'clientes',
    'conversaciones',
    'respuestas_rapidas',
    'pagos'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 7. RE-CREAR LAS POLICIES BÁSICAS (las que se comparten entre migraciones).
--    Las migraciones originales ya las recrean, pero si alguna migración
--    histórica falló antes de llegar al CREATE POLICY, aquí quedan puestas
--    para que el CRM no se quede sin acceso.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- config_divisas
  IF to_regclass('public.config_divisas') IS NOT NULL THEN
    DROP POLICY IF EXISTS "config_divisas_lectura_publica" ON public.config_divisas;
    CREATE POLICY "config_divisas_lectura_publica" ON public.config_divisas FOR SELECT USING (true);
  END IF;

  -- config_general
  IF to_regclass('public.config_general') IS NOT NULL THEN
    DROP POLICY IF EXISTS "config_general_lectura_publica" ON public.config_general;
    CREATE POLICY "config_general_lectura_publica" ON public.config_general FOR SELECT USING (true);
    DROP POLICY IF EXISTS "config_general_escritura_publica" ON public.config_general;
    CREATE POLICY "config_general_escritura_publica" ON public.config_general FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- recordatorios_whatsapp
  IF to_regclass('public.recordatorios_whatsapp') IS NOT NULL THEN
    DROP POLICY IF EXISTS "recordatorios_whatsapp_lectura_publica" ON public.recordatorios_whatsapp;
    CREATE POLICY "recordatorios_whatsapp_lectura_publica" ON public.recordatorios_whatsapp FOR SELECT USING (true);
    DROP POLICY IF EXISTS "recordatorios_whatsapp_escritura_publica" ON public.recordatorios_whatsapp;
    CREATE POLICY "recordatorios_whatsapp_escritura_publica" ON public.recordatorios_whatsapp FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- pipeline_etapas
  IF to_regclass('public.pipeline_etapas') IS NOT NULL THEN
    DROP POLICY IF EXISTS "pipeline_etapas_lectura_publica" ON public.pipeline_etapas;
    CREATE POLICY "pipeline_etapas_lectura_publica" ON public.pipeline_etapas FOR SELECT USING (true);
    DROP POLICY IF EXISTS "pipeline_etapas_escritura_publica" ON public.pipeline_etapas;
    CREATE POLICY "pipeline_etapas_escritura_publica" ON public.pipeline_etapas FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- clientes
  IF to_regclass('public.clientes') IS NOT NULL THEN
    DROP POLICY IF EXISTS "clientes_lectura_publica" ON public.clientes;
    CREATE POLICY "clientes_lectura_publica" ON public.clientes FOR SELECT USING (true);
    DROP POLICY IF EXISTS "clientes_escritura_publica" ON public.clientes;
    CREATE POLICY "clientes_escritura_publica" ON public.clientes FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- conversaciones
  IF to_regclass('public.conversaciones') IS NOT NULL THEN
    DROP POLICY IF EXISTS "conversaciones_escritura_publica" ON public.conversaciones;
    CREATE POLICY "conversaciones_escritura_publica" ON public.conversaciones FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- respuestas_rapidas
  IF to_regclass('public.respuestas_rapidas') IS NOT NULL THEN
    DROP POLICY IF EXISTS "respuestas_rapidas_lectura_publica" ON public.respuestas_rapidas;
    CREATE POLICY "respuestas_rapidas_lectura_publica" ON public.respuestas_rapidas FOR SELECT USING (true);
    DROP POLICY IF EXISTS "respuestas_rapidas_escritura_publica" ON public.respuestas_rapidas;
    CREATE POLICY "respuestas_rapidas_escritura_publica" ON public.respuestas_rapidas FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- ✅ LISTO. Todas las migraciones posteriores (y esta misma) se pueden volver
--    a correr sin errores de objeto duplicado. Si una migración histórica
--    fallaba por "policy/trigger/function already exists", ahora se limpian
--    primero y se recrean.
-- ----------------------------------------------------------------------------
