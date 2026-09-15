-- ============================================================================
-- Mensajes: anti-duplicado por ID de Chatwoot
-- Ejecutar antes de importar el workflow actualizado de Luna.
--
-- Problema: el workflow comparaba el contenido para no duplicar mensajes, pero
-- los audios y las fotos se guardan como "[audio]"/"[imagen]". Resultado: el
-- segundo audio seguido caía como "duplicado" y nunca llegaba al dashboard.
-- Ahora se deduplica con el ID del mensaje de Chatwoot, que es único.
-- ============================================================================

ALTER TABLE public.mensajes ADD COLUMN IF NOT EXISTS chatwoot_message_id text;

COMMENT ON COLUMN public.mensajes.chatwoot_message_id IS
  'ID del mensaje en Chatwoot. Se usa para no guardar dos veces el mismo mensaje.';

-- Índice para que la consulta de deduplicado sea instantánea
CREATE INDEX IF NOT EXISTS mensajes_chatwoot_message_id_idx
  ON public.mensajes (conversacion_id, chatwoot_message_id)
  WHERE chatwoot_message_id IS NOT NULL;

-- Sin RLS nueva: la tabla ya tiene sus políticas y el workflow escribe con la
-- service_role key.
