"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BatteryMedium,
  BatteryWarning,
  ChevronDown,
  ChevronUp,
  Clock3,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  Gauge,
  MapPin,
  Mountain,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Route,
  Share2,
  ShieldAlert,
  Signal,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import { TrackingMap } from "./tracking-map";
import { ElevationProfile } from "./elevation-profile";
import { WeatherCard } from "./weather-card";
import { CheerSection } from "./cheer-section";
import type { Session, Location, RouteData, Viewer, Cheer } from "../lib/tracking-store";

interface LiveTrackerViewProps {
  token: string;
  initialSession: Session | null;
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function LiveTrackerView({ token, initialSession }: LiveTrackerViewProps) {
  const [session, setSession] = useState<Session | null>(initialSession);
  const [visitorId, setVisitorId] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("Penonton");
  const [isEditingName, setIsEditingName] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCoords, setCopiedCoords] = useState(false);

  // Theme Mode (Dark / Light)
  const [isDark, setIsDark] = useState(false);

  // Full-page viewport layout states (No page scrolling)
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showElevationDock, setShowElevationDock] = useState(false);
  const [desktopTab, setDesktopTab] = useState<"cheers" | "stats">("cheers");
  const [mobileSheet, setMobileSheet] = useState<"none" | "elevation" | "cheers" | "stats">("none");

  // Load theme and save last live session token
  useEffect(() => {
    // 1. Initialize theme
    const savedTheme = localStorage.getItem("waymark_theme");
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = savedTheme === "dark" || (!savedTheme && prefersDark);
    setIsDark(shouldBeDark);
    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // 2. Cache current live token for quick instant return
    localStorage.setItem("waymark_last_live_token", token);
  }, [token]);

  useEffect(() => {
    if (session?.eventName) {
      localStorage.setItem("waymark_last_live_title", session.eventName);
    }
  }, [session?.eventName]);

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("waymark_theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("waymark_theme", "light");
      }
      return next;
    });
  };

  // Load / initialize spectator identity
  useEffect(() => {
    let vid = localStorage.getItem("waymark_visitor_id");
    if (!vid) {
      vid = "v_" + Math.random().toString(36).substring(2, 10);
      localStorage.setItem("waymark_visitor_id", vid);
    }
    setVisitorId(vid);

    const savedName = localStorage.getItem("waymark_viewer_name");
    if (savedName && savedName.trim().length > 0) {
      setDisplayName(savedName.trim());
      setNameInput(savedName.trim());
      setShowNameModal(false);
    } else {
      setDisplayName("");
      setNameInput("");
      setShowNameModal(true);
    }
  }, []);

  const handleInitialNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim() || "Penonton";
    setDisplayName(trimmed);
    localStorage.setItem("waymark_viewer_name", trimmed);
    setShowNameModal(false);

    if (visitorId) {
      try {
        await fetch(`/api/tracking/${token}/viewer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId, displayName: trimmed }),
        });
      } catch (_) {}
    }
  };

  // Heartbeat viewer ping (Fast 3-second heartbeat for real-time presence)
  useEffect(() => {
    if (!visitorId || !displayName) return;

    const pingViewer = async () => {
      try {
        await fetch(`/api/tracking/${token}/viewer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId, displayName }),
        });
      } catch (_) {}
    };

    pingViewer();
    const interval = setInterval(pingViewer, 3000);
    return () => clearInterval(interval);
  }, [token, visitorId, displayName]);

  // Polling live session data (2-second interval for instant cheers and metrics)
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/tracking/${token}`);
        if (!res.ok) return;
        const data = await res.json();
        const sessionObj = data.session ?? (data.runnerName ? data : null);
        if (sessionObj) {
          setSession(sessionObj);
        }
      } catch (_) {}
    };

    const interval = setInterval(fetchSession, 2000);
    return () => clearInterval(interval);
  }, [token]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    localStorage.setItem("waymark_viewer_name", trimmed);
    setIsEditingName(false);

    try {
      await fetch(`/api/tracking/${token}/viewer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, displayName: trimmed }),
      });
    } catch (_) {}
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCoords = () => {
    if (!currentPos) return;
    navigator.clipboard.writeText(`${currentPos[1].toFixed(6)}, ${currentPos[0].toFixed(6)}`);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  // Derive coordinates and stats
  const locations = session?.locations ?? [];

  // Filter out low-accuracy cell tower / Wi-Fi drift points (e.g. accuracy > 40m)
  // and anomalous teleportation spikes to keep the runner's path clean, smooth, and accurate.
  const validLocations = useMemo(() => {
    if (locations.length === 0) return [];
    const accurate = locations.filter((loc) => !loc.accuracy || loc.accuracy <= 40);
    // If all fixes had high uncertainty (e.g. initial indoor lock), fallback to raw locations
    const base = accurate.length > 0 ? accurate : locations;

    // Secondary filter: eliminate sharp teleport spikes (teleport out >100m then immediately teleport back)
    if (base.length < 3) return base;
    const smoothed: typeof base = [base[0]];
    for (let i = 1; i < base.length - 1; i++) {
      const prev = smoothed[smoothed.length - 1];
      const curr = base[i];
      const next = base[i + 1];

      const dPrevCurr = distanceMeters(prev.longitude, prev.latitude, curr.longitude, curr.latitude);
      const dCurrNext = distanceMeters(curr.longitude, curr.latitude, next.longitude, next.latitude);
      const dPrevNext = distanceMeters(prev.longitude, prev.latitude, next.longitude, next.latitude);

      // If current point jumps far away while prev and next are close together, it's a spike
      if (dPrevCurr > 150 && dCurrNext > 150 && dPrevNext < 60) {
        continue; // drop spike
      }
      smoothed.push(curr);
    }
    smoothed.push(base[base.length - 1]);
    return smoothed;
  }, [locations]);

  const latestLocation = validLocations.length > 0 ? validLocations[validLocations.length - 1] : null;

  const currentPos: [number, number] | null = latestLocation
    ? [latestLocation.longitude, latestLocation.latitude]
    : null;

  const trackCoords: [number, number][] = useMemo(() => {
    return validLocations.map((loc) => [loc.longitude, loc.latitude]);
  }, [validLocations]);

  let routeCoords: [number, number][] = [];
  if (session?.route?.routeGeojson?.geometry?.coordinates) {
    routeCoords = session.route.routeGeojson.geometry.coordinates as [number, number][];
  }

  // Off-Course Detection
  const offCourseMeters = useMemo(() => {
    if (!currentPos || routeCoords.length < 2) return 0;
    let minD = Infinity;
    const step = Math.max(1, Math.floor(routeCoords.length / 500));
    for (let i = 0; i < routeCoords.length; i += step) {
      const d = distanceMeters(currentPos[0], currentPos[1], routeCoords[i][0], routeCoords[i][1]);
      if (d < minD) minD = d;
    }
    return Math.round(minD);
  }, [currentPos, routeCoords]);

  const isOffCourse = offCourseMeters > 300;
  const isFarOffCourse = offCourseMeters > 1000;

  const isLive = session ? session.status === "live" : true;
  const runnerName = session?.runnerName ?? "Waymark Runner";
  const eventName = session?.eventName ?? "Live Trail Run";

  const totalDistance = session?.route?.totalDistance
    ? `${session.route.totalDistance} km`
    : "-";

  const elevationGain = session?.route?.elevationGain
    ? `${session.route.elevationGain} m`
    : "—";

  const batteryLevel = latestLocation?.battery ?? 100;
  const batteryColor =
    batteryLevel <= 20
      ? "text-rose-600 bg-rose-50 border-rose-200"
      : batteryLevel <= 45
      ? "text-amber-600 bg-amber-50 border-amber-200"
      : "text-emerald-700 bg-emerald-50 border-emerald-200";

  const speedMps = latestLocation?.speed ?? 0;
  const speedKmh = speedMps * 3.6;
  const paceStr = useMemo(() => {
    if (speedKmh < 0.5) return "Diam / Istirahat";
    const paceMinTotal = 60 / speedKmh;
    const paceMin = Math.floor(paceMinTotal);
    const paceSec = Math.round((paceMinTotal - paceMin) * 60);
    return `${paceMin}'${paceSec.toString().padStart(2, "0")}" /km`;
  }, [speedKmh]);

  const lastUpdateText = useMemo(() => {
    if (!latestLocation) return "Menunggu pelacakan";
    const d = new Date(latestLocation.recordedAt);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, [latestLocation]);

  const isEmergencySos = session?.isSos || latestLocation?.isSos;

  return (
    <main className="h-screen h-[100dvh] w-screen overflow-hidden flex flex-col bg-[#fbfbfa] dark:bg-[#0b0f17] text-neutral-900 dark:text-neutral-100 select-none transition-colors">
      {/* 0. WELCOME / SPECTATOR NAME MODAL (Shown automatically on first visit) */}
      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-neutral-900 p-6 shadow-2xl border border-neutral-200 dark:border-neutral-800 text-center animate-in zoom-in-95 duration-200">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mb-4">
              <Users size={28} />
            </div>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
              Pantau Live Tracking
            </h2>
            <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              Masukkan nama Anda agar <strong>{runnerName}</strong> tahu siapa yang sedang memantau & menyemangatinya di lintasan.
            </p>

            <form onSubmit={handleInitialNameSubmit} className="mt-5 space-y-3">
              <input
                type="text"
                autoFocus
                required
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Nama Anda (contoh: Budi / Kakak)"
                maxLength={40}
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-4 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white dark:focus:bg-neutral-850 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!nameInput.trim()}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                Simpan & Mulai Nonton
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 1. TOP NAVBAR (Sleek, h-14, Zero page scroll) */}
      <header className="h-14 shrink-0 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md border-b border-neutral-200/90 dark:border-neutral-800 px-4 sm:px-6 flex items-center justify-between z-30 shadow-xs transition-colors">
        {/* Left: Brand + Runner Info */}
        <div className="flex items-center gap-3">
          <Brand />
          <div className="h-5 w-px bg-neutral-200 dark:bg-neutral-800 hidden sm:block" />
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                isEmergencySos
                  ? "bg-rose-600 text-white animate-pulse"
                  : isLive
                  ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                  : "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  isEmergencySos ? "bg-white" : isLive ? "bg-emerald-500 animate-ping" : "bg-neutral-400"
                }`}
              />
              {isEmergencySos ? "SOS AKTIF" : isLive ? "LIVE" : "SELESAI"}
            </span>

            <div className="hidden md:flex flex-col">
              <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 leading-tight">
                {runnerName}
              </span>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate max-w-[200px]">
                {eventName}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Live HUD Metrics (Desktop/Tablet) */}
        <div className="hidden lg:flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-neutral-100/80 dark:bg-neutral-800/80 px-2.5 py-1 text-xs">
            <Gauge size={13} className="text-emerald-600 dark:text-emerald-400" />
            <span className="text-neutral-500 dark:text-neutral-400">Pace:</span>
            <strong className="text-neutral-900 dark:text-neutral-100">{paceStr}</strong>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg bg-neutral-100/80 dark:bg-neutral-800/80 px-2.5 py-1 text-xs">
            <Mountain size={13} className="text-emerald-600 dark:text-emerald-400" />
            <span className="text-neutral-500 dark:text-neutral-400">Alt:</span>
            <strong className="text-neutral-900 dark:text-neutral-100">
              {latestLocation?.altitude ? `${Math.round(latestLocation.altitude)}m` : "—"}
            </strong>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${batteryColor}`}
          >
            {batteryLevel <= 20 ? <BatteryWarning size={13} /> : <BatteryMedium size={13} />}
            <span>{batteryLevel}%</span>
          </div>

          {session?.route && (
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 text-xs text-emerald-900 dark:text-emerald-300">
              <Compass size={13} className="text-emerald-600 dark:text-emerald-400" />
              <span>Rute: <strong>{totalDistance}</strong></span>
            </div>
          )}
        </div>

        {/* Right: Spectators + Share + Theme Toggle + Toggle Sidebar */}
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">
            <Eye size={13} className="text-emerald-600 dark:text-emerald-400" />
            <span>{session?.activeViewerCount ?? 1}</span>
            <span className="hidden sm:inline text-neutral-400 dark:text-neutral-500">penonton</span>
          </div>

          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-xs transition-colors"
          >
            <Share2 size={13} />
            <span className="hidden sm:inline">{copiedLink ? "Tersalin!" : "Bagikan"}</span>
          </button>

          {/* Theme Toggle Button */}
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center justify-center size-8 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors"
            title={isDark ? "Ganti ke Mode Terang" : "Ganti ke Mode Gelap"}
          >
            {isDark ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} />}
          </button>

          {/* Desktop Sidebar Toggle */}
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="hidden lg:inline-flex items-center justify-center size-8 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors"
            title={sidebarOpen ? "Sembunyikan Panel Samping" : "Tampilkan Panel Samping"}
          >
            {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>

      {/* 2. ALERT TICKER (SOS or Off-Course Warning) */}
      {isEmergencySos && (
        <div className="bg-rose-600 px-4 py-2 text-white shrink-0 flex items-center justify-between text-xs z-20">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert size={16} className="text-white shrink-0 animate-bounce" />
            <span>🚨 PERINGATAN DARURAT (SOS AKTIF): Pelari membutuhkan bantuan segera!</span>
          </div>
          {currentPos && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCoords}
                className="bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-[11px] font-medium"
              >
                {copiedCoords ? "Tersalin!" : "Salin GPS"}
              </button>
              <a
                href={`https://maps.google.com/?q=${currentPos[1]},${currentPos[0]}`}
                target="_blank"
                rel="noreferrer"
                className="bg-white text-rose-700 font-bold px-2 py-0.5 rounded text-[11px] hover:bg-rose-50"
              >
                Google Maps
              </a>
            </div>
          )}
        </div>
      )}

      {!isEmergencySos && isOffCourse && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-300 dark:bg-amber-950/60 dark:border-amber-900/60 px-4 py-1.5 shrink-0 flex items-center gap-2 text-xs font-medium z-20 backdrop-blur-xs">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            {isFarOffCourse
              ? `Pelari belum berada di lintasan rute (~${(offCourseMeters / 1000).toFixed(1)} km dari jalur resmi).`
              : `Pelari terdeteksi melenceng ~${offCourseMeters} meter dari rute resmi GPX.`}
          </span>
        </div>
      )}

      {/* 3. MAIN WORKSPACE: MAP (Left) + DOCKABLE ELEVATION + SIDEBAR (Right) */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* Map Canvas Viewport (100% Full Height & Width) */}
        <div className="flex-1 relative h-full w-full overflow-hidden">
          <TrackingMap
            routeCoordinates={routeCoords}
            trackCoordinates={trackCoords}
            currentPosition={currentPos}
            isStopped={!isLive}
            className="relative h-full w-full overflow-hidden"
          />

          {/* Floating Pill Switcher on Mobile (<lg) */}
          <div className="lg:hidden absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full bg-white/95 dark:bg-neutral-900/95 p-1 shadow-lg backdrop-blur-md border border-neutral-200/90 dark:border-neutral-800 text-xs font-semibold">
            <button
              onClick={() => setMobileSheet("none")}
              className={`px-3 py-1.5 rounded-full transition-all ${
                mobileSheet === "none"
                  ? "bg-neutral-900 dark:bg-emerald-600 text-white shadow-xs"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              🗺️ Peta
            </button>
            {session?.route && (
              <button
                onClick={() => setMobileSheet("elevation")}
                className={`px-3 py-1.5 rounded-full transition-all ${
                  mobileSheet === "elevation"
                    ? "bg-neutral-900 dark:bg-emerald-600 text-white shadow-xs"
                    : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                ⛰️ Elevasi
              </button>
            )}
            <button
              onClick={() => setMobileSheet("cheers")}
              className={`px-3 py-1.5 rounded-full transition-all ${
                mobileSheet === "cheers"
                  ? "bg-neutral-900 dark:bg-emerald-600 text-white shadow-xs"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              🎉 ({session?.cheers?.length ?? 0})
            </button>
            <button
              onClick={() => setMobileSheet("stats")}
              className={`px-3 py-1.5 rounded-full transition-all ${
                mobileSheet === "stats"
                  ? "bg-neutral-900 dark:bg-emerald-600 text-white shadow-xs"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              📊 Info
            </button>
            <button
              onClick={toggleTheme}
              className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
              title="Ganti Tema"
            >
              {isDark ? "☀️" : "🌙"}
            </button>
          </div>

          {/* Desktop Floating Collapsible Elevation Profile Dock (Bottom of map) */}
          {session?.route && (
            <div className="hidden lg:block absolute inset-x-6 bottom-4 z-20 pointer-events-none">
              <div className="pointer-events-auto max-w-4xl mx-auto rounded-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md border border-neutral-200/90 dark:border-neutral-800 shadow-xl overflow-hidden transition-all duration-300">
                <div
                  onClick={() => setShowElevationDock((prev) => !prev)}
                  className="flex items-center justify-between px-4 py-2.5 cursor-pointer bg-neutral-50/80 dark:bg-neutral-800/80 hover:bg-neutral-100/80 dark:hover:bg-neutral-700/80 transition-colors border-b border-neutral-200/50 dark:border-neutral-700/50"
                >
                  <div className="flex items-center gap-2">
                    <Mountain size={16} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                      Profil Elevasi & Kontur Jalur ({totalDistance})
                    </span>
                    {isOffCourse && (
                      <span className="text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold px-2 py-0.5 rounded-full">
                        Di Luar Jalur (~{(offCourseMeters / 1000).toFixed(1)} km)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                    <span>{showElevationDock ? "Sembunyikan" : "Buka Profil"}</span>
                    {showElevationDock ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </div>
                </div>

                {showElevationDock && (
                  <div className="p-4 max-h-[260px] overflow-hidden">
                    <ElevationProfile
                      routeGeojson={session.route.routeGeojson}
                      totalDistance={session.route.totalDistance}
                      elevationGain={session.route.elevationGain}
                      currentPos={currentPos}
                      currentAltitude={
                        latestLocation?.altitude ? Math.round(latestLocation.altitude) : undefined
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mobile Slide-Up Modal Sheets (Full Viewport, Zero page scroll) */}
          {mobileSheet !== "none" && (
            <div className="lg:hidden absolute inset-0 bg-black/50 backdrop-blur-xs z-30 flex flex-col justify-end">
              <div className="bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl max-h-[82vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-200 border-t border-neutral-200 dark:border-slate-800">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    {mobileSheet === "elevation" && <Mountain size={18} className="text-emerald-600 dark:text-emerald-400" />}
                    {mobileSheet === "cheers" && <Sparkles size={18} className="text-emerald-600 dark:text-emerald-400" />}
                    {mobileSheet === "stats" && <Gauge size={18} className="text-emerald-600 dark:text-emerald-400" />}
                    <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                      {mobileSheet === "elevation" && "Profil Elevasi & Jalur Gunung"}
                      {mobileSheet === "cheers" && `Sorakan Penonton (${session?.cheers?.length ?? 0})`}
                      {mobileSheet === "stats" && "Rincian Info & Statistik Pelari"}
                    </h3>
                  </div>
                  <button
                    onClick={() => setMobileSheet("none")}
                    className="p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-slate-800"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Modal Content */}
                <div className="flex-1 overflow-y-auto p-5">
                  {mobileSheet === "elevation" && session?.route && (
                    <ElevationProfile
                      routeGeojson={session.route.routeGeojson}
                      totalDistance={session.route.totalDistance}
                      elevationGain={session.route.elevationGain}
                      currentPos={currentPos}
                      currentAltitude={
                        latestLocation?.altitude ? Math.round(latestLocation.altitude) : undefined
                      }
                    />
                  )}

                  {mobileSheet === "cheers" && (
                    <CheerSection
                      token={token}
                      spectatorName={displayName}
                      cheers={session?.cheers ?? []}
                      onCheerSent={(newCheer) => {
                        setSession((prev) =>
                          prev
                            ? {
                                ...prev,
                                cheers: [newCheer, ...(prev.cheers ?? [])],
                              }
                            : null
                        );
                      }}
                    />
                  )}

                  {mobileSheet === "stats" && (
                    <div className="space-y-4">
                      {currentPos && (
                        <WeatherCard latitude={currentPos[1]} longitude={currentPos[0]} />
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-neutral-50 dark:bg-slate-800/80 p-3 border border-neutral-100 dark:border-slate-700/60">
                          <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-slate-400">
                            <Gauge size={14} className="text-emerald-600 dark:text-emerald-400" />
                            Pace Real-Time
                          </span>
                          <p className="mt-1 text-base font-bold text-neutral-900 dark:text-white">{paceStr}</p>
                          <p className="text-[11px] text-neutral-400 dark:text-slate-400">
                            {speedKmh > 0.5 ? `${speedKmh.toFixed(1)} km/h` : "Diam"}
                          </p>
                        </div>

                        <div className="rounded-xl bg-neutral-50 dark:bg-slate-800/80 p-3 border border-neutral-100 dark:border-slate-700/60">
                          <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-slate-400">
                            <Mountain size={14} className="text-emerald-600 dark:text-emerald-400" />
                            Ketinggian
                          </span>
                          <p className="mt-1 text-base font-bold text-neutral-900 dark:text-white">
                            {latestLocation?.altitude
                              ? `${Math.round(latestLocation.altitude)} mdpl`
                              : "—"}
                          </p>
                          <p className="text-[11px] text-neutral-400 dark:text-slate-400">di atas permukaan laut</p>
                        </div>
                      </div>

                      <div className="rounded-xl bg-neutral-50 dark:bg-slate-800/80 p-3 border border-neutral-100 dark:border-slate-700/60">
                        <p className="text-xs text-neutral-500 dark:text-slate-400">Total Jarak Resmi Rute</p>
                        <p className="text-xl font-bold text-neutral-900 dark:text-white">{totalDistance}</p>
                        {elevationGain !== "—" && (
                          <p className="text-xs text-neutral-500 dark:text-slate-400 mt-1">
                            Total Tanjakan (D+): <strong className="text-neutral-900 dark:text-white">+{elevationGain}</strong>
                          </p>
                        )}
                      </div>

                      {/* Spectators List */}
                      <div className="rounded-xl border border-neutral-100 dark:border-slate-700/60 p-3 bg-white dark:bg-slate-800/80">
                        <p className="text-xs font-bold text-neutral-800 dark:text-slate-200 mb-2">
                          Penonton Terhubung ({session?.viewers?.length ?? 0}):
                        </p>
                        <div className="divide-y divide-neutral-50 dark:divide-slate-700/40 text-xs">
                          {session?.viewers?.map((v) => (
                            <div key={v.visitorId} className="py-1.5 flex items-center justify-between">
                              <span className="font-medium text-neutral-800 dark:text-slate-200">{v.displayName}</span>
                              <span className="text-[10px] text-neutral-400 dark:text-slate-400">
                                {v.isOnline ? "Online" : "Offline"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Desktop Collapsible Right Sidebar (w-[380px], Zero page scroll) */}
        {sidebarOpen && (
          <aside className="w-[380px] xl:w-[420px] shrink-0 h-full bg-white dark:bg-slate-900 border-l border-neutral-200/90 dark:border-slate-800 flex flex-col z-20 shadow-xl overflow-hidden hidden lg:flex transition-colors">
            {/* Sidebar Tab Header */}
            <div className="h-12 shrink-0 border-b border-neutral-200 dark:border-slate-800 px-4 flex items-center justify-between bg-neutral-50/50 dark:bg-slate-900/90">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDesktopTab("cheers")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    desktopTab === "cheers"
                      ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-2xs border border-neutral-200/80 dark:border-slate-700"
                      : "text-neutral-500 dark:text-slate-400 hover:text-neutral-900 dark:hover:text-slate-100"
                  }`}
                >
                  🎉 Sorakan ({session?.cheers?.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setDesktopTab("stats")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    desktopTab === "stats"
                      ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-2xs border border-neutral-200/80 dark:border-slate-700"
                      : "text-neutral-500 dark:text-slate-400 hover:text-neutral-900 dark:hover:text-slate-100"
                  }`}
                >
                  📊 Statistik & Cuaca
                </button>
              </div>

              {/* Spectator Name Editor Button */}
              {isEditingName ? (
                <form onSubmit={handleSaveName} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Nama Anda..."
                    className="h-6 w-24 rounded border border-neutral-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white px-1.5 text-[11px] focus:outline-none"
                    autoFocus
                  />
                  <button type="submit" className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded font-medium">
                    OK
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  className="text-[11px] text-neutral-500 dark:text-slate-400 hover:text-neutral-900 dark:hover:text-slate-200 truncate max-w-[120px]"
                  title="Ubah nama penonton Anda"
                >
                  Sebagai: <strong className="text-emerald-700 dark:text-emerald-400">{displayName}</strong>
                </button>
              )}
            </div>

            {/* Sidebar Tab Contents (Independently scrollable without affecting full-page) */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {desktopTab === "cheers" && (
                <>
                  <CheerSection
                    token={token}
                    spectatorName={displayName}
                    cheers={session?.cheers ?? []}
                    onCheerSent={(newCheer) => {
                      setSession((prev) =>
                        prev
                          ? {
                              ...prev,
                              cheers: [newCheer, ...(prev.cheers ?? [])],
                            }
                          : null
                      );
                    }}
                  />

                  {/* Spectators Section */}
                  <div className="rounded-2xl border border-neutral-200/80 dark:border-slate-800 bg-neutral-50/50 dark:bg-slate-800/60 p-4 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Users size={15} className="text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs font-bold text-neutral-800 dark:text-slate-200 uppercase tracking-wider">
                          Penonton Live ({session?.activeViewerCount ?? 1})
                        </span>
                      </div>
                      <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                    </div>

                    <div className="divide-y divide-neutral-100 dark:divide-slate-700/50 text-xs">
                      {session?.viewers && session.viewers.length > 0 ? (
                        session.viewers.map((v) => (
                          <div key={v.visitorId} className="flex items-center justify-between py-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`size-2 rounded-full ${
                                  v.isOnline ? "bg-emerald-500" : "bg-neutral-300 dark:bg-slate-600"
                                }`}
                              />
                              <span className="font-medium text-neutral-800 dark:text-slate-200">{v.displayName}</span>
                              {v.visitorId === visitorId && (
                                <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-[10px] px-1 py-0.2 rounded font-semibold">
                                  Anda
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-neutral-400 dark:text-slate-500">
                              {v.isOnline ? "Online" : "Offline"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="py-2 text-xs text-neutral-400 dark:text-slate-500">Belum ada penonton lain.</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {desktopTab === "stats" && (
                <div className="space-y-4">
                  {currentPos && (
                    <WeatherCard latitude={currentPos[1]} longitude={currentPos[0]} />
                  )}

                  <div className="rounded-2xl border border-neutral-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/60 p-4 shadow-2xs space-y-3 transition-colors">
                    <p className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-slate-400">
                      Metrik Live Pelari
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-neutral-50 dark:bg-slate-900/60 p-3 border border-neutral-100 dark:border-slate-700/50">
                        <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-slate-400">
                          <Gauge size={14} className="text-emerald-600 dark:text-emerald-400" />
                          Pace Saat Ini
                        </span>
                        <p className="mt-1 text-base font-bold text-neutral-900 dark:text-white">{paceStr}</p>
                        <p className="text-[11px] text-neutral-400 dark:text-slate-400">
                          {speedKmh > 0.5 ? `${speedKmh.toFixed(1)} km/h` : "Diam"}
                        </p>
                      </div>

                      <div className="rounded-xl bg-neutral-50 dark:bg-slate-900/60 p-3 border border-neutral-100 dark:border-slate-700/50">
                        <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-slate-400">
                          <Mountain size={14} className="text-emerald-600 dark:text-emerald-400" />
                          Elevasi
                        </span>
                        <p className="mt-1 text-base font-bold text-neutral-900 dark:text-white">
                          {latestLocation?.altitude
                            ? `${Math.round(latestLocation.altitude)} mdpl`
                            : "—"}
                        </p>
                        <p className="text-[11px] text-neutral-400 dark:text-slate-400">di atas laut</p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-neutral-100 dark:border-slate-700/50 flex items-center justify-between">
                      <div>
                        <p className="text-lg font-bold text-neutral-900 dark:text-white">{totalDistance}</p>
                        <p className="text-xs text-neutral-500 dark:text-slate-400">Total rute resmi</p>
                      </div>
                      <div className="grid size-9 place-items-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                        <Route size={18} />
                      </div>
                    </div>

                    {elevationGain !== "—" && (
                      <p className="text-xs text-neutral-500 dark:text-slate-400">
                        Total tanjakan (D+): <strong className="text-neutral-900 dark:text-white">+{elevationGain}</strong>
                      </p>
                    )}
                  </div>

                  {/* GPS Coordinates card */}
                  <div className="rounded-2xl border border-neutral-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/60 p-4 text-xs space-y-2 transition-colors">
                    <p className="font-bold text-neutral-700 dark:text-slate-200 flex items-center gap-1.5">
                      <Signal size={14} className="text-emerald-600 dark:text-emerald-400" />
                      Status Pembaruan Satelit
                    </p>
                    <p className="text-neutral-500 dark:text-slate-400">
                      Koordinat:{" "}
                      <strong className="text-neutral-800 dark:text-slate-200">
                        {currentPos
                          ? `${currentPos[1].toFixed(5)}, ${currentPos[0].toFixed(5)}`
                          : "—"}
                      </strong>
                    </p>
                    <p className="text-neutral-400 dark:text-slate-500 text-[11px]">Terakhir: {lastUpdateText}</p>
                    {currentPos && (
                      <button
                        type="button"
                        onClick={handleCopyCoords}
                        className="inline-flex items-center gap-1 rounded bg-neutral-100 dark:bg-slate-700 hover:bg-neutral-200 dark:hover:bg-slate-600 px-2 py-1 text-[11px] font-semibold text-neutral-700 dark:text-slate-200 transition-colors"
                      >
                        <Copy size={11} />
                        {copiedCoords ? "Tersalin!" : "Salin Koordinat"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
