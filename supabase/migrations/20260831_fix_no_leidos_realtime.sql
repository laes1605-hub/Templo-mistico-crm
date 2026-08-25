-- Corrige el contador rojo de mensajes pendientes.
-- La app ya muestra conversaciones.no_leidos; este trigger lo incrementa en el
-- mismo INSERT del mensaje entrante, incluso si la app estaba cerrada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversaciones' AND column_name='no_leidos') THEN
    ALTER TABLE public.conversaciones ADD COLUMN no_leidos integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversaciones' AND column_name='ultimo_leido_en') THEN
    ALTER TABLE public.conversaciones ADD COLUMN ultimo_leido_en timestamptz;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.incrementar_no_leidos_entrante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.tipo, '') <> 'enviado' THEN
    UPDATE public.conversaciones
       SET no_leidos = COALESCE(no_leidos, 0) + 1
     WHERE id = NEW.conversacion_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_incrementar_no_leidos_entrante ON public.mensajes;
CREATE TRIGGER trg_incrementar_no_leidos_entrante
AFTER INSERT ON public.mensajes
FOR EACH ROW EXECUTE FUNCTION public.incrementar_no_leidos_entrante();

-- Recalcular los históricos usando la marca de lectura actual.
SELECT public.sincronizar_no_leidos();
