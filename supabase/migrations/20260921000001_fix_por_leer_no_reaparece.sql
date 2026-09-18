-- Fix: Por leer no debe reaparecer 2s después de leer.
-- Causa: conversaciones duplicadas por cliente_id. marcar_leido solo limpiaba 1 id,
-- pero fetchConversaciones suma no_leidos de todas las filas del mismo cliente.
-- Además, al abrir el chat el frontend solo limpiaba una fila optimistamente.

-- 1. marcar_leido ahora limpia TODAS las conversaciones del mismo cliente_id
CREATE OR REPLACE FUNCTION public.marcar_leido(p_conv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid;
BEGIN
  SELECT cliente_id INTO v_cliente_id FROM public.conversaciones WHERE id = p_conv_id;
  IF v_cliente_id IS NOT NULL THEN
    UPDATE public.conversaciones
       SET no_leidos = 0,
           ultimo_leido_en = now()
     WHERE cliente_id = v_cliente_id;
  ELSE
    UPDATE public.conversaciones
       SET no_leidos = 0,
           ultimo_leido_en = now()
     WHERE id = p_conv_id;
  END IF;
END $$;

-- 2. sincronizar_no_leidos: si hay varias filas por cliente, usar el ultimo_leido_en más reciente de ese cliente
-- para recalcular, así no reaparece por una fila secundaria con marca vieja.
CREATE OR REPLACE FUNCTION public.sincronizar_no_leidos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Primero asegurar que todas las filas del mismo cliente compartan la marca más reciente
  WITH max_leido AS (
    SELECT cliente_id, max(ultimo_leido_en) as max_leido
    FROM public.conversaciones
    WHERE cliente_id IS NOT NULL
    GROUP BY cliente_id
    HAVING count(*) > 1
  )
  UPDATE public.conversaciones c
     SET ultimo_leido_en = ml.max_leido
    FROM max_leido ml
   WHERE c.cliente_id = ml.cliente_id
     AND c.ultimo_leido_en IS DISTINCT FROM ml.max_leido;

  -- Recalcular contador
  UPDATE public.conversaciones c
  SET no_leidos = (
    SELECT count(*)::int
    FROM public.mensajes m
    WHERE m.conversacion_id = c.id
      AND m.tipo <> 'enviado'
      AND m.creado_en > COALESCE(c.ultimo_leido_en, '1970-01-01'::timestamptz)
  );
END $$;

-- 3. Trigger de incremento: si el mensaje entra en una conversación secundaria,
-- también actualizar ultimo_mensaje_en de la principal para que el merge no pierda orden,
-- pero no duplicar no_leidos en la suma (el frontend ya suma, así que solo incrementamos la fila donde se insertó).
-- Mantenemos el trigger simple, pero nos aseguramos que unificar limpie después.
-- No cambiamos incrementar_no_leidos_entrante, solo recalculamos con sincronizar.

GRANT EXECUTE ON FUNCTION public.marcar_leido(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_no_leidos() TO anon, authenticated;

-- 4. Limpieza inmediata: unificar y poner a 0 lo que ya fue leído recientemente
SELECT public.unificar_conversaciones_whatsapp();
SELECT public.sincronizar_no_leidos();
