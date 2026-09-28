import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase-admin";
import { estadoDeAdjunto, ingerirAdjunto, nombreBaseDeTipo, necesitaIngesta, tipoDesdeMime } from "../../../../lib/media-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Copia a Supabase Storage los adjuntos que hoy viven fuera del CRM
 * (audios/fotos de Chatwoot) o incrustados como base64 en la fila.
 *
 * ¿Por qué? Cada reproducción de una nota de voz obligaba a bajar el archivo
 * por el proxy del CRM —que a su vez lo baja de Chatwoot—: dos saltos de red,
 * sin caché de CDN y con una cola de descargas en el teléfono. Con el archivo
 * en Storage, el teléfono lo pide directo al CDN y suena al instante, y de paso
 * deja de depender de que Chatwoot siga teniendo la nota.
 *
 * El dashboard llama a este endpoint en segundo plano (no bloquea la UI):
 *   · al abrir la app, para ir vaciando lo viejo,
 *   · al llegar un mensaje con adjunto (ids del mensaje recién insertado),
 *   · al abrir un chat (los adjuntos más recientes de ese chat).
 *
 * POST { ids?, conversacionIds?, limite?, dias? }
 * GET  → cuántos adjuntos quedan por copiar (para saber si insistir).
 *
 * Seguridad: el cliente solo manda IDs de mensajes; las URLs salen SIEMPRE de
 * la base de datos, nunca del cuerpo de la petición. Los hosts privados y la
 * API de Chatwoot siguen bloqueados (ver media-fuente.ts).
 */

const LOTE_POR_DEFECTO = 4;
const ESCANEO_MAXIMO = 60;
const PRESUPUESTO_MS = 38_000;
const DIAS_POR_DEFECTO = 30;
/**
 * Se copia todo menos videos y documentos: los videos/PDF de WhatsApp suelen
 * pesar demasiado para el bucket y ahí el proxy sigue siendo el camino correcto.
 * (Se excluye por lista negra y no por lista blanca para no dejar fuera filas
 * mal clasificadas: los audios de WhatsApp llegaron a guardarse como "texto".)
 */
const TIPOS_EXCLUIDOS = new Set(["video", "archivo"]);
/** Los ids llegan del navegador: solo se aceptan con forma de uuid. */
const FORMA_UUID = /^[0-9a-fA-F-]{16,40}$/;

type FilaMensaje = {
  id: string;
  url_archivo: string | null;
  tipo_contenido: string | null;
  creado_en?: string | null;
};

function limitar(valor: unknown, maximo: number, porDefecto: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return porDefecto;
  return Math.min(Math.round(n), maximo);
}

/** Filas que de verdad se pueden copiar (mismo criterio que la migración). */
function filasPendientes(filas: FilaMensaje[]): FilaMensaje[] {
  return filas.filter(
    (f) => necesitaIngesta(f.url_archivo) && !TIPOS_EXCLUIDOS.has(String(f.tipo_contenido || "").toLowerCase())
  );
}

/**
 * Cuántos adjuntos quedan por copiar en la ventana reciente.
 *
 * Se cuenta sobre las últimas `tope` filas (una sola consulta) y con el mismo
 * filtro que la migración: si contáramos los videos o los documentos —que se
 * copian a propósito— el contador nunca llegaría a 0 y el navegador insistiría
 * para siempre. `mas: true` avisa de que hay más allá de lo escaneado.
 */
async function contarPendientes(desde: string, tope = 200): Promise<{ pendientes: number; mas: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("mensajes")
    .select("id, url_archivo, tipo_contenido")
    .gte("creado_en", desde)
    .not("url_archivo", "is", null)
    .order("creado_en", { ascending: false })
    .limit(tope);
  if (error) throw new Error(error.message);
  const filas = (data || []) as FilaMensaje[];
  return { pendientes: filasPendientes(filas).length, mas: filas.length >= tope };
}

async function candidatas(opciones: {
  ids: string[];
  conversacionIds: string[];
  limite: number;
  dias: number;
}): Promise<FilaMensaje[]> {
  const columnas = "id, url_archivo, tipo_contenido, creado_en";

  if (opciones.ids.length > 0) {
    const { data } = await supabaseAdmin.from("mensajes").select(columnas).in("id", opciones.ids);
    return (data || []) as FilaMensaje[];
  }

  const escaneo = Math.min(Math.max(opciones.limite * 4, 24), ESCANEO_MAXIMO);
  let consulta = supabaseAdmin
    .from("mensajes")
    .select(columnas)
    .not("url_archivo", "is", null)
    .order("creado_en", { ascending: false })
    .limit(escaneo);

  if (opciones.conversacionIds.length > 0) {
    consulta = consulta.in("conversacion_id", opciones.conversacionIds);
  } else {
    const desde = new Date(Date.now() - opciones.dias * 24 * 60 * 60 * 1000).toISOString();
    consulta = consulta.gte("creado_en", desde);
  }

  const { data } = await consulta;
  return (data || []) as FilaMensaje[];
}

async function migrarFilas(filas: FilaMensaje[], inicio: number): Promise<{
  revisados: number;
  migrados: number;
  fallidos: number;
  motivos: string[];
}> {
  const salida = { revisados: 0, migrados: 0, fallidos: 0, motivos: [] as string[] };

  for (const fila of filas) {
    if (Date.now() - inicio > PRESUPUESTO_MS) {
      salida.motivos.push("Se acabó el tiempo de esta pasada; sigue en la próxima.");
      break;
    }
    salida.revisados += 1;
    const tipoActual = String(fila.tipo_contenido || "").toLowerCase();
    const resultado = await ingerirAdjunto(String(fila.url_archivo || ""), {
      nombreBase: nombreBaseDeTipo(tipoActual),
      tipo: tipoActual,
    });
    if (!resultado.ok || !resultado.url) {
      salida.fallidos += 1;
      if (resultado.motivo && salida.motivos.length < 4) salida.motivos.push(resultado.motivo);
      continue;
    }

    const cambios: Record<string, any> = { url_archivo: resultado.url };
    // Aprovecha para corregir el tipo cuando venía mal clasificado (los audios
    // de WhatsApp llegaban a veces como "texto" y la burbuja no se pintaba).
    if (resultado.mime && (!tipoActual || tipoActual === "texto")) {
      const inferido = tipoDesdeMime(resultado.mime, "");
      if (inferido && inferido !== tipoActual) cambios.tipo_contenido = inferido;
    }

    const { error } = await supabaseAdmin.from("mensajes").update(cambios).eq("id", fila.id);
    if (error) {
      salida.fallidos += 1;
      if (salida.motivos.length < 4) salida.motivos.push(error.message);
      continue;
    }
    salida.migrados += 1;
  }

  return salida;
}

export async function POST(req: Request) {
  const inicio = Date.now();
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const ids = Array.isArray(body?.ids)
    ? body.ids.map((x: any) => String(x)).filter((x: string) => FORMA_UUID.test(x)).slice(0, 20)
    : [];
  const conversacionIds = Array.isArray(body?.conversacionIds)
    ? body.conversacionIds.map((x: any) => String(x)).filter((x: string) => FORMA_UUID.test(x)).slice(0, 10)
    : [];
  const limite = limitar(body?.limite, 12, LOTE_POR_DEFECTO);
  const dias = limitar(body?.dias, 3650, DIAS_POR_DEFECTO);

  try {
    const filas = await candidatas({ ids, conversacionIds, limite, dias });
    // Solo se copia lo que de verdad lo necesita; si el cliente pidió IDs
    // concretos (mensaje recién llegado) se respeta ese orden.
    const pendientes = filasPendientes(filas);
    const aMigrar = ids.length > 0 ? pendientes.slice(0, ids.length) : pendientes.slice(0, limite);

    const resultado = await migrarFilas(aMigrar, inicio);

    // Con ids concretos (mensaje recién llegado) no se cuenta nada: el cliente
    // ya sabe que era uno. En las pasadas generales, el contador es lo que le
    // dice si sigue insistiendo.
    // Se cuenta DESPUÉS de copiar: las filas ya migradas salen solas del conteo.
    let restantes: { pendientes: number; mas: boolean } | null = null;
    if (ids.length === 0) {
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
      restantes = await contarPendientes(desde);
    }

    return NextResponse.json({
      ok: true,
      revisados: resultado.revisados,
      migrados: resultado.migrados,
      fallidos: resultado.fallidos,
      pendientes: restantes ? restantes.pendientes : null,
      quedanMas: restantes ? restantes.mas : null,
      motivos: resultado.motivos,
      ms: Date.now() - inicio,
    });
  } catch (e: any) {
    console.error("[media-persistir] Error:", e?.message || e);
    return NextResponse.json(
      { ok: false, error: e?.message || "No se pudieron preparar los adjuntos.", ms: Date.now() - inicio },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dias = limitar(url.searchParams.get("dias"), 3650, DIAS_POR_DEFECTO);
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  try {
    const conteo = await contarPendientes(desde);
    return NextResponse.json({ ok: true, ...conteo, desde });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error contando adjuntos." }, { status: 500 });
  }
}

/** Ayuda para depurar un adjunto concreto sin tocar nada (solo informa el estado). */
export async function PUT(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const id = String(body?.id || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Falta el id del mensaje." }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("mensajes")
    .select("id, url_archivo, tipo_contenido, creado_en")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Ese mensaje no existe." }, { status: 404 });
  return NextResponse.json({
    ok: true,
    id: data.id,
    estado: estadoDeAdjunto((data as any).url_archivo),
    tipo_contenido: (data as any).tipo_contenido,
    necesita_ingesta: necesitaIngesta((data as any).url_archivo),
  });
}
