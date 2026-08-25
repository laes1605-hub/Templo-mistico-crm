// =====================================================
// PULIR Y AUDITAR RESPUESTA
// Red de seguridad determinista: Luna no puede pedir lo que ya tiene.
//  1) Extrae el texto del modelo y los marcadores ocultos.
//  2) Audita frase por frase: si pide algo ya guardado, algo prohibido en
//     la etapa, o la palma en trabajo de pareja, se descarta ese mensaje
//     y se reemplaza por uno construido desde el archivo.
//  3) Decide las banderas de transicion (motivoOk / consultaLista).
// =====================================================
const fusion = $("Fusionar Memoria").first().json;
const checklist = fusion.checklist || {};
const etapa = fusion.etapa || "lead_nuevo";
const faltantes = fusion.faltantes || [];
const tipo = checklist.tipo_trabajo || "";

// -----------------------------------------------------
// 1) TEXTO DEL MODELO
// -----------------------------------------------------
const raw = $input.first().json || {};
let texto = "";
try {
  if (raw.choices && raw.choices[0] && raw.choices[0].message) texto = raw.choices[0].message.content || "";
  else if (raw.candidates && raw.candidates[0]) texto = (raw.candidates[0].content?.parts || []).map(p => p?.text || "").join("");
  else if (typeof raw.textoRespuesta === "string") texto = raw.textoRespuesta;
} catch (e) { texto = ""; }

texto = String(texto || "").trim();

// -----------------------------------------------------
// 2) MARCADORES
// -----------------------------------------------------
const marcadorMotivo = /\[?\s*MOTIVO_OK\s*\]?/i.test(texto);
const marcadorLista = /\[?\s*CONSULTA_LISTA\s*\]?/i.test(texto);

texto = texto
  .replace(/\[?\s*MOTIVO_OK\s*\]?/gi, "")
  .replace(/\[?\s*CONSULTA_LISTA\s*\]?/gi, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

// Limpieza de formato no apto para WhatsApp/voz
texto = texto
  .replace(/[*_`~]/g, "")
  .replace(/^#+\s*/gm, "")
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
  .replace(/\s+/g, " ")
  .trim();

// -----------------------------------------------------
// 3) AUDITORIA DE REPETICION
// Detecta cualquier frase que pida algo que Luna ya tiene guardado o algo
// prohibido en la etapa. Si encuentra una, el mensaje se reconstruye.
// -----------------------------------------------------
const ES_PEDIDO = /necesito|env[ií]a(me|nos)?|m[aá]nda(me|nos)?|p[aá]sa(me|nos)?|comparte|reg[aá]la(me|nos)?|escribe|cu[aá]l es|c[oó]mo te llamas|c[oó]mo se llama|por favor|me puedes|podr[ií]as|falta(n)?|adjunta|sube|manda|\?/i;

const PIDE_MOTIVO = [
  /por qu[eé]\s+(?:vienes|me buscas|me escribes|quieres|deseas|necesitas|llegaste)/i,
  /cu[aá]l es (?:el motivo|tu caso|tu situaci[oó]n|tu problema|la raz[oó]n)/i,
  /en qu[eé]\s+(?:te\s+)?puedo ayudar/i,
  /qu[eé]\s+te\s+(?:trae|pasa|preocupa|gustar[ií]a)/i,
  /cu[eé]ntame\s+(?:tu caso|qu[eé]|tu situaci[oó]n|por qu[eé])/i,
  /qu[eé]\s+(?:tipo de\s+)?trabajo\s+(?:quieres|necesitas|buscas)/i,
  /para\s+qu[eé]\s+(?:es|quieres)\s+la\s+consulta/i
];
const PIDE_NOMBRE_TUYO = /\btu nombre\b|c[oó]mo te llamas|cu[aá]l es tu nombre|tus nombres y apellidos|con qui[eé]n tengo el gusto/i;
const PIDE_NOMBRE_OTRO = /c[oó]mo se llama|nombre de (?:la|esa|tu)?\s*(?:persona|pareja|chic[oa]|se[ñn]or[ao])|nombre completo de|el nombre de (?:[eé]l|ella|tu (?:novi[oa]|espos[oa]|pareja|ex))/i;
const PIDE_NOMBRE = /\bnombre|apellidos|c[oó]mo (?:te llamas|se llama)/i;
const PIDE_FOTO = /\bfoto|fotograf|selfie|\bcara\b|\brostro\b/i;
const PIDE_PALMA = /palma|mano derecha|foto de tu mano|lectura de mano/i;

const fotosRequeridas = tipo === "pareja"
  ? ["foto_cliente", "foto_otra_persona"]
  : (tipo === "personal" ? ["foto_cliente", "foto_mano"] : []);
const fotosCompletas = fotosRequeridas.length > 0 && fotosRequeridas.every(k => checklist[k] === true);

const frases = (texto.match(/[^.!?]+[.!?]*/g) || [texto]).map(s => s.trim()).filter(Boolean);
const violaciones = [];

for (const frase of frases) {
  const pedido = ES_PEDIDO.test(frase);
  const pideMotivo = PIDE_MOTIVO.some(re => re.test(frase));
  const pideNombre = PIDE_NOMBRE.test(frase);
  const pideFoto = PIDE_FOTO.test(frase);
  const pidePalma = PIDE_PALMA.test(frase);

  // --- Motivo: se pregunta una sola vez, y nunca despues de Sin respuesta ---
  if (pideMotivo) {
    if (etapa === "datos" || etapa === "por_consulta") violaciones.push("pregunto_motivo_en_" + etapa);
    else if (etapa === "sin_respuesta" && checklist.motivo_conocido === true) violaciones.push("repitio_motivo");
  }

  // --- Reglas duras por etapa ---
  if (etapa === "lead_nuevo" && pedido && (pideNombre || pideFoto)) violaciones.push("pidio_datos_en_lead_nuevo");
  if (etapa === "por_consulta" && pedido && (pideNombre || pideFoto)) violaciones.push("pidio_datos_en_por_consulta");

  // --- Reglas duras por tipo de trabajo ---
  if (tipo === "pareja" && pidePalma) violaciones.push("pidio_palma_en_pareja");
  if (tipo === "personal" && pedido && PIDE_NOMBRE_OTRO.test(frase)) violaciones.push("pidio_datos_de_otra_persona_en_personal");

  if (!pedido) continue;

  // --- Nombres ya guardados ---
  if (pideNombre) {
    if (checklist.nombre_cliente && checklist.nombre_otra_persona) {
      violaciones.push("pidio_nombre_ya_guardado");
    } else if (checklist.nombre_cliente && tipo === "personal") {
      violaciones.push("pidio_nombre_cliente_ya_guardado");
    } else if (checklist.nombre_cliente && tipo === "pareja" && !checklist.nombre_otra_persona && PIDE_NOMBRE_TUYO.test(frase)) {
      violaciones.push("pidio_nombre_cliente_ya_guardado");
    } else if (checklist.nombre_otra_persona && PIDE_NOMBRE_OTRO.test(frase)) {
      violaciones.push("pidio_nombre_pareja_ya_guardado");
    }
  }

  // --- Fotos ya guardadas ---
  if (pideFoto && fotosCompletas) violaciones.push("pidio_foto_ya_guardada");
  if (pidePalma && checklist.foto_mano) violaciones.push("pidio_palma_ya_guardada");
}

// -----------------------------------------------------
// 4) MENSAJE DETERMINISTA DE RESPALDO
// -----------------------------------------------------
function primerNombre(v) {
  return String(v || "").trim().split(/\s+/)[0] || "";
}

function pedirDatosTexto() {
  const pendientes = faltantes.slice(0, 2).map(f => f.etiqueta);
  if (!pendientes.length) return "";
  const union = pendientes.length === 1 ? pendientes[0] : pendientes.slice(0, -1).join(", ") + " y " + pendientes[pendientes.length - 1];
  return "Para dejar lista tu consulta con el Maestro necesito " + union + ".";
}

function mensajeDeterminista(apertura) {
  const nombre = primerNombre(checklist.nombre_cliente);
  const llama = nombre ? ", " + nombre : "";
  const abre = apertura ? apertura + " " : "";

  if (etapa === "lead_nuevo") {
    return "Hola, bienvenido al Templo Mistico. Soy Luna, asistente del Maestro Raul. Cuentame, en que te puedo ayudar hoy?";
  }
  if (etapa === "sin_respuesta") {
    if (tipo) {
      const primero = pedirDatosTexto();
      return (abre + "Yo me encargo de preparar tu consulta con el Maestro. " + primero).trim();
    }
    return (abre + "Cuentame con tus palabras que esta pasando y que te gustaria lograr, asi el Maestro prepara bien tu consulta.").trim();
  }
  if (etapa === "datos") {
    if (!faltantes.length) {
      return ("Perfecto" + llama + ", ya tengo toda tu informacion. Se la estoy enviando al Maestro Raul y el te llama pronto. La consulta es gratuita y sin compromiso.").trim();
    }
    return (abre + pedirDatosTexto()).trim();
  }
  if (etapa === "por_consulta") {
    return ("Tranquilo" + llama + ", ya le entregue toda tu informacion al Maestro Raul. El la revisa personalmente y te llama pronto. La consulta es gratuita y sin compromiso, solo pendiente del telefono.").trim();
  }
  return "Gracias por escribir al Templo Mistico. El Maestro Raul te atiende personalmente muy pronto.";
}

// Apertura: primera frase del modelo si no es la que incumple
let apertura = "";
if (frases.length > 1 && !/[?]$/.test(frases[0]) && frases[0].length <= 190) {
  const frase0 = frases[0];
  const limpia = !PIDE_NOMBRE.test(frase0) && !PIDE_FOTO.test(frase0) && !PIDE_PALMA.test(frase0) &&
    !PIDE_MOTIVO.some(re => re.test(frase0));
  if (limpia) apertura = frase0.replace(/[.!?]+$/, "").trim();
}

let textoFinal = texto;
let corregido = false;
if (violaciones.length > 0 || !textoFinal) {
  textoFinal = mensajeDeterminista(apertura);
  corregido = true;
}

// Si el modelo olvido el saludo/presentacion en Lead Nuevo, se garantiza
if (etapa === "lead_nuevo" && !/soy luna|mi nombre es luna|asistente del maestro/i.test(textoFinal)) {
  textoFinal = "Hola, bienvenido al Templo Mistico. Soy Luna, asistente del Maestro Raul. " + textoFinal;
  corregido = true;
}

// Tope de longitud sin cortar frases a la mitad
if (textoFinal.length > 620) {
  const corte = textoFinal.substring(0, 620);
  const ultimoCierre = Math.max(corte.lastIndexOf("."), corte.lastIndexOf("!"), corte.lastIndexOf("?"));
  textoFinal = (ultimoCierre > 220 ? corte.substring(0, ultimoCierre + 1) : corte).trim();
}

if (!textoFinal) textoFinal = mensajeDeterminista("");

// -----------------------------------------------------
// 5) BANDERAS DE TRANSICION (deterministas)
// -----------------------------------------------------
const datosCompletos = Boolean(tipo) && faltantes.length === 0;
const consultaLista = datosCompletos && (etapa === "datos" || etapa === "por_consulta");
const motivoOk = etapa === "sin_respuesta" && Boolean(tipo) && (marcadorMotivo || checklist.motivo_conocido === true);

// Los marcadores [MOTIVO_OK] / [CONSULTA_LISTA] NUNCA salen al cliente:
// la transicion de etapa se dispara con las banderas motivoOk / consultaLista.
textoFinal = textoFinal
  .replace(/\[?\s*CONSULTA_LISTA\s*\]?/gi, "")
  .replace(/\[?\s*MOTIVO_OK\s*\]?/gi, "")
  .replace(/\s{2,}/g, " ")
  .trim();

return [{
  json: {
    // Compatibilidad con los nodos existentes
    choices: [{ message: { content: textoFinal } }],
    textoRespuesta: textoFinal,

    // Banderas
    motivoOk: motivoOk,
    consultaLista: consultaLista,
    datosCompletos: datosCompletos,
    corregido: corregido,
    violaciones: violaciones,

    // Contexto
    conversationId: fusion.conversationId,
    clienteId: fusion.clienteId,
    chatwootUrl: fusion.chatwootUrl,
    contactName: fusion.contactName || "Cliente",
    contactPhone: fusion.contactPhone || "",
    telefono: fusion.telefono || "",
    tipoTrabajo: tipo,
    nombreCliente: checklist.nombre_cliente || fusion.contactName || "Cliente",
    nombreOtraPersona: checklist.nombre_otra_persona || "",
    etapa: etapa,
    etapaNombre: fusion.etapaNombre || etapa,
    checklist: checklist,
    faltantes: faltantes,
    novedades: fusion.novedades || [],
    _debug: {
      textoOriginal: texto,
      corregido: corregido,
      violaciones: violaciones,
      marcadorMotivo: marcadorMotivo,
      marcadorLista: marcadorLista,
      aperturaUsada: apertura
    }
  }
}];
