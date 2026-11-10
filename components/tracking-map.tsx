"use client";

import { useEffect, useRef } from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

interface TrackingMapProps {
  routeCoordinates?: [number, number][];
  trackCoordinates?: [number, number][];
  currentPosition?: [number, number] | null;
}

export function TrackingMap({
  routeCoordinates = [],
  trackCoordinates = [],
  currentPosition,
}: TrackingMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const hasAutoCentered = useRef(false);

  const hasRoute = routeCoordinates.length > 0;
  const hasTrack = trackCoordinates.length > 0;

  // Determine initial center
  const initialCenter: [number, number] =
    currentPosition ??
    (hasTrack ? trackCoordinates[trackCoordinates.length - 1] : null) ??
    (hasRoute ? routeCoordinates[0] : [110.42, -7.6]); // Default near Merapi / Indonesia

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
      const lineFeature = (coordinates: [number, number][]) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates,
        },
      });

      // 1. Official Route Source (Orange Line)
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
          "line-color": "#FF6B00", // Vibrant Orange for Official Route
          "line-width": 5,
        },
      });

      // 2. Actual Track Source (Green Line - jalur yang sudah dilewati)
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
          "line-color": "#10B981", // Vibrant Green for Track yang dilewati
          "line-width": 6,
        },
      });

      // 3. Runner Current Location Marker
      const markerPos =
        currentPosition ??
        (hasTrack ? trackCoordinates[trackCoordinates.length - 1] : null) ??
        (hasRoute ? routeCoordinates[0] : null);

      if (markerPos) {
        // Custom DOM element for runner marker with pulsing ring
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

      // Fit bounds to route and track
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

  // Update dynamic sources when props update (live polling)
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;

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

    // Update or add marker
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

    // Auto-center on first live data arrival if not already centered
    if (!hasAutoCentered.current) {
      const allCoords = [...routeCoordinates, ...trackCoordinates];
      if (allCoords.length > 1) {
        const bounds = allCoords.reduce(
          (b, coord) => b.extend(coord),
          new maplibregl.LngLatBounds(allCoords[0], allCoords[0])
        );
        map.current.fitBounds(bounds, { padding: 50, maxZoom: 15, duration: 1000 });
        hasAutoCentered.current = true;
      } else if (markerPos) {
        map.current.flyTo({ center: markerPos, zoom: 15, duration: 1000 });
        hasAutoCentered.current = true;
      }
    }
  }, [routeCoordinates, trackCoordinates, currentPosition]);

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
      className="relative min-h-[460px] overflow-hidden rounded-2xl border border-[#dce3df] bg-[#e6ebe7] sm:min-h-[580px]"
      aria-label="Live route map"
    >
      <div ref={container} className="absolute inset-0" />

      {/* Top Left Live Badge */}
      <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-xs font-semibold shadow-sm backdrop-blur-sm">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-ink">
          {currentPosition ? "GPS LIVE • Tracking" : "LIVE • Route Loaded"}
        </span>
      </div>

      {/* Map Zoom & Locate Controls */}
      <div className="absolute bottom-5 right-5 flex flex-col overflow-hidden rounded-xl border border-[#eaeaea] bg-white shadow-sm">
        <button
          onClick={() => map.current?.zoomIn()}
          aria-label="Zoom in"
          className="grid size-10 place-items-center border-b border-[#eaeaea] transition-colors hover:bg-neutral-50"
        >
          <Plus size={17} />
        </button>
        <button
          onClick={() => map.current?.zoomOut()}
          aria-label="Zoom out"
          className="grid size-10 place-items-center border-b border-[#eaeaea] transition-colors hover:bg-neutral-50"
        >
          <Minus size={17} />
        </button>
        <button
          onClick={handleLocateRunner}
          aria-label="Locate runner"
          title="Fokus ke lokasi pelari"
          className="grid size-10 place-items-center text-brand transition-colors hover:bg-neutral-50"
        >
          <LocateFixed size={18} />
        </button>
      </div>

      {/* Clear Color-Coded Map Legend */}
      <div className="absolute bottom-5 left-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#e5e7eb] bg-white/95 px-4 py-2.5 text-xs font-medium text-ink shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-6 rounded-full bg-[#FF6B00]" />
          <span>Rute Resmi (GPX)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-6 rounded-full bg-[#10B981]" />
          <span>Jalur yang Dilewati</span>
        </div>
        {currentPosition && (
          <div className="flex items-center gap-1.5 text-emerald-600">
            <span className="size-2 rounded-full bg-[#10B981]" />
            <span>Posisi Sekarang</span>
          </div>
        )}
      </div>
    </section>
  );
}
