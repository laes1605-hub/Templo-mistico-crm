-- ============================================================================
-- RESPUESTAS RÁPIDAS: AUDIOS E IMÁGENES A SUPABASE STORAGE (ahorro de Egress)
-- ----------------------------------------------------------------------------
-- Problema: la biblioteca de respuestas rápidas se descarga COMPLETA en cada
-- sincronización y en cada evento de realtime de la tabla. Como los audios y las
-- imágenes vivían dentro de respuestas_rapidas.contenido en base64 (hasta ~8 MB
-- por audio), cada teléfono volvía a bajar todos los megabytes cada vez que algún
-- operador pulsaba «Sincronizar con todos». Es el mismo problema que ya se resolvió
-- para los adjuntos del chat en 20260916_media_storage.sql.
--
-- Solución: el archivo va al bucket público `media-mensajes` (carpeta
-- `respuestas-rapidas/`) y en la tabla queda sólo la URL. La subida la hace el
-- propio teléfono con la anon key (las políticas de ese bucket ya lo permiten), y
-- la ruta del objeto es el MD5 del archivo, así que dos teléfonos que suben el
-- mismo audio escriben en la misma ruta y no dejan copias duplicadas.
--
-- Consecuencia que arregla esta migración: la huella anti-duplicados se calculaba
-- sobre `contenido`, y una URL ya no representa el archivo. Por eso se añade
-- `hash_bytes` (MD5 de los bytes) y la huella pasa a ser md5(tipo + hash_bytes),
-- con md5(tipo + contenido) sólo como plan B (respuestas en texto, o filas de
-- clientes antiguos que aún no mandan la huella).
--
-- Ejecutar DESPUÉS de 20260913_respuestas_rapidas.sql,
-- 20260915_sincronizacion_respuestas_rapidas_unica.sql y
-- 20260916_media_storage.sql.  Supabase → SQL Editor → New query → Run.
-- ============================================================================

ALTER TABLE public.respuestas_rapidas
  ADD COLUMN IF NOT EXISTS hash_bytes text;

-- 1) Huella de los binarios que todavía están incrustados como data-URI.
--    Se valida el base64 antes de decodificar para que una fila con un texto
--    raro no reviente la migración entera.
UPDATE public.respuestas_rapidas
SET hash_bytes = md5(decode(replace(split_part(contenido, ',', 2), E'\n', ''), 'base64'))
WHERE hash_bytes IS NULL
  AND tipo IN ('audio', 'imagen')
  AND contenido LIKE 'data:%'
  AND position(',' IN contenido) > 0
  AND length(replace(split_part(contenido, ',', 2), E'\n', '')) % 4 = 0
  AND replace(split_part(contenido, ',', 2), E'\n', '') ~* '^[a-z0-9+/]+={0,2}$';

-- 2) La huella ahora sale del hash cuando existe. Se suelta el índice único
--    mientras se recalcula, porque al cambiar la fórmula dos filas distintas
--    pueden resultar idénticas (el mismo audio con dos data-URI que sólo
--    difieren en el MIME escrito en el texto).
DROP INDEX IF EXISTS respuestas_rapidas_tipo_huella_unica_idx;

CREATE OR REPLACE FUNCTION public.calcular_huella_respuesta_rapida()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.huella := md5(NEW.tipo || chr(31) || COALESCE(NEW.hash_bytes, NEW.contenido));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS respuestas_rapidas_calcular_huella ON public.respuestas_rapidas;

CREATE TRIGGER respuestas_rapidas_calcular_huella
  BEFORE INSERT OR UPDATE OF tipo, contenido ON public.respuestas_rapidas
  FOR EACH ROW
  EXECUTE FUNCTION public.calcular_huella_respuesta_rapida();

UPDATE public.respuestas_rapidas
SET huella = md5(tipo || chr(31) || COALESCE(hash_bytes, contenido));

-- 3) Una sola fila por archivo/texto, conservando la más antigua (la que ya
--    puede estar referenciada en mensajes enviados).
WITH repetidas AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tipo, huella
      ORDER BY creado_en ASC, id ASC
    ) AS posicion
  FROM public.respuestas_rapidas
)
DELETE FROM public.respuestas_rapidas AS respuesta
USING repetidas
WHERE respuesta.id = repetidas.id
  AND repetidas.posicion > 1;

CREATE UNIQUE INDEX IF NOT EXISTS respuestas_rapidas_tipo_huella_unica_idx
  ON public.respuestas_rapidas (tipo, huella);

COMMENT ON COLUMN public.respuestas_rapidas.hash_bytes IS
  'MD5 (hex) de los bytes del audio o de la imagen. Es la huella real del archivo: permite deduplicar aunque contenido ya sea una URL de Storage.';

COMMENT ON COLUMN public.respuestas_rapidas.contenido IS
  'Texto plano, o URL pública de Supabase Storage (bucket media-mensajes, carpeta respuestas-rapidas/). Se admite un data-URI como plan B cuando la subida a Storage falló; /api/admin/migrar-respuestas-rapidas-storage los pasa a Storage.';

COMMENT ON TABLE public.respuestas_rapidas IS
  'Textos, audios e imágenes de respuesta rápida compartidos por todos los operadores. Los binarios viven en Supabase Storage y acá sólo queda su URL + la huella MD5 del archivo.';
