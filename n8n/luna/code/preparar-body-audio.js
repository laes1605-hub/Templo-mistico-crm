// =====================================================
// PREPARAR RESPUESTA DE LUNA PARA AUDIO
//
// Convierte el texto del chat en una locucion natural sin perder el ultimo
// dato solicitado. Tambien transforma listas numeradas ("1.", "2.") en
// conectores hablados para que la voz nunca diga "uno punto, dos punto".
// =====================================================
const textoOriginal = $("Verificar si Enviar Audio").first().json.textoRespuesta || "";

const ordinales = [
  "Primero", "Segundo", "Tercero", "Cuarto", "Quinto",
  "Sexto", "Septimo", "Octavo", "Noveno", "Decimo"
];

let textoLimpio = String(textoOriginal || "")
  .replace(/\r\n?/g, "\n")

  // Una numeracion visual se vuelve una transicion natural para la voz.
  // Se hace antes de unir las lineas para no confundir el punto con el final
  // de una oracion ni cortar el ultimo requisito.
  .replace(/^\s*(\d{1,2})[.)]\s+/gm, (_, numero) => {
    const indice = Number(numero) - 1;
    return (ordinales[indice] || "Luego") + ", ";
  })
  .replace(/^\s*[•●▪◦*-]\s+/gm, "")

  // Quitar marcadores internos y formato, conservando siempre su contenido.
  .replace(/\[?\s*MOTIVO_OK\s*\]?/gi, "")
  .replace(/\[?\s*CONSULTA_LISTA\s*\]?/gi, "")
  .replace(/\b(ja|je|ji|jo|ju|ha|he){2,}\b/gi, "")
  .replace(/[*_`~#]/g, "")
  .replace(/["'“”‘’´]/g, "")
  .replace(/[\[\]{}]/g, "")
  .replace(/\(/g, ", ")
  .replace(/\)/g, ", ")

  // Separadores y simbolos que un sintetizador suele leer de forma extrana.
  .replace(/\\/g, " ")
  .replace(/\//g, " ")
  .replace(/\|/g, " ")
  .replace(/&/g, " y ")
  .replace(/@/g, " arroba ")
  .replace(/%/g, " por ciento ")
  .replace(/\$/g, " pesos ")
  .replace(/\+/g, " mas ")
  .replace(/=/g, " igual ")
  .replace(/[<>^]/g, "")

  // Quitar emojis sin eliminar letras, tildes ni signos de puntuacion.
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")

  // Las lineas de la lista se oyen como oraciones breves. El texto despues
  // del ultimo punto se conserva: ese era el dato que antes se perdia.
  .replace(/:\s*\n+/g, ": ")
  .replace(/\n+/g, ". ")
  .replace(/\.{2,}/g, ".")
  .replace(/,\s*,+/g, ",")
  .replace(/:\s*\./g, ": ")
  .replace(/\s+([,.!?;:])/g, "$1")
  .replace(/([,.!?;:])(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, "$1 ")
  .replace(/\s+/g, " ")
  .trim();

if (!textoLimpio) {
  textoLimpio = "Gracias por comunicarte con el Templo Mistico.";
} else if (!/[.!?]$/.test(textoLimpio)) {
  textoLimpio += ".";
}

const body = {
  text: textoLimpio,
  reference_id: "be2d2e9342cd4201b690500c4e35d008",
  format: "opus",
  chunk_length: 300,
  normalize: true,
  latency: "normal",
  mp3_bitrate: 128,
  top_p: 0.8,
  temperature: 0.7
};

return [{
  json: {
    body: body,
    textoLimpio: textoLimpio,
    textoOriginal: textoOriginal
  }
}];
