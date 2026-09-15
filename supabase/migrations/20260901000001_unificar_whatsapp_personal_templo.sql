-- Unifica automáticamente las conversaciones del mismo cliente.
-- Conserva como principal la conversación de WhatsApp Personal (Evolution),
-- copia allí los mensajes del WhatsApp API respetando creado_en y elimina la
-- conversación API duplicada. Se ejecuta dentro de una sola transacción.

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
       AND c.fuente = 'meta_business'
       AND EXISTS (
         SELECT 1 FROM public.conversaciones p
          WHERE p.cliente_id = c.cliente_id AND p.fuente = 'evolution'
       )
  LOOP
    SELECT id INTO v_personal
      FROM public.conversaciones
     WHERE cliente_id = v_cliente.cliente_id AND fuente = 'evolution'
     ORDER BY ultimo_mensaje_en DESC NULLS LAST, creado_en ASC NULLS LAST
     LIMIT 1;

    FOR v_meta IN
      SELECT id FROM public.conversaciones
       WHERE cliente_id = v_cliente.cliente_id
         AND fuente = 'meta_business'
    LOOP
      -- Evitar duplicados si una ejecución anterior ya copió el mismo mensaje.
      INSERT INTO public.mensajes
        (conversacion_id, tipo, contenido, tipo_contenido, url_archivo, creado_en)
      SELECT v_personal, m.tipo, m.contenido, m.tipo_contenido, m.url_archivo, m.creado_en
        FROM public.mensajes m
       WHERE m.conversacion_id = v_meta.id
         AND NOT EXISTS (
           SELECT 1 FROM public.mensajes x
            WHERE x.conversacion_id = v_personal
              AND x.tipo = m.tipo
              AND x.creado_en = m.creado_en
              AND COALESCE(x.contenido, '') = COALESCE(m.contenido, '')
         );

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
