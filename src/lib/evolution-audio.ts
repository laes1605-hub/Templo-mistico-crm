/**
 * Notas de voz por Evolution (WhatsApp Personal / Baileys).
 *
 * El 400 "Owned media..." es formato. El 500 "Connection Closed" es la sesión
 * de WhatsApp (Baileys se cayó o el OGG rompe el socket). En ese caso no tiene
 * sentido probar 10 payloads: se reintenta una vez y se avisa de reconectar.
 */

export type EvolutionAudioResult =
  | { ok: true; via: "evolution"; ptt: boolean; detail?: string }
  | { ok: false; status: number; detail: string };

type EvolutionResponse = { ok: boolean; status: number; text: string };

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

const short = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 280);

function esConexionCerrada(text: string): boolean {
  return /connection closed|not connected|instance .* not|session/i.test(text || "");
}

async function estadoInstancia(
  base: string,
  apiKey: string,
  instance: string
): Promise<{ open: boolean; state: string }> {
  const rutas = [
    `/instance/connectionState/${instance}`,
    `/instance/connect/${instance}`,
  ];
  for (const ruta of rutas) {
    try {
      const r = await fetch(`${base}${ruta}`, { headers: { apikey: apiKey } });
      const text = await r.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const state = String(
        json?.instance?.state || json?.state || json?.status || text || ""
      ).toLowerCase();
      if (state.includes("open") || state.includes("connected")) {
        return { open: true, state };
      }
      if (state) return { open: false, state: state.slice(0, 80) };
    } catch {
      /* siguiente */
    }
  }
  return { open: true, state: "desconocido" };
}

export async function sendEvolutionVoiceNote(opts: {
  evoUrl: string;
  evoKey: string;
  instance?: string;
  number: string;
  bytes: Buffer;
  mime: string;
  fileName: string;
}): Promise<EvolutionAudioResult> {
  const instance = opts.instance || process.env.EVOLUTION_INSTANCE || "personal";
  const base = opts.evoUrl.replace(/\/$/, "");
  const pttUrl = `${base}/message/sendWhatsAppAudio/${instance}`;
  const mediaUrl = `${base}/message/sendMedia/${instance}`;
  const mime = opts.mime || "audio/ogg";
  const rawBase64 = opts.bytes.toString("base64").replace(/\s+/g, "");
  const dataUri = `data:${mime};base64,${rawBase64}`;
  const mimetypePtt = mime.includes("ogg") ? "audio/ogg; codecs=opus" : mime;

  if (!rawBase64 || !opts.bytes.length) {
    return { ok: false, status: 400, detail: "El audio está vacío." };
  }

  const conexion = await estadoInstancia(base, opts.evoKey, instance);
  if (!conexion.open) {
    return {
      ok: false,
      status: 503,
      detail: `WhatsApp Personal no está conectado en Evolution (estado: ${conexion.state}). Abre Evolution, reconecta la instancia "${instance}" (QR) y vuelve a enviar.`,
    };
  }

  const payloads: Array<{ label: string; url: string; body: Record<string, unknown>; ptt: boolean }> = [
    {
      label: "ptt-audio-base64",
      url: pttUrl,
      ptt: true,
      body: {
        number: opts.number,
        audio: rawBase64,
        encoding: true,
        delay: 800,
      },
    },
    {
      label: "ptt-audio-data-uri",
      url: pttUrl,
      ptt: true,
      body: {
        number: opts.number,
        audio: dataUri,
        encoding: true,
        delay: 800,
      },
    },
    {
      label: "sendMedia-audio-base64",
      url: mediaUrl,
      ptt: false,
      body: {
        number: opts.number,
        mediatype: "audio",
        mimetype: mimetypePtt,
        fileName: opts.fileName || "audio.ogg",
        media: rawBase64,
      },
    },
    {
      label: "sendMedia-audio-data-uri",
      url: mediaUrl,
      ptt: false,
      body: {
        number: opts.number,
        mediatype: "audio",
        mimetype: mimetypePtt,
        fileName: opts.fileName || "audio.ogg",
        media: dataUri,
      },
    },
  ];

  const failures: string[] = [];
  for (const candidate of payloads) {
    const result = await fetchEvolution(candidate.url, opts.evoKey, {
      json: true,
      body: JSON.stringify(candidate.body),
    });
    if (result.ok) {
      return { ok: true, via: "evolution", ptt: candidate.ptt, detail: candidate.label };
    }
    failures.push(`${candidate.label}: HTTP ${result.status} ${short(result.text)}`);
    console.error(`[evolution-audio] ${failures[failures.length - 1]}`);

    if (esConexionCerrada(result.text)) {
      await new Promise((r) => setTimeout(r, 1500));
      const retry = await fetchEvolution(candidate.url, opts.evoKey, {
        json: true,
        body: JSON.stringify(candidate.body),
      });
      if (retry.ok) {
        return { ok: true, via: "evolution", ptt: candidate.ptt, detail: `${candidate.label}-retry` };
      }
      return {
        ok: false,
        status: 503,
        detail:
          "WhatsApp Personal cerró la conexión al enviar el audio. En Evolution reconecta la instancia (QR) y prueba de nuevo. Si el texto sí sale y el audio no, el socket de Baileys se está cayendo con notas de voz.",
      };
    }
  }

  const lastStatus = Number((failures[failures.length - 1] || "").match(/HTTP (\d+)/)?.[1] || 502);
  return {
    ok: false,
    status: lastStatus,
    detail: failures.join(" | ").slice(0, 900),
  };
}
