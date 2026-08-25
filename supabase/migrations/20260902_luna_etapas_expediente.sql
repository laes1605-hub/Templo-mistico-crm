-- ============================================================================
-- Luna por etapas: expediente del caso + etapas del pipeline
-- Ejecutar ANTES de importar n8n/05-luna-etapas.json.
--
-- 1) Columnas nuevas en public.clientes para guardar lo que Luna aprende
--    (motivo de la consulta y etapa interna). Si no existen, el workflow
--    igual funciona: guarda el resto y registra el error en _debug.
-- 2) Etapas del pipeline que usa el motor de Luna. Solo se crean si el grupo
--    no tiene ya una etapa con ese nombre (no duplica tu pipeline actual).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CLIENTES: expediente que construye Luna
-- ----------------------------------------------------------------------------
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS motivo_consulta text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS motivo_categoria text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS luna_etapa text;

COMMENT ON COLUMN public.clientes.motivo_consulta IS
  'Resumen del caso que Luna entendio en la etapa Sin respuesta. No se vuelve a preguntar.';
COMMENT ON COLUMN public.clientes.motivo_categoria IS
  'Categoria del trabajo: amarre, retorno, dominio, alejamiento, endulzamiento, sexual, conquista, entierro, desamarre, limpieza, mal_de_ojo, proteccion, prosperidad, empleo, atraccion, juegos, salud, otro.';
COMMENT ON COLUMN public.clientes.luna_etapa IS
  'Ultima etapa en la que Luna atendio al lead: lead_nuevo, sin_respuesta, datos, por_consulta.';

-- ----------------------------------------------------------------------------
-- 2. PIPELINE: etapas del motor de Luna (solo si faltan por nombre)
--    Claves toleradas por el workflow (n8n/luna/code/leer-estado-lead.js):
--      Lead Nuevo    → nuevo_lead, lead_nuevo, ...
--      Sin respuesta → sin_respuesta, no_contesta, ...
--      Datos         → datos, solicitar_datos, en_datos, ...
--      Por consulta  → por_consulta, en_consulta, espera_consulta, ...
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  g text;
BEGIN
  FOREACH g IN ARRAY ARRAY['personal','templo']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE grupo = g AND lower(nombre) IN ('sin respuesta','no contesta')
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo)
      VALUES (CASE WHEN g = 'templo' THEN 'sin_respuesta_templo' ELSE 'sin_respuesta' END,
              'Sin respuesta', 2, 'border-slate-500', 'bg-slate-500/10', 'text-slate-300', g);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE grupo = g AND lower(nombre) = 'datos'
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo)
      VALUES (CASE WHEN g = 'templo' THEN 'datos_templo' ELSE 'datos' END,
              'Datos', 3, 'border-sky-500', 'bg-sky-500/10', 'text-sky-300', g);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE grupo = g AND lower(nombre) IN ('por consulta','en consulta')
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, grupo)
      VALUES (CASE WHEN g = 'templo' THEN 'por_consulta_templo' ELSE 'por_consulta' END,
              'Por consulta', 4, 'border-yellow-500', 'bg-yellow-500/10', 'text-yellow-300', g);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Nota: no se toca RLS. El workflow escribe con la service_role key (bypass de
-- RLS) y la app ya tiene sus politicas; aqui solo se agregan columnas.
-- ----------------------------------------------------------------------------
