// =====================================================
// PULIR Y AUDITAR RESPUESTA
// Red determinista de Luna por etapas:
//   • Lead Nuevo: saludo, presentacion y motivo. Luego pasa a Datos.
//   • Datos: clasifica el trabajo, envia una sola lista completa y se pausa.
//
// La lista se construye desde el checklist persistente. Asi Luna no depende
// de que el modelo recuerde los requisitos ni vuelve a pedir datos guardados.
// =====================================================
const fusion = $("Fusionar Memoria").first().json;
const checklist = fusion.checklist || {};
const etapa = fusion.etapa || "lead_nuevo";
const faltantes = fusion.faltantes || [];
const tipo = checklist.tipo_trabajo || "";
const listaYaEnviada = checklist.lista_requisitos_enviada === true;

// Un nombre de pila o el nombre corto del perfil no equivale al nombre
// completo solicitado para el expediente. Debe haber al menos dos palabras
// utiles (por ejemplo, nombre y apellido).
function esNombreCompleto(valor) {
  const partes = String(valor || "")
    .trim()
    .replace(/[.,;:()\[\]{}]/g, " ")
    .split(/\s+/)
    .map(p => p.trim())
    .filter(Boolean);
  return partes.length >= 2 && partes.filter(p => p.length >= 2).length >= 2;
}
const nombreClienteCompleto = esNombreCompleto(checklist.nombre_cliente);
const nombreOtraPersonaCompleto = esNombreCompleto(checklist.nombre_otra_persona);

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
const textoOriginalMarcadores = texto;
const marcadorLista = /\[?\s*CONSULTA_LISTA\s*\]?/i.test(texto);

texto = texto
  .replace(/\[?\s*MOTIVO_OK\s*\]?/gi, "")
  .replace(/\[?\s*CONSULTA_LISTA\s*\]?/gi, "")
  .replace(/[*_`~]/g, "")
  .replace(/^#+\s*/gm, "")
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

// -----------------------------------------------------
// 2) AUDITORIA DE REGLAS
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
const PIDE_TIPO_TRABAJO = /personal o de pareja|es para ti o para|involucra a otra persona|trabajo (?:es )?(?:personal|de pareja)|para ti o para otra/i;

const frases = (texto.match(/[^.!?]+[.!?]*/g) || [texto]).map(s => s.trim()).filter(Boolean);
const violaciones = [];
for (const frase of frases) {
  const pedido = ES_PEDIDO.test(frase);
  const pideMotivo = PIDE_MOTIVO.some(re => re.test(frase));
  const pideNombre = PIDE_NOMBRE.test(frase);
  const pideFoto = PIDE_FOTO.test(frase);
  const pidePalma = PIDE_PALMA.test(frase);

  if (pideMotivo && etapa === "datos") violaciones.push("pregunto_motivo_en_datos");
  if (tipo && PIDE_TIPO_TRABAJO.test(frase)) violaciones.push("repitio_pregunta_de_tipo_de_trabajo");
  if (etapa === "lead_nuevo" && pedido && (pideNombre || pideFoto || pidePalma)) {
    violaciones.push("pidio_datos_en_lead_nuevo");
  }
  if (tipo === "pareja" && pidePalma) violaciones.push("pidio_palma_en_pareja");
  if (tipo === "personal" && pedido && PIDE_NOMBRE_OTRO.test(frase)) {
    violaciones.push("pidio_datos_de_otra_persona_en_personal");
  }

  if (!pedido) continue;
  if (pideNombre) {
    if (nombreClienteCompleto && nombreOtraPersonaCompleto) {
      violaciones.push("pidio_nombre_ya_guardado");
    } else if (nombreClienteCompleto && tipo === "personal") {
      violaciones.push("pidio_nombre_cliente_ya_guardado");
    } else if (nombreClienteCompleto && tipo === "pareja" && !nombreOtraPersonaCompleto && PIDE_NOMBRE_TUYO.test(frase)) {
      violaciones.push("pidio_nombre_cliente_ya_guardado");
    } else if (nombreOtraPersonaCompleto && PIDE_NOMBRE_OTRO.test(frase)) {
      violaciones.push("pidio_nombre_pareja_ya_guardado");
    }
  }
  if (pideFoto && tipo === "pareja" && checklist.foto_cliente && checklist.foto_otra_persona) {
    violaciones.push("pidio_fotos_ya_guardadas");
  }
  if (pideFoto && tipo === "personal" && checklist.foto_cliente && checklist.foto_mano) {
    violaciones.push("pidio_fotos_ya_guardadas");
  }
  if (pidePalma && checklist.foto_mano) violaciones.push("pidio_palma_ya_guardada");
}

// -----------------------------------------------------
// 3) LISTA EXACTA DE REQUISITOS
// -----------------------------------------------------
function motivoVisible() {
  const nombres = {
    retorno: "una recuperación o un retorno",
    amor: "un tema de amor",
    suerte: "tu suerte",
    prosperidad: "prosperidad",
    limpieza: "una limpieza espiritual",
    proteccion: "protección",
    dominio: "un trabajo de dominio",
    alejamiento: "un alejamiento",
    endulzamiento: "un endulzamiento",
    sexual: "amor y atracción",
    conquista: "amor y conquista",
    juegos: "suerte en los juegos de azar",
    mal_de_ojo: "limpieza y protección"
  };
  return nombres[String(checklist.motivo_categoria || "").toLowerCase()] || "";
}

// Cada requisito se expresa completo y en lenguaje natural. La lista no usa
// numeros: asi se entiende igual por texto y por nota de voz, sin que el
// sintetizador diga "uno punto" o "dos punto".
function requisitosPareja() {
  const lista = [];
  if (!nombreClienteCompleto && !nombreOtraPersonaCompleto) {
    lista.push("los nombres completos de las dos personas, con nombre y apellido de cada una");
  } else {
    if (!nombreClienteCompleto) lista.push("tu nombre completo, con nombre y apellido");
    if (!nombreOtraPersonaCompleto) lista.push("el nombre completo de la otra persona, con nombre y apellido");
  }
  if (!checklist.foto_cliente && !checklist.foto_otra_persona) {
    lista.push("una foto clara y de frente de cada persona, o una sola foto clara donde aparezcan las dos");
  } else if (!checklist.foto_cliente) {
    lista.push("una foto tuya, clara y de frente, o una sola foto clara donde aparezcan los dos");
  } else if (!checklist.foto_otra_persona) {
    lista.push("una foto clara y de frente de la otra persona, o una sola foto clara donde aparezcan los dos");
  }
  return lista;
}

function requisitosPersonal() {
  const lista = [];
  // Orden exacto solicitado para trabajos personales: foto, nombre y palma.
  if (!checklist.foto_cliente) lista.push("una foto tuya, clara y de frente, donde se vea bien tu rostro");
  if (!nombreClienteCompleto) lista.push("tu nombre completo, con nombre y apellido");
  if (!checklist.foto_mano) lista.push("una foto clara de la palma de tu mano derecha");
  return lista;
}

function listaRequisitos() {
  if (tipo === "pareja") return requisitosPareja();
  if (tipo === "personal") return requisitosPersonal();
  return [];
}

function iniciarConMayuscula(texto) {
  const limpio = String(texto || "").trim();
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : "";
}

const requisitosPendientes = listaRequisitos();
// Los mensajes de reserva siguen siendo deterministas, pero se redactan como
// hablaria una persona: ritmo variado, conectores naturales y cero formulas
// rigidas. Deben conservar intactas las frases de cada requisito.
function mensajeDeterminista() {
  if (etapa === "lead_nuevo") {
    return "Hola, qué alegría saludarte. Soy Luna, la asistente del Maestro Raúl en el Templo Místico. Este es un espacio de total confianza, así que puedes hablarme con toda tranquilidad. Cuéntame, ¿en qué podemos ayudarte hoy?";
  }
  if (etapa === "datos") {
    if (!tipo) {
      return "Gracias por contarme tu situación, de verdad te escucho con atención. Para orientarte mejor y pedirte solo lo necesario, cuéntame por favor si buscas ayuda con suerte, amor, recuperar a alguien, prosperidad, limpieza, protección, o si es otro motivo distinto.";
    }
    if (!requisitosPendientes.length) {
      return "Perfecto, muchas gracias por tu confianza. Ya tengo todo lo que necesito para tu consulta, así que voy a dejar tu caso listo para que el Maestro Raúl lo revise con mucha atención.";
    }

    const motivo = motivoVisible();
    const apertura = motivo
      ? "Gracias por contarme tu situación con tanta confianza, sé lo importante que esto es para ti. Con mucho gusto vamos a orientarte con " + motivo + "."
      : "Gracias por contarme tu situación con tanta confianza. Con mucho gusto vamos a orientarte.";
    const cantidad = requisitosPendientes.length === 1 ? "este dato" : "estos datos";
    const lineas = requisitosPendientes.map(requisito => iniciarConMayuscula(requisito) + ".");
    const cierre = requisitosPendientes.length === 1
      ? "En cuanto lo tengas, me lo envías por aquí y dejamos todo listo para que el Maestro Raúl revise tu caso con mucha atención. Muchas gracias por tu confianza."
      : "En cuanto los tengas, me los envías por aquí y dejamos todo listo para que el Maestro Raúl revise tu caso con mucha atención. Muchas gracias por tu confianza.";

    return [
      apertura,
      "",
      "Para preparar bien tu consulta, por favor envíame " + cantidad + ":",
      ...lineas,
      "",
      cierre
    ].join("\n");
  }
  return "Gracias por escribir al Templo Místico.";
}

// -----------------------------------------------------
// 4) DECISIONES DETERMINISTAS
// -----------------------------------------------------
// En Datos, la primera vez que se conoce el tipo se envia obligatoriamente la
// lista completa. No se deja que el modelo la fragmente en varios turnos.
const listaRequisitosEnviada = etapa === "datos" && Boolean(tipo) && !listaYaEnviada;
const pausarChat = listaRequisitosEnviada;
let textoFinal = texto;
let corregido = false;

if (listaRequisitosEnviada || (etapa === "datos" && !tipo) || violaciones.length > 0 || !textoFinal) {
  textoFinal = mensajeDeterminista();
  corregido = true;
}

if (etapa === "lead_nuevo" && !/soy luna|mi nombre es luna|asistente del maestro/i.test(textoFinal)) {
  textoFinal = mensajeDeterminista();
  corregido = true;
}

textoFinal = textoFinal
  .replace(/\[?\s*MOTIVO_OK\s*\]?/gi, "")
  .replace(/\[?\s*CONSULTA_LISTA\s*\]?/gi, "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();
if (!textoFinal) textoFinal = mensajeDeterminista();

const datosCompletos = Boolean(tipo) && (fusion.consultaCompleta === true || requisitosPendientes.length === 0);

return [{
  json: {
    choices: [{ message: { content: textoFinal } }],
    textoRespuesta: textoFinal,
    motivoOk: false,
    consultaLista: false,
    datosCompletos: datosCompletos,
    listaRequisitosEnviada: listaRequisitosEnviada,
    pausarChat: pausarChat,
    corregido: corregido,
    violaciones: violaciones,
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
      marcadorLista: marcadorLista,
      listaRequisitosEnviada: listaRequisitosEnviada,
      pausarChat: pausarChat,
      requisitos: requisitosPendientes
    }
  }
}];
