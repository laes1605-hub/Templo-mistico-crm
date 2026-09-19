import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { CARPETA_RESPUESTAS_RAPIDAS, extensionPorMime, parsearDataUri } from "../../../../lib/media-format";
import { md5Hex } from "../../../../lib/md5";

export const dynamic = "force-dynamic";

function sanitizarNombre(nombre: string, ext: string): string {
  const base = (nombre || "respuesta-rapida").replace(/[^\w\sáéíóúñüÁÉÍÓÚÑ-]/g, "").trim().slice(0, 50) || "respuesta-rapida";
  return `${base}.${ext}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.dataUri !== "string") {
      return NextResponse.json({ error: "dataUri requerido" }, { status: 400 });
    }
    const titulo: string = typeof body.titulo === "string" ? body.titulo : "respuesta-rapida";
    const hashHint: string | undefined = typeof body.hash === "string" ? body.hash : undefined;

    const parsed = parsearDataUri(body.dataUri);
    if (!parsed) {
      return NextResponse.json({ error: "dataUri inválido" }, { status: 400 });
    }
    const hash = hashHint || md5Hex(parsed.bytes);
    const ext = extensionPorMime(parsed.mime);
    const path = `${CARPETA_RESPUESTAS_RAPIDAS}/${hash}.${ext}`;

    // Upsert idempotente por hash
    const { error: upErr } = await supabaseAdmin.storage
      .from("media-mensajes")
      .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: true });

    if (upErr) {
      return NextResponse.json({ error: upErr.message, url: null, hash }, { status: 500 });
    }

    const { data: pub } = supabaseAdmin.storage.from("media-mensajes").getPublicUrl(path);
    const url = pub?.publicUrl || null;

    return NextResponse.json({ url, hash });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error subiendo", url: null, hash: null }, { status: 500 });
  }
}
