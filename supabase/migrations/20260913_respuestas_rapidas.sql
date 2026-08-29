-- ===========================================================================
-- Respuestas rápidas compartidas entre todos los dispositivos
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.respuestas_rapidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('texto', 'audio', 'imagen')),
  titulo text NOT NULL DEFAULT '',
  contenido text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS respuestas_rapidas_creado_en_idx
  ON public.respuestas_rapidas (creado_en ASC);

ALTER TABLE public.respuestas_rapidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "respuestas_rapidas_lectura_publica" ON public.respuestas_rapidas;
CREATE POLICY "respuestas_rapidas_lectura_publica"
  ON public.respuestas_rapidas FOR SELECT USING (true);

DROP POLICY IF EXISTS "respuestas_rapidas_escritura_publica" ON public.respuestas_rapidas;
CREATE POLICY "respuestas_rapidas_escritura_publica"
  ON public.respuestas_rapidas FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.respuestas_rapidas REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.respuestas_rapidas;
EXCEPTION WHEN duplicate_object THEN
  NULL;
WHEN undefined_object THEN
  NULL;
END $$;

COMMENT ON TABLE public.respuestas_rapidas IS
  'Textos, audios e imágenes de respuesta rápida compartidos por todos los operadores y dispositivos.';
