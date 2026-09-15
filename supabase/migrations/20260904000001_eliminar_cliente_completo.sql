-- ============================================================================
-- 🗑️ ELIMINAR CLIENTE COMPLETAMENTE
-- ----------------------------------------------------------------------------
-- Borra de forma permanente toda la información del cliente dentro del CRM.
-- Al no quedar ninguna fila en `clientes`, el siguiente mensaje de ese número
-- crea un cliente nuevo y vuelve a entrar como Lead Nuevo.
--
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- La función es transaccional: si una eliminación falla, no deja el cliente
-- borrado a medias.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eliminar_cliente_completo(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversacion_ids uuid[];
  v_conversaciones integer := 0;
  v_mensajes integer := 0;
  v_pagos integer := 0;
  v_tareas integer := 0;
  v_recordatorios integer := 0;
  v_reglas integer := 0;
  v_clientes integer := 0;
BEGIN
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'El cliente es obligatorio';
  END IF;

  -- Guardamos todas las conversaciones antes de borrarlas. Esto cubre también
  -- historiales duplicados o conversaciones de los dos números de WhatsApp.
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_conversacion_ids
    FROM public.conversaciones
   WHERE cliente_id = p_cliente_id;

  v_conversaciones := cardinality(v_conversacion_ids);

  -- Estas tablas son opcionales en instalaciones antiguas. Se consultan de
  -- forma dinámica para que la migración siga siendo compatible si Cerebro o
  -- los recordatorios todavía no se han instalado.
  IF to_regclass('public.recordatorios_whatsapp') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.recordatorios_whatsapp WHERE cliente_id = $1'
      USING p_cliente_id;
    GET DIAGNOSTICS v_recordatorios = ROW_COUNT;
  END IF;

  IF to_regclass('public.cerebro_reglas') IS NOT NULL THEN
    EXECUTE $sql$
      DELETE FROM public.cerebro_reglas
       WHERE cliente_id = $1
          OR (cardinality($2) > 0 AND conversacion_id = ANY($2))
    $sql$
      USING p_cliente_id, v_conversacion_ids;
    GET DIAGNOSTICS v_reglas = ROW_COUNT;
  END IF;

  -- Borrar primero los registros que dependen del cliente o de sus chats.
  DELETE FROM public.tareas WHERE cliente_id = p_cliente_id;
  GET DIAGNOSTICS v_tareas = ROW_COUNT;

  DELETE FROM public.pagos WHERE cliente_id = p_cliente_id;
  GET DIAGNOSTICS v_pagos = ROW_COUNT;

  IF v_conversaciones > 0 THEN
    DELETE FROM public.mensajes
     WHERE conversacion_id = ANY(v_conversacion_ids);
    GET DIAGNOSTICS v_mensajes = ROW_COUNT;
  END IF;

  DELETE FROM public.conversaciones WHERE cliente_id = p_cliente_id;

  -- Este es el punto clave: eliminar el cliente físico, no archivarlo ni
  -- marcarlo como perdido. Así el webhook no lo puede reutilizar por teléfono.
  DELETE FROM public.clientes WHERE id = p_cliente_id;
  GET DIAGNOSTICS v_clientes = ROW_COUNT;

  RETURN jsonb_build_object(
    'cliente_id', p_cliente_id,
    'cliente_eliminado', v_clientes,
    'conversaciones_eliminadas', v_conversaciones,
    'mensajes_eliminados', v_mensajes,
    'pagos_eliminados', v_pagos,
    'tareas_eliminadas', v_tareas,
    'recordatorios_eliminados', v_recordatorios,
    'reglas_cerebro_eliminadas', v_reglas
  );
END;
$$;

-- El CRM usa la anon key desde el navegador. La función tiene SECURITY DEFINER
-- para poder eliminar en orden aun cuando las tablas tengan RLS activado.
REVOKE ALL ON FUNCTION public.eliminar_cliente_completo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_cliente_completo(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.eliminar_cliente_completo(uuid) IS
  'Elimina de forma permanente un cliente y todos sus datos CRM; el siguiente mensaje crea un lead nuevo.';
