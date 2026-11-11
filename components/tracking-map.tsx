"use client";

import { useEffect, useRef, useState } from "react";
import {
  FastForward,
  Layers,
  LocateFixed,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

interface TrackingMapProps {
  routeCoordinates?: [number, number][];
  trackCoordinates?: [number, number][];
  currentPosition?: [number, number] | null;
  isStopped?: boolean;
  className?: string;
}

export function TrackingMap({
  routeCoordinates = [],
  trackCoordinates = [],
  currentPosition,
  isStopped = false,
  className,
}: TrackingMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const hasAutoCentered = useRef(false);

  const [mapLayer, setMapLayer] = useState<"outdoor" | "satellite">("outdoor");
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 5 | 15>(5);

  const hasRoute = routeCoordinates.length > 0;
  const hasTrack = trackCoordinates.length > 0;

  // Determine initial center
  const initialCenter: [number, number] =
    currentPosition ??
    (hasTrack ? trackCoordinates[trackCoordinates.length - 1] : null) ??
    (hasRoute ? routeCoordinates[0] : [110.42, -7.6]);

  // Initialize Map
  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: initialCenter,
      zoom: 13,
      attributionControl: false,
    });

    map.current = instance;
    instance.addControl(new maplibregl.AttributionControl({ compact: true }));

    instance.on("load", () => {
      // 1. Add Satellite Raster Source
      instance.addSource("satellite-tiles", {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
      });

      instance.addLayer({
        id: "satellite-layer",
        type: "raster",
        source: "satellite-tiles",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 0.95 },
      });

      const lineFeature = (coordinates: [number, number][]) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates,
        },
      });

      // 2. Official Route Source (Orange Line)
      instance.addSource("official-route", {
        type: "geojson",
        data: lineFeature(routeCoordinates),
      });

      instance.addLayer({
        id: "official-route-casing",
        type: "line",
        source: "official-route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 8,
          "line-opacity": 0.8,
        },
      });

      instance.addLayer({
        id: "official-route",
        type: "line",
        source: "official-route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FF6B00",
          "line-width": 5,
        },
      });

      // 3. Actual Track Source (Green Line)
      instance.addSource("actual-track", {
        type: "geojson",
        data: lineFeature(trackCoordinates),
      });

      instance.addLayer({
        id: "actual-track-casing",
        type: "line",
        source: "actual-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#FFFFFF",
          "line-width": 9,
          "line-opacity": 0.9,
        },
      });

      instance.addLayer({
        id: "actual-track",
        type: "line",
        source: "actual-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#10B981",
          "line-width": 6,
        },
      });

      // 4. Runner Marker
      const markerPos =
        currentPosition ??
        (hasTrack ? trackCoordinates[trackCoordinates.length - 1] : null) ??
        (hasRoute ? routeCoordinates[0] : null);

      if (markerPos) {
        const el = document.createElement("div");
        el.className = "waymark-runner-marker";
        el.innerHTML = `
          <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; inset: 0; border-radius: 9999px; background: rgba(16, 185, 129, 0.4); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="width: 18px; height: 18px; border-radius: 9999px; background: #10B981; border: 3px solid #FFFFFF; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
          </div>
        `;

        marker.current = new maplibregl.Marker({ element: el })
          .setLngLat(markerPos)
          .addTo(instance);
      }

      // Auto fit bounds
      const allCoords = [...routeCoordinates, ...trackCoordinates];
      if (allCoords.length > 1) {
        const bounds = allCoords.reduce(
          (b, coord) => b.extend(coord),
          new maplibregl.LngLatBounds(allCoords[0], allCoords[0])
        );
        instance.fitBounds(bounds, { padding: 50, maxZoom: 15 });
        hasAutoCentered.current = true;
      } else if (markerPos) {
        instance.setCenter(markerPos);
        instance.setZoom(15);
        hasAutoCentered.current = true;
      }
    });

    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Handle Layer Toggle
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    if (map.current.getLayer("satellite-layer")) {
      map.current.setLayoutProperty(
        "satellite-layer",
        "visibility",
        mapLayer === "satellite" ? "visible" : "none"
      );
    }
  }, [mapLayer]);

  // Update dynamic sources when props update (live polling, only when not in replay mode)
  useEffect(() => {
    if (isReplayMode || !map.current || !map.current.isStyleLoaded()) return;

    // Update official route
    const routeSource = map.current.getSource(
      "official-route"
    ) as maplibregl.GeoJSONSource | undefined;
    if (routeSource) {
      routeSource.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: routeCoordinates },
      });
    }

    // Update actual track
    const trackSource = map.current.getSource(
      "actual-track"
    ) as maplibregl.GeoJSONSource | undefined;
    if (trackSource) {
      trackSource.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: trackCoordinates },
      });
    }

    // Update marker position
    const markerPos =
      currentPosition ??
      (hasTrack ? trackCoordinates[trackCoordinates.length - 1] : null);

    if (markerPos) {
      if (marker.current) {
        marker.current.setLngLat(markerPos);
      } else if (map.current) {
        const el = document.createElement("div");
        el.className = "waymark-runner-marker";
        el.innerHTML = `
          <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; inset: 0; border-radius: 9999px; background: rgba(16, 185, 129, 0.4); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="width: 18px; height: 18px; border-radius: 9999px; background: #10B981; border: 3px solid #FFFFFF; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
          </div>
        `;
        marker.current = new maplibregl.Marker({ element: el })
          .setLngLat(markerPos)
          .addTo(map.current);
      }
    }
  }, [routeCoordinates, trackCoordinates, currentPosition, isReplayMode]);

  // Replay Animation Loop
  useEffect(() => {
    if (!isReplayMode || !isPlaying || trackCoordinates.length === 0) return;

    const intervalMs = Math.max(40, Math.floor(1000 / (playbackSpeed * 3)));
    const interval = setInterval(() => {
      setReplayIndex((prev) => {
        if (prev >= trackCoordinates.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        const next = prev + 1;

        // Update track data and marker to replay point
        const slicedTrack = trackCoordinates.slice(0, next + 1);
        const trackSource = map.current?.getSource(
          "actual-track"
        ) as maplibregl.GeoJSONSource | undefined;
        if (trackSource) {
          trackSource.setData({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: slicedTrack },
          });
        }

        const point = trackCoordinates[next];
        if (point && marker.current) {
          marker.current.setLngLat(point);
        }

        return next;
      });
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isReplayMode, isPlaying, playbackSpeed, trackCoordinates]);

  const handleStartReplay = () => {
    setIsReplayMode(true);
    setReplayIndex(0);
    setIsPlaying(true);
    if (trackCoordinates.length > 0 && marker.current) {
      marker.current.setLngLat(trackCoordinates[0]);
    }
  };

  const handleExitReplay = () => {
    setIsReplayMode(false);
    setIsPlaying(false);
    // Restore full track
    const trackSource = map.current?.getSource(
      "actual-track"
    ) as maplibregl.GeoJSONSource | undefined;
    if (trackSource) {
      trackSource.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: trackCoordinates },
      });
    }
    const markerPos =
      currentPosition ??
      (hasTrack ? trackCoordinates[trackCoordinates.length - 1] : null);
    if (markerPos && marker.current) {
      marker.current.setLngLat(markerPos);
    }
  };

  const handleLocateRunner = () => {
    const target =
      currentPosition ??
      (hasTrack ? trackCoordinates[trackCoordinates.length - 1] : null) ??
      (hasRoute ? routeCoordinates[0] : null);

    if (target && map.current) {
      map.current.flyTo({ center: target, zoom: 15, duration: 1500 });
    }
  };

  return (
    <section
      className={
        className ??
        "relative min-h-[460px] overflow-hidden rounded-2xl border border-[#dce3df] bg-[#e6ebe7] sm:min-h-[580px]"
      }
      aria-label="Live route map"
    >
      <div ref={container} className="absolute inset-0" />

      {/* Top Left Status Badge */}
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-neutral-200/50 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 px-3.5 py-1.5 text-xs font-semibold shadow-xs backdrop-blur-xs transition-colors">
        <span className="relative flex size-2.5">
          <span
            className={`absolute inline-flex size-full rounded-full ${
              isReplayMode
                ? "bg-amber-400 animate-ping"
                : "bg-emerald-400 animate-ping"
            }`}
          />
          <span
            className={`relative inline-flex size-2.5 rounded-full ${
              isReplayMode ? "bg-amber-500" : "bg-emerald-500"
            }`}
          />
        </span>
        <span className="text-neutral-800 dark:text-slate-200">
          {isReplayMode
            ? `REPLAY • ${replayIndex + 1}/${trackCoordinates.length} Titik`
            : currentPosition
            ? "GPS LIVE • Terhubung"
            : "LIVE • Rute GPX Siap"}
        </span>
      </div>

      {/* Top Right Controls: Map Layer Switcher & Replay Trigger */}
      <div className="absolute right-4 top-4 flex items-center gap-2">
        {/* Layer Switcher Pill */}
        <div className="flex overflow-hidden rounded-xl border border-neutral-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-0.5 shadow-xs backdrop-blur-xs text-xs font-medium transition-colors">
          <button
            type="button"
            onClick={() => setMapLayer("outdoor")}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors ${
              mapLayer === "outdoor"
                ? "bg-neutral-900 dark:bg-slate-800 text-white shadow-2xs"
                : "text-neutral-600 dark:text-slate-400 hover:text-neutral-900 dark:hover:text-white"
            }`}
          >
            <Layers size={13} />
            <span>Kontur</span>
          </button>
          <button
            type="button"
            onClick={() => setMapLayer("satellite")}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition-colors ${
              mapLayer === "satellite"
                ? "bg-emerald-600 text-white shadow-2xs"
                : "text-neutral-600 dark:text-slate-400 hover:text-neutral-900 dark:hover:text-white"
            }`}
          >
            <span>🛰️ Satelit</span>
          </button>
        </div>

        {/* Replay Toggle Button */}
        {trackCoordinates.length > 2 && (
          <button
            type="button"
            onClick={isReplayMode ? handleExitReplay : handleStartReplay}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-xs backdrop-blur-xs transition-colors ${
              isReplayMode
                ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300"
                : "border-neutral-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 text-neutral-800 dark:text-slate-200 hover:border-emerald-500"
            }`}
          >
            {isReplayMode ? (
              <>
                <RotateCcw size={13} />
                <span>Keluar Replay</span>
              </>
            ) : (
              <>
                <Play size={13} />
                <span>Putar Ulang</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Replay Floating Control Bar (when Replay active) */}
      {isReplayMode && (
        <div className="absolute bottom-16 left-4 right-4 z-10 mx-auto max-w-lg rounded-2xl border border-neutral-200/90 bg-white/95 p-3.5 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs"
              >
                {isPlaying ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button
                type="button"
                onClick={() => setReplayIndex(0)}
                className="flex size-9 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                title="Mulai dari awal"
              >
                <RotateCcw size={15} />
              </button>
            </div>

            {/* Replay Slider */}
            <input
              type="range"
              min={0}
              max={Math.max(1, trackCoordinates.length - 1)}
              value={replayIndex}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                setReplayIndex(idx);
                const sliced = trackCoordinates.slice(0, idx + 1);
                const s = map.current?.getSource("actual-track") as maplibregl.GeoJSONSource | undefined;
                if (s) s.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: sliced } });
                if (trackCoordinates[idx] && marker.current) marker.current.setLngLat(trackCoordinates[idx]);
              }}
              className="flex-1 accent-emerald-600"
            />

            {/* Speed Switcher */}
            <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-0.5 text-xs font-semibold text-neutral-700">
              <FastForward size={13} className="ml-1 text-neutral-400" />
              {([1, 5, 15] as const).map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setPlaybackSpeed(spd)}
                  className={`rounded px-1.5 py-0.5 ${
                    playbackSpeed === spd ? "bg-white text-emerald-700 shadow-2xs" : "hover:text-neutral-900"
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Map Zoom & Locate Controls */}
      <div className="absolute bottom-5 right-4 flex flex-col overflow-hidden rounded-xl border border-neutral-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs transition-colors">
        <button
          onClick={() => map.current?.zoomIn()}
          aria-label="Zoom in"
          className="grid size-9 place-items-center border-b border-neutral-100 dark:border-slate-800 text-neutral-700 dark:text-slate-300 hover:bg-neutral-50 dark:hover:bg-slate-800 transition-colors"
        >
          <Plus size={16} />
        </button>
        <button
          onClick={() => map.current?.zoomOut()}
          aria-label="Zoom out"
          className="grid size-9 place-items-center border-b border-neutral-100 dark:border-slate-800 text-neutral-700 dark:text-slate-300 hover:bg-neutral-50 dark:hover:bg-slate-800 transition-colors"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={handleLocateRunner}
          aria-label="Locate runner"
          title="Fokus ke lokasi pelari"
          className="grid size-9 place-items-center text-emerald-600 dark:text-emerald-400 hover:bg-neutral-50 dark:hover:bg-slate-800 transition-colors"
        >
          <LocateFixed size={17} />
        </button>
      </div>

      {/* Color-Coded Map Legend */}
      <div className="absolute bottom-5 left-4 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 px-3.5 py-2 text-xs font-medium text-neutral-800 dark:text-slate-200 shadow-xs backdrop-blur-xs transition-colors">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-full bg-[#FF6B00]" />
          <span>Rute GPX</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-full bg-[#10B981]" />
          <span>Jejak Pelari</span>
        </div>
        {currentPosition && (
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-[#10B981]" />
            <span>Pelari</span>
          </div>
        )}
      </div>
    </section>
  );
}
