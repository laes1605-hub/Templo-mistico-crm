import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { listarFilasBiblioteca, pistaParaOperador } from "../../../lib/respuestas-rapidas-fila";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { filas, error } = await listarFilasBiblioteca(supabaseAdmin);
    if (error) {
      return NextResponse.json({ error: `${error.message}${pistaParaOperador(error)}`, respuestas: [] }, { status: 500 });
    }
    return NextResponse.json({ respuestas: filas });
  } catch (e: any) {
    return NextResponse.json(
      { error: `${e?.message || "Error listando respuestas"}${pistaParaOperador(e)}`, respuestas: [] },
      { status: 500 }
    );
  }
}
