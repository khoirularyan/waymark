"use client";

import { useEffect, useState } from "react";
import {
  BatteryMedium,
  Clock3,
  Footprints,
  Radio,
  Route,
  Signal,
  TriangleAlert,
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

interface SessionData {
  runnerName: string;
  eventName: string;
  status: "draft" | "live" | "stopped" | "revoked";
  startedAt: string;
  finishedAt?: string | null;
  locations?: Location[];
  latestLocation?: Location | null;
  route?: RouteData | null;
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

  // Real-time polling every 3 seconds for fresh GPS data
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
            <div
              className={`mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
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
            <h1 className="text-3xl font-semibold tracking-[-.045em] text-ink sm:text-4xl">
              {eventName}
            </h1>
            <p className="mt-1 text-sm text-[#858585]">
              {runnerName} · Private live trail tracking
            </p>
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
