// =====================================================
// INYECTAR ANALISIS DE IMAGEN (v2)
// - Interpreta el JSON de OpenAI Vision (con respaldo por palabras clave).
// - Devuelve fotoEvento {tipo: rostro|pareja|palma|otro, ...} para que
//   "Fusionar Memoria" asigne la foto al hueco correcto segun el tipo de trabajo.
// - Reconstruye body.content para que "Consolidar Lista" vea el analisis
//   como el mensaje actual del cliente.
// =====================================================
const input = $input.first();
const raw = input.json || {};

let textoVision = "";
try {
  if (raw.choices && raw.choices[0] && raw.choices[0].message) {
    textoVision = raw.choices[0].message.content || "";
  } else if (raw.body && raw.body.choices && raw.body.choices[0]) {
    textoVision = raw.body.choices[0].message.content || "";
  } else if (typeof raw.textoAnalisis === "string") {
    textoVision = raw.textoAnalisis;
  }
} catch (e) {
  textoVision = "";
}

// --- Parseo tolerante del JSON de Vision ---
let datos = null;
if (textoVision) {
  try {
    datos = JSON.parse(textoVision);
  } catch (e) {
    const m = textoVision.match(/\{[\s\S]*\}/);
    if (m) {
      try { datos = JSON.parse(m[0]); } catch (e2) { datos = null; }
    }
  }
}

let contenido = "otro";
let personas = 0;
let esPalma = false;
let manos = 0;
let calidad = "regular";
let descripcion = "";

if (datos && typeof datos === "object") {
  contenido = String(datos.contenido || "otro").toLowerCase().trim();
  personas = parseInt(datos.personas_visibles, 10);
  if (isNaN(personas)) personas = 0;
  esPalma = datos.es_palma === true || String(datos.es_palma).toLowerCase() === "true";
  manos = parseInt(datos.manos_visibles, 10);
  if (isNaN(manos)) manos = 0;
  calidad = String(datos.calidad || "regular").toLowerCase().trim();
  descripcion = String(datos.descripcion || "").trim();
  if (contenido === "mano" || contenido === "manos") { contenido = "palma"; esPalma = true; }
} else {
  // Respaldo: si Vision no devolvio JSON util, se deduce por palabras clave.
  const t = textoVision.toLowerCase();
  if (t.indexOf("palma") !== -1 || t.indexOf("mano") !== -1) { contenido = "palma"; esPalma = true; }
  else if (t.indexOf("dos personas") !== -1 || t.indexOf("2 personas") !== -1 || t.indexOf("pareja") !== -1) { contenido = "pareja"; personas = 2; }
  else if (t.indexOf("persona") !== -1 || t.indexOf("rostro") !== -1 || t.indexOf("cara") !== -1) { contenido = "rostro"; personas = 1; }
  descripcion = textoVision.substring(0, 140);
}

// Tipo canonico usado por el checklist
let tipo = "otro";
if (esPalma || contenido === "palma") tipo = "palma";
else if (personas >= 2 || contenido === "pareja" || contenido === "dos_personas") tipo = "pareja";
else if (personas === 1 || contenido === "rostro" || contenido === "persona_unica") tipo = "rostro";

// URL de la foto (la guarda "Preparar Imagen")
let fotoUrl = "";
try { fotoUrl = $("Preparar Imagen").first().json.fotoUrl || ""; } catch (e) {}

const fotoEvento = {
  tipo: tipo,
  personas: personas,
  esPalma: esPalma,
  manos: manos,
  calidad: calidad,
  descripcion: descripcion,
  url: fotoUrl,
  cuando: new Date().toISOString()
};

const textoAnalisis =
  "[IMAGEN ANALIZADA] tipo=" + tipo +
  " personas=" + personas +
  " palma=" + (esPalma ? "si" : "no") +
  " calidad=" + calidad +
  " detalle=" + (descripcion || "sin descripcion");

// Reconstruir el body del webhook con el analisis como contenido del mensaje.
let webhookBody = {};
try { webhookBody = $("Webhook").first().json.body || {}; } catch (e) {}

const nuevoBody = JSON.parse(JSON.stringify(webhookBody || {}));
nuevoBody.content = textoAnalisis;
nuevoBody._tipoMensaje = "imagen";
nuevoBody._fotoEvento = fotoEvento;

return [{
  json: {
    body: nuevoBody,
    fotoEvento: fotoEvento,
    textoAnalisis: textoAnalisis,
    clasificacionDetectada: tipo,
    rawVisionText: textoVision
  },
  binary: input.binary || {}
}];
