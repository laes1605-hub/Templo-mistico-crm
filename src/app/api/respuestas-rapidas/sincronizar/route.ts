import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { CARPETA_RESPUESTAS_RAPIDAS, esDataUri, extensionPorMime, parsearDataUri } from "../../../../lib/media-format";
import { md5Hex } from "../../../../lib/md5";

export const dynamic = "force-dynamic";

const COLUMNAS_BASICAS = "id, tipo, titulo, contenido, creado_en";
const COLUMNAS_REMOTAS = `${COLUMNAS_BASICAS}, hash_bytes`;

function esColumnaInexistente(error: any): boolean {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || (msg.includes("column") && msg.includes("does not exist"));
}
function esDuplicado(error: any): boolean {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "23505" || msg.includes("duplicate key") || msg.includes("duplicate");
}

type Pendiente = {
  id?: string;
  tipo: string;
  titulo: string;
  contenido: string;
  creado_en: string;
  hash?: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const pendientes: Pendiente[] = Array.isArray(body?.pendientes) ? body.pendientes : [];
    if (pendientes.length === 0) {
      // Solo devolver biblioteca actual
      let { data, error } = await supabaseAdmin.from("respuestas_rapidas").select(COLUMNAS_REMOTAS).order("creado_en", { ascending: true });
      if (error && esColumnaInexistente(error)) {
        const r2 = await supabaseAdmin.from("respuestas_rapidas").select(COLUMNAS_BASICAS).order("creado_en", { ascending: true });
        data = r2.data as any;
        error = r2.error as any;
      }
      if (error) return NextResponse.json({ error: error.message, respuestas: [], subidas: 0 }, { status: 500 });
      return NextResponse.json({ respuestas: data || [], subidas: 0 });
    }

    let subidas = 0;
    for (const p of pendientes) {
      if (!p.tipo || !p.contenido || !p.titulo) continue;
      let contenidoFinal = p.contenido;
      let hashFinal: string | null = p.hash || null;

      if (esDataUri(p.contenido)) {
        const parsed = parsearDataUri(p.contenido);
        if (parsed) {
          const h = p.hash || md5Hex(parsed.bytes);
          hashFinal = h;
          const ext = extensionPorMime(parsed.mime);
          const path = `${CARPETA_RESPUESTAS_RAPIDAS}/${h}.${ext}`;
          await supabaseAdmin.storage.from("media-mensajes").upload(path, parsed.bytes, {
            contentType: parsed.mime,
            upsert: true,
          });
          const { data: pub } = supabaseAdmin.storage.from("media-mensajes").getPublicUrl(path);
          if (pub?.publicUrl) contenidoFinal = pub.publicUrl;
        }
      } else if (!hashFinal && (p.tipo === "audio" || p.tipo === "imagen")) {
        // Si ya es URL, intentamos deducir hash si vino, si no queda null
      }

      const base: Record<string, unknown> = {
        tipo: p.tipo,
        titulo: p.titulo,
        contenido: contenidoFinal,
        creado_en: p.creado_en || new Date().toISOString(),
      };
      if (hashFinal) base.hash_bytes = hashFinal;

      // Intentar con id si parece UUID, si no sin id
      let insertError: any = null;
      let inserted = false;
      if (p.id) {
        const { error } = await supabaseAdmin.from("respuestas_rapidas").insert({ ...base, id: p.id }).select(COLUMNAS_REMOTAS).maybeSingle();
        if (!error) inserted = true;
        else {
          // Si id inválido, reintentar sin id
          const msg = String(error.message || "").toLowerCase();
          if (error.code === "22P02" || (msg.includes("uuid") && msg.includes("invalid"))) {
            const { error: e2 } = await supabaseAdmin.from("respuestas_rapidas").insert(base).select(COLUMNAS_REMOTAS).maybeSingle();
            if (!e2) inserted = true;
            else insertError = e2;
          } else if (esColumnaInexistente(error)) {
            const { hash_bytes: _h, ...resto } = base as any;
            const { error: e2 } = await supabaseAdmin.from("respuestas_rapidas").insert(p.id ? { ...resto, id: p.id } : resto).select(COLUMNAS_BASICAS).maybeSingle();
            if (!e2) inserted = true;
            else {
              // reintento sin id
              const { error: e3 } = await supabaseAdmin.from("respuestas_rapidas").insert(resto).select(COLUMNAS_BASICAS).maybeSingle();
              if (!e3) inserted = true;
              else insertError = e3;
            }
          } else if (esDuplicado(error)) {
            // ya existe por hash, no es error
            inserted = false;
          } else {
            insertError = error;
          }
        }
      } else {
        const { error } = await supabaseAdmin.from("respuestas_rapidas").insert(base).select(COLUMNAS_REMOTAS).maybeSingle();
        if (!error) inserted = true;
        else if (esColumnaInexistente(error)) {
          const { hash_bytes: _h, ...resto } = base as any;
          const { error: e2 } = await supabaseAdmin.from("respuestas_rapidas").insert(resto).select(COLUMNAS_BASICAS).maybeSingle();
          if (!e2) inserted = true;
          else if (!esDuplicado(e2)) insertError = e2;
        } else if (!esDuplicado(error)) {
          insertError = error;
        }
      }

      if (inserted) subidas += 1;
      // Si hubo error no duplicado, lo ignoramos por ahora pero no contamos como subida
    }

    // Devolver biblioteca actualizada
    let { data, error } = await supabaseAdmin.from("respuestas_rapidas").select(COLUMNAS_REMOTAS).order("creado_en", { ascending: true });
    if (error && esColumnaInexistente(error)) {
      const r2 = await supabaseAdmin.from("respuestas_rapidas").select(COLUMNAS_BASICAS).order("creado_en", { ascending: true });
      data = r2.data as any;
      error = r2.error as any;
    }
    if (error) return NextResponse.json({ error: error.message, respuestas: [], subidas }, { status: 500 });

    return NextResponse.json({ respuestas: data || [], subidas });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error sincronizando", respuestas: [], subidas: 0 }, { status: 500 });
  }
}
