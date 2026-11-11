"use client";

import { useState, useRef, useEffect } from "react";
import {
  MessageSquareHeart,
  Send,
  Sparkles,
  Mic,
  Square,
  Trash2,
  Play,
  Pause,
  Volume2,
} from "lucide-react";

interface Cheer {
  id: string;
  senderName: string;
  message?: string;
  emoji?: string;
  createdAt: string;
  audioData?: string;
  durationSeconds?: number;
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

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Audio player state for cheers feed
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
      }
    };
  }, []);

  const triggerFloatingEmoji = (emoji: string) => {
    const id = Date.now() + Math.random();
    const x = Math.floor(Math.random() * 60) + 20;
    setFloatingEmojis((prev) => [...prev, { id, emoji, x }]);
    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((item) => item.id !== id));
    }, 1800);
  };

  const sendCheer = async (
    emoji: string,
    customMessage?: string,
    audioData?: string,
    durationSeconds?: number
  ) => {
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
          audioData: audioData || undefined,
          durationSeconds: durationSeconds || undefined,
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

  // Start voice recording
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Browser tidak mendukung perekaman audio.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordSeconds(0);

      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((sec) => {
          if (sec >= 14) {
            stopAndSendRecording();
            return 15;
          }
          return sec + 1;
        });
      }, 1000);
    } catch (err) {
      alert("Izin mikrofon diperlukan untuk mengirim pesan suara.");
    }
  };

  // Cancel voice recording
  const cancelRecording = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    setIsRecording(false);
    setRecordSeconds(0);
    audioChunksRef.current = [];
  };

  // Stop & send voice recording
  const stopAndSendRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
      return;
    }
    const finalSeconds = Math.max(1, recordSeconds);
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);

    mediaRecorderRef.current.onstop = () => {
      const mime = mediaRecorderRef.current?.mimeType || "audio/webm";
      const blob = new Blob(audioChunksRef.current, { type: mime });
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Data = reader.result as string;
        sendCheer("🎙️", `🎙️ Pesan Suara (${finalSeconds}d)`, base64Data, finalSeconds);
      };
      reader.readAsDataURL(blob);

      setIsRecording(false);
      setRecordSeconds(0);
      audioChunksRef.current = [];
    };

    mediaRecorderRef.current.stop();
  };

  // Play audio in feed
  const togglePlayAudio = (cheerId: string, audioData: string) => {
    if (playingAudioId === cheerId && activeAudioRef.current) {
      activeAudioRef.current.pause();
      setPlayingAudioId(null);
      return;
    }

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
    }

    const audio = new Audio(audioData);
    activeAudioRef.current = audio;
    setPlayingAudioId(cheerId);

    audio.onended = () => {
      setPlayingAudioId(null);
    };

    audio.onerror = () => {
      setPlayingAudioId(null);
    };

    audio.play().catch(() => setPlayingAudioId(null));
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-200/80 bg-white dark:border-neutral-800 dark:bg-neutral-900 p-5 shadow-xs transition-colors">
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
          <div className="flex size-7 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
            <MessageSquareHeart size={16} />
          </div>
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Kirim Semangat ke Pelari
          </h3>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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
            disabled={isSending || isRecording}
            className="flex items-center justify-center rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/80 dark:bg-neutral-800/80 px-3.5 py-1.5 text-lg hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-neutral-700 active:scale-95 transition-all shadow-2xs disabled:opacity-50"
            title={`Kirim ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Custom Message & Voice Recording Input */}
      {isRecording ? (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50/80 dark:bg-rose-950/30 p-2.5">
          <div className="size-3 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-xs font-semibold text-rose-700 dark:text-rose-300 flex-1">
            Merekam suara... 0:{recordSeconds.toString().padStart(2, "0")} (Maks 15d)
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="rounded-lg p-1.5 text-neutral-500 hover:bg-rose-100 dark:hover:bg-rose-900/50 hover:text-rose-700 transition-colors"
            title="Batal"
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            onClick={stopAndSendRecording}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 transition-colors shadow-2xs"
          >
            <Send size={13} />
            <span>Kirim VN</span>
          </button>
        </div>
      ) : (
        <form onSubmit={handleCustomSubmit} className="mb-4 flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tulis pesan penyemangat..."
            maxLength={140}
            className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/50 px-3.5 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white dark:focus:bg-neutral-800 focus:outline-none"
          />
          <button
            type="button"
            onClick={startRecording}
            disabled={isSending}
            className="inline-flex items-center justify-center rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-rose-600 transition-colors shadow-2xs"
            title="Rekam Pesan Suara (Voice Note)"
          >
            <Mic size={15} className="text-rose-500" />
          </button>
          <button
            type="submit"
            disabled={!message.trim() || isSending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-2xs"
          >
            <Send size={13} />
            <span>Kirim</span>
          </button>
        </form>
      )}

      {/* Cheer Feed */}
      {cheers.length > 0 && (
        <div className="space-y-2 border-t border-neutral-100 dark:border-neutral-800 pt-3 max-h-56 overflow-y-auto pr-1">
          <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
            Sorakan & Pesan Suara Terbaru
          </p>
          <div className="space-y-1.5">
            {cheers.slice(0, 15).map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-2.5 rounded-xl bg-neutral-50/90 dark:bg-neutral-800/70 p-2.5 text-xs transition-colors"
              >
                <span className="text-lg select-none shrink-0">{c.emoji || "👏"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-800 dark:text-neutral-200 truncate">
                      {c.senderName}
                    </span>
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">
                      {new Date(c.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  {/* Voice note audio player */}
                  {c.audioData ? (
                    <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-900/60 p-1.5">
                      <button
                        type="button"
                        onClick={() => togglePlayAudio(c.id, c.audioData!)}
                        className="flex size-6 items-center justify-center rounded-full bg-emerald-600 text-white shadow-2xs hover:bg-emerald-700 transition-transform active:scale-90"
                      >
                        {playingAudioId === c.id ? <Pause size={11} /> : <Play size={11} className="ml-0.5" />}
                      </button>
                      <div className="flex-1 flex items-center gap-1.5">
                        <Volume2 size={13} className="text-emerald-600 dark:text-emerald-400" />
                        <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                          {c.durationSeconds ? `${c.durationSeconds} detik` : "Pesan Suara"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    c.message && (
                      <p className="mt-0.5 text-neutral-600 dark:text-neutral-300 break-words leading-relaxed">
                        {c.message}
                      </p>
                    )
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
