import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { borrarConversacionCompleta, type LimpiezaChatwoot } from "../../../../lib/chatwoot";

/**
 * 🗑️ ELIMINAR CLIENTE COMPLETO (CRM + Supabase + WhatsApp/Chatwoot + Luna)
 *
 * Un solo endpoint que borra TODO lo que el sistema sabe de un número:
 *
 *   1. Chatwoot  → la conversación entera (historial, fichas privadas de Luna y
 *      custom_attributes). Si el token no permite borrar conversaciones, se
 *      vacían al menos los atributos, las notas "🔎 Ficha de Luna" y etiquetas.
 *      Esto es lo que hace que Luna vuelva a tratarlo como cliente nuevo.
 *   2. Supabase  → conversaciones, mensajes, pagos, tareas, recordatorios,
 *      reglas del Cerebro y, al final, la fila de `clientes`. Sin esa fila, el
 *      workflow de n8n crea un cliente nuevo en el siguiente mensaje.
 *
 * Orden: primero Chatwoot y después Supabase. Si Chatwoot falla de forma
 * inesperada NO se toca Supabase: se devuelve `bloqueo: "chatwoot"` y el CRM
 * ofrece continuar "sólo del CRM" a conciencia.
 */

export const dynamic = "force-dynamic";
// Chatwoot puede tardar en responder; con el límite por defecto de Vercel (10 s)
// la función se cortaría a mitad del borrado.
export const maxDuration = 60;

// Respaldo por tablas para instalaciones donde todavía no se aplicó la
// migración supabase/migrations/20260905_eliminar_cliente_total.sql.
const TABLAS_POR_CLIENTE = ["recordatorios_whatsapp", "cerebro_reglas", "tareas", "pagos"];

function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

function errorIndicaFuncionAusente(error: any): boolean {
  const mensaje = String(error?.message || error || "").toLowerCase();
  return (
    error?.code === "42883" ||
    error?.code === "PGRST202" ||
    mensaje.includes("eliminar_cliente_completo") ||
    mensaje.includes("could not find the function")
  );
}

function errorIndicaTablaAusente(error: any): boolean {
  const mensaje = String(error?.message || error || "").toLowerCase();
  return mensaje.includes("does not exist") || mensaje.includes("could not find the table");
}

async function borrarPorTablas(clienteId: string): Promise<Record<string, number>> {
  const { data: conversaciones, error: errorConversaciones } = await supabaseAdmin
    .from("conversaciones")
    .select("id")
    .eq("cliente_id", clienteId);
  if (errorConversaciones) throw errorConversaciones;

  const idsConversaciones = (conversaciones || []).map((c: any) => c.id).filter(Boolean);

  for (const tabla of TABLAS_POR_CLIENTE) {
    const { error } = await supabaseAdmin.from(tabla).delete().eq("cliente_id", clienteId);
    if (error && !errorIndicaTablaAusente(error)) throw error;
  }

  if (idsConversaciones.length > 0) {
    const { error: errorReglas } = await supabaseAdmin
      .from("cerebro_reglas")
      .delete()
      .in("conversacion_id", idsConversaciones);
    if (errorReglas && !errorIndicaTablaAusente(errorReglas)) throw errorReglas;

    const { error: errorMensajes } = await supabaseAdmin
      .from("mensajes")
      .delete()
      .in("conversacion_id", idsConversaciones);
    if (errorMensajes) throw errorMensajes;
  }

  const { error: errorConversacionesDelete } = await supabaseAdmin
    .from("conversaciones")
    .delete()
    .eq("cliente_id", clienteId);
  if (errorConversacionesDelete) throw errorConversacionesDelete;

  const { error: errorCliente } = await supabaseAdmin.from("clientes").delete().eq("id", clienteId);
  if (errorCliente) throw errorCliente;

  return { conversaciones_eliminadas: idsConversaciones.length, cliente_eliminado: 1 };
}

export async function POST(req: Request) {
  let clienteId = "";
  let soloCrm = false;

  try {
    const body = await req.json();
    clienteId = String(body?.clienteId || "").trim();
    soloCrm = body?.soloCrm === true;
  } catch {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }

  if (!esUuid(clienteId)) {
    return NextResponse.json({ error: "Falta el id del cliente." }, { status: 400 });
  }

  // ------------------------------------------------------------------ cliente
  const { data: cliente, error: errorCliente } = await supabaseAdmin
    .from("clientes")
    .select("id, telefono, telefono_display, nombre, nombre_manual")
    .eq("id", clienteId)
    .maybeSingle();

  if (errorCliente) {
    return NextResponse.json(
      { error: `No se pudo leer el cliente en Supabase: ${errorCliente.message}` },
      { status: 500 }
    );
  }
  if (!cliente) {
    return NextResponse.json(
      { error: "Ese cliente ya no existe en el CRM (quizá ya se eliminó)." },
      { status: 404 }
    );
  }

  const etiquetaCliente = cliente.nombre_manual || cliente.telefono_display || cliente.telefono || clienteId;

  // ------------------------------------------------------------- conversaciones
  const { data: conversaciones, error: errorConversaciones } = await supabaseAdmin
    .from("conversaciones")
    .select("id, chatwoot_conversation_id, fuente, numero_whatsapp")
    .eq("cliente_id", clienteId);

  if (errorConversaciones) {
    return NextResponse.json(
      { error: `No se pudieron leer las conversaciones: ${errorConversaciones.message}` },
      { status: 500 }
    );
  }

  const idsChatwoot = Array.from(
    new Set(
      (conversaciones || [])
        .map((c: any) => (c.chatwoot_conversation_id === null || c.chatwoot_conversation_id === undefined ? "" : String(c.chatwoot_conversation_id)))
        .filter((v: string) => v !== "")
    )
  ) as string[];

  // ---------------------------------------------------------------- Chatwoot
  const limpiezas: LimpiezaChatwoot[] = [];
  if (!soloCrm) {
    // En lotes de 3 en paralelo: rápido sin saturar Chatwoot.
    for (let i = 0; i < idsChatwoot.length; i += 3) {
      const lote = idsChatwoot.slice(i, i + 3);
      limpiezas.push(...(await Promise.all(lote.map((id) => borrarConversacionCompleta(id)))));
    }
  }

  const advertenciasChatwoot = limpiezas.flatMap((l) => l.errores || []);
  const falloTotalChatwoot =
    limpiezas.length > 0 &&
    limpiezas.every((l) => !l.conversacion_eliminada && !l.memoria_vaciada && !l.ya_no_existia);

  if (falloTotalChatwoot) {
    return NextResponse.json(
      {
        error:
          "No se pudo borrar la memoria de Luna en WhatsApp (Chatwoot). No se eliminó nada todavía.",
        bloqueo: "chatwoot",
        detalle: advertenciasChatwoot,
        cliente: etiquetaCliente,
      },
      { status: 409 }
    );
  }

  // ---------------------------------------------------------------- Supabase
  let resumenCrm: any;
  try {
    const { data, error } = await supabaseAdmin.rpc("eliminar_cliente_completo", {
      p_cliente_id: clienteId,
    });
    if (error) {
      if (!errorIndicaFuncionAusente(error)) throw error;
      resumenCrm = await borrarPorTablas(clienteId);
    } else {
      resumenCrm = data;
    }
  } catch (e: any) {
    return NextResponse.json(
      {
        error: `Se limpió WhatsApp pero falló Supabase: ${e?.message || "error desconocido"}`,
        chatwoot: limpiezas,
      },
      { status: 500 }
    );
  }

  const conversacionesBorradas = Number(
    resumenCrm?.conversaciones_eliminadas ?? (conversaciones || []).length
  );

  return NextResponse.json({
    ok: true,
    cliente: etiquetaCliente,
    crm: {
      cliente_eliminado: Number(resumenCrm?.cliente_eliminado ?? 0),
      conversaciones_eliminadas: conversacionesBorradas,
      mensajes_eliminados: Number(resumenCrm?.mensajes_eliminados ?? 0),
      pagos_eliminados: Number(resumenCrm?.pagos_eliminados ?? 0),
      tareas_eliminadas: Number(resumenCrm?.tareas_eliminadas ?? 0),
      recordatorios_eliminados: Number(resumenCrm?.recordatorios_eliminados ?? 0),
      reglas_cerebro_eliminadas: Number(resumenCrm?.reglas_cerebro_eliminadas ?? 0),
      otras_tablas: resumenCrm?.otras_tablas || {},
    },
    chatwoot: {
      conversaciones: idsChatwoot.length,
      eliminadas: limpiezas.filter((l) => l.conversacion_eliminada).length,
      ya_no_existian: limpiezas.filter((l) => l.ya_no_existia).length,
      memoria_vaciada: limpiezas.filter((l) => l.memoria_vaciada && !l.conversacion_eliminada).length,
      fichas_luna_borradas: limpiezas.reduce((total, l) => total + (l.notas_borradas || 0), 0),
      omitidas: soloCrm ? idsChatwoot.length : 0,
      detalle: limpiezas,
    },
    advertencias: [
      ...(soloCrm && idsChatwoot.length > 0
        ? [
            "Se eliminó sólo del CRM: la memoria de Luna sigue en WhatsApp. Si vuelve a escribir, Luna puede recordar el caso.",
          ]
        : []),
      ...advertenciasChatwoot,
    ],
  });
}
