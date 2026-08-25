-- Recordatorios automáticos de WhatsApp por etapa.
-- Ejecutar antes de importar n8n/03-recordatorios-whatsapp-por-etapa.json.
-- La clave única evita que una ejecución repetida envíe dos veces el mismo
-- recordatorio al mismo cliente en el mismo día.

CREATE TABLE IF NOT EXISTS public.recordatorios_whatsapp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  conversacion_id uuid REFERENCES public.conversaciones(id) ON DELETE SET NULL,
  etapa text NOT NULL,
  tipo text NOT NULL,
  plantilla smallint NOT NULL DEFAULT 1,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  mensaje text NOT NULL,
  enviado_en timestamptz NOT NULL DEFAULT now(),
  proveedor text NOT NULL DEFAULT 'chatwoot'
);

CREATE UNIQUE INDEX IF NOT EXISTS recordatorios_whatsapp_unico_dia
  ON public.recordatorios_whatsapp (cliente_id, etapa, tipo, fecha);
CREATE INDEX IF NOT EXISTS recordatorios_whatsapp_enviado_idx
  ON public.recordatorios_whatsapp (enviado_en);

ALTER TABLE public.recordatorios_whatsapp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recordatorios_whatsapp_lectura_publica" ON public.recordatorios_whatsapp;
DROP POLICY IF EXISTS "recordatorios_whatsapp_escritura_publica" ON public.recordatorios_whatsapp;
CREATE POLICY "recordatorios_whatsapp_lectura_publica"
  ON public.recordatorios_whatsapp FOR SELECT USING (true);
CREATE POLICY "recordatorios_whatsapp_escritura_publica"
  ON public.recordatorios_whatsapp FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.recordatorios_whatsapp IS
  'Auditoría/idempotencia de recordatorios automáticos enviados por etapa en WhatsApp API.';
