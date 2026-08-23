"use client";

import React, { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play } from "lucide-react";

/**
 * Reproductor de nota de voz estilo WhatsApp para el dashboard.
 *
 * En lugar del `<audio controls>` nativo (que se ve como "archivo de audio"),
 * muestra una burbuja de nota de voz: botón circular de play/pausa, onda de
 * amplitud, tiempos y el micrófono con velocidad de reproducción (1x/1.5x/2x).
 *
 * La onda intenta decodificarse del audio real (WebAudio); si el navegador no
 * puede decodificar el contenedor (p. ej. Safari viejo con WebM), genera una
 * onda sintética determinista a partir del contenido para que SIEMPRE se vea
 * como nota de voz en laptop y celular.
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
    // Pico (no promedio): se acerca más a la onda que muestra WhatsApp.
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

  // ---- Elemento de audio oculto controlado por la UI de la burbuja ----
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = src;
    audioRef.current = audio;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => {
      if (isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    };
    const onPlay = () => {
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: playerIdRef.current }));
    };
    const onPause = () => setIsPlaying(false);
    const onEnd = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    const stopOthers = (e: Event) => {
      if ((e as CustomEvent).detail !== playerIdRef.current && !audio.paused) audio.pause();
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    window.addEventListener(PLAY_EVENT, stopOthers);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      window.removeEventListener(PLAY_EVENT, stopOthers);
      audioRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // ---- Onda real decodificada del audio (fallback: sintética) ----
  useEffect(() => {
    let cancelled = false;

    const decode = async () => {
      const res = await fetch(src); // data URIs soportadas por fetch en todos los browsers modernos
      const arrayBuffer = await res.arrayBuffer();
      if (!arrayBuffer.byteLength) throw new Error("audio vacío");

      const OfflineCtx: any = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
      const OnlineCtx: any = window.AudioContext || (window as any).webkitAudioContext;
      let ctx: any;
      if (OfflineCtx) {
        // Preferido: no consume un contexto de audio real (los navegadores
        // limitan cuántos hay abiertos) y decodifica sin gesto del usuario.
        ctx = new OfflineCtx(1, 1, 48000);
      } else if (OnlineCtx) {
        ctx = new OnlineCtx();
      } else {
        throw new Error("WebAudio no disponible");
      }
      // Firma con callbacks: compatible con Safari antiguo y Chrome moderno.
      const audioBuffer: AudioBuffer = await new Promise((resolve, reject) => {
        ctx.decodeAudioData(arrayBuffer, resolve, reject);
      });
      if (typeof ctx.close === "function") ctx.close().catch(() => {});
      if (cancelled) return;

      setBars(pcmToBars(audioBuffer.getChannelData(0)));
      // Los WebM grabados con MediaRecorder reportan duración Infinity en
      // <audio>; la duración real decodificada es el respaldo exacto.
      if (isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
        setDuration((prev) => (prev > 0 && isFinite(prev) ? prev : audioBuffer.duration));
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
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
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
                    : "bg-gray-600"
              }`}
            />
          ))}
        </div>
        <div className={`flex items-center justify-between text-[10px] leading-none mt-1 ${isMe ? "text-purple-200" : "text-gray-500"}`}>
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
            ? "bg-white/10 hover:bg-white/20 text-purple-100"
            : "bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 border border-purple-800/40"
        }`}
      >
        <Mic className="w-4 h-4" />
        <span className="text-[8px] leading-none font-bold mt-[1px]">{speed}x</span>
      </button>
    </div>
  );
}
