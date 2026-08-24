/**
 * Envío de notas de voz por Evolution API (WhatsApp Personal / Baileys).
 *
 * El endpoint de audio cambió entre versiones/plantillas de Evolution:
 *
 *   - v2 clásico:  { number, audio, encoding }
 *   - builds usadas en n8n/docs nuevos: { number, options: { encoding }, audioMessage: { audio } }
 *   - algunas instalaciones aceptan multipart con el archivo en `file`, otras
 *     lo esperan en `audio`.
 *
 * El error que reporta Evolution cuando no encuentra la fuente es:
 *   "Owned media must be a url, base64, or valid file with buffer"
 *
 * Por eso no dependemos de una sola forma: probamos primero los JSON conocidos
 * (base64 puro y data URI) y luego multipart. Si todos fallan, devolvemos un
 * detalle con todos los intentos para que no quede oculto el error real detrás
 * del primer 400.
 */

export type EvolutionAudioResult =
  | { ok: true; via: "evolution"; ptt: boolean; detail?: string }
  | { ok: false; status: number; detail: string };

type EvolutionResponse = { ok: boolean; status: number; text: string };

type Attempt = {
  label: string;
  run: () => Promise<EvolutionResponse>;
  ptt: boolean;
};

const fetchEvolution = async (
  url: string,
  apiKey: string,
  init: { body: BodyInit; json?: boolean },
): Promise<EvolutionResponse> => {
  const headers: Record<string, string> = { apikey: apiKey };
  if (init.json) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { method: "POST", headers, body: init.body });
  const text = await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, text };
};

const audioBlob = (bytes: Buffer, mime: string) =>
  new Blob([new Uint8Array(bytes)], { type: mime || "application/octet-stream" });

const buildMultipart = (opts: {
  number: string;
  bytes: Buffer;
  mime: string;
  fileName: string;
  rawBase64?: string;
  fileField: "file" | "audio" | "attachment";
}) => {
  const form = new FormData();
  form.set("number", opts.number);
  form.set("encoding", "true");
  // Compatibilidad con builds que leen `options` aun en multipart.
  form.set("options", JSON.stringify({ encoding: true, presence: "recording" }));
  // Si la instalación no usa multer para esta ruta, al menos queda el DTO.
  if (opts.rawBase64) form.set("audio", opts.rawBase64);
  form.append(opts.fileField, audioBlob(opts.bytes, opts.mime), opts.fileName);
  return form;
};

const short = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 260);

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
  const mime = opts.mime || "audio/ogg";
  const rawBase64 = opts.bytes.toString("base64").replace(/\s+/g, "");
  const dataUri = `data:${mime};base64,${rawBase64}`;

  if (!rawBase64 || !opts.bytes.length) {
    return { ok: false, status: 400, detail: "El audio está vacío." };
  }

  const jsonBodies: Array<{ label: string; body: Record<string, unknown> }> = [
    // Evolution v2 clásico.
    {
      label: "json-top-audio-base64",
      body: { number: opts.number, audio: rawBase64, encoding: true },
    },
    {
      label: "json-top-audio-data-uri",
      body: { number: opts.number, audio: dataUri, encoding: true },
    },
    // Evolution builds/documentación nueva (usado frecuentemente desde n8n).
    {
      label: "json-audioMessage-base64",
      body: {
        number: opts.number,
        options: { encoding: true, presence: "recording" },
        audioMessage: { audio: rawBase64 },
      },
    },
    {
      label: "json-audioMessage-data-uri",
      body: {
        number: opts.number,
        options: { encoding: true, presence: "recording" },
        audioMessage: { audio: dataUri },
      },
    },
    // Variantes defensivas vistas en integraciones no oficiales.
    {
      label: "json-audioMessage-audio-with-mimetype",
      body: {
        number: opts.number,
        audio: rawBase64,
        mimetype: mime === "audio/ogg" ? "audio/ogg; codecs=opus" : mime,
        fileName: opts.fileName,
        options: { encoding: true, presence: "recording" },
        audioMessage: { audio: rawBase64, mimetype: mime === "audio/ogg" ? "audio/ogg; codecs=opus" : mime, ptt: true },
      },
    },
  ];

  const attempts: Attempt[] = [
    ...jsonBodies.map((candidate) => ({
      label: candidate.label,
      ptt: true,
      run: () => fetchEvolution(pttUrl, opts.evoKey, {
        json: true,
        body: JSON.stringify(candidate.body),
      }),
    })),
    // Multipart como fallback: en algunas versiones el interceptor de multer
    // está enlazado a `file`; en otras instalaciones personalizadas, a `audio`.
    ...(["file", "audio", "attachment"] as const).map((fileField) => ({
      label: `multipart-${fileField}`,
      ptt: true,
      run: () => fetchEvolution(pttUrl, opts.evoKey, {
        body: buildMultipart({
          number: opts.number,
          bytes: opts.bytes,
          mime,
          fileName: opts.fileName,
          rawBase64,
          fileField,
        }),
      }),
    })),
  ];

  const failures: string[] = [];
  for (const attempt of attempts) {
    const result = await attempt.run();
    if (result.ok) {
      return { ok: true, via: "evolution", ptt: attempt.ptt, detail: attempt.label };
    }
    const failure = `${attempt.label}: HTTP ${result.status}${result.text ? ` ${short(result.text)}` : ""}`;
    failures.push(failure);
    console.error(`[evolution-audio] ${failure}`);
  }

  // Último recurso: sendMedia. Llega como archivo de audio, no como burbuja PTT,
  // pero evita perder la nota si la ruta PTT de la instancia está rota.
  const mediaBodies: Array<{ label: string; body: Record<string, unknown> }> = [
    {
      label: "sendMedia-media-base64",
      body: {
        number: opts.number,
        mediatype: "audio",
        mimetype: mime,
        fileName: opts.fileName,
        media: rawBase64,
      },
    },
    {
      label: "sendMedia-media-data-uri",
      body: {
        number: opts.number,
        mediatype: "audio",
        mimetype: mime,
        fileName: opts.fileName,
        media: dataUri,
      },
    },
  ];

  for (const candidate of mediaBodies) {
    const media = await fetchEvolution(mediaUrl, opts.evoKey, {
      json: true,
      body: JSON.stringify(candidate.body),
    });
    if (media.ok) return { ok: true, via: "evolution", ptt: false, detail: candidate.label };
    const failure = `${candidate.label}: HTTP ${media.status}${media.text ? ` ${short(media.text)}` : ""}`;
    failures.push(failure);
    console.error(`[evolution-audio] ${failure}`);
  }

  const lastStatus = Number((failures[failures.length - 1] || "").match(/HTTP (\d+)/)?.[1] || 502);
  return {
    ok: false,
    status: lastStatus,
    detail: failures.slice(0, 10).join(" | ").slice(0, 1200),
  };
}
