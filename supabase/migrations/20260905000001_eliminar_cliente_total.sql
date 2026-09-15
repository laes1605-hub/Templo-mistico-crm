-- ============================================================================
-- 🗑️ ELIMINAR CLIENTE TOTAL (versión 2)
-- ----------------------------------------------------------------------------
-- Reemplaza la función de 20260904_eliminar_cliente_completo.sql por una que ya
-- no depende de una lista fija de tablas: recorre TODAS las tablas del esquema
-- public que tengan columna `cliente_id` o `conversacion_id` y borra las filas
-- de ese cliente. Así, aunque mañana agregues una tabla nueva (campañas,
-- seguimientos, lo que sea), el botón Eliminar la sigue limpiando sola.
--
-- Orden de borrado (para no pelear con las llaves foráneas):
--   1) tablas que cuelgan de la conversación (mensajes, reglas del cerebro...)
--   2) tablas que cuelgan del cliente (pagos, tareas, recordatorios...)
--   3) conversaciones
--   4) clientes  ← sin esta fila, el siguiente mensaje crea un lead nuevo
--
-- Toda la función corre en una sola transacción: si algo falla, no queda el
-- cliente borrado a medias.
--
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.eliminar_cliente_completo(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversacion_ids uuid[];
  v_tabla            record;
  v_borrados         integer;
  v_conversaciones   integer := 0;
  v_clientes         integer := 0;
  v_detalle          jsonb := '{}'::jsonb;
BEGIN
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'El cliente es obligatorio';
  END IF;

  -- --------------------------------------------------------------------------
  -- 0. Conversaciones del cliente (puede tener varias: WhatsApp personal y del
  --    templo, o historiales duplicados). Se leen antes de borrar nada.
  -- --------------------------------------------------------------------------
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_conversacion_ids
    FROM public.conversaciones
   WHERE cliente_id = p_cliente_id;

  v_conversaciones := cardinality(v_conversacion_ids);

  -- --------------------------------------------------------------------------
  -- 1. Todo lo que cuelga de una conversación de este cliente.
  --    relkind in ('r','p') deja por fuera vistas y vistas materializadas.
  -- --------------------------------------------------------------------------
  IF v_conversaciones > 0 THEN
    FOR v_tabla IN
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN pg_class      pc ON pc.relname = c.table_name
        JOIN pg_namespace  pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
       WHERE c.table_schema = 'public'
         AND c.column_name  = 'conversacion_id'
         AND pc.relkind IN ('r','p')
         AND c.table_name NOT IN ('conversaciones')
       ORDER BY c.table_name
    LOOP
      EXECUTE format('DELETE FROM public.%I WHERE conversacion_id = ANY($1)', v_tabla.table_name)
        USING v_conversacion_ids;
      GET DIAGNOSTICS v_borrados = ROW_COUNT;
      IF v_borrados > 0 THEN
        v_detalle := v_detalle || jsonb_build_object(v_tabla.table_name, v_borrados);
      END IF;
    END LOOP;
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. Todo lo que cuelga del cliente.
  -- --------------------------------------------------------------------------
  FOR v_tabla IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN pg_class      pc ON pc.relname = c.table_name
      JOIN pg_namespace  pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
     WHERE c.table_schema = 'public'
       AND c.column_name  = 'cliente_id'
       AND pc.relkind IN ('r','p')
       AND c.table_name NOT IN ('clientes', 'conversaciones')
     ORDER BY c.table_name
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE cliente_id = $1', v_tabla.table_name)
      USING p_cliente_id;
    GET DIAGNOSTICS v_borrados = ROW_COUNT;
    IF v_borrados > 0 THEN
      v_detalle := v_detalle || jsonb_build_object(v_tabla.table_name, v_borrados);
    END IF;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 3. Conversaciones y 4. cliente.
  -- --------------------------------------------------------------------------
  DELETE FROM public.conversaciones WHERE cliente_id = p_cliente_id;
  GET DIAGNOSTICS v_conversaciones = ROW_COUNT;

  DELETE FROM public.clientes WHERE id = p_cliente_id;
  GET DIAGNOSTICS v_clientes = ROW_COUNT;

  IF v_clientes = 0 THEN
    RAISE EXCEPTION 'No se encontró el cliente % en public.clientes', p_cliente_id;
  END IF;

  RETURN jsonb_build_object(
    'cliente_id',                  p_cliente_id,
    'cliente_eliminado',           v_clientes,
    'conversaciones_eliminadas',   v_conversaciones,
    'mensajes_eliminados',         COALESCE((v_detalle->>'mensajes')::integer, 0),
    'pagos_eliminados',            COALESCE((v_detalle->>'pagos')::integer, 0),
    'tareas_eliminadas',           COALESCE((v_detalle->>'tareas')::integer, 0),
    'recordatorios_eliminados',    COALESCE((v_detalle->>'recordatorios_whatsapp')::integer, 0),
    'reglas_cerebro_eliminadas',   COALESCE((v_detalle->>'cerebro_reglas')::integer, 0),
    'otras_tablas',                v_detalle - ARRAY['mensajes','pagos','tareas','recordatorios_whatsapp','cerebro_reglas']
  );
END;
$$;

-- El CRM llama esta función con la service role desde el endpoint
-- /api/clientes/eliminar; se deja EXECUTE para anon/authenticated para que la
-- instalación siga funcionando si alguien la llama desde el navegador.
REVOKE ALL ON FUNCTION public.eliminar_cliente_completo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_cliente_completo(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.eliminar_cliente_completo(uuid) IS
  'Elimina de forma permanente un cliente y TODAS sus filas en Supabase (recorre cualquier tabla con cliente_id o conversacion_id). El siguiente mensaje de ese numero crea un lead nuevo.';

-- ============================================================================
-- Verificación opcional después de ejecutar la migración:
--   SELECT public.eliminar_cliente_completo('uuid-del-cliente');
--   SELECT count(*) FROM public.clientes WHERE id = 'uuid-del-cliente';   -- 0
-- ============================================================================
