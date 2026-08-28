-- ============================================================================
-- 🧹 LUNA: consolidar las etapas "Nuevo Lead" y "Datos" POR NOMBRE
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin riesgo; si no hay duplicados
-- no pasa nada.
--
-- PROBLEMA:
--   Las migraciones anteriores crearon filas EXTRA con nombre "Nuevo Lead" y
--   "Datos" en varios grupos (claves tipo datos_templo_<ts>,
--   datos_personal_<ts> ...), duplicando la etapa "Datos" que ya estaba
--   creada en el pipeline del usuario. El CRM mostraba varias etapas "Datos"
--   y los clientes quedaban apuntando a claves duplicadas.
--
-- LO QUE HACE ESTA MIGRACIÓN (NUNCA CREAR NINGUNA ETAPA):
--   1. Busca todas las filas de pipeline_etapas cuyo NOMBRE visible es
--      "Nuevo Lead" o "Datos" (cualquier clave, cualquier grupo).
--   2. Deja UNA sola fila por nombre, conservando la etapa que ya existe:
--        * "Datos": la etapa creada por el usuario (clave etapa_<ts>), si no
--          hay, la más referenciada por clientes, si no, la más antigua.
--        * "Nuevo Lead": la fila con clave 'nuevo_lead' (el trigger de
--          enrutado de leads escribe esa literal), si no existe, la etapa
--          creada por el usuario, si no, la más referenciada.
--   3. Re-apunta a TODOS los clientes cuyo estado apuntaba a una clave
--      eliminada, o a una clave que no existe en el pipeline pero se
--      reconoce por nombre ("datos", "nuevo_lead", "datos_templo_...", etc.).
--   4. Si no hay ninguna fila con clave 'nuevo_lead', renombra a esa clave la
--      "Nuevo Lead" que sobrevive (sigue siendo la MISMA etapa del usuario:
--      mismo nombre, color y orden), para que el trigger siga haciendo caer
--      los leads de publicidad en la etapa existente.
--
-- RESULTADO: una sola "Nuevo Lead" y una sola "Datos" — la que ya estaba
-- creada — y Luna las reconoce por NOMBRE (el workflow n8n busca por nombre
-- visible y ya no escribe claves inventadas ni crea etapas).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CONSOLIDAR DUPLICADOS POR NOMBRE (sin crear nada)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_nombre text;
  v_sob record;
  v_dup record;
  v_n_elim integer := 0;
BEGIN
  FOREACH v_nombre IN ARRAY ARRAY['nuevo lead', 'datos']
  LOOP
    -- Sobreviviente: UNA sola etapa con ese nombre visible
    SELECT * INTO v_sob
    FROM (
      SELECT p.id, p.clave, p.nombre, p.orden, p.grupo, p.creado_en,
             (SELECT count(*) FROM public.clientes c WHERE c.estado = p.clave) AS refs
        FROM public.pipeline_etapas p
       WHERE lower(btrim(p.nombre)) = v_nombre
         AND COALESCE(p.es_spam, false) = false
         AND COALESCE(p.es_archivado, false) = false
       ORDER BY
         CASE
           WHEN v_nombre = 'nuevo lead' AND p.clave = 'nuevo_lead' THEN 0
           WHEN v_nombre = 'datos' AND p.clave ~ '^etapa_[0-9]+$' THEN 0
           WHEN v_nombre = 'nuevo lead' AND p.clave ~ '^etapa_[0-9]+$' THEN 1
           ELSE 2
         END,
         refs DESC,
         COALESCE(p.creado_en, '1970-01-01'::timestamptz) ASC,
         p.clave ASC
    ) s
    LIMIT 1;

    IF v_sob.id IS NULL THEN
      RAISE NOTICE 'Etapa "%" no existe en el pipeline: no se crea ninguna (Luna no crea etapas; usa la que ya esta creada).', v_nombre;
      CONTINUE;
    END IF;

    -- Eliminar los duplicados con el mismo nombre visible y re-apuntar clientes
    FOR v_dup IN
      SELECT p.id, p.clave, p.nombre
        FROM public.pipeline_etapas p
       WHERE lower(btrim(p.nombre)) = v_nombre
         AND COALESCE(p.es_spam, false) = false
         AND COALESCE(p.es_archivado, false) = false
         AND p.id <> v_sob.id
       ORDER BY p.orden
    LOOP
      UPDATE public.clientes
         SET estado = v_sob.clave, actualizado_en = now()
       WHERE estado = v_dup.clave;
      DELETE FROM public.pipeline_etapas WHERE id = v_dup.id;
      v_n_elim := v_n_elim + 1;
      RAISE NOTICE 'Consolidado: eliminada la etapa duplicada "%" (clave %) → los clientes pasan a la etapa ya creada (clave %).',
        v_dup.nombre, v_dup.clave, v_sob.clave;
    END LOOP;
  END LOOP;

  IF v_n_elim = 0 THEN
    RAISE NOTICE 'Sin duplicados por nombre: no se elimino ninguna etapa.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. RE-APUNTAR CLIENTES CUYO ESTADO ES UNA CLAVE QUE NO EXISTE EN EL
--    PIPELINE pero se reconoce por NOMBRE como "Datos" o "Nuevo Lead"
--    (los que Luna movio antes con claves semilla/duplicadas)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_datos text;
  v_nuevo text;
  v_estado record;
  v_cambios integer := 0;
BEGIN
  SELECT clave INTO v_datos
    FROM public.pipeline_etapas
   WHERE lower(btrim(nombre)) = 'datos'
     AND COALESCE(es_spam, false) = false
     AND COALESCE(es_archivado, false) = false
   ORDER BY orden
   LIMIT 1;

  SELECT clave INTO v_nuevo
    FROM public.pipeline_etapas
   WHERE lower(btrim(nombre)) = 'nuevo lead'
     AND COALESCE(es_spam, false) = false
     AND COALESCE(es_archivado, false) = false
   ORDER BY orden
   LIMIT 1;

  FOR v_estado IN
    SELECT DISTINCT estado FROM public.clientes
     WHERE estado IS NOT NULL
       AND btrim(estado) <> ''
  LOOP
    -- Solo nos interesan los estados cuya clave YA NO existe en el pipeline
    IF EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = v_estado.estado) THEN
      CONTINUE;
    END IF;

    IF v_datos IS NOT NULL AND (
         lower(v_estado.estado) IN (
           'datos', 'datos_templo', 'datos_personal', 'datos_cliente', 'datos_del_cliente',
           'solicitar_datos', 'solicitud_datos', 'pedir_datos', 'en_datos',
           'recoger_datos', 'recoleccion_datos'
         )
         OR lower(v_estado.estado) LIKE 'datos\_%'
       ) THEN
      UPDATE public.clientes
         SET estado = v_datos, actualizado_en = now()
       WHERE estado = v_estado.estado;
      v_cambios := v_cambios + 1;
      RAISE NOTICE 'Clientes con estado "%" (clave que no existe) → etapa ya creada "Datos" (clave %).', v_estado.estado, v_datos;
    ELSIF v_nuevo IS NOT NULL AND (
         lower(v_estado.estado) IN (
           'nuevo_lead', 'lead_nuevo', 'leadnuevo', 'nuevo', 'lead',
           'nuevo_lead_templo', 'nuevo_lead_personal', 'nuevo_templo',
           'nuevo_cliente', 'nuevo_contacto', 'primer_contacto'
         )
         OR lower(v_estado.estado) LIKE 'nuevo_lead\_%'
       ) THEN
      UPDATE public.clientes
         SET estado = v_nuevo, actualizado_en = now()
       WHERE estado = v_estado.estado;
      v_cambios := v_cambios + 1;
      RAISE NOTICE 'Clientes con estado "%" (clave que no existe) → etapa ya creada "Nuevo Lead" (clave %).', v_estado.estado, v_nuevo;
    END IF;
  END LOOP;

  IF v_cambios = 0 THEN
    RAISE NOTICE 'Sin clientes apuntando a claves que no existen.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. CLAVE CANONICA "nuevo_lead": el trigger enrutar_cliente_por_numero
--    escribe esa clave literal al hacer caer leads de publicidad.
--    Si no existe la fila, la "Nuevo Lead" que sobrevive (la misma etapa del
--    usuario, sin crear ninguna) toma esa clave.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = 'nuevo_lead') THEN
    UPDATE public.pipeline_etapas
       SET clave = 'nuevo_lead'
     WHERE id = (
       SELECT id FROM public.pipeline_etapas
        WHERE lower(btrim(nombre)) = 'nuevo lead'
          AND COALESCE(es_spam, false) = false
          AND COALESCE(es_archivado, false) = false
        ORDER BY orden
        LIMIT 1
     );
    RAISE NOTICE 'La etapa "Nuevo Lead" ya creada ahora usa la clave canonica "nuevo_lead" (la que escribe el trigger de leads).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. RESUMEN DE VERIFICACION
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT nombre, clave, orden, grupo,
           (SELECT count(*) FROM public.clientes c WHERE c.estado = clave) AS clientes
      FROM public.pipeline_etapas
     WHERE lower(btrim(nombre)) IN ('nuevo lead', 'datos')
       AND COALESCE(es_spam, false) = false
       AND COALESCE(es_archivado, false) = false
     ORDER BY lower(btrim(nombre)), orden
  LOOP
    RAISE NOTICE 'Pipeline por nombre: "%" | clave=% | orden=% | grupo=% | clientes=%',
      r.nombre, r.clave, r.orden, COALESCE(r.grupo, '(null)'), r.clientes;
  END LOOP;
END $$;

-- ============================================================================
-- ✅ LISTO. A partir de ahora:
--    1) El pipeline tiene UNA sola "Nuevo Lead" y UNA sola "Datos" (las ya
--       creadas; no se creo ninguna etapa nueva).
--    2) Todos los clientes apuntan a esas claves reales.
--    3) Luna (n8n) resuelve las etapas por NOMBRE y ya no escribe claves
--       inventadas: si la etapa no existe, no mueve al cliente ni crea nada.
-- ============================================================================
