-- ============================================================================
-- ETAPA "VENCIDOS": TRASPASO DEL WHATSAPP API AL WHATSAPP PERSONAL
-- ----------------------------------------------------------------------------
-- Cuando un chat cuya etapa la responde el WhatsApp API (meta_business) deja
-- pasar la ventana de 24 h sin que el cliente escriba, ya no se puede responder
-- con texto libre por el API. El CRM lo mueve a la etapa "Vencidos", que se
-- responde desde el WhatsApp Personal, para poder continuar la conversación.
--
-- Si el cliente vuelve a escribir POR EL WHATSAPP API, el chat regresa solo a la
-- etapa donde estaba antes de vencer: para eso se guarda `estado_antes_vencido`.
--
-- Es idempotente: se puede correr las veces que sea sin romper nada.
-- ============================================================================

-- 1) Etapa receptora del traspaso: siempre controlada por WhatsApp Personal
DO $$
BEGIN
  -- Si el operador ya había creado una etapa llamada "Vencido/Vencidos" con otra
  -- clave, se normaliza en vez de duplicarla.
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = 'vencidos') THEN
    UPDATE public.pipeline_etapas
       SET clave = 'vencidos',
           cuenta_responsable = 'evolution',
           es_spam = false,
           es_archivado = false
     WHERE lower(trim(nombre)) IN ('vencidos', 'vencido')
       AND clave <> 'vencidos';
  END IF;

  -- Se crea al final del embudo si no existe.
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_etapas WHERE clave = 'vencidos') THEN
    INSERT INTO public.pipeline_etapas
      (clave, nombre, orden, color, bg_color, text_color, cuenta_responsable, grupo, es_spam, es_archivado)
    SELECT
      'vencidos',
      'Vencidos',
      COALESCE((SELECT max(orden) FROM public.pipeline_etapas WHERE es_spam IS NOT TRUE AND es_archivado IS NOT TRUE), 0) + 1,
      'border-red-500',
      'bg-red-500/10',
      'text-red-300',
      'evolution',
      'general',
      false,
      false;
  ELSE
    UPDATE public.pipeline_etapas
       SET nombre = 'Vencidos',
           cuenta_responsable = 'evolution'
     WHERE clave = 'vencidos';
  END IF;
END $$;

-- 2) Memoria de la etapa anterior: permite volver solo cuando el cliente
--    escribe otra vez por el WhatsApp API (se reabre la ventana de 24 h).
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS estado_antes_vencido text;

COMMENT ON COLUMN public.clientes.estado_antes_vencido IS
  'Etapa que tenía el cliente antes de pasar a Vencidos. Si vuelve a escribir por el WhatsApp API, el CRM lo regresa a esa etapa.';

-- Índice para que el traspaso automático no recorra toda la tabla.
CREATE INDEX IF NOT EXISTS clientes_vencidos_idx
  ON public.clientes (estado)
  WHERE estado = 'vencidos';

-- 3) Consulta de control (opcional): LISTA los clientes que están en etapas del
--    WhatsApp API con la ventana ya cerrada, es decir, los que el CRM movería a
--    Vencidos (esta función NO los mueve: el traspaso lo hace la app al abrirse,
--    para que quede dentro de la app y se pueda pausar desde Ajustes).
--      SELECT * FROM public.clientes_vencidos_whatsapp_api();
--    Para forzar el movimiento sin abrir el CRM, usa el resultado:
--      UPDATE public.clientes c SET estado_antes_vencido = v.estado_anterior,
--             estado = 'vencidos', actualizado_en = now()
--        FROM public.clientes_vencidos_whatsapp_api() v WHERE c.id = v.cliente_id;
CREATE OR REPLACE FUNCTION public.clientes_vencidos_whatsapp_api()
RETURNS TABLE (cliente_id uuid, estado_anterior text, ultimo_entrante_api_en timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT cli.id,
         cli.estado,
         conv.ultimo_entrante_api_en
    FROM public.conversaciones conv
    JOIN public.clientes cli ON cli.id = conv.cliente_id
    LEFT JOIN public.pipeline_etapas e
           ON e.clave = regexp_replace(COALESCE(NULLIF(trim(cli.estado), ''), 'nuevo_lead'), '_templo$', '')
   WHERE conv.ultimo_entrante_api_en IS NOT NULL
     AND conv.ultimo_entrante_api_en < now() - interval '24 hours'
     AND cli.es_spam IS NOT TRUE
     AND COALESCE(cli.estado, '') <> 'vencidos'
     AND COALESCE(e.cuenta_responsable, 'meta_business') = 'meta_business';
$$;

GRANT EXECUTE ON FUNCTION public.clientes_vencidos_whatsapp_api() TO anon, authenticated;
