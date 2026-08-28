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
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");

// ----------------------------------------------------
// UNION NATURAL DE RENGLONES (prosodia para la voz)
// ----------------------------------------------------
// La respuesta esta formateada para leerse en pantalla; al hablarla hay que
// unirla como se habla, no como se lista:
//   1) Un renglon que termina en dos puntos seguido de varios datos se lee
//      como una sola enumeracion fluida, con punto y coma y una "y" antes del
//      ultimo dato: "enviame estos datos: una foto...; tu nombre...; y la
//      palma de tu mano derecha". Asi la voz no recita renglones sueltos.
//   2) Los demas renglones conservan una pausa propia: punto si ya la traian
//      o punto suave al unirse, para que la voz respire y no suene atropellada.
//   3) El texto despues del ultimo punto se conserva siempre: ese era el dato
//      que antes se perdia.
// ----------------------------------------------------
function sinPuntoFinal(texto) {
  return String(texto || "").replace(/[.;:\s]+$/, "");
}
function enMinusculaInicial(texto) {
  const limpio = String(texto || "");
  return /^[A-ZÁÉÍÓÚÜÑ]/.test(limpio) ? limpio.charAt(0).toLowerCase() + limpio.slice(1) : limpio;
}
function unirConPausa(renglones) {
  let salida = "";
  for (const renglon of renglones) {
    if (!salida) { salida = renglon; continue; }
    salida += /[.!?;:,]$/.test(salida.trimEnd()) ? " " + renglon : ". " + renglon;
  }
  return salida;
}

const parrafos = textoLimpio.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
const partesVoz = [];
for (const parrafo of parrafos) {
  const renglones = parrafo.split(/\n/).map(r => r.trim()).filter(Boolean);
  if (renglones.length >= 3 && /[:：]\s*$/.test(renglones[0])) {
    // Enumeracion hablada: "intro: primera cosa; segunda; y la ultima."
    const intro = sinPuntoFinal(renglones[0]) + ":";
    const datos = renglones.slice(1).map(d => enMinusculaInicial(sinPuntoFinal(d))).filter(Boolean);
    const enumeracion = datos.length === 1
      ? datos[0]
      : datos.slice(0, -1).join("; ") + "; y " + datos[datos.length - 1];
    partesVoz.push(intro + " " + enumeracion + ".");
  } else {
    partesVoz.push(unirConPausa(renglones));
  }
}

textoLimpio = partesVoz
  .filter(Boolean)
  .join(" ")
  .replace(/\.{2,}/g, ".")
  .replace(/,\s*,+/g, ",")
  .replace(/;\s*;+/g, ";")
  .replace(/([:;,])\s*\./g, "$1 ")
  .replace(/\s+([,.!?;:])/g, "$1")
  .replace(/([,.!?;:])(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ¿¡])/g, "$1 ")
  .replace(/\s+/g, " ")
  .trim();

if (!textoLimpio) {
  textoLimpio = "Gracias por comunicarte con el Templo Místico. En un momento te atendemos.";
} else if (!/[.!?]$/.test(textoLimpio)) {
  textoLimpio += ".";
}

// Muestreo de voz: dentro de la banda recomendada por Fish Audio para habla
// expresiva (temperatura 0.7-0.8), lo justo para que Luna suene variada y
// natural sin perder estabilidad ni inventar sonidos al final.
const body = {
  text: textoLimpio,
  reference_id: "be2d2e9342cd4201b690500c4e35d008",
  format: "opus",
  chunk_length: 300,
  normalize: true,
  latency: "normal",
  mp3_bitrate: 128,
  top_p: 0.85,
  temperature: 0.75
};

return [{
  json: {
    body: body,
    textoLimpio: textoLimpio,
    textoOriginal: textoOriginal
  }
}];
