-- ============================================================================
-- 📲 SEGUNDO WHATSAPP PERSONAL (cuenta de respaldo, SIN API)
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede ejecutar varias veces sin riesgo.
--
-- ¿Qué resuelve?
--   El WhatsApp Personal principal se bloquea temporalmente cuando el operador
--   hace muchas llamadas en un día. Esta migración deja el CRM listo para una
--   SEGUNDA cuenta personal (otro número en la misma cuenta de Evolution API y
--   su propia bandeja de Chatwoot) con la misma funcionalidad: texto, adjuntos,
--   notas de voz, llamadas desde la APK y seguimientos de Luna.
--
--   La elección de cuenta es MANUAL: el operador decide desde la bandeja qué
--   WhatsApp personal está usando y cada chat recuerda el suyo.
--
-- Pasos después de correr esto (ver SEGUNDO-WHATSAPP-PERSONAL.md):
--   1. Crear la instancia en Evolution y escanear el QR del segundo número.
--   2. Crear una bandeja en Chatwoot conectada a esa instancia.
--   3. Rellenar número / instancia / bandeja en Ajustes → WhatsApp Personal.
-- ============================================================================

-- 1) CUENTA PERSONAL DE CADA CONVERSACIÓN -------------------------------------
-- Valores: 'personal' (WhatsApp 1) | 'personal_2' (WhatsApp 2).
-- NULL = chat del WhatsApp API o chat viejo que aún no se ha enviado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversaciones'
      AND column_name = 'cuenta_whatsapp'
  ) THEN
    ALTER TABLE public.conversaciones ADD COLUMN cuenta_whatsapp text;
  END IF;
END $$;

COMMENT ON COLUMN public.conversaciones.cuenta_whatsapp IS
  'Cuenta de WhatsApp Personal que atiende el chat: personal (WhatsApp 1) o personal_2 (WhatsApp 2). NULL en chats del WhatsApp API.';

-- Normaliza lo que hayan escrito integraciones antiguas.
UPDATE public.conversaciones
   SET cuenta_whatsapp = 'personal'
 WHERE cuenta_whatsapp IN ('evolution', 'personal1', 'personal_1', 'principal');

UPDATE public.conversaciones
   SET cuenta_whatsapp = 'personal_2'
 WHERE cuenta_whatsapp IN ('personal2', 'evolution_2', 'secundaria');

-- Índice parcial: sólo interesa saber qué chats atiende cada cuenta personal.
CREATE INDEX IF NOT EXISTS conversaciones_cuenta_whatsapp_idx
  ON public.conversaciones (cuenta_whatsapp)
  WHERE cuenta_whatsapp IS NOT NULL;

-- 2) CONFIGURACIÓN DE LAS DOS CUENTAS ----------------------------------------
-- Todo se puede editar también desde la app (Ajustes → WhatsApp Personal).
INSERT INTO public.config_general (clave, valor, descripcion) VALUES
  ('whatsapp_personal_activo', 'personal',
   'Cuenta de WhatsApp Personal activa (elección manual): personal = WhatsApp 1, personal_2 = WhatsApp 2.'),
  ('whatsapp_personal_etiqueta', 'WhatsApp 1',
   'Nombre visible de la cuenta principal de WhatsApp Personal.'),
  ('whatsapp_personal_numero', '',
   'Número de la cuenta principal de WhatsApp Personal (sólo informativo).'),
  ('whatsapp_personal_instancia', 'personal',
   'Instancia de Evolution API de la cuenta principal.'),
  ('whatsapp_personal2_etiqueta', 'WhatsApp 2',
   'Nombre visible de la segunda cuenta de WhatsApp Personal (respaldo).'),
  ('whatsapp_personal2_numero', '',
   'Número de la segunda cuenta de WhatsApp Personal.'),
  ('whatsapp_personal2_instancia', 'personal2',
   'Instancia de Evolution API de la segunda cuenta de WhatsApp Personal.'),
  ('whatsapp_personal2_inbox_id', '',
   'ID de la bandeja de Chatwoot conectada a la segunda cuenta de WhatsApp Personal.')
ON CONFLICT (clave) DO NOTHING;

-- 3) ETIQUETA DE LA CUENTA EN LOS MENSAJES (opcional, para auditoría) --------
-- Los mensajes ya guardan el texto; la cuenta se consulta en la conversación.
-- Se deja una vista de control para saber cuántos chats atiende cada cuenta.
CREATE OR REPLACE VIEW public.v_conversaciones_por_cuenta AS
SELECT
  COALESCE(cuenta_whatsapp, 'meta_business') AS cuenta,
  count(*)::integer AS conversaciones,
  max(ultimo_mensaje_en) AS ultima_actividad
FROM public.conversaciones
WHERE COALESCE(archivada, false) = false
GROUP BY COALESCE(cuenta_whatsapp, 'meta_business');

COMMENT ON VIEW public.v_conversaciones_por_cuenta IS
  'Cuántos chats atiende cada canal: meta_business (API), personal (WhatsApp 1) y personal_2 (WhatsApp 2).';

-- 4) COMPROBACIÓN (opcional) -------------------------------------------------
--   SELECT * FROM public.v_conversaciones_por_cuenta;
--   SELECT clave, valor FROM public.config_general WHERE clave LIKE 'whatsapp_personal%';
--
-- ============================================================================
-- ✅ LISTO
-- ============================================================================
