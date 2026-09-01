"use client";

import React, { useState } from "react";
import { Download, Loader2, Video as VideoIcon } from "lucide-react";
import { downloadMedia, guessFilename } from "../lib/download-media";

export default function ChatVideo({
  src,
  filename,
  isMe,
}: {
  src: string;
  filename?: string;
  isMe: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const name = filename || guessFilename(src, "video-cliente.mp4");

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy || !src) return;
    setBusy(true);
    try {
      await downloadMedia(src, name);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 relative group" onClick={(e) => e.stopPropagation()}>
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        className="max-w-full max-h-64 rounded-xl border border-black/20 bg-black/40"
      />
      <div className="flex items-center justify-between text-[10px] px-1">
        <span className={`flex items-center gap-1 ${isMe ? "text-white/75" : "text-gray-400"}`}>
          <VideoIcon className="w-3 h-3" /> Video
        </span>
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy}
          className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
            isMe ? "text-white hover:bg-white/20" : "text-purple-300 hover:bg-purple-950/50"
          }`}
          title="Descargar video"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          <span>Descargar</span>
        </button>
      </div>
    </div>
  );
}
