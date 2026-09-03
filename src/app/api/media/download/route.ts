import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024; // hasta 50 MB

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0") return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function extraHeadersFor(target: URL): Record<string, string> {
  const headers: Record<string, string> = { Accept: "*/*" };
  const addIfSameOrigin = (rawBase: string | undefined, header: string, value: string) => {
    if (!rawBase || !value) return;
    try {
      if (target.origin === new URL(rawBase).origin) headers[header] = value;
    } catch {}
  };
  addIfSameOrigin(process.env.CHATWOOT_URL || "https://TU-CHATWOOT.duckdns.org", "api_access_token", process.env.CHATWOOT_API_TOKEN || "");
  addIfSameOrigin(process.env.EVOLUTION_API_URL || "https://TU-EVOLUTION.duckdns.org", "apikey", process.env.EVOLUTION_API_KEY || "");
  return headers;
}

function filenameFrom(url: URL, contentType: string, contentDisposition: string | null): string {
  const disp = contentDisposition || "";
  const quoted = disp.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
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

export async function GET(req: Request) {
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
    if (isPrivateHostname(target.hostname)) {
      return NextResponse.json({ error: "URL no permitida." }, { status: 400 });
    }

    const upstream = await fetch(target.toString(), {
      headers: extraHeadersFor(target),
      cache: "no-store",
      redirect: "follow",
    });
    if (!upstream.ok) {
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

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (!bytes.length) return NextResponse.json({ error: "El archivo está vacío." }, { status: 502 });
    if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "El archivo es demasiado grande." }, { status: 413 });

    const filename = filenameFrom(target, contentType, upstream.headers.get("content-disposition"));
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "public, max-age=86400",
        "Content-Length": String(bytes.length),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      },
    });
  } catch (error: any) {
    console.error("Error descargando media:", error);
    return NextResponse.json({ error: error.message || "No se pudo descargar el archivo." }, { status: 500 });
  }
}
