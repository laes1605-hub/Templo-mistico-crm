/**
 * Chatwoot desde el servidor (sólo route handlers).
 *
 * ¿Por qué existe? La "ficha" que Luna construye de cada cliente NO vive en
 * Supabase: vive en la conversación de Chatwoot como `custom_attributes`
 * (tipo de trabajo, motivo, nombres, fotos, etapa) y como notas privadas
 * "🔎 Ficha de Luna". Mientras eso exista, aunque borres el cliente del CRM,
 * Luna vuelve a saberlo todo en el siguiente mensaje (el workflow n8n
 * "Sincronizar Supabase" incluso re-copia tipo_trabajo / nombre_otra_persona /
 * fotos desde esos atributos al cliente nuevo).
 *
 * Por eso al eliminar un cliente hay que limpiar también Chatwoot:
 *   1) DELETE de la conversación  → se va el historial, las notas y los atributos.
 *   2) Respaldo si ese DELETE no está permitido (token sin rol administrador):
 *      se vacían los custom_attributes, se borran las notas privadas de Luna y
 *      se quitan las etiquetas. Con eso Luna arranca de cero igual.
 */

// Mismo token que ya está publicado en n8n/luna/code/*.js y en el workflow
// exportable. Se usa únicamente si no defines CHATWOOT_API_TOKEN en Vercel,
// para que el botón funcione sin configuración extra.
const TOKEN_RESPALDO = "KKaF2gF4bJZvnSkqKnR42zD8";

export type ChatwootConfig = {
  url: string;
  token: string;
  accountId: string;
  /** true cuando el token viene de la variable de entorno (lo recomendado). */
  tokenDeEntorno: boolean;
};

export function chatwootConfig(): ChatwootConfig {
  const tokenEntorno = (process.env.CHATWOOT_API_TOKEN || "").trim();
  return {
    url: (process.env.CHATWOOT_URL || "https://crmesteban.duckdns.org").replace(/\/$/, ""),
    token: tokenEntorno || TOKEN_RESPALDO,
    accountId: (process.env.CHATWOOT_ACCOUNT_ID || "1").trim() || "1",
    tokenDeEntorno: Boolean(tokenEntorno),
  };
}

type RespuestaCw = {
  status: number;
  ok: boolean;
  json: any;
  texto: string;
};

async function cwFetch(
  cfg: ChatwootConfig,
  ruta: string,
  init: RequestInit = {},
  timeoutMs = 20000
): Promise<RespuestaCw> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const respuesta = await fetch(`${cfg.url}/api/v1/accounts/${cfg.accountId}${ruta}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        api_access_token: cfg.token,
        ...(init.headers || {}),
      },
      signal: controlador.signal,
    });
    const texto = await respuesta.text();
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { status: respuesta.status, ok: respuesta.ok, json, texto };
  } catch (e: any) {
    const motivo = e?.name === "AbortError" ? "tiempo de espera agotado" : e?.message || "error de red";
    return { status: 0, ok: false, json: null, texto: motivo };
  } finally {
    clearTimeout(temporizador);
  }
}

// ---------------------------------------------------------------------------
// Atributos que Luna guarda en la conversación (fuente: n8n/luna/code/*.js)
// ---------------------------------------------------------------------------
const CLAVES_TEXTO = [
  "tipo_trabajo",
  "motivo_categoria",
  "motivo_resumen",
  "nombre_cliente",
  "nombre_otra_persona",
  "foto_cliente_url",
  "foto_otra_persona_url",
  "foto_mano_url",
  "luna_etapa",
  "luna_etapa_crm_sync",
  "tiempo_consulta_lista",
  "fotos_pendientes",
];
const CLAVES_BOOLEANAS = [
  "motivo_conocido",
  "foto_cliente",
  "foto_otra_persona",
  "foto_mano",
  "consulta_lista_enviada",
];

/** Valor "vacío" según el tipo, para que Luna lo lea como "no lo sé todavía". */
function vaciar(valor: any): any {
  if (Array.isArray(valor)) return [];
  if (typeof valor === "boolean") return false;
  if (typeof valor === "number") return 0;
  if (valor === null || valor === undefined) return "";
  return "";
}

function payloadMemoriaVacia(attrsActuales: Record<string, any> | null): Record<string, any> {
  const payload: Record<string, any> = {};
  CLAVES_TEXTO.forEach((clave) => {
    payload[clave] = "";
  });
  CLAVES_BOOLEANAS.forEach((clave) => {
    payload[clave] = false;
  });
  // Cualquier otra clave que ya exista se vacía también (a prueba de futuras
  // versiones del workflow de Luna).
  Object.entries(attrsActuales || {}).forEach(([clave, valor]) => {
    if (!(clave in payload)) payload[clave] = vaciar(valor);
  });
  return payload;
}

export type LimpiezaChatwoot = {
  conversacion: string;
  /** La conversación completa se borró de Chatwoot (historial incluido). */
  conversacion_eliminada: boolean;
  /** Los custom_attributes de Luna quedaron vacíos. */
  memoria_vaciada: boolean;
  /** Notas privadas "🔎 Ficha de Luna" eliminadas (respaldo). */
  notas_borradas: number;
  /** Etiquetas quitadas de la conversación (respaldo). */
  etiquetas_vaciadas: boolean;
  /** No había nada que borrar en Chatwoot (404). */
  ya_no_existia: boolean;
  errores: string[];
};

/** Borra las notas privadas de Luna recorriendo el historial por cursor. */
async function borrarNotasPrivadas(
  cfg: ChatwootConfig,
  conversacionId: string | number,
  limiteBorrados = 80
): Promise<{ borradas: number; error: string | null; truncado: boolean }> {
  let cursor = 0;
  let borradas = 0;
  let truncado = false;

  for (let pagina = 0; pagina < 30; pagina += 1) {
    const listado = await cwFetch(cfg, `/conversations/${conversacionId}/messages?after=${cursor}`);
    if (listado.status === 404) return { borradas, error: null, truncado };
    if (!listado.ok) {
      return { borradas, error: `no se pudo listar el historial (${listado.status})`, truncado };
    }
    const mensajes: any[] = Array.isArray(listado.json?.data) ? listado.json.data : [];
    if (mensajes.length === 0) break;

    const idsPrivados = mensajes.filter((m) => m?.private === true).map((m) => m.id).filter(Boolean);
    for (let i = 0; i < idsPrivados.length; i += 10) {
      if (borradas >= limiteBorrados) {
        truncado = true;
        break;
      }
      const lote = idsPrivados.slice(i, i + 10);
      const resultados = await Promise.all(
        lote.map((id) =>
          cwFetch(cfg, `/conversations/${conversacionId}/messages/${id}`, { method: "DELETE" })
        )
      );
      borradas += resultados.filter((r) => r.ok).length;
    }
    if (borradas >= limiteBorrados) {
      truncado = true;
      break;
    }

    const ultimo = mensajes.reduce((max, m) => Math.max(max, Number(m?.id) || 0), cursor);
    if (ultimo === cursor) break;
    cursor = ultimo;
    if (mensajes.length < 100) break;
  }

  return { borradas, error: null, truncado };
}

/**
 * Borra todo lo que Chatwoot sabe de una conversación: la conversación entera
 * si el token lo permite, o como mínimo la memoria de Luna (atributos, fichas
 * privadas y etiquetas).
 */
export async function borrarConversacionCompleta(
  conversacionId: string | number
): Promise<LimpiezaChatwoot> {
  const cfg = chatwootConfig();
  const resultado: LimpiezaChatwoot = {
    conversacion: String(conversacionId),
    conversacion_eliminada: false,
    memoria_vaciada: false,
    notas_borradas: 0,
    etiquetas_vaciadas: false,
    ya_no_existia: false,
    errores: [],
  };

  // 1) Intento principal: borrar la conversación completa.
  const borrado = await cwFetch(cfg, `/conversations/${conversacionId}`, { method: "DELETE" });
  if (borrado.ok) {
    resultado.conversacion_eliminada = true;
    resultado.memoria_vaciada = true;
    return resultado;
  }

  // 2) Respaldo: vaciar la memoria de Luna sin borrar el historial.
  //    El GET sirve además para distinguir "la conversación ya no existe" de
  //    "este Chatwoot no permite borrar conversaciones" (ambos dan 404 arriba).
  const detalle = await cwFetch(cfg, `/conversations/${conversacionId}`);
  if (detalle.status === 404) {
    resultado.ya_no_existia = true;
    resultado.memoria_vaciada = true;
    return resultado;
  }
  if (!detalle.ok) {
    resultado.errores.push(
      `Chatwoot no permitió borrar la conversación (${borrado.status || detalle.status || "sin conexión"})`
    );
    return resultado;
  }
  resultado.errores.push(
    `sin permiso para borrar el historial de Chatwoot (${borrado.status || "sin conexión"}); se vació la memoria de Luna`
  );

  const attrs = detalle.json?.custom_attributes || {};
  const reset = await cwFetch(cfg, `/conversations/${conversacionId}/custom_attributes`, {
    method: "POST",
    body: JSON.stringify({ custom_attributes: payloadMemoriaVacia(attrs) }),
  });
  resultado.memoria_vaciada = reset.ok;
  if (!reset.ok) {
    resultado.errores.push(`no se pudo vaciar la memoria de Luna (${reset.status})`);
  }

  const notas = await borrarNotasPrivadas(cfg, conversacionId);
  resultado.notas_borradas = notas.borradas;
  if (notas.error) resultado.errores.push(notas.error);
  if (notas.truncado) {
    resultado.errores.push("quedaron fichas de Luna sin borrar (historial muy largo)");
  }

  const etiquetas = await cwFetch(cfg, `/conversations/${conversacionId}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: [] }),
  });
  resultado.etiquetas_vaciadas = etiquetas.ok;

  if (!resultado.memoria_vaciada && resultado.errores.length === 0) {
    resultado.errores.push("no se pudo vaciar la memoria de Luna");
  }
  return resultado;
}

/**
 * Busca o crea una conversación en Chatwoot (inbox 5 = WhatsApp Cloud API) para
 * un número telefónico. Permite enviar vía WhatsApp API a un cliente cuya
 * conversación original se haya creado por Evolution (WhatsApp Personal).
 */
export async function buscarOCrearConversacionChatwoot(
  cleanPhone: string,
  inboxId = 5
): Promise<string | number | null> {
  const digits = cleanPhone.replace(/\D/g, "");
  if (!digits) return null;
  const cfg = chatwootConfig();
  const e164 = `+${digits}`;

  try {
    // 1. Buscar contacto existente
    let contactId: number | string | null = null;
    const search = await cwFetch(cfg, `/contacts/search?q=${encodeURIComponent(digits)}`);
    if (search.ok) {
      const payload = search.json?.payload || search.json?.data || [];
      if (Array.isArray(payload) && payload.length > 0) {
        contactId = payload[0]?.id || null;
      }
    }

    // 2. Si no existe el contacto en Chatwoot, crearlo
    if (!contactId) {
      const creacion = await cwFetch(cfg, "/contacts", {
        method: "POST",
        body: JSON.stringify({
          name: e164,
          phone_number: e164,
        }),
      });
      if (creacion.ok) {
        contactId = creacion.json?.payload?.contact?.id || creacion.json?.id || null;
      }
    }

    if (!contactId) return null;

    // 3. Buscar si el contacto ya tiene una conversación en Chatwoot
    const convs = await cwFetch(cfg, `/contacts/${contactId}/conversations`);
    if (convs.ok) {
      const lista = convs.json?.payload || [];
      if (Array.isArray(lista) && lista.length > 0) {
        const abierta = lista.find((c: any) => c.status === "open") || lista[0];
        if (abierta?.id) return abierta.id;
      }
    }

    // 4. Si no tiene conversación en Chatwoot, crearla en el inbox especificado (inbox 5 = API)
    const nuevaConv = await cwFetch(cfg, "/conversations", {
      method: "POST",
      body: JSON.stringify({
        source_id: digits,
        inbox_id: inboxId,
        contact_id: contactId,
        status: "open",
      }),
    });
    if (nuevaConv.ok) {
      return nuevaConv.json?.id || null;
    }
  } catch (err) {
    console.error("[chatwoot] Error buscando o creando conversación:", err);
  }
  return null;
}

