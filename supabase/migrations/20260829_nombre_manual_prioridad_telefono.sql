-- ============================================================================
-- 📞 PRIORIDAD TELÉFONO + NOMBRE MANUAL (+ pestaña "Por leer")
-- ----------------------------------------------------------------------------
-- Ejecutar en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- REGLA DE VISUALIZACIÓN DEL CRM:
--   1. Si "nombre_manual" tiene valor → se muestra ese nombre (el operador lo
--      puso a mano desde la ficha del cliente con el lápiz ✏️).
--   2. Si no → se muestra SOLO el número de teléfono en formato internacional
--      con el indicativo del país y el "+". Ej: +573054021111 o +595985123456.
--
-- El campo "nombre" (que llenan automáticamente los webhooks con el nombre
-- cargado de WhatsApp, la agenda del teléfono del maestro o del cliente) DEJA
-- DE MOSTRARSE por completo. No se borra: otras herramientas (Cerebro IA)
-- siguen pudiendo usarlo, pero el CRM nunca lo enseña.
--
-- La pestaña "Por leer" (chats con mensajes sin leer de todas las categorías)
-- NO requiere cambios en la base de datos: usa el contador "no_leidos" de la
-- migración 20260828_no_leidos_atendidos_spam_negro.sql
-- ============================================================================

-- 1. COLUMNA nombre_manual EN CLIENTES
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clientes' AND column_name='nombre_manual') THEN
    ALTER TABLE public.clientes ADD COLUMN nombre_manual text;
  END IF;
END $$;

COMMENT ON COLUMN public.clientes.nombre_manual IS 'Nombre puesto manualmente por el operador en el CRM. NULL = mostrar solo el número de teléfono con el + del país. El campo "nombre" (auto-cargado de WhatsApp/agenda) NO se muestra en la interfaz.';

-- Índice parcial para buscar rápido por nombre manual
CREATE INDEX IF NOT EXISTS clientes_nombre_manual_idx ON public.clientes (nombre_manual) WHERE nombre_manual IS NOT NULL;

-- RLS: clientes ya tiene políticas públicas de lectura/escritura
-- (ver migración 20260826_mejoras_luna_grupos_colores.sql), y las políticas
-- "FOR ALL" cubren automáticamente la columna nueva. Nada que hacer aquí.

-- ============================================================================
-- ✅ LISTO. Ahora en el CRM:
--    1) Todos los chats y tarjetas muestran el número con + (+573054021111).
--    2) Si le pones nombre con el lápiz ✏️ en la ficha, ese nombre se guarda
--       en nombre_manual y pasa a mostrarse (y puede quitarse dejándolo vacío).
--    3) Al lado de "Leads nuevos" aparece la pestaña "Por leer" con los chats
--       de TODAS las categorías que tienen mensajes sin leer.
-- ============================================================================
