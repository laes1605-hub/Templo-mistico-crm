import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { borrarObjetoDelBucket } from "../../../../lib/media-format";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const url = body?.url;
    const id = body?.id;
    if (!url || typeof url !== "string") return NextResponse.json({ error: "url requerida" }, { status: 400 });
    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    // Verificar que nadie más use la URL
    const [{ count: otras, error: e1 }, { count: msgs, error: e2 }] = await Promise.all([
      supabaseAdmin.from("respuestas_rapidas").select("id", { count: "exact", head: true }).eq("contenido", url).neq("id", id),
      supabaseAdmin.from("mensajes").select("id", { count: "exact", head: true }).eq("url_archivo", url),
    ]);
    if (e1 || e2) return NextResponse.json({ ok: false, reason: "no verificado" });
    if ((otras ?? 0) > 0 || (msgs ?? 0) > 0) return NextResponse.json({ ok: false, reason: "en uso" });

    await borrarObjetoDelBucket(supabaseAdmin as any, url);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 });
  }
}
