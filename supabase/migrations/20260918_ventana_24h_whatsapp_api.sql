-- ============================================================================
-- VENTANA DE 24 HORAS DEL WHATSAPP API (Meta)
-- ----------------------------------------------------------------------------
-- El CRM muestra cuánto tiempo queda para responder con texto libre a los
-- chats del WhatsApp API (fuente = 'meta_business'). La ventana se cuenta
-- desde el ÚLTIMO MENSAJE DEL CLIENTE, que es la regla real de Meta.
--
-- Para no re-descargar el historial completo cada vez, la columna
-- `conversaciones.ultimo_entrante_en` guarda esa marca y un trigger la
-- mantiene al día con cada mensaje que entra (aunque la app esté cerrada).
--
-- Es idempotente: se puede correr las veces que sea sin romper nada.
-- ============================================================================

-- 1) Marcas del último mensaje del cliente por conversación
--    · ultimo_entrante_en       → cualquier canal (WhatsApp API o Personal)
--    · ultimo_entrante_api_en   → solo mensajes que entraron POR EL WHATSAPP API
--      (es el que decide la ventana de 24 h y el traspaso a la etapa Vencidos)
ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS ultimo_entrante_en timestamptz;

ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS ultimo_entrante_api_en timestamptz;

COMMENT ON COLUMN public.conversaciones.ultimo_entrante_en IS
  'Fecha del último mensaje RECIBIDO del cliente (cualquier canal).';

COMMENT ON COLUMN public.conversaciones.ultimo_entrante_api_en IS
  'Fecha del último mensaje del cliente que entró por el WhatsApp API (meta_business). Base de la ventana de 24 h y del traspaso a Vencidos.';

-- 2) Índice que hace barato el MAX(creado_en) por conversación (solo entrantes)
CREATE INDEX IF NOT EXISTS mensajes_conv_entrante_idx
  ON public.mensajes (conversacion_id, creado_en DESC)
  WHERE tipo <> 'enviado';

-- 3) Relleno inicial del historial ya guardado
UPDATE public.conversaciones c
SET ultimo_entrante_en = m.ultimo
FROM (
  SELECT conversacion_id, max(creado_en) AS ultimo
  FROM public.mensajes
  WHERE COALESCE(tipo, '') <> 'enviado'
  GROUP BY conversacion_id
) m
WHERE m.conversacion_id = c.id
  AND (c.ultimo_entrante_en IS NULL OR c.ultimo_entrante_en < m.ultimo);

-- La marca del API solo se puede rellenar donde la fila es de un único chat del
-- WhatsApp API: los mensajes no guardan su canal. En los chats unificados (API +
-- Personal en la misma fila) la completa /api/chatwoot/sync, que sí conoce el
-- canal de cada conversación de Chatwoot.
UPDATE public.conversaciones c
SET ultimo_entrante_api_en = c.ultimo_entrante_en
WHERE c.fuente = 'meta_business'
  AND cardinality(c.chatwoot_conversation_ids) <= 1
  AND c.ultimo_entrante_en IS NOT NULL
  AND (c.ultimo_entrante_api_en IS NULL OR c.ultimo_entrante_api_en < c.ultimo_entrante_en);

-- 4) Trigger: cada mensaje mantiene la marca de su conversación.
--    La marca del API solo se adelanta en las filas de UN solo chat del API: en
--    los chats unificados (varios ids en chatwoot_conversation_ids) los mensajes
--    pueden venir del WhatsApp Personal y el trigger no sabe distinguirlo, así
--    que ahí la mantiene /api/chatwoot/sync, que sí conoce el canal. Sin esto, una
--    respuesta del cliente por el WhatsApp Personal parecería «reabrir» la
--    ventana del API y sacaría el chat de la etapa Vencidos.
CREATE OR REPLACE FUNCTION public.actualizar_ultimo_entrante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Camino rápido: un mensaje nuevo solo puede adelantar la marca.
    IF COALESCE(NEW.tipo, '') <> 'enviado' THEN
      UPDATE public.conversaciones
         SET ultimo_entrante_en = GREATEST(
               COALESCE(ultimo_entrante_en, 'epoch'::timestamptz),
               COALESCE(NEW.creado_en, now())
             ),
             -- Solo las filas del WhatsApp API adelantan la marca del API, y solo
             -- si son de un único chat del API (las unificadas las mantiene la
             -- sincronización, que conoce el canal real de cada mensaje).
             ultimo_entrante_api_en = CASE
               WHEN fuente = 'meta_business' AND cardinality(chatwoot_conversation_ids) <= 1
                 THEN GREATEST(COALESCE(ultimo_entrante_api_en, 'epoch'::timestamptz), COALESCE(NEW.creado_en, now()))
               ELSE ultimo_entrante_api_en
             END
       WHERE id = NEW.conversacion_id
         AND (ultimo_entrante_en IS NULL OR ultimo_entrante_en < COALESCE(NEW.creado_en, now()));
    END IF;
    RETURN NULL;
  END IF;

  -- Ediciones y borrados (reparaciones de Chatwoot, borrado de media, etc.):
  -- se recalcula la conversación afectada para no dejar una marca vieja.
  v_conv := COALESCE(NEW.conversacion_id, OLD.conversacion_id);
  IF v_conv IS NOT NULL THEN
    UPDATE public.conversaciones c
       SET ultimo_entrante_en = (
             SELECT max(m.creado_en) FROM public.mensajes m
              WHERE m.conversacion_id = v_conv AND COALESCE(m.tipo, '') <> 'enviado'
           ),
           ultimo_entrante_api_en = CASE
             WHEN c.fuente = 'meta_business' AND cardinality(c.chatwoot_conversation_ids) <= 1 THEN (
               SELECT max(m.creado_en) FROM public.mensajes m
                WHERE m.conversacion_id = v_conv AND COALESCE(m.tipo, '') <> 'enviado'
             )
             ELSE c.ultimo_entrante_api_en
           END
     WHERE c.id = v_conv;
  END IF;

  -- Si el mensaje cambió de conversación, la anterior también se recalcula.
  IF TG_OP = 'UPDATE' AND OLD.conversacion_id IS DISTINCT FROM NEW.conversacion_id THEN
    UPDATE public.conversaciones c
       SET ultimo_entrante_en = (
             SELECT max(m.creado_en) FROM public.mensajes m
              WHERE m.conversacion_id = OLD.conversacion_id AND COALESCE(m.tipo, '') <> 'enviado'
           ),
           ultimo_entrante_api_en = CASE
             WHEN c.fuente = 'meta_business' AND cardinality(c.chatwoot_conversation_ids) <= 1 THEN (
               SELECT max(m.creado_en) FROM public.mensajes m
                WHERE m.conversacion_id = OLD.conversacion_id AND COALESCE(m.tipo, '') <> 'enviado'
             )
             ELSE c.ultimo_entrante_api_en
           END
     WHERE c.id = OLD.conversacion_id;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_actualizar_ultimo_entrante ON public.mensajes;
CREATE TRIGGER trg_actualizar_ultimo_entrante
AFTER INSERT OR UPDATE OR DELETE ON public.mensajes
FOR EACH ROW EXECUTE FUNCTION public.actualizar_ultimo_entrante();

-- 5) Reparación manual: recalcula TODAS las conversaciones de una vez.
--    Útil si algún día se importa historial a mano:
--      SELECT public.recalcular_ultimos_entrantes();
CREATE OR REPLACE FUNCTION public.recalcular_ultimos_entrantes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_filas integer;
BEGIN
  UPDATE public.conversaciones c
     SET ultimo_entrante_en = m.ultimo,
         ultimo_entrante_api_en = CASE
           WHEN c.fuente = 'meta_business' AND cardinality(c.chatwoot_conversation_ids) <= 1 THEN m.ultimo
           ELSE c.ultimo_entrante_api_en
         END
  FROM (
    SELECT conversacion_id, max(creado_en) AS ultimo
    FROM public.mensajes
    WHERE COALESCE(tipo, '') <> 'enviado'
    GROUP BY conversacion_id
  ) m
  WHERE m.conversacion_id = c.id
    AND (
      c.ultimo_entrante_en IS DISTINCT FROM m.ultimo
      OR (
        c.fuente = 'meta_business'
        AND cardinality(c.chatwoot_conversation_ids) <= 1
        AND c.ultimo_entrante_api_en IS DISTINCT FROM m.ultimo
      )
    );

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas;
END $$;
