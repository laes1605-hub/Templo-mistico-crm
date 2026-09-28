import { NextResponse } from "next/server";
import { cabecerasParaFuente, esHostPrivado, esRutaDeApiBloqueada } from "../../../../lib/media-fuente";

export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024; // hasta 50 MB

/**
 * Proxy de adjuntos (fotos, audios, videos, documentos) para el dashboard.
 *
 * Por qué existe: los adjuntos que entran por WhatsApp viven en el servidor de
 * Chatwoot y sus URLs exigen cabeceras especiales (el token, que Caddy solo
 * acepta con guiones) y no mandan CORS, así que el navegador no los puede
 * pedir directo. Este endpoint los sirve con esas cabeceras puestas.
 *
 * Notas de rendimiento (por qué se demoraba):
 *   · Antes cada respuesta era "no cacheable" de cara al CDN: cada reproducción
 *     volvía a bajar el archivo del servidor propio. Ahora la respuesta se puede
 *     guardar en el borde (s-maxage) y en el navegador (max-age), así que la
 *     segunda vez el audio ya no toca el origen.
 *   · Se respetan las peticiones `Range` (el <audio>/<video> de los navegadores
 *     pide rangos para empezar a sonar sin esperar el final del archivo): antes
 *     se devolvía siempre el archivo completo con un 200.
 *   · Lo ideal sigue siendo copiar el adjunto a Supabase Storage
 *     (/api/media/persistir), que además sale por el CDN de Supabase.
 */

function filenameFrom(url: URL, contentType: string, contentDisposition: string | null): string {
  const disp = contentDisposition || "";
  const quoted = disp.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (quoted?.[1]) {
    try {
      return decodeURIComponent(quoted[1].replace(/["']/g, "")).replace(/[^\w.-]+/g, "_");
    } catch {}
  }
  const last = decodeURIComponent(url.pathname.split("/").pop() || "");
  if (/\.([A-Za-z0-9]{2,5})$/i.test(last)) return last;
  const rawSub = contentType.split(";")[0].split("/")[1] || "bin";
  const ext = rawSub.replace("jpeg", "jpg");
  return `adjunto.${ext}`;
}

/** Cabeceras comunes de una respuesta con archivo (con caché fuerte). */
function cabecerasDeArchivo(extras: Record<string, string>): Record<string, string> {
  return {
    // El archivo de un mensaje no cambia: se puede guardar mucho tiempo.
    // s-maxage = caché del CDN de Vercel; max-age = caché del navegador/APK.
    "Cache-Control": "public, max-age=604800, s-maxage=31536000, stale-while-revalidate=86400",
    "CDN-Cache-Control": "public, max-age=31536000",
    "Vercel-CDN-Cache-Control": "public, max-age=31536000",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    ...extras,
  };
}

/** Recorta el archivo pedido cuando el navegador manda `Range`. */
function respuestaParcial(
  bytes: Uint8Array,
  rango: string | null,
  base: Record<string, string>
): NextResponse | null {
  if (!rango) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rango.trim());
  if (!m) return null;

  const total = bytes.length;
  let inicio: number;
  let fin: number;
  if (!m[1] && m[2]) {
    // Sufijo: "bytes=-500" → los últimos 500 bytes.
    const ultimos = Number(m[2]);
    inicio = Math.max(0, total - ultimos);
    fin = total - 1;
  } else {
    inicio = m[1] ? Number(m[1]) : 0;
    fin = m[2] ? Number(m[2]) : total - 1;
  }
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || inicio > fin || inicio >= total) {
    return new NextResponse(null, {
      status: 416,
      headers: { ...base, "Content-Range": `bytes */${total}` },
    });
  }
  fin = Math.min(fin, total - 1);
  const trozo = bytes.slice(inicio, fin + 1);
  return new NextResponse(trozo, {
    status: 206,
    headers: {
      ...base,
      "Content-Range": `bytes ${inicio}-${fin}/${total}`,
      "Content-Length": String(trozo.length),
      "Accept-Ranges": "bytes",
    },
  });
}

async function manejar(req: Request, soloCabeceras = false) {
  try {
    const raw = new URL(req.url).searchParams.get("url") || "";
    if (!raw) return NextResponse.json({ error: "Falta la URL del archivo." }, { status: 400 });
    if (raw.startsWith("data:")) {
      return NextResponse.json({ error: "Los archivos incrustados se procesan en el navegador." }, { status: 400 });
    }

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return NextResponse.json({ error: "URL de archivo inválida." }, { status: 400 });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return NextResponse.json({ error: "Solo se pueden descargar archivos http(s)." }, { status: 400 });
    }
    if (esHostPrivado(target.hostname)) {
      return NextResponse.json({ error: "URL no permitida." }, { status: 400 });
    }
    if (esRutaDeApiBloqueada(target)) {
      // Del servidor de Chatwoot solo se sirven archivos, nunca su API: ese
      // endpoint viaja con el token de administrador en la cabecera.
      return NextResponse.json({ error: "URL no permitida." }, { status: 400 });
    }

    const rango = soloCabeceras ? null : req.headers.get("range");
    const upstream = await fetch(target.toString(), {
      headers: {
        ...cabecerasParaFuente(target),
        // Si el navegador pide un rango, se le pasa al origen (Chatwoot/Storage
        // saben responder 206 y así el audio arranca sin bajar todo).
        ...(rango ? { Range: rango } : {}),
      },
      cache: "no-store",
      redirect: "follow",
    });
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: upstream.status === 404 ? "El archivo ya no está disponible." : `No se pudo obtener el archivo (${upstream.status}).` },
        { status: upstream.status === 404 ? 404 : 502 }
      );
    }

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo es demasiado grande." }, { status: 413 });
    }

    const contentType = (upstream.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    if (contentType.includes("text/html")) {
      return NextResponse.json({ error: "El archivo ya no está disponible." }, { status: 410 });
    }

    const filename = filenameFrom(target, contentType, upstream.headers.get("content-disposition"));
    const base = cabecerasDeArchivo({
      "Content-Type": contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });

    if (soloCabeceras) {
      return new NextResponse(null, {
        status: 200,
        headers: {
          ...base,
          ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
          "Accept-Ranges": "bytes",
        },
      });
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (!bytes.length) return NextResponse.json({ error: "El archivo está vacío." }, { status: 502 });
    if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "El archivo es demasiado grande." }, { status: 413 });

    const parcial = respuestaParcial(bytes, rango, base);
    if (parcial) return parcial;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        ...base,
        "Content-Length": String(bytes.length),
        "Accept-Ranges": "bytes",
        ETag: `W/"${bytes.length}"`,
      },
    });
  } catch (error: any) {
    console.error("Error descargando media:", error);
    return NextResponse.json({ error: error.message || "No se pudo descargar el archivo." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return manejar(req);
}

export async function HEAD(req: Request) {
  return manejar(req, true);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    },
  });
}
