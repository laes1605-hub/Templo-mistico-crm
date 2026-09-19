import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";

const COLUMNAS_BASICAS = "id, tipo, titulo, contenido, creado_en";
const COLUMNAS_REMOTAS = `${COLUMNAS_BASICAS}, hash_bytes`;

function esColumnaInexistente(error: any): boolean {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || (msg.includes("column") && msg.includes("does not exist"));
}

export async function GET() {
  try {
    let { data, error } = await supabaseAdmin
      .from("respuestas_rapidas")
      .select(COLUMNAS_REMOTAS)
      .order("creado_en", { ascending: true });
    if (error && esColumnaInexistente(error)) {
      const retry = await supabaseAdmin.from("respuestas_rapidas").select(COLUMNAS_BASICAS).order("creado_en", { ascending: true });
      data = retry.data as any;
      error = retry.error as any;
    }
    if (error) {
      return NextResponse.json({ error: error.message, respuestas: [] }, { status: 500 });
    }
    return NextResponse.json({ respuestas: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error listando respuestas", respuestas: [] }, { status: 500 });
  }
}
