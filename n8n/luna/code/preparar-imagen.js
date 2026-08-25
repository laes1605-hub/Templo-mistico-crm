// =====================================================
// PREPARAR IMAGEN PARA OPENAI VISION (v2 — clasificador estricto)
// Devuelve el body de la peticion y la URL original de la foto
// (la URL se guarda en el checklist para enviarsela al Maestro).
// =====================================================
const input = $input.first();
const item = input.json || {};
const binary = input.binary || {};

let imageUrl = "";

// 1) URL publica directa (Chatwoot data_url / file_url)
let rawUrl = item.url || item.file_url || item.data_url || "";
if (!rawUrl && item.body && item.body.attachments && item.body.attachments[0]) {
  rawUrl = item.body.attachments[0].data_url || item.body.attachments[0].file_url || "";
}
if (!rawUrl && item.attachments && item.attachments[0]) {
  rawUrl = item.attachments[0].data_url || item.attachments[0].file_url || "";
}
if (rawUrl && /^https?:\/\//i.test(rawUrl)) imageUrl = rawUrl;

// 2) Binario de n8n (funciona tambien con filesystem-v2)
if (!imageUrl && binary && Object.keys(binary).length > 0) {
  const key = binary.data ? "data" : Object.keys(binary)[0];
  const mime = binary[key].mimeType || "image/jpeg";
  const buffer = await this.helpers.getBinaryDataBuffer(0, key);
  imageUrl = "data:" + mime + ";base64," + buffer.toString("base64");
}

if (!imageUrl || imageUrl.indexOf("filesystem-v2") !== -1) {
  throw new Error("No se pudo extraer la imagen. Revisa el nodo 'Descargar Imagen'.");
}

const promptText = [
  "Eres un analista de imagenes para un gabinete espiritual. Analiza la foto y responde SOLO con JSON valido, sin markdown, sin texto antes ni despues, con este formato exacto:",
  '{"contenido":"rostro|pareja|palma|otro","personas_visibles":0,"es_palma":false,"manos_visibles":0,"calidad":"buena|regular|mala","descripcion":"maximo 25 palabras"}',
  "",
  "REGLAS DE CLASIFICACION:",
  '- "rostro": hay UNA sola persona visible (selfie, retrato, foto de perfil).',
  '- "pareja": hay DOS o mas personas visibles en la misma foto (pareja, matrimonio, familia). Cuenta muy bien los rostros, incluidos los del fondo o recortados.',
  '- "palma": lo principal es la palma de una mano abierta (lectura de mano). Si se ve una mano cerrada, de espaldas o un brazo, usa "otro".',
  '- "otro": cualquier otra cosa (objetos, velas, amuletos, capturas de pantalla, fotos demasiado borrosas).',
  "- personas_visibles: numero exacto de personas (0 si es una palma o un objeto).",
  "- es_palma: true solo si la palma abierta es el contenido principal de la foto.",
  "- manos_visibles: cantidad de manos que se ven (0 si no hay).",
  '- calidad: "mala" si esta borrosa, oscura o cortada al punto de no poder identificar a la persona o la palma.',
  "- descripcion: en espanol, objetiva, sin inventar nombres."
].join("\n");

const body = {
  model: "gpt-4o-mini",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }
  ],
  temperature: 0,
  max_tokens: 300,
  response_format: { type: "json_object" }
};

return [{
  json: {
    body: body,
    bodyString: JSON.stringify(body),
    fotoUrl: (rawUrl && /^https?:\/\//i.test(rawUrl)) ? rawUrl : "",
    imageUrl: imageUrl.substring(0, 80) + "..."
  }
}];
