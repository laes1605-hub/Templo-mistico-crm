/**
 * Respuestas rápidas: textos, audios (OGG) e imágenes.
 *
 * La tabla `respuestas_rapidas` es la biblioteca compartida. Cada dispositivo
 * conserva una copia local para poder preparar respuestas sin red, pero sólo
 * las respuestas marcadas como pendientes se publican cuando el operador pulsa
 * «Sincronizar con todos».
 *
 * Los binarios NO viajan dentro de la tabla: al publicarlos se suben al bucket
 * `media-mensajes` (carpeta `respuestas-rapidas/`) y en `contenido` queda la URL
 * pública. La biblioteca se descarga completa en cada sincronización y en cada
 * evento de realtime, así que incrustar base64 multiplicaba el Egress de la
 * misma forma que ya multiplicaba el de los chats (ver 20260916_media_storage).
 *
 * Como la URL no identifica el archivo, la huella de deduplicación se calcula
 * sobre los bytes (MD5 en `hash_bytes`, columna + trigger de la migración
 * 20260917). Así dos teléfonos que suben el mismo audio siguen siendo la misma
 * respuesta rápida aunque cada uno tenga una URL distinta, y un teléfono que
 * todavía tiene el base64 en caché reconoce la copia ya publicada en vez de
 * volver a insertarla.
 */
import { remuxWebmToOgg } from "./webm-to-ogg";
import { isWebmBytes } from "./audio-download";
import { supabase } from "./supabase";
import {
  CARPETA_RESPUESTAS_RAPIDAS,
  bytesADataUri,
  borrarObjetoDelBucket,
  esDataUri,
  esUrlDeStorage,
  extensionPorMime,
  mimeDesdeUrl,
  nombreDesdeUrl,
  parsearDataUri,
  subirBytesAStorage,
} from "./media-format";
import { md5Hex } from "./md5";

export type TipoRespuestaRapida = "texto" | "audio" | "imagen";

export interface RespuestaRapida {
  id: string;
  tipo: TipoRespuestaRapida;
  titulo: string;
  contenido: string;
  creado_en: string;
  sincronizada?: boolean;
  hash?: string;
}

export interface ResultadoSincronizacionRR {
  respuestas: RespuestaRapida[];
  subidas: number;
  pendientes: number;
  error?: string;
}

export interface AdjuntoParaEnviar {
  fileBase64: string | null;
  fileUrl: string | null;
  fileMime: string;
  fileName: string;
}

const STORAGE_KEY = "templo-crm:respuestas-rapidas:v1";
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_IMG_DIRECTA = 2 * 1024 * 1024;

let listaEnMemoria: RespuestaRapida[] | null = null;
let persistenciaRota = false;

function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `rr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function esTipoRespuesta(valor: unknown): valor is TipoRespuestaRapida {
  return valor === "texto" || valor === "audio" || valor === "imagen";
}

const esBinaria = (respuesta: Pick<RespuestaRapida, "tipo">): boolean =>
  respuesta.tipo === "audio" || respuesta.tipo === "imagen";

function fechaRespuesta(valor: string): number {
  const fecha = new Date(valor).getTime();
  return Number.isFinite(fecha) ? fecha : 0;
}

function claveContenido(respuesta: RespuestaRapida): string {
  const identificador = esBinaria(respuesta) && respuesta.hash ? respuesta.hash : respuesta.contenido;
  return `${respuesta.tipo}\u001f${identificador}`;
}

function clavesDe(respuesta: RespuestaRapida): string[] {
  const claves = [`${respuesta.tipo}\u001f${respuesta.contenido}`];
  if (esBinaria(respuesta) && respuesta.hash) claves.push(`${respuesta.tipo}\u001f${respuesta.hash}`);
  return claves;
}

function conHuella(respuesta: RespuestaRapida): RespuestaRapida {
  if (respuesta.hash || !esBinaria(respuesta) || !esDataUri(respuesta.contenido)) return respuesta;
  const parseado = parsearDataUri(respuesta.contenido);
  return parseado ? { ...respuesta, hash: md5Hex(parseado.bytes) } : respuesta;
}

function ordenarRespuestas(todas: RespuestaRapida[]): RespuestaRapida[] {
  return [...todas].sort((a, b) => {
    const diferencia = fechaRespuesta(a.creado_en) - fechaRespuesta(b.creado_en);
    return diferencia || a.id.localeCompare(b.id);
  });
}

function deduplicarRespuestas(todas: RespuestaRapida[]): RespuestaRapida[] {
  const porContenido = new Map<string, RespuestaRapida>();
  for (const respuesta of todas) {
    const clave = claveContenido(respuesta);
    const actual = porContenido.get(clave);
    if (!actual) {
      porContenido.set(clave, respuesta);
      continue;
    }
    const preferirNueva =
      (respuesta.sincronizada === true && actual.sincronizada !== true) ||
      (respuesta.sincronizada === actual.sincronizada &&
        (fechaRespuesta(respuesta.creado_en) < fechaRespuesta(actual.creado_en) ||
          (fechaRespuesta(respuesta.creado_en) === fechaRespuesta(actual.creado_en) && respuesta.id < actual.id)));
    if (preferirNueva) porContenido.set(clave, respuesta);
  }
  return ordenarRespuestas(Array.from(porContenido.values()));
}

function esMuyGrande(rr: RespuestaRapida): boolean {
  return esDataUri(rr.contenido) && rr.contenido.length > 200_000;
}

function cachearLocal(todas: RespuestaRapida[]): RespuestaRapida[] {
  const unicas = deduplicarRespuestas(todas);
  listaEnMemoria = unicas;
  if (typeof window === "undefined") return unicas;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(unicas));
    persistenciaRota = false;
  } catch {
    try {
      const sinGigantes = unicas.filter((r) => !esMuyGrande(r));
      const paraGuardar = sinGigantes.length > 0 ? sinGigantes : unicas.slice(-5);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(paraGuardar));
      persistenciaRota = false;
    } catch {
      persistenciaRota = true;
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        const esenciales = unicas.filter((r) => r.sincronizada !== true && !esMuyGrande(r)).slice(-20);
        if (esenciales.length > 0) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(esenciales));
          persistenciaRota = false;
        }
      } catch {}
    }
  }
  return unicas;
}

function filaACache(row: any): RespuestaRapida | null {
  if (!row || !row.id || !esTipoRespuesta(row.tipo) || typeof row.contenido !== "string" || !row.contenido) return null;
  return {
    id: String(row.id),
    tipo: row.tipo,
    titulo: String(row.titulo || ""),
    contenido: row.contenido,
    creado_en: typeof row.creado_en === "string" ? row.creado_en : new Date().toISOString(),
    sincronizada: row.sincronizada === true,
    hash: typeof row.hash === "string" && row.hash ? row.hash : undefined,
  };
}

function filaARemota(row: any): RespuestaRapida | null {
  const respuesta = filaACache(row);
  if (!respuesta) return null;
  const hashDeFila = typeof row.hash_bytes === "string" && row.hash_bytes ? row.hash_bytes : undefined;
  return { ...respuesta, sincronizada: true, hash: hashDeFila ?? respuesta.hash };
}

export function listarRespuestasRapidas(): RespuestaRapida[] {
  if (typeof window === "undefined") return listaEnMemoria ? deduplicarRespuestas(listaEnMemoria) : [];
  if (persistenciaRota && listaEnMemoria) return deduplicarRespuestas(listaEnMemoria);
  let persistidas: RespuestaRapida[] = [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) persistidas = arr.map(filaACache).filter(Boolean) as RespuestaRapida[];
    }
  } catch {
    persistidas = [];
  }
  if (listaEnMemoria && listaEnMemoria.length > 0) {
    return deduplicarRespuestas([...persistidas, ...listaEnMemoria]);
  }
  return deduplicarRespuestas(persistidas);
}

async function subirViaServidor(
  dataUri: string,
  titulo: string,
  hash?: string
): Promise<{ url: string | null; hash: string | null }> {
  try {
    const res = await fetch("/api/respuestas-rapidas/subir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUri, titulo, hash }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return { url: null, hash: null };
    return { url: typeof json.url === "string" ? json.url : null, hash: typeof json.hash === "string" ? json.hash : hash || null };
  } catch {
    return { url: null, hash: null };
  }
}

async function obtenerRemotasViaServidor(): Promise<RespuestaRapida[] | null> {
  try {
    const res = await fetch("/api/respuestas-rapidas", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !Array.isArray(json.respuestas)) return null;
    return deduplicarRespuestas((json.respuestas || []).map(filaARemota).filter(Boolean) as RespuestaRapida[]);
  } catch {
    return null;
  }
}

async function sincronizarViaServidor(
  pendientes: RespuestaRapida[]
): Promise<{ remotas: RespuestaRapida[]; subidas: number; error?: string } | null> {
  try {
    const res = await fetch("/api/respuestas-rapidas/sincronizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendientes }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return { remotas: [], subidas: 0, error: json?.error || "Error del servidor" };
    const remotas = Array.isArray(json.respuestas)
      ? deduplicarRespuestas((json.respuestas || []).map(filaARemota).filter(Boolean) as RespuestaRapida[])
      : [];
    return { remotas, subidas: typeof json.subidas === "number" ? json.subidas : 0, error: json.error };
  } catch {
    return null;
  }
}

const COLUMNAS_BASICAS = "id, tipo, titulo, contenido, creado_en";
const COLUMNAS_REMOTAS = `${COLUMNAS_BASICAS}, hash_bytes`;

async function obtenerRemotas(): Promise<RespuestaRapida[]> {
  try {
    const { data, error } = await supabase.from("respuestas_rapidas").select(COLUMNAS_REMOTAS).order("creado_en", { ascending: true });
    if (!error) return deduplicarRespuestas((data || []).map(filaARemota).filter(Boolean) as RespuestaRapida[]);
    if (!esColumnaInexistente(error)) throw error;
    const { data: sinHash, error: error2 } = await supabase
      .from("respuestas_rapidas")
      .select(COLUMNAS_BASICAS)
      .order("creado_en", { ascending: true });
    if (error2) throw error2;
    return deduplicarRespuestas((sinHash || []).map(filaARemota).filter(Boolean) as RespuestaRapida[]);
  } catch (e) {
    const viaServidor = await obtenerRemotasViaServidor();
    if (viaServidor) return viaServidor;
    throw e;
  }
}

function combinarRemotasYPendientes(remotas: RespuestaRapida[], locales: RespuestaRapida[]): RespuestaRapida[] {
  const clavesRemotas = new Set(remotas.flatMap(clavesDe));
  const pendientes = locales
    .filter((respuesta) => respuesta.sincronizada !== true && !clavesDe(respuesta).some((clave) => clavesRemotas.has(clave)))
    .map((respuesta) => ({ ...respuesta, sincronizada: false }));
  return deduplicarRespuestas([...remotas.map((respuesta) => ({ ...respuesta, sincronizada: true })), ...pendientes]);
}

export async function actualizarRespuestasRapidas(): Promise<RespuestaRapida[]> {
  const locales = listarRespuestasRapidas();
  try {
    const remotas = await obtenerRemotas();
    return cachearLocal(combinarRemotasYPendientes(remotas, locales));
  } catch {
    return cachearLocal(locales);
  }
}

function esIdNoValido(error: any): boolean {
  const mensaje = String(error?.message || "").toLowerCase();
  return error?.code === "22P02" || (mensaje.includes("uuid") && mensaje.includes("invalid"));
}

function esDuplicado(error: any): boolean {
  const mensaje = String(error?.message || "").toLowerCase();
  return error?.code === "23505" || mensaje.includes("duplicate key") || mensaje.includes("duplicate");
}

function esColumnaInexistente(error: any): boolean {
  const mensaje = String(error?.message || "").toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || (mensaje.includes("column") && mensaje.includes("does not exist"));
}

async function contenidoPublicado(item: RespuestaRapida): Promise<{ contenido: string; hash: string | null }> {
  if (!esBinaria(item) || !esDataUri(item.contenido)) {
    return { contenido: item.contenido, hash: item.hash ?? null };
  }
  const parseado = parsearDataUri(item.contenido);
  if (!parseado) return { contenido: item.contenido, hash: item.hash ?? null };
  const hash = item.hash || md5Hex(parseado.bytes);
  let url = await subirBytesAStorage(supabase, parseado.bytes, parseado.mime, {
    carpeta: CARPETA_RESPUESTAS_RAPIDAS,
    hash,
    nombreBase: item.titulo || "respuesta-rapida",
  });
  if (!url) {
    const viaSrv = await subirViaServidor(item.contenido, item.titulo || "respuesta-rapida", hash);
    if (viaSrv.url) url = viaSrv.url;
  }
  return { contenido: url || item.contenido, hash };
}

async function insertarFila(payload: Record<string, unknown>): Promise<{ data: any; error: any }> {
  const intento = await supabase
    .from("respuestas_rapidas")
    .insert(payload)
    .select(COLUMNAS_REMOTAS)
    .maybeSingle();
  if (!intento.error || !esColumnaInexistente(intento.error)) return { data: intento.data, error: intento.error };
  const { hash_bytes: _sinColumna, ...resto } = payload;
  const reintento = await supabase
    .from("respuestas_rapidas")
    .insert(resto)
    .select(COLUMNAS_BASICAS)
    .maybeSingle();
  return { data: reintento.data, error: reintento.error };
}

async function insertarPendiente(item: RespuestaRapida): Promise<RespuestaRapida | null> {
  const { contenido, hash } = await contenidoPublicado(item);
  const base: Record<string, unknown> = {
    tipo: item.tipo,
    titulo: item.titulo,
    contenido,
    creado_en: item.creado_en,
  };
  if (hash) base.hash_bytes = hash;
  let { data, error } = await insertarFila({ ...base, id: item.id });
  if (error && esIdNoValido(error)) {
    ({ data, error } = await insertarFila(base));
  }
  if (error) {
    if (esDuplicado(error)) return null;
    throw error;
  }
  return filaARemota(data);
}

export async function sincronizarRespuestasRapidas(): Promise<ResultadoSincronizacionRR> {
  const locales = listarRespuestasRapidas();
  let remotas: RespuestaRapida[];
  try {
    remotas = await obtenerRemotas();
  } catch (error: any) {
    const pendientes = locales.filter((r) => r.sincronizada !== true);
    if (pendientes.length > 0) {
      const viaSrv = await sincronizarViaServidor(pendientes);
      if (viaSrv && viaSrv.remotas.length > 0) {
        const respuestas = cachearLocal(combinarRemotasYPendientes(viaSrv.remotas, locales));
        return {
          respuestas,
          subidas: viaSrv.subidas,
          pendientes: respuestas.filter((r) => r.sincronizada !== true).length,
          error: viaSrv.error,
        };
      }
    }
    const respuestas = cachearLocal(locales);
    return {
      respuestas,
      subidas: 0,
      pendientes: respuestas.filter((respuesta) => respuesta.sincronizada !== true).length,
      error: error?.message || "No se pudo conectar con la biblioteca compartida.",
    };
  }

  const clavesRemotas = new Set(remotas.flatMap(clavesDe));
  let subidas = 0;
  const fallos: string[] = [];
  const pendientesFallidos: RespuestaRapida[] = [];

  for (const pendiente of locales.filter((respuesta) => respuesta.sincronizada !== true)) {
    if (clavesDe(pendiente).some((clave) => clavesRemotas.has(clave))) continue;
    try {
      const insertada = await insertarPendiente(pendiente);
      if (insertada) {
        remotas.push(insertada);
        for (const clave of clavesDe(insertada)) clavesRemotas.add(clave);
        for (const clave of clavesDe(pendiente)) clavesRemotas.add(clave);
        subidas += 1;
      }
    } catch (error: any) {
      fallos.push(`"${pendiente.titulo || pendiente.tipo}": ${error?.message || "error desconocido"}`);
      pendientesFallidos.push(pendiente);
    }
  }

  if (pendientesFallidos.length > 0) {
    const viaSrv = await sincronizarViaServidor(pendientesFallidos);
    if (viaSrv) {
      if (viaSrv.remotas.length > 0) {
        for (const r of viaSrv.remotas) {
          const k1 = `${r.tipo}\u001f${r.contenido}`;
          const k2 = r.hash ? `${r.tipo}\u001f${r.hash}` : null;
          if (!clavesRemotas.has(k1) && !(k2 && clavesRemotas.has(k2))) {
            remotas.push(r);
            clavesRemotas.add(k1);
            if (k2) clavesRemotas.add(k2);
          }
        }
        subidas += viaSrv.subidas;
        if (viaSrv.subidas > 0) fallos.length = 0;
        else if (viaSrv.error) fallos.push(viaSrv.error);
      } else if (viaSrv.error) {
        fallos.push(viaSrv.error);
      }
    }
  }

  try {
    remotas = await obtenerRemotas();
  } catch {}

  const respuestas = cachearLocal(combinarRemotasYPendientes(remotas, locales));
  const pendientes = respuestas.filter((respuesta) => respuesta.sincronizada !== true).length;
  return {
    respuestas,
    subidas,
    pendientes,
    error:
      fallos.length > 0
        ? `No se pudo subir ${fallos.length === 1 ? "una respuesta" : `${fallos.length} respuestas`}: ${fallos[0]}${
            fallos.length > 1 ? ` (y ${fallos.length - 1} más)` : ""
          }.${pistaDeFallo(fallos.join(" "))}`
        : undefined,
  };
}

/**
 * Traduce los fallos de Supabase que ya sabemos diagnosticar. El caso típico
 * (19–22/09/2026): la migración de «duplicados» borró el trigger que calcula
 * `respuestas_rapidas.huella`, que es NOT NULL, así que TODA inserción fallaba
 * con un error de Postgres que no le dice nada al operador.
 */
function pistaDeFallo(detalle: string): string {
  const texto = detalle.toLowerCase();
  if (texto.includes("huella") && texto.includes("not-null")) {
    return " Falta el trigger que calcula la huella en Supabase: corre supabase/migrations/20260922000001_restaurar_triggers_perdidos.sql y vuelve a sincronizar.";
  }
  return " Intenta sincronizar de nuevo.";
}

export async function guardarRespuestaRapida(
  nueva: { tipo: TipoRespuestaRapida; titulo: string; contenido: string; hash?: string }
): Promise<RespuestaRapida & { archivoEnNube?: boolean }> {
  const item = conHuella({
    id: uid(),
    tipo: nueva.tipo,
    titulo: nueva.titulo,
    contenido: nueva.contenido,
    creado_en: new Date().toISOString(),
    sincronizada: false,
    hash: nueva.hash,
  });

  let paraGuardar: RespuestaRapida = item;
  let archivoEnNube = false;
  if (esBinaria(item) && esDataUri(item.contenido)) {
    const parseado = parsearDataUri(item.contenido);
    if (parseado) {
      const hashCalc = item.hash || md5Hex(parseado.bytes);
      let url = await subirBytesAStorage(supabase, parseado.bytes, parseado.mime, {
        carpeta: CARPETA_RESPUESTAS_RAPIDAS,
        hash: hashCalc,
        nombreBase: item.titulo || "respuesta-rapida",
      });
      if (!url) {
        const viaSrv = await subirViaServidor(item.contenido, item.titulo || "respuesta-rapida", hashCalc);
        if (viaSrv.url) url = viaSrv.url;
      }
      if (url) {
        paraGuardar = { ...item, contenido: url };
        archivoEnNube = true;
      }
    }
  }

  const todas = cachearLocal([...listarRespuestasRapidas(), paraGuardar]);
  const guardada = todas.find((respuesta) => claveContenido(respuesta) === claveContenido(paraGuardar)) || paraGuardar;
  return { ...guardada, archivoEnNube };
}

async function liberarAdjuntoSiHuerfano(url: string, idConservado: string): Promise<void> {
  try {
    const [{ count: otrasRespuestas, error: e1 }, { count: mensajesConUrl, error: e2 }] = await Promise.all([
      supabase
        .from("respuestas_rapidas")
        .select("id", { count: "exact", head: true })
        .eq("contenido", url)
        .neq("id", idConservado),
      supabase.from("mensajes").select("id", { count: "exact", head: true }).eq("url_archivo", url),
    ]);
    if (e1 || e2) return;
    if ((otrasRespuestas ?? 0) > 0 || (mensajesConUrl ?? 0) > 0) return;
    await borrarObjetoDelBucket(supabase, url);
  } catch {}
}

export async function eliminarRespuestaRapida(id: string): Promise<RespuestaRapida[]> {
  const locales = listarRespuestasRapidas();
  const objetivo = locales.find((respuesta) => respuesta.id === id);
  if (!objetivo) return locales;

  if (objetivo.sincronizada === true) {
    try {
      const { error } = await supabase.from("respuestas_rapidas").delete().eq("id", id);
      if (error) throw error;
    } catch {
      // Fallback servidor
      try {
        await fetch(`/api/respuestas-rapidas/${id}`, { method: "DELETE" });
      } catch {}
    }
  }

  if (esUrlDeStorage(objetivo.contenido)) {
    try {
      await liberarAdjuntoSiHuerfano(objetivo.contenido, id);
    } catch {
      try {
        await fetch("/api/respuestas-rapidas/borrar-storage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: objetivo.contenido, id }),
        });
      } catch {}
    }
  }

  return cachearLocal(locales.filter((respuesta) => respuesta.id !== id));
}

export function adjuntoParaEnviar(rr: RespuestaRapida): AdjuntoParaEnviar | null {
  if (rr.tipo === "texto") return null;
  if (esDataUri(rr.contenido)) {
    const coma = rr.contenido.indexOf(",");
    const mime = (rr.contenido.slice(5, coma > 0 ? coma : undefined) || "").split(";")[0] || "application/octet-stream";
    if (rr.tipo === "audio") {
      const audioMime = mime.startsWith("audio/") ? mime : "audio/ogg";
      return {
        fileBase64: rr.contenido,
        fileUrl: null,
        fileMime: audioMime,
        fileName: nombreArchivoRR(rr, audioMime, "nota_de_voz"),
      };
    }
    const imgMime = mime.startsWith("image/") ? mime : "image/jpeg";
    return { fileBase64: rr.contenido, fileUrl: null, fileMime: imgMime, fileName: nombreArchivoRR(rr, imgMime, "respuesta-rapida") };
  }
  const mime = mimeDesdeUrl(rr.contenido, rr.tipo === "audio" ? "audio/ogg" : "image/jpeg");
  return {
    fileBase64: null,
    fileUrl: rr.contenido,
    fileMime: mime,
    fileName: nombreDesdeUrl(rr.contenido, nombreArchivoRR(rr, mime, "respuesta-rapida")),
  };
}

function nombreArchivoRR(rr: RespuestaRapida, mime: string, prefijo: string): string {
  const ext = extensionPorMime(mime);
  const sinExtension = (rr.titulo || prefijo).replace(/[^\w\sáéíóúñüÁÉÍÓÚÑ.-]/g, "").trim().replace(/\.[^.]+$/, "");
  return `${sinExtension || prefijo}.${ext}`;
}

const nombreBase = (file: File, fallback: string): string =>
  file.name.replace(/\.[^.]+$/, "").replace(/[^\w\sáéíóúñüÁÉÍÓÚÑ-]/g, "").trim().slice(0, 50) || fallback;

const leerComoDataUri = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });

export async function prepararAudioRR(file: File): Promise<{ dataUri: string; titulo: string; mime: string }> {
  const esAudio =
    (file.type || "").startsWith("audio/") || /\.(ogg|opus|webm|mp3|wav|m4a|aac)$/i.test(file.name);
  if (!esAudio) throw new Error("Selecciona un archivo de audio.");
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("El audio supera 6 MB: recórtalo a una nota más corta y vuelve a intentarlo.");
  }
  const titulo = nombreBase(file, "nota-de-voz");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let out: Uint8Array = bytes;
  let mime = file.type && file.type.startsWith("audio/") ? file.type : "audio/ogg";
  if (isWebmBytes(bytes)) {
    try {
      out = remuxWebmToOgg(bytes, { prerollMs: 0 });
      mime = "audio/ogg";
    } catch {}
  }
  return { dataUri: bytesADataUri(out, mime), titulo, mime };
}

export async function prepararImagenRR(file: File): Promise<{ dataUri: string; titulo: string }> {
  if (!(file.type || "").startsWith("image/")) throw new Error("Selecciona un archivo de imagen.");
  const titulo = nombreBase(file, "respuesta-rapida");
  if (file.size <= MAX_IMG_DIRECTA && file.type !== "image/gif") {
    return { dataUri: await leerComoDataUri(file), titulo };
  }
  const dataUri = await leerComoDataUri(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("No se pudo procesar la imagen."));
    el.src = dataUri;
  });
  const escala = Math.min(1, 1024 / Math.max(img.width || 1, img.height || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((img.width || 1) * escala));
  canvas.height = Math.max(1, Math.round((img.height || 1) * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo reducir la imagen (canvas no disponible).");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUri: canvas.toDataURL("image/jpeg", 0.82), titulo };
}
