"use client";

import React, { useEffect, useState } from "react";
import { Download, X, AlertTriangle, Loader2 } from "lucide-react";
import { downloadMedia, guessImageFilename } from "../lib/download-media";

type Variant = "bubble" | "thumb";

export default function ChatImage({
  src,
  alt = "",
  filename,
  variant = "bubble",
  label,
  className = "",
}: {
  src: string;
  alt?: string;
  filename?: string;
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const name = filename || guessImageFilename(src, label ? `foto-${label}` : "imagen-cliente");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleDownload = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (busy || !src) return;
    setBusy(true);
    setError("");
    try {
      await downloadMedia(src, name);
    } catch (err: any) {
      setError(err?.message || "No se pudo descargar la imagen.");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const imgClass =
    variant === "thumb"
      ? "w-full h-full object-cover"
      : `rounded-lg max-h-60 object-cover cursor-zoom-in ${className}`;

  return (
    <>
      <div
        className={`relative group overflow-hidden ${variant === "thumb" ? "aspect-square rounded-lg bg-surface border border-border cursor-zoom-in" : ""}`}
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={label ? `Ver foto ${label}` : "Ver imagen"}
      >
        <img src={src} alt={alt || label || "Imagen del cliente"} className={imgClass} />
        {label && variant === "thumb" && (
          <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[10px] text-white font-semibold py-1 text-center">
            {label}
          </span>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy}
          title="Descargar imagen"
          aria-label="Descargar imagen"
          className={`absolute ${variant === "thumb" ? "top-1.5 right-1.5" : "bottom-2 right-2"} z-10 p-1.5 rounded-full bg-black/70 text-white hover:bg-black/90 transition-opacity disabled:opacity-50 ${
            variant === "bubble" ? "opacity-100 md:opacity-0 md:group-hover:opacity-100" : "opacity-100"
          }`}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-sm flex flex-col"
          onClick={() => setOpen(false)}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium truncate">{label || "Imagen del cliente"}</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleDownload}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-bold disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {busy ? "Descargando..." : "Descargar"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10" aria-label="Cerrar">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto" onClick={() => setOpen(false)}>
            <img
              src={src}
              alt={alt || label || "Imagen del cliente"}
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {error && (
            <div className="px-4 pb-4" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs text-red-300 bg-red-950/70 border border-red-800 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {error}
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
