import { NextResponse } from "next/server";
import { supabaseAdmin, usingServiceRole } from "../../../lib/supabase-admin";
import {
  CEREBRO_TABLA,
  CEREBRO_TABLA_EJECUCIONES,
  ESTADOS,
  normalizarEstado,
  sanitizarRegla,
  ReglaEntrada,
} from "../../../lib/cerebro";
import { verificarSecreto } from "../../../lib/cerebro-auth";

export const dynamic = "force-dynamic";

// ============================================================================
// 🧠 /api/cerebro — Gestión de reglas aprendidas por Luna
// ----------------------------------------------------------------------------
//  GET    /api/cerebro?estado=pendiente&categoria=cierre&limit=100
//  POST   /api/cerebro            → alta de reglas (n8n extractor o manual)
//  PATCH  /api/cerebro            → aprobar / rechazar / editar / archivar
//  DELETE /api/cerebro?id=...     → borrar definitivamente
// ============================================================================

const SELECT_COLS = "*";

function fallaSupabase(error: any, contexto: string) {
  const msg = error?.message || "Error desconocido";
  const faltaTabla = /relation .*cerebro_reglas.* does not exist|could not find the table/i.test(msg);
  return NextResponse.json(
    {
      error: faltaTabla
        ? "La tabla 'cerebro_reglas' no existe todavía en Supabase. Ejecutá supabase/migrations/20260824_fase3_cerebro_ia.sql en el SQL Editor."
        : `${contexto}: ${msg}`,
      needsMigration: faltaTabla,
    },
    { status: faltaTabla ? 424 : 500 }
  );
}

// ----------------------------------------------------------------------------
// GET — Listar reglas + estadísticas
// ----------------------------------------------------------------------------
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const estado = url.searchParams.get("estado");
    const categoria = url.searchParams.get("categoria");
    const buscar = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") || 200) || 200, 500);

    let query = supabaseAdmin
      .from(CEREBRO_TABLA)
      .select(SELECT_COLS)
      .order("estado", { ascending: true })
      .order("prioridad", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(limit);

    if (estado && estado !== "todos" && (ESTADOS as readonly string[]).includes(estado)) {
      query = query.eq("estado", estado);
    }
    if (categoria && categoria !== "todas") query = query.eq("categoria", categoria);
    if (buscar) query = query.or(`titulo.ilike.%${buscar}%,regla.ilike.%${buscar}%`);

    const { data, error } = await query;
    if (error) return fallaSupabase(error, "No se pudieron cargar las reglas");

    const reglas = data || [];
    const stats = {
      total: reglas.length,
      pendientes: reglas.filter((r: any) => r.estado === "pendiente").length,
      aprobadas: reglas.filter((r: any) => r.estado === "aprobada").length,
      rechazadas: reglas.filter((r: any) => r.estado === "rechazada").length,
      archivadas: reglas.filter((r: any) => r.estado === "archivada").length,
      confianzaPromedio: reglas.length
        ? Number((reglas.reduce((a: number, r: any) => a + Number(r.confianza || 0), 0) / reglas.length).toFixed(3))
        : 0,
      inyeccionesTotales: reglas.reduce((a: number, r: any) => a + Number(r.veces_usada || 0), 0),
    };

    // Última corrida del extractor (si la tabla existe)
    let ultimaEjecucion: any = null;
    const { data: ejec } = await supabaseAdmin
      .from(CEREBRO_TABLA_EJECUCIONES)
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(1);
    if (ejec && ejec.length) ultimaEjecucion = ejec[0];

    return NextResponse.json({
      ok: true,
      reglas,
      stats,
      ultimaEjecucion,
      serviceRole: usingServiceRole,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error interno" }, { status: 500 });
  }
}

// ----------------------------------------------------------------------------
// POST — Alta de reglas (n8n extractor, o creación manual desde el CRM)
//   Body: { regla: {...} }  ó  { reglas: [{...}, {...}] }
//   Opcional: { ejecucion: { conversaciones_analizadas, mensajes_analizados, modelo } }
// ----------------------------------------------------------------------------
export async function POST(req: Request) {
  const noAutorizado = verificarSecreto(req);
  if (noAutorizado) return noAutorizado;

  try {
    const body = await req.json().catch(() => ({}));
    const entrada: ReglaEntrada[] = Array.isArray(body?.reglas)
      ? body.reglas
      : body?.regla
      ? [body.regla]
      : Array.isArray(body)
      ? body
      : [body];

    const origen = String(body?.origen || "n8n_extractor").slice(0, 60);
    const sanitizadas = entrada
      .map((r) => sanitizarRegla(r, origen))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    if (sanitizadas.length === 0) {
      return NextResponse.json(
        { error: "No llegó ninguna regla válida. Se requiere al menos 'titulo' y 'regla' (mínimo 12 caracteres)." },
        { status: 400 }
      );
    }

    // Deduplicado dentro del mismo lote
    const vistos = new Set<string>();
    const lote = sanitizadas.filter((r) => {
      if (vistos.has(r.hash_regla)) return false;
      vistos.add(r.hash_regla);
      return true;
    });

    // ¿Cuáles ya existían? (para reportar duplicados sin pisar decisiones previas)
    const { data: existentes } = await supabaseAdmin
      .from(CEREBRO_TABLA)
      .select("hash_regla")
      .in("hash_regla", lote.map((r) => r.hash_regla));

    const yaExistian = new Set((existentes || []).map((r: any) => r.hash_regla));
    const nuevas = lote.filter((r) => !yaExistian.has(r.hash_regla));

    let insertadas: any[] = [];
    if (nuevas.length) {
      const { data, error } = await supabaseAdmin.from(CEREBRO_TABLA).insert(nuevas).select();
      if (error) return fallaSupabase(error, "No se pudieron guardar las reglas");
      insertadas = data || [];
    }

    // Bitácora de la corrida (nunca bloquea la respuesta)
    const infoEjec = body?.ejecucion || {};
    await supabaseAdmin
      .from(CEREBRO_TABLA_EJECUCIONES)
      .insert([
        {
          origen,
          estado: "ok",
          conversaciones_analizadas: Number(infoEjec.conversaciones_analizadas || 0) || 0,
          mensajes_analizados: Number(infoEjec.mensajes_analizados || 0) || 0,
          reglas_sugeridas: lote.length,
          reglas_nuevas: insertadas.length,
          reglas_duplicadas: lote.length - insertadas.length,
          modelo: infoEjec.modelo ? String(infoEjec.modelo).slice(0, 80) : null,
          detalle: typeof infoEjec.detalle === "object" && infoEjec.detalle ? infoEjec.detalle : {},
        },
      ])
      .then(() => null, () => null);

    return NextResponse.json({
      ok: true,
      recibidas: entrada.length,
      validas: lote.length,
      nuevas: insertadas.length,
      duplicadas: lote.length - insertadas.length,
      reglas: insertadas,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error interno" }, { status: 500 });
  }
}

// ----------------------------------------------------------------------------
// PATCH — Aprobar / rechazar / editar (el famoso "1 clic")
//   Body: { id | ids: [], accion: "aprobar"|"rechazar"|"pendiente"|"archivar", ... }
// ----------------------------------------------------------------------------
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : body?.id ? [String(body.id)] : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: "Falta 'id' o 'ids' de la regla a actualizar." }, { status: 400 });
    }

    const accionMap: Record<string, string> = {
      aprobar: "aprobada",
      aprobada: "aprobada",
      rechazar: "rechazada",
      rechazada: "rechazada",
      pendiente: "pendiente",
      reabrir: "pendiente",
      archivar: "archivada",
      archivada: "archivada",
    };

    const update: Record<string, any> = {};

    const accion = body?.accion ? String(body.accion).toLowerCase() : null;
    const nuevoEstado = accion ? accionMap[accion] : body?.estado ? normalizarEstado(body.estado) : null;

    if (nuevoEstado) {
      update.estado = nuevoEstado;
      update.revisado_en = new Date().toISOString();
      update.revisado_por = String(body?.revisado_por || "admin_crm").slice(0, 60);
    }

    if (typeof body?.titulo === "string" && body.titulo.trim()) update.titulo = body.titulo.trim().slice(0, 160);
    if (typeof body?.regla === "string" && body.regla.trim()) update.regla = body.regla.trim().slice(0, 2000);
    if (typeof body?.ejemplo === "string") update.ejemplo = body.ejemplo.trim().slice(0, 1200) || null;
    if (typeof body?.nota_revision === "string") update.nota_revision = body.nota_revision.trim().slice(0, 600) || null;
    if (body?.prioridad !== undefined && body.prioridad !== null && !Number.isNaN(Number(body.prioridad))) {
      update.prioridad = Math.round(Math.min(100, Math.max(0, Number(body.prioridad))));
    }
    if (body?.categoria) update.categoria = String(body.categoria);

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No hay nada que actualizar." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.from(CEREBRO_TABLA).update(update).in("id", ids).select();
    if (error) return fallaSupabase(error, "No se pudo actualizar la regla");

    if (!data || data.length === 0) {
      return NextResponse.json(
        {
          error: usingServiceRole
            ? "No se encontró la regla indicada."
            : "No se pudo escribir. Configurá SUPABASE_SERVICE_ROLE_KEY en Vercel o habilitá la política de escritura anónima en el SQL.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, actualizadas: data.length, reglas: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error interno" }, { status: 500 });
  }
}

// ----------------------------------------------------------------------------
// DELETE — Borrado definitivo
// ----------------------------------------------------------------------------
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    let ids = url.searchParams.getAll("id");
    if (ids.length === 0) {
      const body = await req.json().catch(() => ({}));
      ids = Array.isArray(body?.ids) ? body.ids : body?.id ? [String(body.id)] : [];
    }
    if (ids.length === 0) return NextResponse.json({ error: "Falta 'id'." }, { status: 400 });

    const { error } = await supabaseAdmin.from(CEREBRO_TABLA).delete().in("id", ids);
    if (error) return fallaSupabase(error, "No se pudo eliminar la regla");

    return NextResponse.json({ ok: true, eliminadas: ids.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error interno" }, { status: 500 });
  }
}
