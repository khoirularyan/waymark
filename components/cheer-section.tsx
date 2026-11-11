"use client";

import { useState } from "react";
import { MessageSquareHeart, Send, Sparkles } from "lucide-react";

interface Cheer {
  id: string;
  senderName: string;
  message?: string;
  emoji?: string;
  createdAt: string;
}

interface CheerSectionProps {
  token: string;
  spectatorName: string;
  cheers: Cheer[];
  onCheerSent?: (cheer: Cheer) => void;
}

const QUICK_EMOJIS = ["👏", "🔥", "❤️", "🏃‍♂️", "⛰️", "💪"];

export function CheerSection({
  token,
  spectatorName,
  cheers,
  onCheerSent,
}: CheerSectionProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: number; emoji: string; x: number }[]>([]);

  const triggerFloatingEmoji = (emoji: string) => {
    const id = Date.now() + Math.random();
    const x = Math.floor(Math.random() * 60) + 20; // 20% to 80% horizontal
    setFloatingEmojis((prev) => [...prev, { id, emoji, x }]);
    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((item) => item.id !== id));
    }, 1800);
  };

  const sendCheer = async (emoji: string, customMessage?: string) => {
    if (!token) return;
    try {
      setIsSending(true);
      triggerFloatingEmoji(emoji);

      const res = await fetch(`/api/tracking/${token}/cheer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderName: spectatorName || "Penonton",
          emoji,
          message: customMessage || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.cheer && onCheerSent) {
          onCheerSent(data.cheer);
        }
        if (customMessage) setMessage("");
      }
    } catch (_) {
      // Ignore
    } finally {
      setIsSending(false);
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isSending) return;
    sendCheer("💬", message.trim());
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs">
      {/* Floating Emoji Particles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {floatingEmojis.map((item) => (
          <div
            key={item.id}
            className="absolute bottom-6 text-2xl animate-bounce-float"
            style={{ left: `${item.x}%` }}
          >
            {item.emoji}
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <MessageSquareHeart size={16} />
          </div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Kirim Semangat ke Pelari
          </h3>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-neutral-500">
          <Sparkles size={12} className="text-amber-500" />
          Langsung masuk ke HP pelari
        </span>
      </div>

      {/* Quick Emoji Reaction Buttons */}
      <div className="mb-3.5 flex flex-wrap gap-2">
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => sendCheer(emoji)}
            disabled={isSending}
            className="flex items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50/80 px-3.5 py-1.5 text-lg hover:border-emerald-400 hover:bg-emerald-50 active:scale-95 transition-all shadow-2xs"
            title={`Kirim ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Custom Message Input */}
      <form onSubmit={handleCustomSubmit} className="mb-4 flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tulis pesan penyemangat untuk pelari..."
          maxLength={140}
          className="flex-1 rounded-xl border border-neutral-200 bg-neutral-50/50 px-3.5 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
        />
        <button
          type="submit"
          disabled={!message.trim() || isSending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-2xs"
        >
          <Send size={13} />
          <span>Kirim</span>
        </button>
      </form>

      {/* Cheer Feed */}
      {cheers.length > 0 && (
        <div className="space-y-2 border-t border-neutral-100 pt-3 max-h-48 overflow-y-auto pr-1">
          <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
            Sorakan Terbaru
          </p>
          <div className="space-y-1.5">
            {cheers.slice(0, 8).map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-2 rounded-lg bg-neutral-50/80 p-2 text-xs"
              >
                <span className="text-base select-none shrink-0">{c.emoji || "👏"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-800 truncate">
                      {c.senderName}
                    </span>
                    <span className="text-[10px] text-neutral-400 shrink-0">
                      {new Date(c.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {c.message && (
                    <p className="mt-0.5 text-neutral-600 break-words">{c.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
