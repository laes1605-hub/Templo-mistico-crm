"use client";

import React, { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, AlertCircle } from "lucide-react";

/**
 * Reproductor de nota de voz estilo WhatsApp para el dashboard.
 *
 * En lugar del `<audio controls>` nativo (que se ve como "archivo de audio"),
 * muestra una burbuja de nota de voz: botón circular de play/pausa, onda de
 * amplitud, tiempos y el micrófono con velocidad de reproducción (1x/1.5x/2x).
 *
 * Soporta reproducción dual: HTML5 `<audio>` por defecto, con fallback a
 * WebAudio `AudioBufferSourceNode` en caso de incompatibilidad de códec
 * (por ejemplo OGG en Safari) o errores de red.
 */

const BAR_COUNT = 30;
const SPEED_STEPS = [1, 1.5, 2];

/** Evento global para que solo suene una nota de voz a la vez (como WhatsApp). */
const PLAY_EVENT = "templo:voicenote-play";

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

export default function VoiceNotePlayer({ src, isMe }: { src: string; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerIdRef = useRef<string>(`vn-${Math.random().toString(36).slice(2)}`);
  const [bars, setBars] = useState<number[]>(() => syntheticBars(""));
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [hasError, setHasError] = useState(false);

  // WebAudio fallback refs
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const webAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const webAudioStartOffsetRef = useRef<number>(0);
  const webAudioStartTimeRef = useRef<number>(0);
  const webAudioTimerRef = useRef<any>(null);
  const isUsingWebAudioRef = useRef<boolean>(false);

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

  // ---- Elemento de audio oculto controlado por la UI de la burbuja ----
  useEffect(() => {
    setHasError(false);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = src;
    audioRef.current = audio;

    const onTime = () => {
      if (!isUsingWebAudioRef.current) {
        setCurrentTime(audio.currentTime);
      }
    };
    const onMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration((prev) => (prev > 0 ? prev : audio.duration));
      }
    };
    const onPlay = () => {
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: playerIdRef.current }));
    };
    const onPause = () => {
      if (!isUsingWebAudioRef.current) {
        setIsPlaying(false);
      }
    };
    const onEnd = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    const onError = () => {
      // HTML5 audio falló: no marcamos error de inmediato si podemos usar WebAudio
      if (!decodedBufferRef.current) {
        setHasError(false);
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
    audio.addEventListener("error", onError);
    window.addEventListener(PLAY_EVENT, stopOthers);

    return () => {
      audio.pause();
      stopWebAudio();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onError);
      window.removeEventListener(PLAY_EVENT, stopOthers);
      audioRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
    if (isUsingWebAudioRef.current && webAudioSourceRef.current) {
      try { webAudioSourceRef.current.playbackRate.value = speed; } catch {}
    }
  }, [speed]);

  // ---- Onda real decodificada del audio (fallback: sintética) ----
  useEffect(() => {
    let cancelled = false;

    const decode = async () => {
      let arrayBuffer: ArrayBuffer | null = null;
      try {
        const res = await fetch(src);
        if (res.ok) arrayBuffer = await res.arrayBuffer();
      } catch {
        // CORS o red: intentar por el proxy del CRM
      }

      if (!arrayBuffer || !arrayBuffer.byteLength) {
        if (!src.startsWith("data:")) {
          try {
            const proxyRes = await fetch(`/api/media/download?url=${encodeURIComponent(src)}`);
            if (proxyRes.ok) arrayBuffer = await proxyRes.arrayBuffer();
          } catch {}
        }
      }

      if (!arrayBuffer || !arrayBuffer.byteLength) throw new Error("audio vacío");

      const OfflineCtx: any = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
      const OnlineCtx: any = window.AudioContext || (window as any).webkitAudioContext;
      let ctx: any;
      if (OfflineCtx) {
        ctx = new OfflineCtx(1, 1, 48000);
      } else if (OnlineCtx) {
        ctx = new OnlineCtx();
      } else {
        throw new Error("WebAudio no disponible");
      }

      const audioBuffer: AudioBuffer = await new Promise((resolve, reject) => {
        ctx.decodeAudioData(arrayBuffer, resolve, reject);
      });
      if (typeof ctx.close === "function") ctx.close().catch(() => {});
      if (cancelled) return;

      decodedBufferRef.current = audioBuffer;
      setBars(pcmToBars(audioBuffer.getChannelData(0)));
      if (isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
        setDuration(audioBuffer.duration);
      }
    };

    decode().catch(() => {
      if (!cancelled) setBars(syntheticBars(src));
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  const togglePlayback = () => {
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
    if (!audio) {
      playWebAudio();
      return;
    }

    audio.play().then(() => {
      setIsPlaying(true);
    }).catch(() => {
      // HTML5 audio falló (p. ej. OGG en Safari o códec no soportado): probar WebAudio
      const ok = playWebAudio();
      if (!ok) {
        setIsPlaying(false);
        setHasError(true);
      }
    });
  };

  const cycleSpeed = () => {
    setSpeed((prev) => SPEED_STEPS[(SPEED_STEPS.indexOf(prev) + 1) % SPEED_STEPS.length]);
  };

  const hasDuration = duration > 0 && isFinite(duration);
  const playedBars = hasDuration ? Math.round((currentTime / duration) * BAR_COUNT) : 0;

  return (
    <div className="flex items-center gap-2.5 py-0.5 w-[232px] max-w-full select-none" onClick={(e) => e.stopPropagation()}>
      {/* Botón play / pausa */}
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={isPlaying ? "Pausar nota de voz" : "Reproducir nota de voz"}
        className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors shadow-sm ${
          isMe ? "bg-white/25 hover:bg-white/35 text-white" : "bg-purple-600 hover:bg-purple-500 text-white"
        }`}
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
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
          <span>{hasDuration ? formatClock(duration) : "…"}</span>
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
  );
}
