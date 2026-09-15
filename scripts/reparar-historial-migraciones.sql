-- ============================================================================
-- 🔧 REPARAR HISTORIAL DE MIGRACIONES — Templo Místico CRM
-- Corrige el error:
--   duplicate key value violates unique constraint "schema_migrations_pkey"
--   Key (version)=(20260824) already exists.
--   INSERT INTO supabase_migrations.schema_migrations(version, ...)
--
-- Causa: dos archivos compartían la misma versión (20260824 y 20260825).
--   - 20260824_archivado_eliminado.sql  + 20260824_fase3_cerebro_ia.sql
--   - 20260825_fix_all.sql              + 20260825_recordatorios_whatsapp_etapa.sql
--
-- Solución local (ya aplicada en este repo): renombrar TODAS las migraciones
-- a formato TIMESTAMP de 14 dígitos (YYYYMMDDHHMMSS) para que cada versión
-- sea única y quede ordenada:
--   20260824000001_archivado_eliminado.sql
--   20260824000002_fase3_cerebro_ia.sql
--   20260825000001_fix_all.sql
--   20260825000002_recordatorios_whatsapp_etapa.sql
--   20260826000001_..., etc.
--
-- Qué hacer en Supabase después del renombrado:
--   Este script limpia el historial remoto para que el próximo
--   `supabase db push` o el deploy de GitHub pueda aplicar las nuevas
--   versiones sin chocar con la PK.
--
--   Es SEGURO volver a correr: todas las migraciones del proyecto son
--   idempotentes (CREATE IF NOT EXISTS, DROP IF EXISTS, DO $$ ...).
--   Re-aplicarlas no borra datos.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 0. DIAGNÓSTICO: ver qué tiene tu base ahora (ejecuta primero para inspeccionar)
-- --------------------------------------------------------------------------
-- Tabla vieja (Supabase CLI < 1.150):
SELECT 'schema_migrations' as tabla, version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

-- Tabla nueva (Supabase CLI >= 1.150):
-- Si la anterior falla con "relation does not exist", usa esta:
SELECT 'history' as tabla, version, name
FROM supabase_migrations.history
ORDER BY version;

-- Ver si hay duplicados / versiones de 8 dígitos que ahora son 14:
SELECT version, count(*) FROM supabase_migrations.schema_migrations GROUP BY version HAVING count(*) > 1;
-- (cambiar a supabase_migrations.history si tu proyecto usa history)


-- --------------------------------------------------------------------------
-- 1. OPCIÓN RÁPIDA (recomendada): borrar solo las versiones conflictivas
--    y dejar que el próximo `supabase db push` las vuelva a aplicar con
--    los nuevos nombres. Esto es lo que hace que el merge de GitHub deje
--    de fallar inmediatamente.
-- --------------------------------------------------------------------------

-- Si tu proyecto usa supabase_migrations.schema_migrations:
DELETE FROM supabase_migrations.schema_migrations
WHERE version IN ('20260824', '20260825');

-- Si tu proyecto usa supabase_migrations.history:
DELETE FROM supabase_migrations.history
WHERE version IN ('20260824', '20260825');

-- Después de este DELETE, haz `supabase db push` (o reintenta el merge).
-- Las 4 migraciones siguientes se insertarán como:
--   20260824000001, 20260824000002, 20260825000001, 20260825000002
-- y el error de PK desaparece. Es normal que se re-ejecute el SQL de
-- esas 4 migraciones: son idempotentes.


-- --------------------------------------------------------------------------
-- 2. OPCIÓN LIMPIA (opcional): normalizar TODO el historial a 14 dígitos
--    para que quede perfectamente alineado con los nombres de archivo
--    locales. Ejecuta ESTE bloque SOLO si quieres un historial impecable
--    (no es necesario para que el deploy funcione).
--    Si ya hiciste la opción 1 y el `db push` re-aplicó todo, NO necesitas esto.
-- --------------------------------------------------------------------------

-- Mapeo 8 dígitos -> 14 dígitos. UPDATE cada fila existente a su nuevo version.
-- Para supabase_migrations.schema_migrations:
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='supabase_migrations' AND table_name='schema_migrations') THEN
    UPDATE supabase_migrations.schema_migrations SET version='20260826000001' WHERE version='20260826';
    UPDATE supabase_migrations.schema_migrations SET version='20260827000001' WHERE version='20260827';
    UPDATE supabase_migrations.schema_migrations SET version='20260828000001' WHERE version='20260828';
    UPDATE supabase_migrations.schema_migrations SET version='20260829000001' WHERE version='20260829';
    UPDATE supabase_migrations.schema_migrations SET version='20260830000001' WHERE version='20260830';
    UPDATE supabase_migrations.schema_migrations SET version='20260831000001' WHERE version='20260831';
    UPDATE supabase_migrations.schema_migrations SET version='20260901000001' WHERE version='20260901';
    UPDATE supabase_migrations.schema_migrations SET version='20260902000001' WHERE version='20260902';
    UPDATE supabase_migrations.schema_migrations SET version='20260903000001' WHERE version='20260903';
    UPDATE supabase_migrations.schema_migrations SET version='20260904000001' WHERE version='20260904';
    UPDATE supabase_migrations.schema_migrations SET version='20260905000001' WHERE version='20260905';
    UPDATE supabase_migrations.schema_migrations SET version='20260906000001' WHERE version='20260906';
    UPDATE supabase_migrations.schema_migrations SET version='20260907000001' WHERE version='20260907';
    UPDATE supabase_migrations.schema_migrations SET version='20260908000001' WHERE version='20260908';
    UPDATE supabase_migrations.schema_migrations SET version='20260910000001' WHERE version='20260910';
    UPDATE supabase_migrations.schema_migrations SET version='20260911000001' WHERE version='20260911';
    UPDATE supabase_migrations.schema_migrations SET version='20260912000001' WHERE version='20260912';
    UPDATE supabase_migrations.schema_migrations SET version='20260913000001' WHERE version='20260913';
    UPDATE supabase_migrations.schema_migrations SET version='20260914000001' WHERE version='20260914';
    UPDATE supabase_migrations.schema_migrations SET version='20260915000001' WHERE version='20260915';
    UPDATE supabase_migrations.schema_migrations SET version='20260916000001' WHERE version='20260916';
    UPDATE supabase_migrations.schema_migrations SET version='20260917000001' WHERE version='20260917';
    UPDATE supabase_migrations.schema_migrations SET version='20260918000001' WHERE version='20260918';
    UPDATE supabase_migrations.schema_migrations SET version='20260919000001' WHERE version='20260919';
    UPDATE supabase_migrations.schema_migrations SET version='20260920000001' WHERE version='20260920';
    -- Para los duplicados, actualizar uno y crear el segundo si falta:
    -- 20260824: había 1 fila con version '20260824', la pasamos a 00001;
    -- la 00002 se insertará en el próximo db push.
    UPDATE supabase_migrations.schema_migrations SET version='20260824000001' WHERE version='20260824';
    UPDATE supabase_migrations.schema_migrations SET version='20260825000001' WHERE version='20260825';
  END IF;
END $$;

-- Para supabase_migrations.history (mismo mapeo):
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='supabase_migrations' AND table_name='history') THEN
    UPDATE supabase_migrations.history SET version='20260826000001' WHERE version='20260826';
    UPDATE supabase_migrations.history SET version='20260827000001' WHERE version='20260827';
    UPDATE supabase_migrations.history SET version='20260828000001' WHERE version='20260828';
    UPDATE supabase_migrations.history SET version='20260829000001' WHERE version='20260829';
    UPDATE supabase_migrations.history SET version='20260830000001' WHERE version='20260830';
    UPDATE supabase_migrations.history SET version='20260831000001' WHERE version='20260831';
    UPDATE supabase_migrations.history SET version='20260901000001' WHERE version='20260901';
    UPDATE supabase_migrations.history SET version='20260902000001' WHERE version='20260902';
    UPDATE supabase_migrations.history SET version='20260903000001' WHERE version='20260903';
    UPDATE supabase_migrations.history SET version='20260904000001' WHERE version='20260904';
    UPDATE supabase_migrations.history SET version='20260905000001' WHERE version='20260905';
    UPDATE supabase_migrations.history SET version='20260906000001' WHERE version='20260906';
    UPDATE supabase_migrations.history SET version='20260907000001' WHERE version='20260907';
    UPDATE supabase_migrations.history SET version='20260908000001' WHERE version='20260908';
    UPDATE supabase_migrations.history SET version='20260910000001' WHERE version='20260910';
    UPDATE supabase_migrations.history SET version='20260911000001' WHERE version='20260911';
    UPDATE supabase_migrations.history SET version='20260912000001' WHERE version='20260912';
    UPDATE supabase_migrations.history SET version='20260913000001' WHERE version='20260913';
    UPDATE supabase_migrations.history SET version='20260914000001' WHERE version='20260914';
    UPDATE supabase_migrations.history SET version='20260915000001' WHERE version='20260915';
    UPDATE supabase_migrations.history SET version='20260916000001' WHERE version='20260916';
    UPDATE supabase_migrations.history SET version='20260917000001' WHERE version='20260917';
    UPDATE supabase_migrations.history SET version='20260918000001' WHERE version='20260918';
    UPDATE supabase_migrations.history SET version='20260919000001' WHERE version='20260919';
    UPDATE supabase_migrations.history SET version='20260920000001' WHERE version='20260920';
    UPDATE supabase_migrations.history SET version='20260824000001' WHERE version='20260824';
    UPDATE supabase_migrations.history SET version='20260825000001' WHERE version='20260825';
  END IF;
END $$;

-- Verificación final:
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
-- o
SELECT version, name FROM supabase_migrations.history ORDER BY version;


-- --------------------------------------------------------------------------
-- 3. ALTERNATIVA POR CLI (si tienes supabase CLI vinculado localmente):
-- --------------------------------------------------------------------------
-- En tu terminal, con el proyecto vinculado:
--
--   supabase link --project-ref zcljlddtcoyfyvshlyfk
--   # Ver estado
--   supabase migration list
--   # Reparar los duplicados (marca 20260824/25 como reverted para re-aplicar)
--   supabase migration repair --status reverted 20260824
--   supabase migration repair --status reverted 20260825
--   # O si ya las borraste con el SQL de arriba:
--   supabase db push
--
-- Si el CLI se queja de "remote migrations not found locally", es porque
-- espera las versiones de 8 dígitos que acabas de borrar/renombrar.
-- El `repair --status reverted` le dice que ya no existen en remoto y que
-- debe aplicar las nuevas de 14 dígitos.
-- --------------------------------------------------------------------------
