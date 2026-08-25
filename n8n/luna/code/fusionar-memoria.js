// =====================================================
// FUSIONAR MEMORIA  (el cerebro persistente de Luna)
// Junta tres fuentes y decide que sabe Luna y que le falta:
//   A) Chatwoot custom_attributes  -> lo que YA esta guardado (manda siempre)
//   B) Extraccion IA del caso      -> motivo, tipo de trabajo y nombres nuevos
//   C) Vision (foto de este turno) -> se asigna sola al hueco correcto
// Regla de oro: lo guardado NUNCA se sobreescribe ni se vuelve a pedir.
// =====================================================
const SUPABASE_URL = "https://qrrkokfmbdtodrqbfehs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmtva2ZtYmR0b2RycWJmZWhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzE5NTU0NSwiZXhwIjoyMTAyNzcxNTQ1fQ.bFwt6pAidvSEEuv3UNuKeZYwkfB-d2OPgMHM8MmwcD8";
const CHATWOOT_URL = "https://crmesteban.duckdns.org";
const CHATWOOT_TOKEN = "KKaF2gF4bJZvnSkqKnR42zD8";
const ACCOUNT_ID = "1";

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json",
  Prefer: "return=minimal"
};

const estado = $("Leer Estado del Lead").first().json;
const attrs = estado.attrs || {};
const conversationId = estado.conversationId;
const etapa = estado.etapa || "lead_nuevo";

const OBJETIVOS_ETAPA = {
  lead_nuevo: "Saludar, presentarte como Luna y abrir el caso con UNA pregunta. Nada de datos ni de agendar.",
  sin_respuesta: "Descubrir POR QUE viene y si el trabajo es PERSONAL o de PAREJA. Nada de nombres, fotos ni palma.",
  datos: "Completar UNICAMENTE los datos marcados como pendientes. Nunca volver a preguntar el motivo.",
  por_consulta: "Retener al cliente hasta que el Maestro llame. No pedir nada de nada."
};
const NOMBRES_ETAPA_FICHA = { lead_nuevo: "Lead Nuevo", sin_respuesta: "Sin respuesta", datos: "Datos", por_consulta: "Por consulta" };

const bool = (v) => v === true || v === "true" || v === 1 || v === "1";
const txt = (v) => (v === null || v === undefined) ? "" : String(v).trim();
const novedades = [];

// -----------------------------------------------------
// A) CHECKLIST GUARDADO (fuente de verdad)
// -----------------------------------------------------
let fotosPendientes = [];
try {
  const rawPend = attrs.fotos_pendientes;
  if (rawPend) fotosPendientes = typeof rawPend === "string" ? JSON.parse(rawPend) : rawPend;
  if (!Array.isArray(fotosPendientes)) fotosPendientes = [];
} catch (e) { fotosPendientes = []; }

const checklist = {
  tipo_trabajo: txt(attrs.tipo_trabajo).toLowerCase(),
  motivo_categoria: txt(attrs.motivo_categoria),
  motivo_resumen: txt(attrs.motivo_resumen),
  motivo_conocido: bool(attrs.motivo_conocido),
  nombre_cliente: txt(attrs.nombre_cliente),
  nombre_otra_persona: txt(attrs.nombre_otra_persona),
  foto_cliente: bool(attrs.foto_cliente),
  foto_otra_persona: bool(attrs.foto_otra_persona),
  foto_mano: bool(attrs.foto_mano),
  foto_cliente_url: txt(attrs.foto_cliente_url),
  foto_otra_persona_url: txt(attrs.foto_otra_persona_url),
  foto_mano_url: txt(attrs.foto_mano_url),
  consulta_lista_enviada: bool(attrs.consulta_lista_enviada)
};
if (["pareja", "personal"].indexOf(checklist.tipo_trabajo) === -1) checklist.tipo_trabajo = "";

// -----------------------------------------------------
// B) EXTRACCION IA (solo llena huecos, jamas pisa)
// -----------------------------------------------------
let ia = null;
const rawIA = $input.first().json || {};
let textoIA = "";
try {
  textoIA = (rawIA.choices && rawIA.choices[0] && rawIA.choices[0].message && rawIA.choices[0].message.content) ||
            (rawIA.body && rawIA.body.choices && rawIA.body.choices[0] && rawIA.body.choices[0].message.content) || "";
} catch (e) { textoIA = ""; }

if (textoIA) {
  try { ia = JSON.parse(textoIA); }
  catch (e) {
    const m = textoIA.match(/\{[\s\S]*\}/);
    if (m) { try { ia = JSON.parse(m[0]); } catch (e2) { ia = null; } }
  }
}

if (ia && typeof ia === "object") {
  const tipoIA = txt(ia.tipo_trabajo).toLowerCase();
  if (!checklist.tipo_trabajo && (tipoIA === "pareja" || tipoIA === "personal")) {
    checklist.tipo_trabajo = tipoIA;
    novedades.push("tipo_trabajo:" + tipoIA);
  }
  const cat = txt(ia.motivo_categoria).toLowerCase();
  if (!checklist.motivo_categoria && cat && cat !== "desconocido") {
    checklist.motivo_categoria = cat;
    novedades.push("motivo_categoria:" + cat);
  }
  const resumen = txt(ia.motivo_resumen);
  if (!checklist.motivo_resumen && resumen && resumen.toLowerCase() !== "null") {
    checklist.motivo_resumen = resumen.substring(0, 200);
    novedades.push("motivo_resumen");
  }
  if (!checklist.motivo_conocido && ia.motivo_conocido === true) {
    checklist.motivo_conocido = true;
    novedades.push("motivo_conocido");
  }
  const nombreCli = txt(ia.nombre_cliente);
  if (!checklist.nombre_cliente && nombreCli && nombreCli.toLowerCase() !== "null" && nombreCli.length >= 2) {
    checklist.nombre_cliente = nombreCli.substring(0, 80);
    novedades.push("nombre_cliente:" + checklist.nombre_cliente);
  }
  // El nombre de otra persona solo existe en trabajos de pareja
  const nombreOtro = txt(ia.nombre_otra_persona);
  if (checklist.tipo_trabajo === "pareja" && !checklist.nombre_otra_persona &&
      nombreOtro && nombreOtro.toLowerCase() !== "null" && nombreOtro.length >= 2 &&
      nombreOtro.toLowerCase() !== checklist.nombre_cliente.toLowerCase()) {
    checklist.nombre_otra_persona = nombreOtro.substring(0, 80);
    novedades.push("nombre_otra_persona:" + checklist.nombre_otra_persona);
  }
}

// -----------------------------------------------------
// B2) CLASIFICADOR DETERMINISTA (respaldo si la IA falla o duda)
// -----------------------------------------------------
const PALABRAS_PAREJA = [
  "pareja", "novio", "novia", "esposo", "esposa", "marido", "mujer", "concubina", "concubino",
  "exnovio", "exnovia", "ex novio", "ex novia", " ex ", "amarre", "amarres", "amarrar", "amarrado",
  "retorno", "retornar", "recuperar", "recuperarlo", "recuperarla", "volver con", "vuelva conmigo",
  "reconquistar", "enamorar", "enamore", "dominio", "dominar", "dominante", "alejamiento", "alejar",
  "endulzamiento", "endulzar", "infiel", "infidelidad", "amante", "me dejo", "me dejo", "se fue",
  "terminamos", "separamos", "separacion", "reconcili", "sexo", "acostar", "intimidad",
  "que me quiera", "que se fije", "conquistar", "controlar", "obedezca", "ligadura", "esa persona"
];
const PALABRAS_PERSONAL = [
  "suerte", "prosperidad", "abundancia", "dinero", "empleo", "trabajo", "negocio", "empresa",
  "limpieza", "limpias", "amuleto", "proteccion", "brujeria", "mal de ojo", "envidia",
  "mala vibra", "energia negativa", "chance", "loteria", "casino", "apuestas", "juego", "juegos",
  "azar", "salud", "caminos", "abrir caminos", "entierro", "salamiento", "prospero", "progresar"
];

function clasificarPorPalabras(texto) {
  const t = " " + String(texto || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") + " ";
  let pareja = 0;
  let personal = 0;
  for (const p of PALABRAS_PAREJA) if (t.indexOf(p) !== -1) pareja++;
  for (const p of PALABRAS_PERSONAL) if (t.indexOf(p) !== -1) personal++;
  if (pareja > personal) return "pareja";
  if (personal > pareja) return "personal";
  return "";
}

// Texto de los ultimos turnos del cliente (para clasificar con respaldo)
let textoParaClasificar = "";
try { textoParaClasificar += " " + ($("Consolidar Lista").first().json.listaConsolidada || ""); } catch (e) {}
try {
  const hist = $("Historial").first().json.payload || [];
  const delCliente = hist
    .filter(m => (m.message_type === 0 || m.message_type === "incoming") && m.private !== true && m.content)
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
    .slice(-10);
  textoParaClasificar += " " + delCliente.map(m => m.content).join(" ");
} catch (e) {}
const tipoPorPalabras = clasificarPorPalabras(textoParaClasificar);

// -----------------------------------------------------
// C) FOTO DE ESTE TURNO (asignacion determinista)
// -----------------------------------------------------
let fotoEvento = null;
try { fotoEvento = $("Inyectar Analisis").first().json.fotoEvento || null; } catch (e) { fotoEvento = null; }

if (fotoEvento && ["rostro", "pareja", "palma"].indexOf(fotoEvento.tipo) !== -1) {
  fotosPendientes.push({ tipo: fotoEvento.tipo, url: fotoEvento.url || "", cuando: fotoEvento.cuando || new Date().toISOString() });
  if (fotosPendientes.length > 6) fotosPendientes = fotosPendientes.slice(-6);
}

function asignarFoto(f) {
  const t = checklist.tipo_trabajo;
  if (t === "personal") {
    if (f.tipo === "palma") {
      if (checklist.foto_mano) return false;
      checklist.foto_mano = true;
      if (f.url) checklist.foto_mano_url = f.url;
      novedades.push("foto_mano");
      return true;
    }
    if (f.tipo === "rostro" || f.tipo === "pareja") {
      if (checklist.foto_cliente) return false;
      checklist.foto_cliente = true;
      if (f.url) checklist.foto_cliente_url = f.url;
      novedades.push("foto_cliente");
      return true;
    }
    return false;
  }
  if (t === "pareja") {
    if (f.tipo === "pareja") {
      let ok = false;
      if (!checklist.foto_cliente) { checklist.foto_cliente = true; if (f.url) checklist.foto_cliente_url = f.url; ok = true; }
      if (!checklist.foto_otra_persona) { checklist.foto_otra_persona = true; if (f.url) checklist.foto_otra_persona_url = f.url; ok = true; }
      if (ok) novedades.push("foto_pareja_completa");
      return ok;
    }
    if (f.tipo === "rostro") {
      if (!checklist.foto_cliente) {
        checklist.foto_cliente = true;
        if (f.url) checklist.foto_cliente_url = f.url;
        novedades.push("foto_cliente");
        return true;
      }
      if (!checklist.foto_otra_persona) {
        checklist.foto_otra_persona = true;
        if (f.url) checklist.foto_otra_persona_url = f.url;
        novedades.push("foto_otra_persona");
        return true;
      }
      return false;
    }
    return false; // la palma no aplica en trabajos de pareja
  }
  return false; // sin tipo de trabajo la foto queda en la cola
}

if (checklist.tipo_trabajo) {
  const sinAsignar = [];
  for (const f of fotosPendientes) {
    if (!asignarFoto(f)) sinAsignar.push(f);
  }
  fotosPendientes = sinAsignar;
}

// -----------------------------------------------------
// B3) EL TIPO DE TRABAJO NO QUEDA MAL PEGADO
// Si se clasifico mal y todavia no se recogio ningun dato, se corrige.
// Hace falta que la IA y las palabras coincidan para no cambiar a lo loco.
// -----------------------------------------------------
const sinDatosAun = !checklist.nombre_cliente && !checklist.nombre_otra_persona &&
  !checklist.foto_cliente && !checklist.foto_otra_persona && !checklist.foto_mano;
const etapaTemprana = ["lead_nuevo", "sin_respuesta"].indexOf(etapa) !== -1;
const tipoPorIa = (ia && typeof ia === "object") ? txt(ia.tipo_trabajo).toLowerCase() : "";

if (checklist.tipo_trabajo && sinDatosAun && etapaTemprana && tipoPorPalabras &&
    tipoPorIa === tipoPorPalabras && tipoPorPalabras !== checklist.tipo_trabajo) {
  const anterior = checklist.tipo_trabajo;
  checklist.tipo_trabajo = tipoPorPalabras;
  if (tipoPorPalabras === "personal") checklist.nombre_otra_persona = "";
  novedades.push("tipo_trabajo_corregido:" + anterior + "→" + tipoPorPalabras);
}

// Si la IA no dijo nada util, el respaldo por palabras decide
if (!checklist.tipo_trabajo && tipoPorPalabras) {
  checklist.tipo_trabajo = tipoPorPalabras;
  novedades.push("tipo_trabajo_por_palabras:" + tipoPorPalabras);
}

// -----------------------------------------------------
// QUE FALTA (segun el tipo de trabajo)
// -----------------------------------------------------
const faltantes = [];
if (!checklist.tipo_trabajo) {
  faltantes.push({ clave: "tipo_trabajo", etiqueta: "saber si el trabajo es personal o de pareja" });
} else if (checklist.tipo_trabajo === "pareja") {
  if (!checklist.nombre_cliente) faltantes.push({ clave: "nombre_cliente", etiqueta: "tu nombre completo" });
  if (!checklist.nombre_otra_persona) faltantes.push({ clave: "nombre_otra_persona", etiqueta: "el nombre completo de la persona a consultar" });
  if (!checklist.foto_cliente) faltantes.push({ clave: "foto_cliente", etiqueta: "una foto tuya (rostro visible)" });
  if (!checklist.foto_otra_persona) faltantes.push({ clave: "foto_otra_persona", etiqueta: "una foto de esa persona (o una foto donde salgan los dos)" });
} else {
  if (!checklist.nombre_cliente) faltantes.push({ clave: "nombre_cliente", etiqueta: "tu nombre completo" });
  if (!checklist.foto_cliente) faltantes.push({ clave: "foto_cliente", etiqueta: "una foto tuya (rostro visible)" });
  if (!checklist.foto_mano) faltantes.push({ clave: "foto_mano", etiqueta: "una foto de la palma de tu mano derecha" });
}

const consultaCompleta = Boolean(checklist.tipo_trabajo) && faltantes.length === 0;

// -----------------------------------------------------
// GUARDAR EN CHATWOOT (custom_attributes)
// -----------------------------------------------------
const attrsGuardar = {
  tipo_trabajo: checklist.tipo_trabajo,
  motivo_categoria: checklist.motivo_categoria,
  motivo_resumen: checklist.motivo_resumen,
  motivo_conocido: checklist.motivo_conocido,
  nombre_cliente: checklist.nombre_cliente,
  nombre_otra_persona: checklist.nombre_otra_persona,
  foto_cliente: checklist.foto_cliente,
  foto_otra_persona: checklist.foto_otra_persona,
  foto_mano: checklist.foto_mano,
  foto_cliente_url: checklist.foto_cliente_url,
  foto_otra_persona_url: checklist.foto_otra_persona_url,
  foto_mano_url: checklist.foto_mano_url,
  fotos_pendientes: JSON.stringify(fotosPendientes),
  luna_etapa: etapa
};

let errorAttrs = null;
try {
  await this.helpers.httpRequest({
    method: "POST",
    url: CHATWOOT_URL + "/api/v1/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId + "/custom_attributes",
    headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
    body: { custom_attributes: attrsGuardar },
    json: true
  });
} catch (e) { errorAttrs = e.message || "error attrs"; }

// -----------------------------------------------------
// GUARDAR EN SUPABASE (clientes) con respaldo por columnas
// -----------------------------------------------------
let errorSupabase = null;
if (estado.clienteId) {
  const completo = {
    tipo_trabajo: checklist.tipo_trabajo || null,
    nombre_otra_persona: checklist.nombre_otra_persona || null,
    foto_otra_persona: checklist.foto_otra_persona,
    foto_mano: checklist.foto_mano,
    motivo_consulta: checklist.motivo_resumen || null,
    motivo_categoria: checklist.motivo_categoria || null,
    luna_etapa: etapa,
    actualizado_en: new Date().toISOString()
  };
  try {
    await this.helpers.httpRequest({
      method: "PATCH",
      url: SUPABASE_URL + "/rest/v1/clientes?id=eq." + estado.clienteId,
      headers: sbHeaders,
      body: completo,
      json: true
    });
  } catch (e) {
    // Si faltan columnas nuevas, se guarda solo lo que la tabla ya conoce.
    try {
      await this.helpers.httpRequest({
        method: "PATCH",
        url: SUPABASE_URL + "/rest/v1/clientes?id=eq." + estado.clienteId,
        headers: sbHeaders,
        body: {
          tipo_trabajo: checklist.tipo_trabajo || null,
          nombre_otra_persona: checklist.nombre_otra_persona || null,
          foto_otra_persona: checklist.foto_otra_persona,
          foto_mano: checklist.foto_mano
        },
        json: true
      });
    } catch (e2) { errorSupabase = e2.message || "error supabase"; }
  }
}

// -----------------------------------------------------
// NOTA PRIVADA PARA EL MAESTRO (solo si hubo novedades)
// -----------------------------------------------------
let errorNota = null;
if (novedades.length > 0) {
  const partes = [];
  partes.push("Etapa: " + (NOMBRES_ETAPA_FICHA[etapa] || etapa));
  partes.push("Objetivo de esta etapa: " + (OBJETIVOS_ETAPA[etapa] || "Atender el caso."));
  if (checklist.tipo_trabajo) partes.push("Tipo: " + checklist.tipo_trabajo.toUpperCase());
  else partes.push("Tipo: POR DEFINIR (falta saber si es personal o de pareja)");
  if (checklist.motivo_categoria) partes.push("Motivo: " + checklist.motivo_categoria);
  if (checklist.motivo_resumen) partes.push("Caso: " + checklist.motivo_resumen);
  if (checklist.nombre_cliente) partes.push("Cliente: " + checklist.nombre_cliente);
  if (checklist.nombre_otra_persona) partes.push("Persona a consultar: " + checklist.nombre_otra_persona);
  const fotosTxt = [];
  if (checklist.foto_cliente) fotosTxt.push("foto del cliente");
  if (checklist.foto_otra_persona) fotosTxt.push("foto de la persona a consultar");
  if (checklist.foto_mano) fotosTxt.push("foto de la palma");
  if (fotosTxt.length) partes.push("Fotos: " + fotosTxt.join(", "));
  if (faltantes.length) partes.push("Falta: " + faltantes.map(f => f.etiqueta).join(", "));
  try {
    await this.helpers.httpRequest({
      method: "POST",
      url: CHATWOOT_URL + "/api/v1/accounts/" + ACCOUNT_ID + "/conversations/" + conversationId + "/messages",
      headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
      body: {
        content: "🔎 *Ficha de Luna* (etapa: " + (estado.etapaNombre || etapa) + ")\n" + partes.join("\n"),
        message_type: "outgoing",
        private: true
      },
      json: true
    });
  } catch (e) { errorNota = e.message || "error nota"; }
}

// -----------------------------------------------------
// MEMORIA QUE SE LE INYECTA A LUNA EN CADA TURNO
// -----------------------------------------------------
const recibido = [];
const pendiente = [];
const marca = (ok, etiqueta, valor) => {
  if (ok) recibido.push("✅ " + etiqueta + (valor ? " → " + valor : "") + "  (GUARDADO, PROHIBIDO PEDIRLO OTRA VEZ)");
  else pendiente.push("❌ " + etiqueta + "  (SOLO ESTO SE PUEDE PEDIR)");
};

if (!checklist.tipo_trabajo) {
  pendiente.push("❌ Tipo de trabajo (personal o de pareja): aun no se sabe");
} else {
  recibido.push("✅ Tipo de trabajo: " + checklist.tipo_trabajo.toUpperCase() + "  (ya definido, no lo vuelvas a preguntar)");
}
if (checklist.motivo_categoria || checklist.motivo_resumen) {
  recibido.push("✅ Motivo de la consulta: " +
    (checklist.motivo_categoria ? checklist.motivo_categoria : "") +
    (checklist.motivo_resumen ? " — " + checklist.motivo_resumen : "") +
    "  (YA LO SABES, PROHIBIDO VOLVER A PREGUNTAR POR QUE VIENE)");
} else {
  pendiente.push("❌ Motivo de la consulta: aun no se sabe por que viene");
}

if (checklist.tipo_trabajo === "pareja") {
  marca(checklist.nombre_cliente, "Nombre del cliente", checklist.nombre_cliente);
  marca(checklist.nombre_otra_persona, "Nombre de la persona a consultar", checklist.nombre_otra_persona);
  marca(checklist.foto_cliente, "Foto del cliente");
  marca(checklist.foto_otra_persona, "Foto de la persona a consultar");
} else if (checklist.tipo_trabajo === "personal") {
  marca(checklist.nombre_cliente, "Nombre del cliente", checklist.nombre_cliente);
  marca(checklist.foto_cliente, "Foto del cliente");
  marca(checklist.foto_mano, "Foto de la palma de la mano derecha");
}

let contextoMemoria = "ETAPA ACTUAL DEL LEAD: " + (estado.etapaNombre || etapa).toUpperCase() + "\n";
contextoMemoria += "🎯 OBJETIVO UNICO DE ESTA ETAPA (no hagas nada mas): " + (OBJETIVOS_ETAPA[etapa] || "Atender el caso.") + "\n";
contextoMemoria += "DATOS YA GUARDADOS EN TU ARCHIVO:\n" + (recibido.length ? recibido.join("\n") : "(ninguno todavia)") + "\n";
contextoMemoria += "DATOS PENDIENTES:\n" + (pendiente.length ? pendiente.join("\n") : "(ninguno, ya tienes todo)") + "\n";
if (checklist.tipo_trabajo === "pareja") contextoMemoria += "⛔ En trabajo de PAREJA esta prohibido pedir la palma de la mano.\n";
if (checklist.tipo_trabajo === "personal") contextoMemoria += "⛔ En trabajo PERSONAL esta prohibido pedir nombres o fotos de otra persona.\n";
if (fotosPendientes.length) contextoMemoria += "ℹ️ Hay " + fotosPendientes.length + " foto(s) recibidas antes de definir el tipo de trabajo; se asignaran solas cuando sepas el tipo.\n";

return [{
  json: {
    body: estado.body,
    conversationId: conversationId,
    clienteId: estado.clienteId,
    grupo: estado.grupo,
    etapa: etapa,
    etapaClave: estado.etapaClave,
    etapaNombre: estado.etapaNombre,
    etapasPipeline: estado.etapasPipeline || [],
    lunaActua: estado.lunaActua === true,
    labels: estado.labels || [],
    chatwootUrl: estado.chatwootUrl,
    contactName: estado.nombreContacto || "Cliente",
    contactPhone: estado.telefono || "",
    telefono: estado.telefono || "",
    tipoTrabajo: checklist.tipo_trabajo,
    nombreCliente: checklist.nombre_cliente || estado.nombreContacto || "Cliente",
    nombreOtraPersona: checklist.nombre_otra_persona,
    checklist: checklist,
    fotosPendientes: fotosPendientes,
    faltantes: faltantes,
    faltantesTexto: faltantes.map(f => f.etiqueta).join(", "),
    consultaCompleta: consultaCompleta,
    contextoMemoria: contextoMemoria,
    novedades: novedades,
    fotoEvento: fotoEvento,
    listaConsolidada: (function () { try { return $("Consolidar Lista").first().json.listaConsolidada || ""; } catch (e) { return ""; } })(),
    _debug: {
      iaExtraida: ia ? "si" : "no",
      textoIA: textoIA ? textoIA.substring(0, 300) : "",
      novedades: novedades,
      errorAttrs: errorAttrs,
      errorSupabase: errorSupabase,
      errorNota: errorNota
    }
  }
}];
