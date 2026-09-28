"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, AlertCircle, RotateCw, Loader2 } from "lucide-react";
import {
  adjuntoEnMemoria,
  esUrlDirecta,
  obtenerAdjunto,
  PRIORIDAD_DESCARGA,
  type PrestamoAdjunto,
  type PrioridadDescarga,
} from "../lib/download-media";

/**
 * Reproductor de nota de voz estilo WhatsApp para el dashboard.
 *
 * En lugar del `<audio controls>` nativo (que se ve como "archivo de audio"),
 * muestra una burbuja de nota de voz: botón circular de play/pausa, onda de
 * amplitud, tiempos y el micrófono con velocidad de reproducción (1x/1.5x/2x).
 *
 * CÓMO SE CARGA EL AUDIO (esto es lo que hacía esperar 15-20 s):
 *  1. SOLO se baja el archivo cuando la burbuja está por aparecer en pantalla
 *     (IntersectionObserver) o cuando el operador toca play. Antes cada burbuja
 *     del historial arrancaba su descarga al montarse, en una fila FIFO de 2: la
 *     nota nueva —la que importa— quedaba última detrás de todo el historial.
 *  2. Al tocar play, si el audio vive en una URL http(s) (Chatwoot), se le pasa
 *     la URL DIRECTA al `<audio>`: el navegador pide solo los primeros rangos y
 *     suena en ~1 s, sin esperar la descarga completa. En paralelo se bajan los
 *     bytes (prioridad máxima) para la onda real y para el plan B si el formato
 *     no se puede reproducir directo (o si el host exige cabeceras).
 *  3. Los bytes se resuelven con `obtenerAdjunto`: con turnos por prioridad
 *     (play > visible > precarga), deduplicación y caché en memoria por URL, así
 *     cambiar de chat y volver ya no vuelve a bajar nada.
 *  4. Si el navegador no puede decodificar el formato (OGG en Safari), queda el
 *     respaldo WebAudio (`AudioBufferSourceNode`) con los mismos bytes.
 *  5. Si no se consigue el archivo, la burbuja lo DICE (icono + mensaje + botón
 *     de reintentar) en vez de quedarse muda.
 */

const BAR_COUNT = 30;
const SPEED_STEPS = [1, 1.5, 2];
/** Por encima de esto no se decodifica el audio para la onda (CPU del teléfono). */
const MAX_BYTES_DECODIFICAR = 8 * 1024 * 1024;

/** Evento global para que solo suene una nota de voz a la vez (como WhatsApp). */
const PLAY_EVENT = "templo:voicenote-play";

/**
 * La decodificación (para la onda real) es CPU pura: si hay 20 burbujas a la
 * vista, no pueden decodificar todas a la vez.
 */
const MAX_DECODES_PARALELOS = 2;
let decodesActivos = 0;
const colaDecodes: Array<() => void> = [];

function turnoDeDecodificacion(): Promise<() => void> {
  return new Promise((resolver) => {
    const ejecutar = () => {
      decodesActivos += 1;
      let liberado = false;
      resolver(() => {
        if (liberado) return;
        liberado = true;
        decodesActivos -= 1;
        const siguiente = colaDecodes.shift();
        if (siguiente) siguiente();
      });
    };
    if (decodesActivos < MAX_DECODES_PARALELOS) ejecutar();
    else colaDecodes.push(ejecutar);
  });
}

const formatClock = (secs: number) => {
  if (!secs || !isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/** Onda sintética determinista: misma entrada -> misma onda, aspecto natural. */
const syntheticBars = (seedSource: string): number[] => {
  let seed = seedSource.length || 7;
  const sample = seedSource.slice(0, 4096);
  for (let i = 0; i < sample.length; i++) seed = (seed * 31 + sample.charCodeAt(i)) >>> 0;
  if (seed === 0) seed = 42;
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const rnd = seed / 0xffffffff;
    const envelope = 0.55 + 0.45 * Math.sin((i / BAR_COUNT) * Math.PI);
    bars.push(Math.min(1, Math.max(0.14, rnd * 0.75 * envelope + 0.15)));
  }
  return bars;
};

/** Remuestrea el PCM decodificado a N barras de amplitud normalizadas. */
const pcmToBars = (channel: Float32Array): number[] => {
  const raw = new Array(BAR_COUNT).fill(0);
  for (let i = 0; i < BAR_COUNT; i++) {
    const start = Math.floor((i / BAR_COUNT) * channel.length);
    const end = Math.max(Math.floor(((i + 1) / BAR_COUNT) * channel.length), start + 1);
    let peak = 0;
    for (let j = start; j < end; j += 16) {
      const v = Math.abs(channel[j] || 0);
      if (v > peak) peak = v;
    }
    raw[i] = peak;
  }
  const max = Math.max(...raw, 0.01);
  return raw.map((v) => Math.min(1, Math.max(0.14, (v / max) * 0.92 + 0.08)));
};

/** Decodifica el audio (WebAudio) para la onda real y como respaldo de códec. */
async function decodificarAudio(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
  const OfflineCtx: any =
    typeof window !== "undefined"
      ? (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext
      : null;
  const OnlineCtx: any = typeof window !== "undefined" ? window.AudioContext || (window as any).webkitAudioContext : null;
  const Ctx = OfflineCtx || OnlineCtx;
  if (!Ctx) return null;
  const ctx: any = OfflineCtx ? new OfflineCtx(1, 1, 48000) : new OnlineCtx();
  try {
    return await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(bytes, resolve, reject);
    });
  } catch {
    return null;
  } finally {
    if (typeof ctx.close === "function") ctx.close().catch?.(() => {});
  }
}

export default function VoiceNotePlayer({ src, isMe }: { src: string; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const playerIdRef = useRef<string>(`vn-${Math.random().toString(36).slice(2)}`);
  const [bars, setBars] = useState<number[]>(() => syntheticBars(""));
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  // Si la URL se puede reproducir directo, el play está disponible de entrada
  // (suena con los primeros rangos); si no, se espera a tener los bytes.
  const [cargando, setCargando] = useState(() => !esUrlDirecta(src));
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  // WebAudio fallback refs
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const webAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const webAudioStartOffsetRef = useRef<number>(0);
  const webAudioStartTimeRef = useRef<number>(0);
  const webAudioTimerRef = useRef<any>(null);
  const isUsingWebAudioRef = useRef<boolean>(false);

  // Estado de carga (todo en refs para no re-renderizar de más)
  const prestamoRef = useRef<PrestamoAdjunto | null>(null);
  const listoRef = useRef(false);              // los bytes ya están en memoria
  const descargaEnCursoRef = useRef(false);    // hay una descarga pedida
  const reproduciendoDirectoRef = useRef(false); // suena desde la URL directa
  const pidePlayRef = useRef(false);           // tocó play y todavía no suena
  const falloDirectoRef = useRef(false);       // el intento directo no sirvió
  const canceladoRef = useRef(false);

  // Detener WebAudio fallback
  const stopWebAudio = () => {
    if (webAudioTimerRef.current) {
      clearInterval(webAudioTimerRef.current);
      webAudioTimerRef.current = null;
    }
    if (webAudioSourceRef.current) {
      try { webAudioSourceRef.current.stop(); } catch {}
      try { webAudioSourceRef.current.disconnect(); } catch {}
      webAudioSourceRef.current = null;
    }
    isUsingWebAudioRef.current = false;
  };

  // Reproducir vía WebAudio fallback
  const playWebAudio = () => {
    if (!decodedBufferRef.current) return false;
    stopWebAudio();

    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return false;
      if (!webAudioCtxRef.current || webAudioCtxRef.current.state === "closed") {
        webAudioCtxRef.current = new Ctx();
      }
      const ctx = webAudioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      const source = ctx.createBufferSource();
      source.buffer = decodedBufferRef.current;
      source.playbackRate.value = speed;
      source.connect(ctx.destination);

      const offset = currentTime >= duration ? 0 : currentTime;
      webAudioStartOffsetRef.current = offset;
      webAudioStartTimeRef.current = ctx.currentTime;
      webAudioSourceRef.current = source;
      isUsingWebAudioRef.current = true;

      source.onended = () => {
        if (isUsingWebAudioRef.current) {
          setIsPlaying(false);
          setCurrentTime(0);
          stopWebAudio();
        }
      };

      source.start(0, offset);
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: playerIdRef.current }));

      webAudioTimerRef.current = setInterval(() => {
        if (!webAudioCtxRef.current || !isUsingWebAudioRef.current) return;
        const elapsed = (webAudioCtxRef.current.currentTime - webAudioStartTimeRef.current) * speed;
        const current = webAudioStartOffsetRef.current + elapsed;
        if (current >= duration) {
          setCurrentTime(duration);
          setIsPlaying(false);
          stopWebAudio();
        } else {
          setCurrentTime(current);
        }
      }, 50);

      return true;
    } catch {
      return false;
    }
  };

  /**
   * Baja los bytes del audio (con prioridad) y los deja listos para el <audio>.
   * Idempotente: si ya hay bytes o hay una descarga en curso, no hace nada.
   */
  const cargarBytes = useCallback(
    async (prioridad: PrioridadDescarga) => {
      if (!src || listoRef.current || canceladoRef.current) return;
      // Una precarga no arranca si el usuario ya está esperando otra cosa.
      if (descargaEnCursoRef.current && prioridad < PRIORIDAD_DESCARGA.USUARIO) return;
      descargaEnCursoRef.current = true;
      if (!esUrlDirecta(src)) setCargando(true);

      try {
        const prestamo = await obtenerAdjunto(src, prioridad);
        if (canceladoRef.current) {
          prestamo.liberar();
          return;
        }
        prestamoRef.current?.liberar();
        prestamoRef.current = prestamo;
        listoRef.current = true;
        setCargando(false);

        const audio = audioRef.current;
        // Si el audio ya está sonando desde la URL directa, NO se le cambia el
        // src a mitad de la reproducción (se cortaría): los bytes quedan para la
        // onda, la duración exacta y el plan B.
        if (audio && !reproduciendoDirectoRef.current) {
          if (prestamo.objectUrl) audio.src = prestamo.objectUrl;
          else audio.src = src;
          if (pidePlayRef.current) {
            audio.play().then(() => setIsPlaying(true)).catch(() => {});
          }
        }

        // Onda real + duración exacta (en segundo plano, sin bloquear el play).
        if (prestamo.blob.size > 0 && prestamo.blob.size <= MAX_BYTES_DECODIFICAR) {
          const bytes = await prestamo.blob.arrayBuffer().catch(() => null);
          if (!bytes || canceladoRef.current) return;
          const liberarTurno = await turnoDeDecodificacion();
          let audioBuffer: AudioBuffer | null = null;
          try {
            audioBuffer = await decodificarAudio(bytes);
          } finally {
            liberarTurno();
          }
          if (canceladoRef.current || !audioBuffer) return;
          decodedBufferRef.current = audioBuffer;
          setBars(pcmToBars(audioBuffer.getChannelData(0)));
          if (isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
            setDuration((prev) => (prev > 0 ? prev : audioBuffer.duration));
          }
        }
      } catch (e: any) {
        // Si el audio ya está sonando desde la URL directa, que falle el copia
        // de bytes (onda/duración) no debe pintar un error en la burbuja.
        if (!canceladoRef.current && !reproduciendoDirectoRef.current) {
          setError(e?.message || "No se pudo descargar el audio.");
          setCargando(false);
        }
      } finally {
        descargaEnCursoRef.current = false;
      }
    },
    [src]
  );

  // ---- Carga del audio: perezosa + priorizada --------------------------------
  useEffect(() => {
    canceladoRef.current = false;
    descargaEnCursoRef.current = false;
    listoRef.current = false;
    reproduciendoDirectoRef.current = false;
    pidePlayRef.current = false;
    falloDirectoRef.current = false;
    decodedBufferRef.current = null; // el PCM de un intento anterior ya no vale
    prestamoRef.current?.liberar();
    prestamoRef.current = null;

    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.preload = "metadata";
    setCargando(!esUrlDirecta(src));
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setBars(syntheticBars(src.slice(-64)));

    // ¿Ya está en la caché de la sesión? Entonces no hay nada que esperar.
    const enMemoria = adjuntoEnMemoria(src);
    if (enMemoria) {
      prestamoRef.current = enMemoria;
      listoRef.current = true;
      setCargando(false);
      if (enMemoria.objectUrl) audio.src = enMemoria.objectUrl;
      void (async () => {
        const bytes = await enMemoria.blob.arrayBuffer().catch(() => null);
        if (!bytes || canceladoRef.current) return;
        const audioBuffer = await decodificarAudio(bytes);
        if (canceladoRef.current || !audioBuffer) return;
        decodedBufferRef.current = audioBuffer;
        setBars(pcmToBars(audioBuffer.getChannelData(0)));
        if (isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
          setDuration((prev) => (prev > 0 ? prev : audioBuffer.duration));
        }
      })();
    }

    const onTime = () => {
      if (!isUsingWebAudioRef.current) setCurrentTime(audio.currentTime);
    };
    const onMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration((prev) => (prev > 0 ? prev : audio.duration));
      }
      // Si la reproducción directa funciona, hay duración: no hace falta esperar nada.
      if (reproduciendoDirectoRef.current) setCargando(false);
    };
    const onPlay = () => {
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: playerIdRef.current }));
    };
    const onPause = () => {
      if (isUsingWebAudioRef.current) return;
      setIsPlaying(false);
    };
    const onEnd = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      try { audio.currentTime = 0; } catch {}
    };
    const onElementError = () => {
      if (canceladoRef.current) return;
      // El <audio> no pudo con el archivo: puede ser que el host exija
      // cabeceras (se resuelve con los bytes del proxy) o un códec que el
      // navegador no soporta (queda el respaldo WebAudio).
      if (reproduciendoDirectoRef.current) {
        reproduciendoDirectoRef.current = false;
        falloDirectoRef.current = true;
        try { audio.removeAttribute("src"); } catch {}
        // La descarga por el proxy ya está en marcha con prioridad de usuario:
        // cuando lleguen los bytes, el <audio> reintenta con el blob.
        if (!descargaEnCursoRef.current && !listoRef.current) void cargarBytes(PRIORIDAD_DESCARGA.USUARIO);
        return;
      }
      if (!decodedBufferRef.current && listoRef.current) {
        setError("Tu navegador no puede reproducir este formato de audio.");
        setCargando(false);
      }
    };
    const stopOthers = (e: Event) => {
      if ((e as CustomEvent).detail !== playerIdRef.current) {
        if (!audio.paused) audio.pause();
        if (isUsingWebAudioRef.current) {
          stopWebAudio();
          setIsPlaying(false);
        }
      }
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onElementError);
    window.addEventListener(PLAY_EVENT, stopOthers);

    // Descarga perezosa: nada se baja hasta que la burbuja está por verse.
    let observador: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined" && contenedorRef.current) {
      observador = new IntersectionObserver(
        (entradas) => {
          for (const entrada of entradas) {
            if (!entrada.isIntersecting) continue;
            void cargarBytes(PRIORIDAD_DESCARGA.VISIBLE);
          }
        },
        { rootMargin: "320px 0px" }
      );
      observador.observe(contenedorRef.current);
    } else if (!enMemoria) {
      // Sin IntersectionObserver (WebView viejo): se comporta como antes.
      void cargarBytes(PRIORIDAD_DESCARGA.VISIBLE);
    }

    return () => {
      canceladoRef.current = true;
      observador?.disconnect();
      audio.pause();
      stopWebAudio();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onElementError);
      window.removeEventListener(PLAY_EVENT, stopOthers);
      try { audio.removeAttribute("src"); audio.load(); } catch {}
      prestamoRef.current?.liberar();
      prestamoRef.current = null;
    };
  }, [src, intento, cargarBytes]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
    if (isUsingWebAudioRef.current && webAudioSourceRef.current) {
      try { webAudioSourceRef.current.playbackRate.value = speed; } catch {}
    }
  }, [speed]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      if (isUsingWebAudioRef.current) {
        stopWebAudio();
        setIsPlaying(false);
      } else if (audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
      return;
    }

    const audio = audioRef.current;

    // Sin bytes todavía: suena YA desde la URL directa (streaming por rangos) y
    // en paralelo se bajan los bytes con la máxima prioridad.
    if (!listoRef.current) {
      pidePlayRef.current = true;
      void cargarBytes(PRIORIDAD_DESCARGA.USUARIO);
      if (esUrlDirecta(src) && audio && !falloDirectoRef.current) {
        reproduciendoDirectoRef.current = true;
        audio.preload = "auto";
        audio.src = src;
        audio
          .play()
          .then(() => {
            setIsPlaying(true);
            setCargando(false);
          })
          .catch(() => {
            // El navegador no dejó reproducir el stream: esperará los bytes.
          });
        return;
      }
      return;
    }

    if (!audio || !audio.src) {
      if (!playWebAudio()) setError("El audio todavía no está disponible. Pulsa reintentar.");
      return;
    }

    audio.play().then(() => {
      setIsPlaying(true);
    }).catch(() => {
      // HTML5 audio falló (p. ej. OGG en Safari o códec no soportado): probar WebAudio
      const ok = playWebAudio();
      if (!ok) {
        setIsPlaying(false);
        setError("No se pudo reproducir esta nota de voz en este navegador.");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, speed, duration, currentTime, src, cargarBytes]);

  const cycleSpeed = () => {
    setSpeed((prev) => SPEED_STEPS[(SPEED_STEPS.indexOf(prev) + 1) % SPEED_STEPS.length]);
  };

  const hasDuration = duration > 0 && isFinite(duration);
  const playedBars = hasDuration ? Math.round((currentTime / duration) * BAR_COUNT) : 0;

  return (
    <div
      ref={contenedorRef}
      className="flex flex-col gap-1 w-[232px] max-w-full select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2.5 py-0.5">
        {/* Botón play / pausa */}
        <button
          type="button"
          onClick={togglePlayback}
          disabled={cargando}
          aria-label={isPlaying ? "Pausar nota de voz" : "Reproducir nota de voz"}
          className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors shadow-sm disabled:opacity-60 ${
            isMe ? "bg-white/25 hover:bg-white/35 text-white" : "bg-purple-600 hover:bg-purple-500 text-white"
          }`}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : cargando ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        {/* Onda + tiempos */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-[2px] h-7" aria-hidden="true">
            {bars.map((v, i) => (
              <span
                key={i}
                style={{ height: `${Math.max(3, v * 26)}px` }}
                className={`w-[3px] rounded-full flex-shrink-0 transition-colors ${
                  i < playedBars
                    ? isMe
                      ? "bg-white"
                      : "bg-purple-400"
                    : isMe
                      ? "bg-white/40"
                      : "bg-gray-700"
                }`}
              />
            ))}
          </div>
          <div className={`flex items-center justify-between text-[10px] leading-none mt-1 ${isMe ? "text-white/75" : "text-gray-500"}`}>
            <span>{formatClock(currentTime)}</span>
            <span>{hasDuration ? formatClock(duration) : cargando ? "…" : "0:00"}</span>
          </div>
        </div>

        {/* Micrófono: identifica visualmente la nota de voz; tocar cambia velocidad */}
        <button
          type="button"
          onClick={cycleSpeed}
          title="Nota de voz · toca para cambiar la velocidad"
          aria-label={`Nota de voz, velocidad ${speed}x`}
          className={`flex-shrink-0 w-9 h-9 rounded-full flex flex-col items-center justify-center transition-colors ${
            isMe
              ? "bg-white/10 hover:bg-white/20 text-white"
              : "bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 border border-purple-800/40"
          }`}
        >
          <Mic className="w-4 h-4" />
          <span className="text-[8px] leading-none font-bold mt-[1px]">{speed}x</span>
        </button>
      </div>

      {/* Antes el fallo era silencioso: la burbuja se quedaba "vacía" y sin
          explicación. Ahora dice qué pasó y deja reintentar. */}
      {error && (
        <div
          className={`flex items-center gap-1.5 text-[10px] leading-tight px-1 ${isMe ? "text-white/85" : "text-red-300"}`}
          role="alert"
        >
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => { setError(null); setIntento((n) => n + 1); }}
            className={`flex items-center gap-0.5 underline flex-shrink-0 ${isMe ? "hover:text-white" : "hover:text-red-200"}`}
          >
            <RotateCw className="w-3 h-3" /> Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
