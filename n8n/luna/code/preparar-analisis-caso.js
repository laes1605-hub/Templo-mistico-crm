// =====================================================
// PREPARAR ANALISIS DE CASO (extraccion estructurada con IA)
// Un solo llamado barato a gpt-4o-mini que convierte la conversacion en
// datos duros: tipo de trabajo, motivo y nombres. Esto reemplaza las
// expresiones regulares que antes se equivocaban o perdian los nombres.
// =====================================================
let historial = [];
try { historial = $input.first().json.payload || []; } catch (e) { historial = []; }

const estado = $("Leer Estado del Lead").first().json;
const attrs = estado.attrs || {};

// Transcripcion compacta (solo mensajes publicos, mas recientes al final)
const ordenados = [...historial].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
const lineas = [];
for (const m of ordenados.slice(-30)) {
  if (m.private === true) continue;
  const tipo = (m.message_type === 0 || m.message_type === "incoming") ? "CLIENTE" : "LUNA";
  let texto = String(m.content || "").trim();
  if (!texto) {
    const atts = m.attachments || [];
    if (atts.length) texto = "[" + (atts[0].file_type || "archivo") + "]";
  }
  if (!texto) continue;
  if (texto.length > 500) texto = texto.substring(0, 500) + "...";
  lineas.push(tipo + ": " + texto);
}
const transcript = lineas.join("\n");

// Ultimo turno ya procesado (audio transcrito / analisis de imagen / texto)
let ultimoTurno = "";
let tipoUltimo = "texto";
try {
  const cons = $("Consolidar Lista").first().json;
  ultimoTurno = cons.listaConsolidada || cons.mensajeActual || "";
  tipoUltimo = cons.tipoMensajeActual || "texto";
} catch (e) {}

let fotoTexto = "";
try {
  const fe = $("Inyectar Analisis").first().json.fotoEvento;
  if (fe && fe.tipo) {
    fotoTexto = "FOTO RECIBIDA EN ESTE TURNO: tipo=" + fe.tipo +
      ", personas=" + fe.personas + ", calidad=" + fe.calidad + ", detalle=" + (fe.descripcion || "");
  }
} catch (e) {}

const guardados = {
  tipo_trabajo: attrs.tipo_trabajo || null,
  motivo_categoria: attrs.motivo_categoria || null,
  motivo_resumen: attrs.motivo_resumen || null,
  nombre_cliente: attrs.nombre_cliente || null,
  nombre_otra_persona: attrs.nombre_otra_persona || null
};

const systemPrompt = [
  "Eres el extractor de datos de Luna, asistente del Templo Mistico del Maestro Raul.",
  "Lees la conversacion entre Luna y un cliente y devuelves SOLO un JSON valido (sin markdown, sin comentarios) con este formato exacto:",
  '{"tipo_trabajo":"pareja|personal|desconocido","motivo_categoria":"amarre|retorno|dominio|alejamiento|endulzamiento|sexual|conquista|entierro|desamarre|limpieza|mal_de_ojo|proteccion|prosperidad|empleo|atraccion|juegos|salud|otro|desconocido","motivo_resumen":"frase de maximo 140 caracteres","motivo_conocido":true,"nombre_cliente":null,"nombre_otra_persona":null,"confianza":0.0}',
  "",
  "REGLAS:",
  '1) tipo_trabajo = "pareja" cuando el caso involucra a OTRA persona: amarre, retorno, reconciliacion, dominio, alejamiento de terceros, endulzamiento, infidelidad, sexo o conquista con alguien concreto, o dano dirigido a una persona concreta.',
  '2) tipo_trabajo = "personal" cuando el caso es del propio cliente: dinero, prosperidad, empleo, suerte, juegos de azar, proteccion, limpiezas, mal de ojo, brujeria encima, salud, caminos abiertos.',
  '3) tipo_trabajo = "desconocido" si el cliente aun no conto nada aprovechable.',
  "4) motivo_categoria: elige UNA sola categoria, la mas especifica posible.",
  "5) motivo_resumen: UNA frase en tercera persona con lo esencial (quien, que le pasa, que quiere). Nunca inventes detalles que el cliente no dijo.",
  "6) motivo_conocido: true solo si el cliente ya explico por que vino, aunque sea en una linea.",
  "7) nombre_cliente y nombre_otra_persona: SOLO si el cliente los escribio explicitamente en la conversacion. Copialos tal cual, con apellidos si los dio. Si no aparecen, null. No uses el nombre del perfil de WhatsApp salvo que el cliente se presente con el.",
  "8) PROHIBIDO borrar datos: si un dato ya esta en DATOS YA GUARDADOS, devuelvelo identico aunque no se repita en la conversacion.",
  "9) Si el cliente se corrige (\"no, es Karla, no Carla\"), usa la ultima version que dio."
].join("\n");

const userPrompt = [
  "DATOS YA GUARDADOS (no los pierdas):",
  JSON.stringify(guardados),
  "",
  "ETAPA ACTUAL DEL LEAD: " + (estado.etapaNombre || estado.etapa),
  "",
  "CONVERSACION:",
  transcript || "(sin historial)",
  "",
  "ULTIMO TURNO DEL CLIENTE (" + tipoUltimo + "):",
  ultimoTurno || "(vacio)",
  fotoTexto ? "\n" + fotoTexto : "",
  "",
  "Devuelve unicamente el JSON."
].join("\n").trim();

const body = {
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ],
  temperature: 0,
  max_tokens: 400,
  response_format: { type: "json_object" }
};

return [{
  json: {
    body: body,
    bodyString: JSON.stringify(body),
    transcriptPreview: transcript.slice(-400)
  }
}];
