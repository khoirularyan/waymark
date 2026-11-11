"use client";

import { useMemo } from "react";
import { Mountain, TrendingUp, Compass, Flag, AlertTriangle } from "lucide-react";

interface ElevationProfileProps {
  routeGeojson: any;
  totalDistance?: number;
  elevationGain?: number;
  currentPos: [number, number] | null; // [longitude, latitude]
  currentAltitude?: number;
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371; // Earth radius in km
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

export function ElevationProfile({
  routeGeojson,
  totalDistance = 0,
  elevationGain = 0,
  currentPos,
  currentAltitude,
}: ElevationProfileProps) {
  const profileData = useMemo(() => {
    if (!routeGeojson?.geometry?.coordinates) return null;

    const coords = routeGeojson.geometry.coordinates as number[][];
    if (coords.length < 2) return null;

    let cumulativeDist = 0;
    const points: { distKm: number; ele: number; coord: [number, number] }[] = [];

    // Check if coordinates have elevation [lon, lat, ele]
    const hasElevationInCoords = coords.some((c) => c.length >= 3 && typeof c[2] === "number");

    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (i > 0) {
        const prev = coords[i - 1];
        cumulativeDist += haversineKm(prev[0], prev[1], c[0], c[1]);
      }

      let ele = 1000;
      if (hasElevationInCoords && c[2] != null) {
        ele = c[2];
      } else {
        // Generate a smooth bell curve representing mountain summit from elevationGain
        const progress = coords.length > 1 ? i / (coords.length - 1) : 0;
        const peak = elevationGain > 0 ? elevationGain : 1200;
        ele = 800 + Math.sin(progress * Math.PI) * peak;
      }

      points.push({
        distKm: cumulativeDist,
        ele: Math.round(ele),
        coord: [c[0], c[1]],
      });
    }

    const totalDist = cumulativeDist > 0 ? cumulativeDist : totalDistance || 1;
    const minEle = Math.min(...points.map((p) => p.ele));
    const maxEle = Math.max(...points.map((p) => p.ele));

    // Find closest point to runner's current position
    let closestIndex = 0;
    let minDistanceToRunner = Infinity;

    if (currentPos) {
      for (let i = 0; i < points.length; i++) {
        const d = haversineKm(
          currentPos[0],
          currentPos[1],
          points[i].coord[0],
          points[i].coord[1]
        );
        if (d < minDistanceToRunner) {
          minDistanceToRunner = d;
          closestIndex = i;
        }
      }
    }

    // Runner is considered off-course if farther than 300 meters (0.3 km) from track
    const isOffCourse = !currentPos || minDistanceToRunner > 0.3;

    // Calculate total elevation gain of the whole route
    let totalEleGain = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const diff = points[i + 1].ele - points[i].ele;
      if (diff > 0) totalEleGain += diff;
    }

    if (isOffCourse) {
      return {
        points,
        totalDist,
        minEle,
        maxEle,
        closestIndex: 0,
        currentPoint: points[0],
        coveredKm: 0,
        remainingKm: totalDist,
        remainingEleGain: Math.round(totalEleGain),
        offCourseKm: minDistanceToRunner,
        isOffCourse: true,
      };
    }

    const currentPoint = points[closestIndex] ?? points[0];
    const coveredKm = currentPoint.distKm;
    const remainingKm = Math.max(0, totalDist - coveredKm);

    // Calculate remaining elevation gain from current index to the end
    let remainingEleGain = 0;
    for (let i = closestIndex; i < points.length - 1; i++) {
      const diff = points[i + 1].ele - points[i].ele;
      if (diff > 0) remainingEleGain += diff;
    }

    return {
      points,
      totalDist,
      minEle,
      maxEle,
      closestIndex,
      currentPoint,
      coveredKm,
      remainingKm,
      remainingEleGain: Math.round(remainingEleGain),
      offCourseKm: minDistanceToRunner,
      isOffCourse: false,
    };
  }, [routeGeojson, totalDistance, elevationGain, currentPos]);

  if (!profileData || profileData.points.length < 2) {
    return null;
  }

  const {
    points,
    totalDist,
    minEle,
    maxEle,
    currentPoint,
    coveredKm,
    remainingKm,
    remainingEleGain,
    isOffCourse,
    offCourseKm,
  } = profileData;

  const width = 800;
  const height = 180;
  const paddingX = 40;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartW = width - paddingX * 2;
  const chartH = height - paddingTop - paddingBottom;
  const eleSpan = maxEle - minEle || 1;

  // Build SVG polyline points
  const svgCoords = points.map((p) => {
    const x = paddingX + (p.distKm / totalDist) * chartW;
    const y = paddingTop + chartH - ((p.ele - minEle) / eleSpan) * chartH;
    return { x, y, distKm: p.distKm, ele: p.ele };
  });

  const linePath = svgCoords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${svgCoords[svgCoords.length - 1].x.toFixed(1)} ${(paddingTop + chartH).toFixed(1)} L ${paddingX} ${(paddingTop + chartH).toFixed(1)} Z`;

  // Runner marker position on the SVG
  const runnerX = paddingX + (currentPoint.distKm / totalDist) * chartW;
  const runnerY = paddingTop + chartH - ((currentPoint.ele - minEle) / eleSpan) * chartH;
  const displayAltitude = currentAltitude ?? currentPoint.ele;

  return (
    <div className="rounded-2xl border border-neutral-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs transition-colors">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
            <Mountain size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Profil Elevasi & Jalur Gunung
            </h3>
            <p className="text-xs text-neutral-500 dark:text-slate-400">
              Posisi pelari pada kontur tanjakan dan turunan
            </p>
          </div>
        </div>

        {/* Quick Stats Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isOffCourse && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 dark:bg-rose-950/50 px-2.5 py-1 font-medium text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60">
              <AlertTriangle size={13} className="text-rose-600 dark:text-rose-400" />
              Status: <strong className="text-rose-950 dark:text-rose-200">Di Luar Jalur ({offCourseKm >= 1 ? `${offCourseKm.toFixed(1)} km` : `${Math.round(offCourseKm * 1000)} m`})</strong>
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-slate-800 px-2.5 py-1 font-medium text-neutral-700 dark:text-slate-300 border border-neutral-200/40 dark:border-slate-700/60">
            <TrendingUp size={13} className="text-emerald-600 dark:text-emerald-400" />
            Elevasi: <strong className="text-neutral-900 dark:text-white">{displayAltitude} mdpl</strong>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 font-medium text-emerald-800 dark:text-emerald-300 border border-emerald-200/40 dark:border-emerald-800/40">
            <Compass size={13} className="text-emerald-600 dark:text-emerald-400" />
            Sisa Jarak: <strong className="text-emerald-950 dark:text-emerald-200">{remainingKm.toFixed(1)} km</strong>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/50 px-2.5 py-1 font-medium text-amber-800 dark:text-amber-300 border border-amber-200/40 dark:border-amber-800/40">
            <Flag size={13} className="text-amber-600 dark:text-amber-400" />
            Sisa D+: <strong className="text-amber-950 dark:text-amber-200">+{remainingEleGain} m</strong>
          </span>
        </div>
      </div>

      {/* SVG Elevation Chart */}
      <div className="relative w-full overflow-hidden rounded-xl bg-neutral-50/70 dark:bg-slate-950/80 p-2 border border-neutral-100 dark:border-slate-800/80">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="eleGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="eleLineGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#059669" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line
            x1={paddingX}
            y1={paddingTop}
            x2={width - paddingX}
            y2={paddingTop}
            stroke="currentColor"
            className="text-neutral-200 dark:text-slate-800"
            strokeDasharray="4 4"
          />
          <line
            x1={paddingX}
            y1={paddingTop + chartH / 2}
            x2={width - paddingX}
            y2={paddingTop + chartH / 2}
            stroke="currentColor"
            className="text-neutral-200 dark:text-slate-800"
            strokeDasharray="4 4"
          />
          <line
            x1={paddingX}
            y1={paddingTop + chartH}
            x2={width - paddingX}
            y2={paddingTop + chartH}
            stroke="currentColor"
            className="text-neutral-300 dark:text-slate-700"
          />

          {/* Elevation area fill */}
          <path d={areaPath} fill="url(#eleGradient)" />

          {/* Elevation contour line */}
          <path
            d={linePath}
            fill="none"
            stroke="url(#eleLineGradient)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Completed path highlight (only when runner is on the route) */}
          {!isOffCourse && svgCoords.length > 0 && (
            <path
              d={svgCoords
                .slice(0, profileData.closestIndex + 1)
                .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke="#047857"
              strokeWidth="4"
              strokeLinecap="round"
            />
          )}

          {/* Runner vertical indicator line & dot (only when on-course) */}
          {!isOffCourse && (
            <>
              <line
                x1={runnerX}
                y1={paddingTop}
                x2={runnerX}
                y2={paddingTop + chartH}
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <circle cx={runnerX} cy={runnerY} r="7" fill="#ef4444" stroke="#ffffff" strokeWidth="2.5" />
              <circle cx={runnerX} cy={runnerY} r="12" fill="#ef4444" fillOpacity="0.25" className="animate-ping" />
            </>
          )}

          {/* Axis labels */}
          <text x={paddingX} y={height - 8} fontSize="11" fill="currentColor" className="text-neutral-500 dark:text-slate-400" fontWeight="500">
            0 km (Start: {minEle}m)
          </text>
          <text
            x={width - paddingX}
            y={height - 8}
            fontSize="11"
            fill="currentColor"
            className="text-neutral-500 dark:text-slate-400"
            fontWeight="500"
            textAnchor="end"
          >
            {totalDist.toFixed(1)} km (Finish)
          </text>
          <text x={paddingX} y={paddingTop - 6} fontSize="10" fill="currentColor" className="text-neutral-400 dark:text-slate-500">
            Puncak: {maxEle} mdpl
          </text>
        </svg>

        {/* Runner indicator pill (only when on-course) */}
        {!isOffCourse && (
          <div
            className="absolute -translate-x-1/2 rounded-md bg-neutral-900/90 dark:bg-slate-900/95 border border-transparent dark:border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-white shadow-md backdrop-blur-xs pointer-events-none"
            style={{
              left: `${(runnerX / width) * 100}%`,
              top: `${Math.max(6, (runnerY / height) * 100 - 18)}%`,
            }}
          >
            🏃 {displayAltitude}m ({coveredKm.toFixed(1)} km)
          </div>
        )}

        {/* Off-course / Not yet on route warning banner overlay */}
        {isOffCourse && (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 rounded-xl bg-neutral-900/85 dark:bg-slate-900/90 px-4 py-2.5 text-xs font-medium text-white shadow-lg backdrop-blur-xs border border-neutral-700/60 dark:border-slate-700/60">
              <AlertTriangle size={15} className="text-amber-400 shrink-0" />
              <span>
                Pelari belum berada di lintasan rute resmi (<strong>{offCourseKm >= 1 ? `${offCourseKm.toFixed(1)} km` : `${Math.round(offCourseKm * 1000)} m`}</strong> ke rute terdekat)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
