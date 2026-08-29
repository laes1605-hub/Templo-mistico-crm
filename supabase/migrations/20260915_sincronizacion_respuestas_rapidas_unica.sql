-- ===========================================================================
-- Biblioteca de respuestas rápidas: sincronización manual sin duplicados.
-- Ejecutar DESPUÉS de 20260913_respuestas_rapidas.sql en Supabase SQL Editor.
-- ===========================================================================
--
-- Conserva la copia más antigua de cada respuesta cuyo tipo y contenido son
-- idénticos. Dos audios con el mismo título pero con audio distinto se conservan:
-- el título no es una clave única.

ALTER TABLE public.respuestas_rapidas
  ADD COLUMN IF NOT EXISTS huella text;

-- Calcula una huella estable para las filas existentes antes de crear el índice.
UPDATE public.respuestas_rapidas
SET huella = md5(tipo || chr(31) || contenido)
WHERE huella IS NULL
   OR huella <> md5(tipo || chr(31) || contenido);

-- El arreglo anterior pudo subir la misma respuesta desde cachés con IDs
-- distintos. Se conserva sólo la más antigua de cada contenido idéntico.
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

ALTER TABLE public.respuestas_rapidas
  ALTER COLUMN huella SET NOT NULL;

-- La función se ejecuta antes de insertar/actualizar, así ninguna aplicación
-- puede crear otra fila del mismo archivo o texto aunque sincronice a la vez.
CREATE OR REPLACE FUNCTION public.calcular_huella_respuesta_rapida()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.huella := md5(NEW.tipo || chr(31) || NEW.contenido);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS respuestas_rapidas_calcular_huella
  ON public.respuestas_rapidas;

CREATE TRIGGER respuestas_rapidas_calcular_huella
  BEFORE INSERT OR UPDATE OF tipo, contenido ON public.respuestas_rapidas
  FOR EACH ROW
  EXECUTE FUNCTION public.calcular_huella_respuesta_rapida();

CREATE UNIQUE INDEX IF NOT EXISTS respuestas_rapidas_tipo_huella_unica_idx
  ON public.respuestas_rapidas (tipo, huella);

COMMENT ON COLUMN public.respuestas_rapidas.huella IS
  'MD5 de tipo + separador + contenido. Evita respuestas rápidas duplicadas entre dispositivos.';
