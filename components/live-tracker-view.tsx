"use client";

import { useEffect, useState } from "react";
import {
  BatteryMedium,
  Clock3,
  Eye,
  Footprints,
  Radio,
  Route,
  Signal,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Header } from "./brand";
import { TrackingMap } from "./tracking-map";

interface Location {
  latitude: number;
  longitude: number;
  accuracy: number;
  battery: number;
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
}

interface LiveTrackerViewProps {
  token: string;
  initialSession: SessionData | null;
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

    // Immediate heartbeat with the new display name
    fetch(`/api/tracking/${token}/viewer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId, displayName: clean }),
    }).catch(() => {});
  };

  // Real-time polling every 3 seconds for fresh GPS data & viewers
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
      } catch (err) {
        // Silently retry on next interval
      }
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

  // Extract actual recorded track coordinates (jalur yang sudah dilewati)
  const trackCoords: [number, number][] = locations.map((loc) => [
    loc.longitude,
    loc.latitude,
  ]);

  // Current real-time position
  const currentPos: [number, number] | null = latestLocation
    ? [latestLocation.longitude, latestLocation.latitude]
    : null;

  const batteryStr = latestLocation ? `${latestLocation.battery}%` : "—";

  const stats = [
    {
      icon: <Footprints size={20} />,
      label: "Official route",
      value: totalDistance,
      note: elevationGain !== "—" ? `Elevation gain: ${elevationGain}` : "GPX distance",
    },
    {
      icon: <Clock3 size={20} />,
      label: "Session status",
      value: isLive ? "LIVE TRACKING" : "STOPPED",
      note: session?.startedAt
        ? `Started ${new Date(session.startedAt).toLocaleTimeString()}`
        : "Active session",
    },
    {
      icon: <BatteryMedium size={20} />,
      label: "Runner battery",
      value: batteryStr,
      note: latestLocation?.recordedAt
        ? `Updated ${new Date(latestLocation.recordedAt).toLocaleTimeString()}`
        : "Awaiting first GPS signal",
    },
  ];

  return (
    <main className="min-h-screen bg-[#fbfbfa]">
      <Header action="Share tracking" />

      <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
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
                {isLive ? "LIVE" : "STOPPED"}
              </div>

              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                <Eye size={13} className="text-emerald-600" />
                <span>{session?.activeViewerCount ?? 1} Penonton Aktif</span>
              </div>
            </div>

            <h1 className="text-3xl font-semibold tracking-[-.045em] text-ink sm:text-4xl">
              {eventName}
            </h1>
            <p className="mt-1 text-sm text-[#858585]">
              {runnerName} · Private live trail tracking
            </p>

            {/* Spectator Identity Bar */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[#777]">Anda memantau sebagai:</span>
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
                    className="h-7 w-36 rounded-md border border-neutral-300 px-2 text-xs text-ink focus:border-brand focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="h-7 rounded-md bg-brand px-2.5 font-medium text-white hover:bg-brand/90"
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
                  className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-semibold text-ink border border-neutral-200 hover:border-brand shadow-xs transition-colors"
                  title="Klik untuk mengubah nama Anda agar pelari tahu siapa yang memantau"
                >
                  <span>{displayName || "Tamu"}</span>
                  <span className="text-[10px] text-brand font-normal">✎ Ubah</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col items-start gap-1 sm:items-end">
            <p className="flex items-center gap-2 text-sm text-[#666]">
              <Signal
                size={16}
                className={isLive ? "text-[#10B981]" : "text-[#999]"}
              />
              {currentPos
                ? `GPS fix: ${currentPos[1].toFixed(5)}, ${currentPos[0].toFixed(5)}`
                : "Waiting for GPS fix..."}
            </p>
            <p className="text-xs text-[#999]">Updated: {lastUpdateText}</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TrackingMap
            routeCoordinates={routeCoords}
            trackCoordinates={trackCoords}
            currentPosition={currentPos}
          />

          <aside className="space-y-3">
            {/* Live Spectators Section */}
            <section className="rounded-2xl border border-[#eaeaea] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-emerald-600" />
                  <p className="text-xs font-semibold uppercase tracking-[.13em] text-[#858585]">
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
                        <span className="font-medium text-ink">
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

            <section className="rounded-2xl border border-[#eaeaea] bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[.13em] text-[#858585]">
                Live Status
              </p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-[#666]">Current position</span>
                <span
                  className={`text-sm font-semibold ${
                    currentPos ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {currentPos ? "GPS Active" : "Waiting for GPS"}
                </span>
              </div>
              <div className="my-4 h-px bg-[#eee]" />
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-3xl font-bold tracking-tight text-ink">
                    {totalDistance}
                  </p>
                  <p className="text-xs text-[#858585]">total trail distance</p>
                </div>
                <div className="grid size-11 place-items-center rounded-xl bg-orange-50 text-brand">
                  <Route size={24} />
                </div>
              </div>
              {elevationGain !== "—" && (
                <p className="mt-3 text-xs text-[#858585]">
                  Elevation gain: <b className="text-ink">{elevationGain}</b>
                </p>
              )}
            </section>

            {stats.map((item) => (
              <section
                key={item.label}
                className="flex items-start gap-3 rounded-xl border border-[#eaeaea] bg-white p-4 shadow-sm"
              >
                <span className="mt-0.5 text-brand">{item.icon}</span>
                <div>
                  <p className="text-xs text-[#858585]">{item.label}</p>
                  <p className="mt-0.5 font-semibold text-ink">{item.value}</p>
                  <p className="mt-0.5 text-xs text-[#858585]">{item.note}</p>
                </div>
              </section>
            ))}

            <div className="rounded-xl border border-dashed border-[#d8d8d8] bg-white p-4 text-xs text-[#858585]">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <Radio size={14} className="text-brand" /> Live Streaming
              </p>
              <p className="mt-1 leading-relaxed">
                Rute oranye menunjukkan rute resmi GPX. Garis hijau akan digambar
                secara otomatis mengikuti jejak langkah runner secara realtime.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <footer className="mx-auto max-w-[1440px] px-5 pb-7 pt-2 text-xs text-[#999] sm:px-8">
        Waymark · Every journey, in sight.
      </footer>
    </main>
  );
}
