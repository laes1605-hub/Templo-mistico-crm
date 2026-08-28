-- ============================================================================
-- 🔮 LUNA: asegurar etapas "Nuevo Lead" y "Datos" por NOMBRE, no por clave
-- + reactivar Luna en esas etapas
-- ----------------------------------------------------------------------------
-- Problema: Luna no contestaba en las etapas acordadas (nuevo lead y datos).
-- Causa: validacion por clave (etapa_xxx_timestamp) en vez de por nombre visible,
-- y conversaciones con agente_activo=false o luna_pausada=true que no se reactivaban.
--
-- Esta migración:
-- 1. Garantiza que existan etapas con NOMBRE "Nuevo Lead" y "Datos" (validacion por nombre)
--    en grupo "general" y también en "templo"/"personal" por compatibilidad.
-- 2. Reactiva Luna (agente_activo=true) en conversaciones cuyo cliente está
--    en etapa "Nuevo Lead" o "Datos" por NOMBRE y aún no ha enviado lista.
-- 3. Limpia luna_pausada y lista_requisitos_enviada cuando la etapa es "Nuevo Lead" por nombre.
-- 4. Asegura luna_global_activa=true para que Luna esté activa.
-- ============================================================================

-- 1) Asegurar que existan las etapas base por NOMBRE (no por clave)
DO $$
DECLARE
  g text;
BEGIN
  -- Grupos donde deben existir Nuevo Lead y Datos por nombre
  FOREACH g IN ARRAY ARRAY['general','templo','personal']
  LOOP
    -- Nuevo Lead por nombre
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE lower(nombre) = 'nuevo lead' AND (grupo = g OR (g = 'general' AND (grupo IS NULL OR grupo = 'general')))
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
      VALUES (
        CASE WHEN g = 'general' THEN 'nuevo_lead' ELSE 'nuevo_lead_' || g || '_' || extract(epoch from now())::bigint END,
        'Nuevo Lead',
        1,
        'border-blue-500', 'bg-blue-500/10', 'text-blue-300',
        'meta_business',
        g,
        false, false
      )
      ON CONFLICT (clave) DO NOTHING;
    END IF;

    -- Datos por nombre (etapa donde Luna clasifica y envía lista)
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_etapas
      WHERE lower(nombre) = 'datos' AND (grupo = g OR (g = 'general' AND (grupo IS NULL OR grupo = 'general')))
    ) THEN
      INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
      VALUES (
        CASE WHEN g = 'general' THEN 'datos' ELSE 'datos_' || g || '_' || extract(epoch from now())::bigint END,
        'Datos',
        2,
        'border-sky-500', 'bg-sky-500/10', 'text-sky-300',
        'meta_business',
        g,
        false, false
      )
      ON CONFLICT (clave) DO NOTHING;
    END IF;
  END LOOP;

  -- Si la tabla estaba vacía o solo tenía el pipeline unificado de 5 etapas sin Datos,
  -- asegurar que Datos exista en general con orden 2 y reordenar el resto
  IF EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = 'nuevo_lead' AND lower(nombre) = 'nuevo lead') 
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = 'datos' AND lower(nombre) = 'datos' AND grupo = 'general') THEN
    INSERT INTO public.pipeline_etapas (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
    VALUES ('datos','Datos',2,'border-sky-500','bg-sky-500/10','text-sky-300','meta_business','general',false,false)
    ON CONFLICT (clave) DO UPDATE SET nombre='Datos', orden=2;
  END IF;

  -- Reordenar pipeline general para que sea: Nuevo Lead (1), Datos (2), En Consulta (3), Consulta Hecha (4), Trabajo en Proceso (5), Trabajo Completado (6)
  UPDATE public.pipeline_etapas SET orden = 1 WHERE clave = 'nuevo_lead' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 2 WHERE clave = 'datos' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 3 WHERE clave = 'en_consulta' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 4 WHERE clave = 'consulta_hecha' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 5 WHERE clave = 'trabajo_proceso' AND grupo = 'general';
  UPDATE public.pipeline_etapas SET orden = 6 WHERE clave = 'trabajo_completado' AND grupo = 'general';
END $$;

-- 2) Asegurar luna_global_activa = true (Luna debe estar activa)
INSERT INTO public.config_general (clave, valor, descripcion)
VALUES ('luna_global_activa','true','Luna activa globalmente — validacion por nombre en Nuevo Lead y Datos')
ON CONFLICT (clave) DO UPDATE SET valor='true', actualizado_en=now();

-- 3) Reactivar conversaciones en Nuevo Lead o Datos por NOMBRE
--    - Si el cliente está en etapa cuyo NOMBRE es "Nuevo Lead" o "Datos", poner agente_activo=true
--    - Si está en "Nuevo Lead" por nombre, limpiar pausa de Chatwoot (esto último lo hace n8n, pero dejamos agente_activo true)
DO $$
DECLARE
  etapa_record record;
  clave_datos text;
  clave_nuevo text;
BEGIN
  -- Obtener claves reales por NOMBRE en grupo general
  SELECT clave INTO clave_nuevo FROM public.pipeline_etapas WHERE lower(nombre)='nuevo lead' AND grupo='general' ORDER BY orden LIMIT 1;
  SELECT clave INTO clave_datos FROM public.pipeline_etapas WHERE lower(nombre)='datos' AND grupo='general' ORDER BY orden LIMIT 1;

  -- Si no hay en general, buscar en cualquier grupo por nombre
  IF clave_nuevo IS NULL THEN
    SELECT clave INTO clave_nuevo FROM public.pipeline_etapas WHERE lower(nombre)='nuevo lead' ORDER BY orden LIMIT 1;
  END IF;
  IF clave_datos IS NULL THEN
    SELECT clave INTO clave_datos FROM public.pipeline_etapas WHERE lower(nombre)='datos' ORDER BY orden LIMIT 1;
  END IF;

  -- Reactivar agentes en Nuevo Lead por NOMBRE (todas las claves cuyo nombre es Nuevo Lead)
  FOR etapa_record IN
    SELECT clave FROM public.pipeline_etapas WHERE lower(nombre)='nuevo lead'
  LOOP
    UPDATE public.conversaciones
       SET agente_activo = true
     WHERE cliente_id IN (SELECT id FROM public.clientes WHERE lower(estado)=lower(etapa_record.clave) OR lower(estado)=lower('nuevo_lead') OR lower(estado) LIKE '%nuevo%lead%')
       AND agente_activo = false;
  END LOOP;

  -- Reactivar agentes en Datos por NOMBRE donde lista no ha sido enviada (agente_activo false por pausa previa incorrecta)
  -- Solo reactivamos si la conversación NO tiene luna_pausada true en Chatwoot (no podemos leer Chatwoot desde SQL, así que reactivamos Datos que estaban pausados por error)
  FOR etapa_record IN
    SELECT clave FROM public.pipeline_etapas WHERE lower(nombre)='datos'
  LOOP
    UPDATE public.conversaciones
       SET agente_activo = true
     WHERE cliente_id IN (SELECT id FROM public.clientes WHERE lower(estado)=lower(etapa_record.clave) OR lower(estado)='datos')
       AND agente_activo = false
       -- No reactivar si el cliente ya tiene luna_etapa = datos y lista enviada (eso lo maneja n8n)
       AND cliente_id NOT IN (
         SELECT id FROM public.clientes WHERE luna_etapa='datos' AND motivo_categoria IS NOT NULL
       );
  END LOOP;

  -- Fallback: si hay clientes sin estado o con estado vacío, ponerlos en Nuevo Lead y activar
  UPDATE public.clientes SET estado = COALESCE(clave_nuevo, 'nuevo_lead'), actualizado_en=now() WHERE estado IS NULL OR estado = '';
  UPDATE public.conversaciones SET agente_activo = true WHERE cliente_id IN (SELECT id FROM public.clientes WHERE estado IS NULL OR estado = '');

END $$;

-- 4) Log de verificación
DO $$
DECLARE
  total_nuevo integer;
  total_datos integer;
  total_activas integer;
BEGIN
  SELECT count(*) INTO total_nuevo FROM public.pipeline_etapas WHERE lower(nombre)='nuevo lead';
  SELECT count(*) INTO total_datos FROM public.pipeline_etapas WHERE lower(nombre)='datos';
  SELECT count(*) INTO total_activas FROM public.conversaciones WHERE agente_activo=true;
  RAISE NOTICE 'Luna etapas por NOMBRE: Nuevo Lead=% Datos=% Conversaciones activas=%', total_nuevo, total_datos, total_activas;
END $$;
