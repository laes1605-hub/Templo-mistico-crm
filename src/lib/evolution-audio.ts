/**
 * Envío de notas de voz por Evolution API (WhatsApp Personal / Baileys).
 *
 * Evolution v2 valida así el endpoint POST /message/sendWhatsAppAudio/:instance:
 *
 *   if (file?.buffer || isURL(data.audio) || isBase64(data.audio)) { ... }
 *   else throw BadRequestException(
 *     "Owned media must be a url, base64, or valid file with buffer"
 *   );
 *
 * `isBase64()` de class-validator es estricto: rechaza data URIs
 * (`data:audio/ogg;base64,...`) y, en varias versiones, también el base64
 * largo de una nota de voz (el regex explota / devuelve false). Por eso un
 * JSON `{ audio: "<base64>" }` termina en 400 aunque el contenido sea válido.
 *
 * El camino fiable es multipart/form-data con el campo `file`: multer llena
 * `file.buffer` y el validador ni mira el base64. El JSON se deja como
 * fallback para instancias viejas sin multer en esta ruta.
 */

export type EvolutionAudioResult =
  | { ok: true; via: "evolution"; ptt: boolean; detail?: string }
  | { ok: false; status: number; detail: string };

const OWNED_MEDIA_ERROR = /owned media must be a url/i;

const fetchEvolution = async (
  url: string,
  apiKey: string,
  init: { body: BodyInit; json?: boolean },
): Promise<{ ok: boolean; status: number; text: string }> => {
  const headers: Record<string, string> = { apikey: apiKey };
  if (init.json) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { method: "POST", headers, body: init.body });
  const text = await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, text };
};

const audioBlob = (bytes: Buffer, mime: string) =>
  new Blob([new Uint8Array(bytes)], { type: mime || "application/octet-stream" });

/** Multipart: `file` es lo que multer de Evolution espera (`upload.single("file")`). */
const buildAudioForm = (number: string, bytes: Buffer, mime: string, fileName: string, rawBase64: string) => {
  const form = new FormData();
  form.set("number", number);
  // encoding=true pide a Evolution que deje el audio en PTT (ogg/opus). Como
  // string, porque multipart no tiene booleanos; es truthy del lado de ellos.
  form.set("encoding", "true");
  // Por si multer no rellena file.buffer (proxy, versión vieja): el campo
  // `audio` del DTO sigue disponible. Base64 puro, nunca data URI.
  form.set("audio", rawBase64);
  form.append("file", audioBlob(bytes, mime), fileName);
  return form;
};

export async function sendEvolutionVoiceNote(opts: {
  evoUrl: string;
  evoKey: string;
  instance?: string;
  number: string;
  bytes: Buffer;
  mime: string;
  fileName: string;
}): Promise<EvolutionAudioResult> {
  const instance = opts.instance || "personal";
  const base = opts.evoUrl.replace(/\/$/, "");
  const pttUrl = `${base}/message/sendWhatsAppAudio/${instance}`;
  const mediaUrl = `${base}/message/sendMedia/${instance}`;
  const rawBase64 = opts.bytes.toString("base64").replace(/\s+/g, "");
  const dataUri = `data:${opts.mime || "audio/ogg"};base64,${rawBase64}`;

  if (!rawBase64 || !opts.bytes.length) {
    return { ok: false, status: 400, detail: "El audio está vacío." };
  }

  // 1) Multipart PTT — evita isBase64 por completo.
  const multipart = await fetchEvolution(pttUrl, opts.evoKey, {
    body: buildAudioForm(opts.number, opts.bytes, opts.mime, opts.fileName, rawBase64),
  });
  if (multipart.ok) return { ok: true, via: "evolution", ptt: true, detail: "multipart" };

  console.error("[evolution-audio] multipart sendWhatsAppAudio falló:", multipart.status, multipart.text.slice(0, 400));

  // 2) JSON con base64 puro (lo que Evolution realmente valida con isBase64).
  const jsonRaw = await fetchEvolution(pttUrl, opts.evoKey, {
    json: true,
    body: JSON.stringify({ number: opts.number, audio: rawBase64, encoding: true }),
  });
  if (jsonRaw.ok) return { ok: true, via: "evolution", ptt: true, detail: "json-base64" };

  console.error("[evolution-audio] JSON base64 sendWhatsAppAudio falló:", jsonRaw.status, jsonRaw.text.slice(0, 400));

  // 3) JSON con data URI — es lo que muestra la documentación, y algunas
  //    versiones lo aceptan aunque isBase64 oficialmente no.
  if (!OWNED_MEDIA_ERROR.test(jsonRaw.text)) {
    const jsonUri = await fetchEvolution(pttUrl, opts.evoKey, {
      json: true,
      body: JSON.stringify({ number: opts.number, audio: dataUri, encoding: true }),
    });
    if (jsonUri.ok) return { ok: true, via: "evolution", ptt: true, detail: "json-data-uri" };
    console.error("[evolution-audio] JSON data-URI sendWhatsAppAudio falló:", jsonUri.status, jsonUri.text.slice(0, 400));
  }

  // 4) Último recurso: sendMedia multipart. Llega como archivo de audio, no
  //    como burbuja PTT, pero al menos no se pierde la nota.
  const mediaForm = new FormData();
  mediaForm.set("number", opts.number);
  mediaForm.set("mediatype", "audio");
  mediaForm.set("mimetype", opts.mime || "audio/ogg");
  mediaForm.set("fileName", opts.fileName);
  mediaForm.set("media", rawBase64);
  mediaForm.append("file", audioBlob(opts.bytes, opts.mime), opts.fileName);

  const media = await fetchEvolution(mediaUrl, opts.evoKey, { body: mediaForm });
  if (media.ok) return { ok: true, via: "evolution", ptt: false, detail: "sendMedia" };

  const detail = (multipart.text || jsonRaw.text || media.text).slice(0, 500);
  const status = multipart.status || jsonRaw.status || media.status || 502;
  console.error("[evolution-audio] todos los intentos fallaron:", status, detail);
  return { ok: false, status, detail };
}
