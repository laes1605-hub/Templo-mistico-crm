/**
 * Buscador global del CRM.
 *
 * Antes, el buscador de la bandeja filtraba SOLO dentro de la subcategoría
 * abierta (Nuevo Lead, En Consulta, Archivados…): si el contacto estaba en otra
 * etapa, la lista salía vacía aunque el cliente existiera en el CRM. Ahora, en
 * cuanto se escribe algo, se busca en TODO el CRM —todas las etapas del
 * pipeline, Spam y Archivados— y cada resultado dice dónde está ubicado.
 *
 * Qué se compara (lo mismo que el CRM muestra en pantalla):
 *   · el número de teléfono, escrito como sea: con o sin «+», con espacios,
 *     guiones o paréntesis, con o sin indicativo, con el 0 o el 00 de marcado;
 *   · el nombre que el operador puso a mano (`nombre_manual`), sin importar
 *     mayúsculas ni tildes. El nombre que carga WhatsApp NO se usa: la regla
 *     del CRM es que ese nombre nunca se muestra.
 *
 * Este archivo solo tiene funciones puras (sin React ni Supabase) para poder
 * probarlas con `npm run test:buscador`.
 */

/** Dónde vive un contacto dentro del CRM. */
export type UbicacionContacto = "activo" | "archivado" | "spam" | "sin_chat";

/** Por qué campo coincidió un resultado. */
export type CampoCoincidencia = "telefono" | "nombre" | "mensaje";

export type ConsultaBusqueda = {
  /** false = no hay nada que buscar (campo vacío o solo signos como «+»). */
  activa: boolean;
  tipo: "vacia" | "telefono" | "texto";
  /** Texto normalizado (minúsculas, sin tildes, espacios simples). */
  texto: string;
  /** Palabras del texto normalizado. */
  palabras: string[];
  /** Todos los dígitos escritos, en orden. */
  digitos: string;
  /**
   * Dígitos con los que se compara el teléfono. Vacío cuando la consulta es un
   * nombre. Incluye la variante sin el 0 / 00 inicial de marcado.
   */
  variantesDigitos: string[];
};

export type ResultadoBusqueda = {
  /** "chat" = tiene conversación en la bandeja; "cliente" = ficha sin chat. */
  tipo: "chat" | "cliente";
  conv: any | null;
  cliente: any | null;
  ubicacion: UbicacionContacto;
  por: CampoCoincidencia;
  /** 0 = coincidencia exacta; cuanto más alto, menos precisa. */
  puntaje: number;
};

// Caracteres invisibles que WhatsApp y algunas agendas meten al copiar un
// número o un nombre (marcas de dirección del texto, espacios de ancho cero).
const INVISIBLES = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

// Signos con los que se suele escribir un teléfono: no convierten la consulta
// en «texto». Incluye guiones tipográficos y el signo menos.
const SIGNOS_TELEFONO = /[\s+\-().\/\\#*,;:_~'"\u2010-\u2015\u2212]/g;

/** Un nombre o texto con al menos estos dígitos también se prueba como teléfono. */
const MIN_DIGITOS_EN_TEXTO = 7;
/** Con estos dígitos al final del número se considera «el número completo». */
const MIN_DIGITOS_NUMERO_COMPLETO = 7;
/** La variante sin el 0 inicial solo se usa si queda algo razonable que buscar. */
const MIN_DIGITOS_SIN_CERO = 3;
/** Puntaje fijo de la coincidencia por último mensaje: siempre al final. */
const PUNTAJE_MENSAJE = 1000;
/** Título (ya normalizado) que muestra la interfaz cuando no hay nombre ni teléfono. */
const TITULO_SIN_NUMERO = "sin numero";

const ORDEN_UBICACION: Record<UbicacionContacto, number> = {
  activo: 0,
  archivado: 1,
  spam: 2,
  sin_chat: 3,
};

/** Minúsculas, sin tildes ni caracteres invisibles y con espacios simples. */
export function normalizarTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(INVISIBLES, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function soloDigitos(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).replace(/\D/g, "");
}

/**
 * Nombre visible del cliente: SOLO el que el operador puso a mano. Es la misma
 * regla de toda la interfaz (nunca se usa el nombre cargado desde WhatsApp).
 */
export function nombreManualDe(cliente: any): string {
  const n = cliente?.nombre_manual;
  if (!n) return "";
  const t = String(n).trim();
  if (!t || t.toLowerCase() === "sin nombre") return "";
  return t;
}

/** Campos donde el CRM guarda el teléfono de un contacto. */
export function camposTelefonoDe(cliente: any, conv?: any): unknown[] {
  return [cliente?.telefono_display, cliente?.telefono, conv?.numero_whatsapp];
}

/** Teléfonos del contacto reducidos a dígitos, sin repetir y sin vacíos. */
export function telefonosDe(cliente: any, conv?: any): string[] {
  const vistos = new Set<string>();
  for (const campo of camposTelefonoDe(cliente, conv)) {
    const d = soloDigitos(campo);
    if (d) vistos.add(d);
  }
  return Array.from(vistos);
}

/**
 * Interpreta lo que se escribió en el buscador.
 *   «305 402 11»        → teléfono (dígitos 30540211)
 *   «+57 (305) 402-11»  → teléfono (dígitos 5730540211)
 *   «0985 123456»       → teléfono; también prueba 985123456 (sin el 0 local)
 *   «maría lópez»       → texto (palabras maria, lopez)
 *   «wa.me/573054021111»→ texto, pero con 7+ dígitos también se prueba como teléfono
 *   «+», « », «()»      → vacía (todavía no hay nada que buscar)
 */
export function analizarConsulta(valor: unknown): ConsultaBusqueda {
  const crudo = valor === null || valor === undefined ? "" : String(valor);
  const texto = normalizarTexto(crudo);
  const digitos = soloDigitos(crudo);
  const resto = crudo.replace(INVISIBLES, "").replace(/\d/g, "").replace(SIGNOS_TELEFONO, "");
  const tieneTexto = resto.length > 0;

  if (!tieneTexto && !digitos) {
    return { activa: false, tipo: "vacia", texto: "", palabras: [], digitos: "", variantesDigitos: [] };
  }

  const variantesDigitos: string[] = [];
  const digitosTelefono = !tieneTexto || digitos.length >= MIN_DIGITOS_EN_TEXTO ? digitos : "";
  if (digitosTelefono) {
    variantesDigitos.push(digitosTelefono);
    // «0985…» (marcado local) o «0057…» (marcado internacional): el CRM guarda
    // el número con el indicativo y sin esos ceros.
    const sinCeros = digitosTelefono.replace(/^0+/, "");
    if (sinCeros !== digitosTelefono && sinCeros.length >= MIN_DIGITOS_SIN_CERO) {
      variantesDigitos.push(sinCeros);
    }
  }

  return {
    activa: true,
    tipo: tieneTexto ? "texto" : "telefono",
    texto,
    palabras: texto.split(" ").filter(Boolean),
    digitos,
    variantesDigitos,
  };
}

/** Acepta el texto del buscador o una consulta ya analizada. */
function comoConsulta(consulta: string | ConsultaBusqueda | null | undefined): ConsultaBusqueda {
  if (consulta && typeof consulta === "object") return consulta;
  return analizarConsulta(consulta);
}

/**
 * Qué tan bien coincide un teléfono. null = no coincide.
 *   0      → es el número (completo, o el número local completo sin indicativo)
 *   1 + i  → los dígitos aparecen dentro del número a partir de la posición i
 *            (cuanto más al principio, más arriba sale)
 */
export function puntajeTelefono(telefonos: string[], consulta: ConsultaBusqueda): number | null {
  let mejor: number | null = null;
  for (const buscado of consulta.variantesDigitos) {
    if (!buscado) continue;
    for (const telefono of telefonos) {
      if (!telefono) continue;
      let puntaje: number | null = null;
      if (telefono === buscado) {
        puntaje = 0;
      } else if (buscado.length >= MIN_DIGITOS_NUMERO_COMPLETO && telefono.endsWith(buscado)) {
        // Se escribió el número sin el indicativo del país.
        puntaje = 0;
      } else {
        const posicion = telefono.indexOf(buscado);
        if (posicion >= 0) {
          puntaje = 1 + Math.min(posicion, 30);
        } else if (
          buscado.length > telefono.length &&
          telefono.length >= 8 &&
          buscado.endsWith(telefono)
        ) {
          // Se escribió con indicativo y el CRM guardó el número sin él.
          puntaje = 1;
        }
      }
      if (puntaje !== null && (mejor === null || puntaje < mejor)) mejor = puntaje;
    }
  }
  return mejor;
}

/**
 * Qué tan bien coincide un nombre (ya normalizado). null = no coincide.
 *   0 → igual
 *   1 → empieza por lo escrito
 *   2 → cada palabra escrita es el inicio de una palabra del nombre, en
 *       cualquier orden («lopez maria» encuentra «María López»)
 *   3 → lo escrito aparece tal cual dentro del nombre («ari» en «María»)
 */
export function puntajeNombre(nombre: string, consulta: ConsultaBusqueda): number | null {
  if (!nombre || consulta.palabras.length === 0) return null;
  if (nombre === consulta.texto) return 0;
  if (nombre.startsWith(consulta.texto)) return 1;
  const palabrasNombre = nombre.split(" ");
  if (consulta.palabras.every((p) => palabrasNombre.some((w) => w.startsWith(p)))) return 2;
  if (nombre.includes(consulta.texto)) return 3;
  return null;
}

/**
 * ¿El contacto coincide con lo escrito? Devuelve el mejor puntaje y el campo
 * por el que coincidió (nombre manual o teléfono), o null si no coincide.
 */
export function coincidenciaContacto(
  consulta: string | ConsultaBusqueda | null | undefined,
  cliente: any,
  conv?: any
): { puntaje: number; por: CampoCoincidencia } | null {
  const c = comoConsulta(consulta);
  if (!c.activa) return null;
  let mejor: { puntaje: number; por: CampoCoincidencia } | null = null;

  const telefonos = telefonosDe(cliente, conv);
  // Un contacto sin nombre ni teléfono se ve en pantalla como «Sin número»: se
  // puede buscar por ese título, como siempre.
  const titulo = normalizarTexto(nombreManualDe(cliente)) || (telefonos.length === 0 ? TITULO_SIN_NUMERO : "");
  const porNombre = puntajeNombre(titulo, c);
  if (porNombre !== null) mejor = { puntaje: porNombre, por: "nombre" };

  if (c.variantesDigitos.length > 0) {
    const porTelefono = puntajeTelefono(telefonos, c);
    if (porTelefono !== null && (mejor === null || porTelefono < mejor.puntaje)) {
      mejor = { puntaje: porTelefono, por: "telefono" };
    }
  }
  return mejor;
}

/**
 * Dónde vive una conversación. El spam manda sobre el archivado, igual que en
 * las listas de la bandeja (un chat de spam archivado se ve en Spam).
 */
export function ubicacionDeConversacion(conv: any): Exclude<UbicacionContacto, "sin_chat"> {
  if (conv?.clientes?.es_spam === true) return "spam";
  if (conv?.archivada === true) return "archivado";
  return "activo";
}

function marcaDeTiempo(valor: unknown): number {
  if (!valor) return 0;
  const t = Date.parse(String(valor));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Busca en TODO el CRM.
 *
 * @param consulta        Lo que se escribió en el buscador.
 * @param conversaciones  Todas las conversaciones cargadas (cualquier etapa,
 *                        archivadas y spam incluidas), con su `clientes`.
 * @param clientes        Todos los clientes: los que no tienen conversación en
 *                        la bandeja salen como resultado "cliente" (sin chat).
 * @param mensajeEnArchivados  Los chats archivados también se encuentran por el
 *                        texto de su último mensaje. Es lo que ya hacía el
 *                        buscador dentro de la subcategoría Archivados, y se
 *                        conserva solo ahí. Esos resultados salen al final.
 *
 * Orden: mejor coincidencia primero; a igual coincidencia, primero los chats
 * activos, luego archivados, spam y fichas sin chat; y dentro de cada grupo el
 * que tuvo actividad más reciente.
 */
export function buscarEnCrm(opciones: {
  consulta: string | ConsultaBusqueda | null | undefined;
  conversaciones: any[] | null | undefined;
  clientes?: any[] | null;
  mensajeEnArchivados?: boolean;
}): ResultadoBusqueda[] {
  const consulta = comoConsulta(opciones.consulta);
  if (!consulta.activa) return [];

  type Fila = ResultadoBusqueda & { reciente: number; indice: number };
  const filas: Fila[] = [];
  const clientesConChat = new Set<string>();
  let indice = 0;

  for (const conv of opciones.conversaciones || []) {
    if (!conv) continue;
    const cliente = conv.clientes ?? null;
    if (conv.cliente_id) clientesConChat.add(String(conv.cliente_id));
    if (cliente?.id) clientesConChat.add(String(cliente.id));

    const ubicacion = ubicacionDeConversacion(conv);
    let coincidencia = coincidenciaContacto(consulta, cliente, conv);
    if (
      !coincidencia &&
      opciones.mensajeEnArchivados &&
      ubicacion === "archivado" &&
      consulta.texto &&
      normalizarTexto(conv.ultimo_mensaje).includes(consulta.texto)
    ) {
      coincidencia = { puntaje: PUNTAJE_MENSAJE, por: "mensaje" };
    }
    if (!coincidencia) continue;

    filas.push({
      tipo: "chat",
      conv,
      cliente,
      ubicacion,
      por: coincidencia.por,
      puntaje: coincidencia.puntaje,
      reciente: marcaDeTiempo(conv.ultimo_mensaje_en),
      indice: indice++,
    });
  }

  for (const cliente of opciones.clientes || []) {
    if (!cliente || !cliente.id) continue;
    if (clientesConChat.has(String(cliente.id))) continue;
    const coincidencia = coincidenciaContacto(consulta, cliente);
    if (!coincidencia) continue;
    filas.push({
      tipo: "cliente",
      conv: null,
      cliente,
      ubicacion: "sin_chat",
      por: coincidencia.por,
      puntaje: coincidencia.puntaje,
      reciente: marcaDeTiempo(cliente.actualizado_en),
      indice: indice++,
    });
  }

  filas.sort(
    (a, b) =>
      a.puntaje - b.puntaje ||
      ORDEN_UBICACION[a.ubicacion] - ORDEN_UBICACION[b.ubicacion] ||
      b.reciente - a.reciente ||
      a.indice - b.indice
  );

  return filas.map((fila) => ({
    tipo: fila.tipo,
    conv: fila.conv,
    cliente: fila.cliente,
    ubicacion: fila.ubicacion,
    por: fila.por,
    puntaje: fila.puntaje,
  }));
}
