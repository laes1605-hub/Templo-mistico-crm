"use client";

import React, { useState } from "react";
import { FileText, Download, FileArchive, FileSpreadsheet, FileCode, Paperclip, Loader2, ExternalLink } from "lucide-react";
import { downloadMedia, guessFilename } from "../lib/download-media";

export default function ChatFile({
  src,
  filename,
  isMe,
}: {
  src: string;
  filename?: string;
  isMe: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const name = filename || guessFilename(src, "archivo-adjunto");
  const ext = (name.split(".").pop() || "").toLowerCase();

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

  const getIcon = () => {
    if (["pdf", "doc", "docx", "txt", "rtf"].includes(ext)) return <FileText className="w-5 h-5 flex-shrink-0" />;
    if (["xls", "xlsx", "csv"].includes(ext)) return <FileSpreadsheet className="w-5 h-5 flex-shrink-0" />;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return <FileArchive className="w-5 h-5 flex-shrink-0" />;
    if (["json", "js", "ts", "html", "css", "xml"].includes(ext)) return <FileCode className="w-5 h-5 flex-shrink-0" />;
    return <Paperclip className="w-5 h-5 flex-shrink-0" />;
  };

  return (
    <div
      onClick={handleDownload}
      role="button"
      tabIndex={0}
      className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${
        isMe
          ? "bg-white/10 hover:bg-white/20 border-white/20 text-white"
          : "bg-surface hover:bg-surfaceHover border-border text-gray-200"
      }`}
      title="Toca para abrir o descargar el archivo"
    >
      <div className={`p-2 rounded-lg flex items-center justify-center ${isMe ? "bg-white/20 text-white" : "bg-purple-950/60 text-purple-300 border border-purple-800/40"}`}>
        {getIcon()}
      </div>
      <div className="flex-1 min-w-0 pr-1">
        <p className="text-xs font-semibold truncate leading-tight">{name}</p>
        <p className={`text-[10px] mt-0.5 uppercase font-medium ${isMe ? "text-white/70" : "text-gray-400"}`}>
          {ext ? `Archivo .${ext}` : "Documento adjunto"}
        </p>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        aria-label="Descargar archivo"
        className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
          isMe
            ? "bg-white/20 hover:bg-white/30 text-white"
            : "bg-purple-600 hover:bg-purple-500 text-white"
        }`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      </button>
    </div>
  );
}
