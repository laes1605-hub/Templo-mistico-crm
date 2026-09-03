import { supabaseAdmin } from "./supabase-admin";
import { supabaseRestUrl } from "./supabase-config";
import { BUCKET_MEDIA, type OpcionesRuta, parsearDataUri, subirBytesAStorage } from "./media-format";

/**
 * Subida de adjuntos al bucket `media-mensajes` desde el SERVIDOR.
 *
 * Antes estos archivos se guardaban como data-URI base64 dentro de
 * `mensajes.url_archivo`, lo que multiplicaba el Egress: cada refetch del chat
 * y cada evento realtime volvía a transmitir los megabytes del adjunto. Con
 * Storage, en la tabla queda solo una URL corta y el archivo se descarga
 * únicamente cuando se reproduce/abre (y el navegador lo cachea).
 *
 * Los helpers puros (parsear data-URIs, rutas del bucket, detección de MIME)
 * viven en `media-format.ts` porque el teléfono también los necesita y allí no
 * hay ni `Buffer` ni service role.
 */

export {
  BUCKET_MEDIA,
  CARPETA_MENSAJES,
  CARPETA_RESPUESTAS_RAPIDAS,
  esDataUri,
  esUrlDeStorage,
  extensionPorMime,
  mimeDesdeUrl,
  nombreDesdeUrl,
  parsearDataUri,
  rutaEnBucket,
} from "./media-format";

export async function subirMediaAStorage(
  bytes: Uint8Array,
  mime: string,
  nombreBase = "adjunto",
  opciones: OpcionesRuta = {}
): Promise<string | null> {
  return subirBytesAStorage(supabaseAdmin, bytes, mime, { ...opciones, nombreBase });
}

/**
 * Convierte un data-URI en URL de Storage. Si algo falla devuelve el data-URI
 * original para que el mensaje nunca pierda su adjunto.
 */
export async function dataUriAStorage(dataUri: string, nombreBase = "adjunto"): Promise<string> {
  const parseado = parsearDataUri(dataUri);
  if (!parseado) return dataUri;
  const url = await subirMediaAStorage(parseado.bytes, parseado.mime, nombreBase);
  return url || dataUri;
}

/**
 * Descarga un adjunto que YA está en Storage, validando que la URL pertenezca
 * al bucket público del proyecto (no se puede usar esta ruta para que el
 * servidor le pida archivos a hosts ajenos).
 *
 * Se usa al enviar una respuesta rápida: el teléfono manda sólo la URL y el
 * servidor lee los bytes dentro de la misma región de Supabase, en vez de
 * bajar 6 MB al celular y volver a subirlos.
 */
export async function descargarAdjuntoDeStorage(
  url: string
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const destino = new URL(url);
    const origenLocal = new URL(supabaseRestUrl() || "https://TU-PROYECTO.supabase.co");
    if (destino.origin !== origenLocal.origin) return null;
    if (!destino.pathname.startsWith(`/storage/v1/object/public/${BUCKET_MEDIA}/`)) return null;

    const respuesta = await fetch(destino.toString());
    if (!respuesta.ok) {
      console.error(`[media] Storage respondió ${respuesta.status} al descargar el adjunto.`);
      return null;
    }
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    if (!bytes.length) return null;
    const mime = (respuesta.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    return { bytes, mime: mime || "application/octet-stream" };
  } catch (e: any) {
    console.error("[media] No se pudo descargar el adjunto de Storage:", e?.message || e);
    return null;
  }
}
