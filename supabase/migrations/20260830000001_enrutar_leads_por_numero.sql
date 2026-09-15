-- ============================================================================
-- 📲 ENRUTAR LEADS POR NÚMERO DE LLEGADA (publicidad → WhatsApp API Templo)
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- PROBLEMA: los leads de la publicidad paga llegan al número del WhatsApp API
-- (conversaciones.fuente = 'meta_business'), pero el webhook los guarda con
-- grupo='personal' y una etapa del pipeline personal (ej: "No Contesta").
-- Resultado: aparecen en la bandeja del WhatsApp personal en vez de caer en
-- "Nuevo Lead" del grupo Templo.
--
-- SOLUCIÓN: la procedencia la manda el NÚMERO al que escribió el lead:
--   * fuente = 'meta_business'  (WhatsApp API Templo)  → grupo Templo
--   * fuente = 'evolution'      (WhatsApp personal)    → grupo Personal
--
-- Esta migración:
--   1. Corrige los datos que ya están mal (backfill de todos los clientes).
--   2. Deja triggers que auto-corrigen cada vez que un webhook escriba mal,
--      venga de donde venga el dato (ahora y en el futuro).
--
-- REGLAS (solo para clientes con conversación en el número Templo):
--   - Si TODAS sus conversaciones son del número Templo → grupo='templo'.
--   - Si su estado es una etapa del pipeline PERSONAL (ej: "No Contesta",
--     "Nuevo Lead" personal) y el cliente pertenece al Templo → se convierte
--     a su equivalente Templo; las etapas personales personalizadas caen a
--     'nuevo_lead_templo' (Lead Nuevo del Templo).
--   - Los estados Templo válidos y los cambios hechos a mano por el operador
--     NO se tocan.
--   - Los leads del WhatsApp personal (sin conversación meta_business) no se
--     tocan para nada: "No Contesta" del personal sigue igual que siempre.
-- ============================================================================

-- 1. FUNCIÓN DE ENRUTADO (una llamada corrige un cliente según su número)
CREATE OR REPLACE FUNCTION public.enrutar_cliente_por_numero(p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta integer;
  v_otras integer;
  v_grupo_actual text;
  v_estado_actual text;
  v_grupo_nuevo text;
  v_estado_nuevo text;
BEGIN
  SELECT count(*) FILTER (WHERE fuente = 'meta_business'),
         count(*) FILTER (WHERE fuente IS DISTINCT FROM 'meta_business')
    INTO v_meta, v_otras
    FROM public.conversaciones
   WHERE cliente_id = p_cliente_id;

  -- Lead sin ninguna conversación en el número Templo: no se toca
  IF v_meta = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(grupo, ''), COALESCE(estado, '')
    INTO v_grupo_actual, v_estado_actual
    FROM public.clientes
   WHERE id = p_cliente_id;

  -- Grupo: Templo si todas sus conversaciones son del número API
  IF v_otras = 0 THEN
    v_grupo_nuevo := 'templo';
  ELSE
    v_grupo_nuevo := v_grupo_actual;
  END IF;

  -- Estado: etapas del pipeline PERSONAL (o vacías) se convierten a Templo
  v_estado_nuevo := v_estado_actual;
  IF COALESCE(v_grupo_nuevo, '') = 'templo' AND (
       v_estado_actual = '' OR EXISTS (
         SELECT 1 FROM public.pipeline_etapas e
          WHERE e.clave = v_estado_actual
            AND e.grupo = 'personal'
       )
     ) THEN
    v_estado_nuevo := CASE v_estado_actual
      WHEN 'nuevo_lead'         THEN 'nuevo_lead_templo'
      WHEN 'en_consulta'        THEN 'en_consulta_templo'
      WHEN 'consulta_hecha'     THEN 'consulta_hecha_templo'
      WHEN 'pago_recibido'      THEN 'pago_recibido_templo'
      WHEN 'trabajo_proceso'    THEN 'trabajo_proceso_templo'
      WHEN 'trabajo_completado' THEN 'trabajo_completado_templo'
      WHEN 'perdido'            THEN 'perdido_templo'
      ELSE 'nuevo_lead_templo' -- etapas personales personalizadas (ej: "No Contesta") → Lead Nuevo Templo
    END;
  END IF;

  IF v_grupo_nuevo IS DISTINCT FROM NULLIF(v_grupo_actual, '')
     OR v_estado_nuevo IS DISTINCT FROM v_estado_actual THEN
    UPDATE public.clientes
       SET grupo = NULLIF(v_grupo_nuevo, ''),
           estado = NULLIF(v_estado_nuevo, ''),
           atendido = CASE WHEN v_estado_nuevo = 'consulta_hecha_templo'
                           THEN true ELSE clientes.atendido END,
           actualizado_en = now()
     WHERE id = p_cliente_id;
  END IF;
END;
$$;

-- 2. TRIGGER SOBRE CLIENTES: cada vez que un webhook escriba grupo/estado,
--    se re-enruta según el número donde realmente escribió el lead.
CREATE OR REPLACE FUNCTION public.clientes_enrutar_por_numero_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enrutar_cliente_por_numero(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clientes_enrutar_por_numero ON public.clientes;
CREATE TRIGGER clientes_enrutar_por_numero
AFTER INSERT OR UPDATE OF estado, grupo ON public.clientes
FOR EACH ROW
WHEN (pg_trigger_depth() < 2)
EXECUTE FUNCTION public.clientes_enrutar_por_numero_trg();

-- 3. TRIGGER SOBRE CONVERSACIONES: cuando llegue una conversación nueva al
--    número del WhatsApp API, el cliente queda en el grupo Templo.
CREATE OR REPLACE FUNCTION public.conversaciones_enrutar_cliente_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cliente_id IS NOT NULL THEN
    PERFORM public.enrutar_cliente_por_numero(NEW.cliente_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversaciones_enrutar_cliente ON public.conversaciones;
CREATE TRIGGER conversaciones_enrutar_cliente
AFTER INSERT OR UPDATE OF fuente, cliente_id ON public.conversaciones
FOR EACH ROW
WHEN (pg_trigger_depth() < 2)
EXECUTE FUNCTION public.conversaciones_enrutar_cliente_trg();

-- 4. BACKFILL: corrige todos los leads que ya cayeron mal clasificados
SELECT public.enrutar_cliente_por_numero(id) FROM public.clientes;

-- ============================================================================
-- ✅ LISTO. A partir de ahora:
--    1) Todo lead que escriba al número del WhatsApp API (Templo) cae en
--       "Nuevo Lead" del grupo Templo, sin importar cómo lo clasifique el
--       webhook ("No Contesta" del personal ya no se lo roba).
--    2) Los leads del WhatsApp personal siguen funcionando igual (incluida
--       su etapa "No Contesta").
--    3) Si mueves un cliente a una etapa del otro grupo desde el CRM, la
--       bandeja lo sigue (el CRM también sincroniza el grupo al mover etapa).
-- ============================================================================
