"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Radio, ArrowRight, X } from "lucide-react";

export function ResumeLiveBanner() {
  const [token, setToken] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const savedToken = localStorage.getItem("waymark_last_live_token");
      const savedTitle = localStorage.getItem("waymark_last_live_title");
      if (savedToken && savedToken.trim().length > 0) {
        setToken(savedToken);
        setTitle(savedTitle || "Live Tracking Anda");
      }
    } catch (_) {}
  }, []);

  if (!token || dismissed) return null;

  return (
    <div className="bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-700 text-white px-4 py-2.5 shadow-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex size-2 rounded-full bg-rose-400 animate-ping shrink-0" />
          <Radio size={16} className="text-emerald-200 shrink-0" />
          <span className="font-medium truncate">
            Sesi Live Tersimpan: <strong className="text-white font-bold">{title}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/live/${token}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-white text-emerald-800 font-bold px-3.5 py-1 text-xs hover:bg-emerald-50 transition-colors shadow-2xs"
          >
            <span>Buka Langsung</span>
            <ArrowRight size={13} />
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-emerald-200 hover:text-white p-1 rounded-full transition-colors"
            title="Tutup banner"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
