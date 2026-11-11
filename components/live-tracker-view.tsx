"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  BatteryMedium,
  BatteryWarning,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  Footprints,
  Gauge,
  Mountain,
  Radio,
  Route,
  Share2,
  ShieldAlert,
  Signal,
  TrendingUp,
  Users,
} from "lucide-react";
import { Header } from "./brand";
import { TrackingMap } from "./tracking-map";
import { ElevationProfile } from "./elevation-profile";
import { WeatherCard } from "./weather-card";
import { CheerSection } from "./cheer-section";

interface Location {
  latitude: number;
  longitude: number;
  accuracy: number;
  battery: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  isSos?: boolean;
  recordedAt: string;
}

interface RouteData {
  routeGeojson: any;
  totalDistance: number;
  elevationGain?: number;
}

interface Viewer {
  visitorId: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  isOnline: boolean;
}

interface Cheer {
  id: string;
  senderName: string;
  message?: string;
  emoji?: string;
  createdAt: string;
}

interface SessionData {
  runnerName: string;
  eventName: string;
  status: "draft" | "live" | "stopped" | "revoked";
  startedAt: string;
  finishedAt?: string | null;
  locations?: Location[];
  latestLocation?: Location | null;
  route?: RouteData | null;
  viewers?: Viewer[];
  activeViewerCount?: number;
  cheers?: Cheer[];
  isSos?: boolean;
}

interface LiveTrackerViewProps {
  token: string;
  initialSession: SessionData | null;
}

function distanceMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function LiveTrackerView({
  token,
  initialSession,
}: LiveTrackerViewProps) {
  const [session, setSession] = useState<SessionData | null>(initialSession);
  const [lastUpdateText, setLastUpdateText] = useState("Just now");
  const [visitorId, setVisitorId] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [copiedCoords, setCopiedCoords] = useState(false);

  // Initialize spectator identity from localStorage
  useEffect(() => {
    let vid = localStorage.getItem("waymark_visitor_id");
    if (!vid) {
      vid = "v_" + Math.random().toString(36).substring(2, 10);
      localStorage.setItem("waymark_visitor_id", vid);
    }
    setVisitorId(vid);

    const savedName =
      localStorage.getItem("waymark_display_name") ||
      `Penonton #${vid.slice(-4)}`;
    setDisplayName(savedName);
    setNameInput(savedName);
  }, []);

  // Spectator heartbeat every 10 seconds to register viewer
  useEffect(() => {
    if (!visitorId || !token) return;

    const sendHeartbeat = async () => {
      try {
        await fetch(`/api/tracking/${token}/viewer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId, displayName }),
        });
      } catch (_) {}
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 10000);
    return () => clearInterval(interval);
  }, [token, visitorId, displayName]);

  const handleSaveName = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!nameInput.trim()) return;
    const clean = nameInput.trim();
    setDisplayName(clean);
    localStorage.setItem("waymark_display_name", clean);
    setIsEditingName(false);

    fetch(`/api/tracking/${token}/viewer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId, displayName: clean }),
    }).catch(() => {});
  };

  // Real-time polling every 3 seconds for fresh GPS data, cheers, & viewers
  useEffect(() => {
    let isMounted = true;

    const fetchLatest = async () => {
      try {
        const res = await fetch(`/api/tracking/${token}`);
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data) {
          setSession((prev) => ({
            ...prev,
            ...data,
          }));
          setLastUpdateText(new Date().toLocaleTimeString());
        }
      } catch (_) {}
    };

    const interval = setInterval(fetchLatest, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [token]);

  const eventName = session?.eventName || "Live Trail Session";
  const runnerName = session?.runnerName || "Waymark Runner";
  const isLive = session ? session.status === "live" : true;

  const totalDistance = session?.route?.totalDistance
    ? `${session.route.totalDistance} km`
    : "—";

  const elevationGain = session?.route?.elevationGain
    ? `${session.route.elevationGain} m`
    : "—";

  const locations = session?.locations ?? [];
  const latestLocation = session?.latestLocation ?? locations.at(-1);

  // Extract official route coordinates
  let routeCoords: [number, number][] = [];
  if (session?.route?.routeGeojson?.geometry?.coordinates) {
    routeCoords = session.route.routeGeojson.geometry.coordinates as [
      number,
      number,
    ][];
  }

  // Extract actual recorded track coordinates
  const trackCoords: [number, number][] = locations.map((loc) => [
    loc.longitude,
    loc.latitude,
  ]);

  // Current real-time position
  const currentPos: [number, number] | null = latestLocation
    ? [latestLocation.longitude, latestLocation.latitude]
    : null;

  // Off-Course Detection
  const offCourseMeters = useMemo(() => {
    if (!currentPos || routeCoords.length < 2) return 0;
    let minD = Infinity;
    // Step through route points
    const step = Math.max(1, Math.floor(routeCoords.length / 500));
    for (let i = 0; i < routeCoords.length; i += step) {
      const d = distanceMeters(currentPos[0], currentPos[1], routeCoords[i][0], routeCoords[i][1]);
      if (d < minD) minD = d;
    }
    return Math.round(minD);
  }, [currentPos, routeCoords]);

  const isOffCourse = offCourseMeters > 75;

  // Inactivity detection: > 15 minutes without location update while live
  const lastRecordedMs = latestLocation ? new Date(latestLocation.recordedAt).getTime() : 0;
  const isInactive =
    isLive && lastRecordedMs > 0 && Date.now() - lastRecordedMs > 15 * 60 * 1000;

  // Battery calculations
  const batteryLevel = latestLocation?.battery ?? 100;
  const batteryColor =
    batteryLevel <= 20
      ? "text-rose-600 bg-rose-50 border-rose-200"
      : batteryLevel <= 45
      ? "text-amber-600 bg-amber-50 border-amber-200"
      : "text-emerald-700 bg-emerald-50 border-emerald-200";

  // Speed / Pace calculation
  const speedMps = latestLocation?.speed ?? 0;
  const speedKmh = speedMps * 3.6;
  const paceStr = useMemo(() => {
    if (speedKmh < 0.5) return "Diam / Istirahat";
    const paceMinTotal = 60 / speedKmh;
    const paceMin = Math.floor(paceMinTotal);
    const paceSec = Math.round((paceMinTotal - paceMin) * 60);
    return `${paceMin}'${paceSec.toString().padStart(2, "0")}" /km`;
  }, [speedKmh]);

  const handleCopyCoords = () => {
    if (!currentPos) return;
    navigator.clipboard.writeText(`${currentPos[1].toFixed(6)}, ${currentPos[0].toFixed(6)}`);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  const isEmergencySos = session?.isSos || latestLocation?.isSos;

  return (
    <main className="min-h-screen bg-[#fbfbfa]">
      <Header action="Share tracking" />

      {/* EMERGENCY SOS BANNER */}
      {isEmergencySos && (
        <div className="bg-rose-600 px-5 py-4 text-white shadow-lg animate-pulse">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                <ShieldAlert size={24} className="text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-wide">
                  🚨 PERINGATAN DARURAT (SOS AKTIF)
                </h2>
                <p className="text-xs text-rose-100">
                  Pelari {runnerName} telah mengaktifkan sinyal bantuan darurat di jalur trail!
                  {currentPos && ` Lokasi GPS: ${currentPos[1].toFixed(5)}, ${currentPos[0].toFixed(5)}`}
                </p>
              </div>
            </div>

            {currentPos && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCoords}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/30 transition-colors"
                >
                  <Copy size={13} />
                  <span>{copiedCoords ? "Tersalin!" : "Salin Koordinat"}</span>
                </button>
                <a
                  href={`https://maps.google.com/?q=${currentPos[1]},${currentPos[0]}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 shadow-sm transition-colors"
                >
                  <ExternalLink size={13} />
                  <span>Buka di Google Maps</span>
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* OFF-COURSE WARNING BANNER */}
      {!isEmergencySos && isOffCourse && (
        <div className="bg-amber-500 px-5 py-2.5 text-amber-950 font-medium text-xs border-b border-amber-600/20">
          <div className="mx-auto flex max-w-[1440px] items-center gap-2">
            <AlertTriangle size={16} className="text-amber-950 shrink-0" />
            <span>
              <strong>Perhatian:</strong> Pelari terdeteksi melenceng sejauh{" "}
              <strong>~{offCourseMeters} meter</strong> dari rute resmi GPX. Pastikan pelari tetap berada di jalur yang benar.
            </span>
          </div>
        </div>
      )}

      {/* INACTIVITY WARNING BANNER */}
      {!isEmergencySos && isInactive && (
        <div className="bg-sky-50 px-5 py-2.5 text-sky-900 font-medium text-xs border-b border-sky-200">
          <div className="mx-auto flex max-w-[1440px] items-center gap-2">
            <Clock3 size={16} className="text-sky-600 shrink-0" />
            <span>
              Pelari belum memperbarui koordinat selama lebih dari 15 menit (mungkin sedang berada di area tanpa sinyal atau sedang beristirahat).
            </span>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1440px] px-5 py-6 sm:px-8">
        {/* HEADER SECTION */}
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                  isLive
                    ? "border-[#d6e7dc] bg-[#f6fbf8] text-[#168654]"
                    : "border-[#eaeaea] bg-[#f2f2f2] text-[#666]"
                }`}
              >
                <span
                  className={`size-2 rounded-full ${
                    isLive ? "animate-pulse bg-[#22A06B]" : "bg-[#999]"
                  }`}
                />
                {isLive ? "LIVE TRACKING" : "STOPPED"}
              </div>

              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                <Eye size={13} className="text-emerald-600" />
                <span>{session?.activeViewerCount ?? 1} Penonton Aktif</span>
              </div>

              {/* Runner Battery Badge */}
              {latestLocation && (
                <div
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${batteryColor}`}
                >
                  {batteryLevel <= 20 ? (
                    <BatteryWarning size={14} />
                  ) : (
                    <BatteryMedium size={14} />
                  )}
                  <span>Baterai Pelari: {batteryLevel}%</span>
                </div>
              )}
            </div>

            <h1 className="text-3xl font-semibold tracking-[-.045em] text-neutral-900 sm:text-4xl">
              {eventName}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {runnerName} · Pelacakan langsung rute gunung & trail
            </p>

            {/* Spectator Identity Bar */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-neutral-500">Anda memantau sebagai:</span>
              {isEditingName ? (
                <form
                  onSubmit={handleSaveName}
                  className="inline-flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Nama Anda..."
                    className="h-7 w-36 rounded-md border border-neutral-300 px-2 text-xs text-neutral-900 focus:border-emerald-600 focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="h-7 rounded-md bg-emerald-600 px-2.5 font-medium text-white hover:bg-emerald-700"
                  >
                    Simpan
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingName(false)}
                    className="h-7 rounded-md px-1.5 text-neutral-500 hover:text-neutral-700"
                  >
                    Batal
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 font-semibold text-neutral-800 border border-neutral-200 hover:border-emerald-500 shadow-2xs transition-colors"
                  title="Klik untuk mengubah nama Anda agar pelari tahu siapa yang memantau"
                >
                  <span>{displayName || "Tamu"}</span>
                  <span className="text-[10px] text-emerald-600 font-normal">✎ Ubah</span>
                </button>
              )}
            </div>
          </div>

          {/* Weather & GPS signal info */}
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center lg:items-end">
            {currentPos && (
              <WeatherCard latitude={currentPos[1]} longitude={currentPos[0]} />
            )}
            <div className="flex flex-col items-start gap-0.5 sm:items-end">
              <p className="flex items-center gap-1.5 text-xs text-neutral-600">
                <Signal
                  size={14}
                  className={isLive ? "text-emerald-500" : "text-neutral-400"}
                />
                {currentPos
                  ? `GPS: ${currentPos[1].toFixed(5)}, ${currentPos[0].toFixed(5)}`
                  : "Menunggu sinyal GPS..."}
              </p>
              <p className="text-[11px] text-neutral-400">Pembaruan: {lastUpdateText}</p>
            </div>
          </div>
        </div>

        {/* MAIN GRID */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            {/* Interactive Map */}
            <TrackingMap
              routeCoordinates={routeCoords}
              trackCoordinates={trackCoords}
              currentPosition={currentPos}
              isStopped={!isLive}
            />

            {/* Interactive Mountain Elevation Profile */}
            {session?.route && (
              <ElevationProfile
                routeGeojson={session.route.routeGeojson}
                totalDistance={session.route.totalDistance}
                elevationGain={session.route.elevationGain}
                currentPos={currentPos}
                currentAltitude={latestLocation?.altitude ? Math.round(latestLocation.altitude) : undefined}
              />
            )}
          </div>

          {/* SIDEBAR */}
          <aside className="space-y-4">
            {/* Cheer Section */}
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

            {/* Live Runner Performance Card */}
            <section className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-[.13em] text-neutral-400">
                Statistik Pelari Real-Time
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-100">
                  <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                    <Gauge size={14} className="text-emerald-600" />
                    Pace Saat Ini
                  </span>
                  <p className="mt-1 text-base font-bold text-neutral-900">
                    {paceStr}
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    {speedKmh > 0.5 ? `${speedKmh.toFixed(1)} km/h` : "Tidak bergerak"}
                  </p>
                </div>

                <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-100">
                  <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                    <Mountain size={14} className="text-emerald-600" />
                    Ketinggian
                  </span>
                  <p className="mt-1 text-base font-bold text-neutral-900">
                    {latestLocation?.altitude
                      ? `${Math.round(latestLocation.altitude)} mdpl`
                      : "—"}
                  </p>
                  <p className="text-[11px] text-neutral-400">di atas permukaan laut</p>
                </div>
              </div>

              <div className="my-4 h-px bg-neutral-100" />

              <div className="flex items-end justify-between">
                <div>
                  <p className="text-2xl font-bold tracking-tight text-neutral-900">
                    {totalDistance}
                  </p>
                  <p className="text-xs text-neutral-500">Total panjang rute resmi</p>
                </div>
                <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Route size={20} />
                </div>
              </div>

              {elevationGain !== "—" && (
                <p className="mt-2 text-xs text-neutral-500">
                  Total tanjakan (D+): <strong className="text-neutral-900">+{elevationGain}</strong>
                </p>
              )}
            </section>

            {/* Live Spectators Section */}
            <section className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-emerald-600" />
                  <p className="text-xs font-semibold uppercase tracking-[.13em] text-neutral-500">
                    Penonton Live ({session?.activeViewerCount ?? 1})
                  </p>
                </div>
                <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              <div className="mt-3 divide-y divide-neutral-100">
                {session?.viewers && session.viewers.length > 0 ? (
                  session.viewers.slice(0, 8).map((v) => (
                    <div
                      key={v.visitorId}
                      className="flex items-center justify-between py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-2 rounded-full ${
                            v.isOnline ? "bg-emerald-500" : "bg-neutral-300"
                          }`}
                        />
                        <span className="font-medium text-neutral-800">
                          {v.displayName}
                        </span>
                        {v.visitorId === visitorId && (
                          <span className="rounded bg-emerald-100 px-1 py-0.2 text-[10px] font-semibold text-emerald-800">
                            Anda
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-neutral-400">
                        {v.isOnline ? "Online" : "Offline"}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-xs text-neutral-400">
                    Belum ada penonton lain yang terhubung.
                  </p>
                )}
              </div>
            </section>

            {/* Live Streaming Info Card */}
            <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-xs text-neutral-500">
              <p className="flex items-center gap-2 font-semibold text-neutral-800">
                <Radio size={14} className="text-emerald-600" /> Waymark Live Engine
              </p>
              <p className="mt-1 leading-relaxed text-[11px]">
                Garis oranye menandai rute resmi GPX. Garis hijau digambar otomatis
                mengikuti pergerakan GPS aktual pelari. Sorakan & emoji dikirim secara langsung ke HP pelari.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <footer className="mx-auto max-w-[1440px] px-5 pb-7 pt-4 text-xs text-neutral-400 sm:px-8">
        Waymark · Every journey, in sight.
      </footer>
    </main>
  );
}
