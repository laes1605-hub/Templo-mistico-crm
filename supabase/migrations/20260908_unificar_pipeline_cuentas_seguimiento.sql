-- ============================================================================
-- 🔮 UNIFICAR PIPELINE, CUENTAS POR ETAPA, SEGUIMIENTO DIARIO Y ARCHIVADOS
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede ejecutar varias veces sin riesgo.
--
-- CAMBIOS:
--   1. Un solo pipeline y unas solas subcategorías (se eliminan duplicados _templo).
--   2. Cada etapa tiene una cuenta encargada (WhatsApp API / WhatsApp Personal).
--   3. Una sola conversación por cliente unificando historial y chatwoot_id.
--   4. "En seguimiento" como check booleano en clientes con corte diario a las 8:00 AM.
--   5. Reconfirmar que leads de publicidad caen en "Nuevo Lead" (WhatsApp API).
-- ============================================================================

-- 1. COLUMNAS EN CLIENTES: CHECK DE SEGUIMIENTO Y FECHA DE ÚLTIMA REVISIÓN
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes' AND column_name = 'en_seguimiento'
  ) THEN
    ALTER TABLE public.clientes ADD COLUMN en_seguimiento boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes' AND column_name = 'seguimiento_revisado_en'
  ) THEN
    ALTER TABLE public.clientes ADD COLUMN seguimiento_revisado_en timestamptz DEFAULT NULL;
  END IF;
END $$;

-- 2. COLUMNA EN PIPELINE_ETAPAS: CUENTA RESPONSABLE (meta_business | evolution)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_etapas' AND column_name = 'cuenta_responsable'
  ) THEN
    ALTER TABLE public.pipeline_etapas ADD COLUMN cuenta_responsable text DEFAULT 'meta_business';
  END IF;
END $$;

-- 3. MIGRAR ESTADOS DE CLIENTES DUPLICADOS (_templo → base)
UPDATE public.clientes SET estado = 'nuevo_lead' WHERE estado = 'nuevo_lead_templo' OR estado IS NULL OR estado = '';
UPDATE public.clientes SET estado = 'en_consulta' WHERE estado = 'en_consulta_templo';
UPDATE public.clientes SET estado = 'consulta_hecha' WHERE estado = 'consulta_hecha_templo';
UPDATE public.clientes SET estado = 'pago_recibido' WHERE estado = 'pago_recibido_templo';
UPDATE public.clientes SET estado = 'trabajo_proceso' WHERE estado = 'trabajo_proceso_templo';
UPDATE public.clientes SET estado = 'trabajo_completado' WHERE estado = 'trabajo_completado_templo';
UPDATE public.clientes SET estado = 'perdido' WHERE estado = 'perdido_templo';

-- Si algún cliente tenía estado = 'en_seguimiento', activar check y pasar a 'en_consulta'
UPDATE public.clientes
   SET en_seguimiento = true,
       estado = 'en_consulta'
 WHERE estado = 'en_seguimiento';

-- 4. LIMPIEZA Y CONFIGURACIÓN DE PIPELINE_ETAPAS (UN SOLO PIPELINE)
-- Eliminar duplicados _templo y etapa en_seguimiento
DELETE FROM public.pipeline_etapas WHERE clave LIKE '%_templo';
DELETE FROM public.pipeline_etapas WHERE clave = 'en_seguimiento';
DELETE FROM public.pipeline_etapas WHERE es_spam = true OR es_archivado = true;

-- Garantizar las 7 etapas base del pipeline unificado con sus cuentas encargadas
INSERT INTO public.pipeline_etapas
  (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
VALUES
  ('nuevo_lead',        'Nuevo Lead',          1, 'border-blue-500',    'bg-blue-500/10',    'text-blue-300',    'meta_business', 'general', false, false),
  ('en_consulta',       'En Consulta',         2, 'border-yellow-500',  'bg-yellow-500/10',  'text-yellow-300',  'meta_business', 'general', false, false),
  ('consulta_hecha',    'Consulta Hecha',      3, 'border-orange-500',  'bg-orange-500/10',  'text-orange-300',  'evolution',     'general', false, false),
  ('pago_recibido',     'Pago Recibido',       4, 'border-emerald-500', 'bg-emerald-500/10', 'text-emerald-300', 'evolution',     'general', false, false),
  ('trabajo_proceso',   'Trabajo en Proceso',  5, 'border-purple-500',  'bg-purple-500/10',  'text-purple-300',  'evolution',     'general', false, false),
  ('trabajo_completado','Trabajo Completado',  6, 'border-green-500',   'bg-green-500/10',   'text-green-300',   'evolution',     'general', false, false),
  ('perdido',           'Perdido',             7, 'border-red-500',     'bg-red-500/10',     'text-red-300',     'evolution',     'general', false, false)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  orden = EXCLUDED.orden,
  color = EXCLUDED.color,
  bg_color = EXCLUDED.bg_color,
  text_color = EXCLUDED.text_color,
  cuenta_responsable = COALESCE(pipeline_etapas.cuenta_responsable, EXCLUDED.cuenta_responsable);

-- 5. FUNCIÓN MEJORADA: UNIFICAR HISTORIAL DE WHATSAPP EN UNA SOLA CONVERSACIÓN
CREATE OR REPLACE FUNCTION public.unificar_conversaciones_whatsapp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente record;
  v_principal uuid;
  v_sec record;
  v_cw_id text;
  v_total integer := 0;
  v_ultimo record;
BEGIN
  -- Buscar clientes con más de una conversación
  FOR v_cliente IN
    SELECT cliente_id
      FROM public.conversaciones
     WHERE cliente_id IS NOT NULL
     GROUP BY cliente_id
    HAVING count(*) > 1
  LOOP
    -- Elegir la conversación principal: la más activa recientemente
    SELECT id, chatwoot_conversation_id
      INTO v_principal, v_cw_id
      FROM public.conversaciones
     WHERE cliente_id = v_cliente.cliente_id
     ORDER BY ultimo_mensaje_en DESC NULLS LAST, creado_en ASC NULLS LAST
     LIMIT 1;

    -- Si la principal no tiene chatwoot_conversation_id, buscar si alguna secundaria sí lo tiene
    IF v_cw_id IS NULL THEN
      SELECT chatwoot_conversation_id INTO v_cw_id
        FROM public.conversaciones
       WHERE cliente_id = v_cliente.cliente_id
         AND chatwoot_conversation_id IS NOT NULL
       LIMIT 1;

      IF v_cw_id IS NOT NULL THEN
        UPDATE public.conversaciones
           SET chatwoot_conversation_id = v_cw_id
         WHERE id = v_principal;
      END IF;
    END IF;

    -- Mover mensajes de conversaciones secundarias a la principal
    FOR v_sec IN
      SELECT id FROM public.conversaciones
       WHERE cliente_id = v_cliente.cliente_id
         AND id <> v_principal
    LOOP
      INSERT INTO public.mensajes
        (conversacion_id, tipo, contenido, tipo_contenido, url_archivo, creado_en, chatwoot_message_id)
      SELECT v_principal, m.tipo, m.contenido, m.tipo_contenido, m.url_archivo, m.creado_en, m.chatwoot_message_id
        FROM public.mensajes m
       WHERE m.conversacion_id = v_sec.id
         AND NOT EXISTS (
           SELECT 1 FROM public.mensajes x
            WHERE x.conversacion_id = v_principal
              AND x.tipo = m.tipo
              AND x.creado_en = m.creado_en
              AND COALESCE(x.contenido, '') = COALESCE(m.contenido, '')
         );

      DELETE FROM public.mensajes WHERE conversacion_id = v_sec.id;
      DELETE FROM public.conversaciones WHERE id = v_sec.id;
      v_total := v_total + 1;
    END LOOP;

    -- Recalcular último mensaje y no leídos
    SELECT m.contenido, m.creado_en
      INTO v_ultimo
      FROM public.mensajes m
     WHERE m.conversacion_id = v_principal
     ORDER BY m.creado_en DESC NULLS LAST
     LIMIT 1;

    IF v_ultimo.creado_en IS NOT NULL THEN
      UPDATE public.conversaciones
         SET ultimo_mensaje = v_ultimo.contenido,
             ultimo_mensaje_en = v_ultimo.creado_en,
             no_leidos = (
               SELECT count(*)::integer FROM public.mensajes x
                WHERE x.conversacion_id = v_principal
                  AND x.tipo <> 'enviado'
                  AND x.creado_en > COALESCE(public.conversaciones.ultimo_leido_en, '1970-01-01'::timestamptz)
             )
       WHERE id = v_principal;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unificar_conversaciones_whatsapp() TO anon, authenticated;

-- 6. TRIGGER DE ENRUTADO: LEADS DE PUBLICIDAD SIEMPRE CAEN A NUEVO LEAD
CREATE OR REPLACE FUNCTION public.enrutar_cliente_por_numero(p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta integer;
  v_estado_actual text;
BEGIN
  SELECT count(*) FILTER (WHERE fuente = 'meta_business')
    INTO v_meta
    FROM public.conversaciones
   WHERE cliente_id = p_cliente_id;

  IF v_meta > 0 THEN
    SELECT COALESCE(estado, '') INTO v_estado_actual
      FROM public.clientes
     WHERE id = p_cliente_id;

    -- Si el cliente no tiene etapa asignada o tiene una etapa antigua, cae en 'nuevo_lead'
    IF v_estado_actual = '' OR v_estado_actual = 'nuevo_lead_templo' OR v_estado_actual = 'en_seguimiento' THEN
      UPDATE public.clientes
         SET estado = 'nuevo_lead',
             actualizado_en = now()
       WHERE id = p_cliente_id;
    END IF;
  END IF;
END;
$$;

-- Ejecutar unificación inicial de conversaciones
SELECT public.unificar_conversaciones_whatsapp();
