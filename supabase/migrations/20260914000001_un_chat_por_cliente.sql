-- Un chat CRM por cliente: guarda todos los conversation_id de Chatwoot
-- (WhatsApp API + WhatsApp Personal) en la misma fila.

ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS chatwoot_conversation_ids text[] NOT NULL DEFAULT '{}';

UPDATE public.conversaciones
   SET chatwoot_conversation_ids = ARRAY[chatwoot_conversation_id]
 WHERE chatwoot_conversation_id IS NOT NULL
   AND (chatwoot_conversation_ids IS NULL OR cardinality(chatwoot_conversation_ids) = 0);

CREATE INDEX IF NOT EXISTS conversaciones_chatwoot_ids_gin
  ON public.conversaciones USING gin (chatwoot_conversation_ids);

-- Fusiona duplicados: conserva Evolution (Personal) y mueve mensajes + ids.
CREATE OR REPLACE FUNCTION public.unificar_conversaciones_whatsapp()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente record;
  v_personal uuid;
  v_meta record;
  v_total integer := 0;
  v_ultimo record;
BEGIN
  FOR v_cliente IN
    SELECT DISTINCT c.cliente_id
      FROM public.conversaciones c
     WHERE c.cliente_id IS NOT NULL
     GROUP BY c.cliente_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO v_personal
      FROM public.conversaciones
     WHERE cliente_id = v_cliente.cliente_id
     ORDER BY (fuente = 'evolution') DESC,
              ultimo_mensaje_en DESC NULLS LAST,
              creado_en ASC NULLS LAST
     LIMIT 1;

    FOR v_meta IN
      SELECT id, chatwoot_conversation_id, chatwoot_conversation_ids
        FROM public.conversaciones
       WHERE cliente_id = v_cliente.cliente_id
         AND id <> v_personal
    LOOP
      INSERT INTO public.mensajes
        (conversacion_id, tipo, contenido, tipo_contenido, url_archivo, creado_en, chatwoot_message_id)
      SELECT v_personal, m.tipo, m.contenido, m.tipo_contenido, m.url_archivo, m.creado_en, m.chatwoot_message_id
        FROM public.mensajes m
       WHERE m.conversacion_id = v_meta.id
         AND NOT EXISTS (
           SELECT 1 FROM public.mensajes x
            WHERE x.conversacion_id = v_personal
              AND (
                (m.chatwoot_message_id IS NOT NULL AND x.chatwoot_message_id = m.chatwoot_message_id)
                OR (
                  x.tipo = m.tipo
                  AND x.creado_en = m.creado_en
                  AND COALESCE(x.contenido, '') = COALESCE(m.contenido, '')
                )
              )
         );

      UPDATE public.conversaciones
         SET chatwoot_conversation_ids = (
           SELECT ARRAY(
             SELECT DISTINCT unnest(
               COALESCE(chatwoot_conversation_ids, '{}')
               || COALESCE(v_meta.chatwoot_conversation_ids, '{}')
               || CASE WHEN v_meta.chatwoot_conversation_id IS NOT NULL
                       THEN ARRAY[v_meta.chatwoot_conversation_id] ELSE '{}' END
             )
           )
         )
       WHERE id = v_personal;

      DELETE FROM public.mensajes WHERE conversacion_id = v_meta.id;
      DELETE FROM public.conversaciones WHERE id = v_meta.id;
      v_total := v_total + 1;
    END LOOP;

    SELECT m.contenido, m.creado_en
      INTO v_ultimo
      FROM public.mensajes m
     WHERE m.conversacion_id = v_personal
     ORDER BY m.creado_en DESC NULLS LAST
     LIMIT 1;

    UPDATE public.conversaciones
       SET ultimo_mensaje = v_ultimo.contenido,
           ultimo_mensaje_en = v_ultimo.creado_en,
           no_leidos = (
             SELECT count(*)::integer FROM public.mensajes x
              WHERE x.conversacion_id = v_personal
                AND x.tipo <> 'enviado'
                AND x.creado_en > COALESCE(public.conversaciones.ultimo_leido_en, '1970-01-01'::timestamptz)
           )
     WHERE id = v_personal;
  END LOOP;
  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unificar_conversaciones_whatsapp() TO anon, authenticated;
