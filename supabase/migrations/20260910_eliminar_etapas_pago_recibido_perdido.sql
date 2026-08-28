-- =====================================================================
-- ELIMINAR ETAPAS "PAGO RECIBIDO" Y "PERDIDO" DEL PIPELINE
-- ---------------------------------------------------------------------
-- Pipeline final (5 etapas):
--   1. Nuevo Lead
--   2. En Consulta
--   3. Consulta Hecha
--   4. Trabajo en Proceso
--   5. Trabajo Completado
--
-- Remapeo de clientes existentes:
--   pago_recibido (y *_templo) -> trabajo_proceso
--   perdido       (y *_templo) -> nuevo_lead
-- =====================================================================

-- 1. MOVER CLIENTES QUE ESTÁN EN LAS ETAPAS ELIMINADAS
UPDATE public.clientes
   SET estado = 'trabajo_proceso',
       actualizado_en = now()
 WHERE estado IN ('pago_recibido', 'pago_recibido_templo');

UPDATE public.clientes
   SET estado = 'nuevo_lead',
       actualizado_en = now()
 WHERE estado IN ('perdido', 'perdido_templo');

-- 2. BORRAR LAS ETAPAS DEL PIPELINE
DELETE FROM public.pipeline_etapas
 WHERE clave IN ('pago_recibido', 'pago_recibido_templo', 'perdido', 'perdido_templo');

-- 3. REORDENAR LAS ETAPAS RESTANTES
UPDATE public.pipeline_etapas SET orden = 1 WHERE clave = 'nuevo_lead';
UPDATE public.pipeline_etapas SET orden = 2 WHERE clave = 'en_consulta';
UPDATE public.pipeline_etapas SET orden = 3 WHERE clave = 'consulta_hecha';
UPDATE public.pipeline_etapas SET orden = 4 WHERE clave = 'trabajo_proceso';
UPDATE public.pipeline_etapas SET orden = 5 WHERE clave = 'trabajo_completado';

-- 4. GARANTIZAR QUE LAS 5 ETAPAS VIGENTES EXISTEN
INSERT INTO public.pipeline_etapas
  (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
VALUES
  ('nuevo_lead',        'Nuevo Lead',          1, 'border-blue-500',   'bg-blue-500/10',   'text-blue-300',   'meta_business', 'general', false, false),
  ('en_consulta',       'En Consulta',         2, 'border-yellow-500', 'bg-yellow-500/10', 'text-yellow-300', 'meta_business', 'general', false, false),
  ('consulta_hecha',    'Consulta Hecha',      3, 'border-orange-500', 'bg-orange-500/10', 'text-orange-300', 'evolution',     'general', false, false),
  ('trabajo_proceso',   'Trabajo en Proceso',  4, 'border-purple-500', 'bg-purple-500/10', 'text-purple-300', 'evolution',     'general', false, false),
  ('trabajo_completado','Trabajo Completado',  5, 'border-green-500',  'bg-green-500/10',  'text-green-300',  'evolution',     'general', false, false)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  orden = EXCLUDED.orden,
  color = EXCLUDED.color,
  bg_color = EXCLUDED.bg_color,
  text_color = EXCLUDED.text_color;
