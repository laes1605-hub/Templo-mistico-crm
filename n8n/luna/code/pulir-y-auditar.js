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
    retorno: "recuperacion o retorno",
    amor: "amor",
    suerte: "suerte",
    prosperidad: "prosperidad",
    limpieza: "limpieza",
    proteccion: "proteccion",
    dominio: "dominio",
    alejamiento: "alejamiento",
    endulzamiento: "endulzamiento",
    sexual: "amor y atraccion",
    conquista: "amor y conquista",
    juegos: "suerte y juegos de azar",
    mal_de_ojo: "limpieza y proteccion"
  };
  return nombres[String(checklist.motivo_categoria || "").toLowerCase()] || "tu consulta";
}

function requisitosPareja() {
  const lista = [];
  if (!checklist.nombre_cliente && !checklist.nombre_otra_persona) {
    lista.push("el nombre de cada uno");
  } else {
    if (!checklist.nombre_cliente) lista.push("el nombre del cliente");
    if (!checklist.nombre_otra_persona) lista.push("el nombre de la persona a consultar");
  }
  if (!checklist.foto_cliente && !checklist.foto_otra_persona) {
    lista.push("una foto de cada uno o una foto juntos");
  } else if (!checklist.foto_cliente) {
    lista.push("una foto del cliente o una foto juntos");
  } else if (!checklist.foto_otra_persona) {
    lista.push("una foto de la persona a consultar o una foto juntos");
  }
  return lista;
}

function requisitosPersonal() {
  const lista = [];
  if (!checklist.foto_cliente) lista.push("una foto suya");
  if (!checklist.foto_mano) lista.push("una foto de la palma de su mano derecha");
  if (!checklist.nombre_cliente) lista.push("su nombre completo");
  return lista;
}

function listaRequisitos() {
  if (tipo === "pareja") return requisitosPareja();
  if (tipo === "personal") return requisitosPersonal();
  return [];
}

const requisitosPendientes = listaRequisitos();
function mensajeDeterminista() {
  if (etapa === "lead_nuevo") {
    return "Hola, bienvenido al Templo Mistico. Soy Luna, asistente del Maestro Raul. Cuentame, en que te puedo ayudar hoy?";
  }
  if (etapa === "datos") {
    if (!tipo) {
      return "Para orientarte bien, cuentame si buscas ayuda por suerte, amor, recuperar a alguien, prosperidad, limpieza, proteccion u otro motivo.";
    }
    if (!requisitosPendientes.length) {
      return "Perfecto, ya tengo la informacion necesaria para tu consulta. El Maestro Raul revisara tu caso.";
    }
    const lineas = requisitosPendientes.map((requisito, i) => (i + 1) + ". " + requisito);
    return "Entiendo que necesitas ayuda por " + motivoVisible() + ". Para preparar tu consulta necesito:\n" + lineas.join("\n");
  }
  return "Gracias por escribir al Templo Mistico.";
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
