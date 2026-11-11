import { getSupabaseAdmin } from "./supabase";

export type Location = {
  latitude: number;
  longitude: number;
  accuracy: number;
  battery: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  isSos?: boolean;
  recordedAt: string;
};

export type RouteData = {
  routeGeojson: any;
  totalDistance: number;
  elevationGain?: number;
};

export type Viewer = {
  visitorId: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  isOnline: boolean;
};

export type Cheer = {
  id: string;
  senderName: string;
  message?: string;
  emoji?: string;
  createdAt: string;
};

export type Session = {
  id?: string;
  shareToken: string;
  runnerName: string;
  eventName: string;
  status: "draft" | "live" | "stopped" | "revoked";
  startedAt: string;
  finishedAt?: string | null;
  locations: Location[];
  route?: RouteData | null;
  viewers?: Viewer[];
  activeViewerCount?: number;
  cheers?: Cheer[];
  isSos?: boolean;
};

// Global singleton memory store for Next.js across route module boundaries
const inMemoryStore: Map<string, Session> =
  (globalThis as any).__waymarkStore ??= new Map<string, Session>();

const inMemoryViewers: Map<string, Map<string, Viewer>> =
  (globalThis as any).__waymarkViewers ??= new Map<string, Map<string, Viewer>>();

const inMemoryCheers: Map<string, Cheer[]> =
  (globalThis as any).__waymarkCheers ??= new Map<string, Cheer[]>();

export async function startSession(
  runnerName: string,
  eventName: string,
  route?: RouteData
): Promise<Session> {
  const shareToken = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const supabase = getSupabaseAdmin();

  let sessionId: string | undefined;

  if (supabase) {
    try {
      const { data: sessionRow, error: sessionError } = await supabase
        .from("tracking_sessions")
        .insert({
          share_token: shareToken,
          runner_name: runnerName,
          event_name: eventName,
          status: "live",
          started_at: startedAt,
        })
        .select("id")
        .single();

      if (!sessionError && sessionRow) {
        sessionId = sessionRow.id;

        if (route) {
          await supabase.from("tracking_routes").insert({
            session_id: sessionId,
            route_geojson: route.routeGeojson,
            total_distance: route.totalDistance,
            elevation_gain: route.elevationGain ?? null,
          });
        }
      }
    } catch (err) {
      console.warn("Supabase startSession fallback to in-memory:", err);
    }
  }

  const session: Session = {
    id: sessionId,
    shareToken,
    runnerName,
    eventName,
    status: "live",
    startedAt,
    locations: [],
    route: route ?? null,
  };

  inMemoryStore.set(shareToken, session);
  return session;
}

export async function getSession(token: string): Promise<Session | null> {
  // Check memory store first for low latency
  const memorySession = inMemoryStore.get(token);
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    if (memorySession) {
      const viewers = getActiveViewers(token);
      memorySession.viewers = viewers;
      memorySession.activeViewerCount = viewers.filter((v) => v.isOnline).length;
      memorySession.cheers = getCheers(token);
    }
    return memorySession ?? null;
  }

  try {
    const { data: sessionRow, error: sessionErr } = await supabase
      .from("tracking_sessions")
      .select("id, share_token, runner_name, event_name, status, started_at, finished_at")
      .eq("share_token", token)
      .maybeSingle();

    if (sessionErr || !sessionRow) {
      if (memorySession) {
        const viewers = getActiveViewers(token);
        memorySession.viewers = viewers;
        memorySession.activeViewerCount = viewers.filter((v) => v.isOnline).length;
        memorySession.cheers = getCheers(token);
      }
      return memorySession ?? null;
    }

    // Fetch route if exists
    const { data: routeRow } = await supabase
      .from("tracking_routes")
      .select("route_geojson, total_distance, elevation_gain")
      .eq("session_id", sessionRow.id)
      .maybeSingle();

    // Fetch locations
    const { data: locationRows } = await supabase
      .from("tracking_locations")
      .select("latitude, longitude, accuracy, battery, recorded_at")
      .eq("session_id", sessionRow.id)
      .order("recorded_at", { ascending: true })
      .limit(500);

    const locations: Location[] = (locationRows || []).map((row) => ({
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy ?? 0,
      battery: row.battery ?? 100,
      recordedAt: row.recorded_at,
    }));

    // Fetch viewers from Supabase if any
    try {
      const { data: viewerRows } = await supabase
        .from("tracking_viewers")
        .select("visitor_id, display_name, joined_at, last_seen_at")
        .eq("session_id", sessionRow.id)
        .order("last_seen_at", { ascending: false });

      if (viewerRows && viewerRows.length > 0) {
        let memViewers = inMemoryViewers.get(token);
        if (!memViewers) {
          memViewers = new Map<string, Viewer>();
          inMemoryViewers.set(token, memViewers);
        }
        for (const row of viewerRows) {
          if (!memViewers.has(row.visitor_id)) {
            memViewers.set(row.visitor_id, {
              visitorId: row.visitor_id,
              displayName: row.display_name,
              joinedAt: row.joined_at,
              lastSeenAt: row.last_seen_at,
              isOnline: Date.now() - new Date(row.last_seen_at).getTime() <= 45000,
            });
          }
        }
      }
    } catch (_) {}

    const viewers = getActiveViewers(token);

    const memLocations = memorySession?.locations ?? [];
    const mergedLocations =
      memLocations.length >= locations.length
        ? memLocations
        : locations.map((loc, idx) => ({
            ...loc,
            altitude: memLocations[idx]?.altitude,
            speed: memLocations[idx]?.speed,
            heading: memLocations[idx]?.heading,
            isSos: memLocations[idx]?.isSos,
          }));

    const session: Session = {
      id: sessionRow.id,
      shareToken: sessionRow.share_token,
      runnerName: sessionRow.runner_name,
      eventName: sessionRow.event_name,
      status: sessionRow.status,
      startedAt: sessionRow.started_at,
      finishedAt: sessionRow.finished_at,
      locations: mergedLocations.length > 0 ? mergedLocations : locations,
      route: routeRow
        ? {
            routeGeojson: routeRow.route_geojson,
            totalDistance: routeRow.total_distance,
            elevationGain: routeRow.elevation_gain,
          }
        : memorySession?.route ?? null,
      viewers,
      activeViewerCount: viewers.filter((v) => v.isOnline).length,
      cheers: getCheers(token),
      isSos: memorySession?.isSos ?? false,
    };

    inMemoryStore.set(token, session);
    return session;
  } catch (err) {
    console.warn("Supabase getSession fallback to in-memory:", err);
    if (memorySession) {
      const viewers = getActiveViewers(token);
      memorySession.viewers = viewers;
      memorySession.activeViewerCount = viewers.filter((v) => v.isOnline).length;
      memorySession.cheers = getCheers(token);
    }
    return memorySession ?? null;
  }
}

export async function addLocation(
  token: string,
  location: Location
): Promise<Session | null> {
  const session = inMemoryStore.get(token);
  if (!session || session.status !== "live") {
    // If not in memory, try to retrieve from Supabase
    const dbSession = await getSession(token);
    if (!dbSession || dbSession.status !== "live") return null;
  }

  const activeSession = inMemoryStore.get(token)!;

  // Avoid duplicate timestamps
  if (activeSession.locations.at(-1)?.recordedAt === location.recordedAt) {
    if (location.isSos !== undefined) activeSession.isSos = location.isSos;
    return activeSession;
  }

  if (location.isSos !== undefined) activeSession.isSos = location.isSos;
  activeSession.locations.push(location);

  const supabase = getSupabaseAdmin();
  if (supabase && activeSession.id) {
    try {
      await supabase.from("tracking_locations").insert({
        session_id: activeSession.id,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        battery: location.battery,
        recorded_at: location.recordedAt,
      });
    } catch (err) {
      console.warn("Supabase addLocation write failed:", err);
    }
  }

  const viewers = getActiveViewers(token);
  activeSession.viewers = viewers;
  activeSession.activeViewerCount = viewers.filter((v) => v.isOnline).length;
  activeSession.cheers = getCheers(token);
  return activeSession;
}

export async function addLocations(
  token: string,
  newLocations: Location[]
): Promise<Session | null> {
  if (newLocations.length === 0) return getSession(token);

  const session = inMemoryStore.get(token);
  if (!session || session.status !== "live") {
    const dbSession = await getSession(token);
    if (!dbSession || dbSession.status !== "live") return null;
  }

  const activeSession = inMemoryStore.get(token)!;
  const existingTimestamps = new Set(
    activeSession.locations.map((l) => l.recordedAt)
  );

  const toAdd: Location[] = [];
  for (const loc of newLocations) {
    if (!existingTimestamps.has(loc.recordedAt)) {
      existingTimestamps.add(loc.recordedAt);
      toAdd.push(loc);
      if (loc.isSos !== undefined) {
        activeSession.isSos = loc.isSos;
      }
    }
  }

  if (toAdd.length > 0) {
    activeSession.locations.push(...toAdd);

    const supabase = getSupabaseAdmin();
    if (supabase && activeSession.id) {
      try {
        await supabase.from("tracking_locations").insert(
          toAdd.map((loc) => ({
            session_id: activeSession.id,
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy,
            battery: loc.battery,
            recorded_at: loc.recordedAt,
          }))
        );
      } catch (err) {
        console.warn("Supabase addLocations batch write failed:", err);
      }
    }
  }

  const viewers = getActiveViewers(token);
  activeSession.viewers = viewers;
  activeSession.activeViewerCount = viewers.filter((v) => v.isOnline).length;
  activeSession.cheers = getCheers(token);
  return activeSession;
}

export async function saveRoute(
  token: string,
  route: RouteData
): Promise<boolean> {
  const session = await getSession(token);
  if (!session) return false;

  session.route = route;
  inMemoryStore.set(token, session);

  const supabase = getSupabaseAdmin();
  if (supabase && session.id) {
    try {
      await supabase.from("tracking_routes").upsert({
        session_id: session.id,
        route_geojson: route.routeGeojson,
        total_distance: route.totalDistance,
        elevation_gain: route.elevationGain ?? null,
      });
      return true;
    } catch (err) {
      console.warn("Supabase saveRoute failed:", err);
    }
  }

  return true;
}

export async function stopSession(token: string): Promise<Session | null> {
  const session = inMemoryStore.get(token);
  if (session) {
    session.status = "stopped";
    session.finishedAt = new Date().toISOString();
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      await supabase
        .from("tracking_sessions")
        .update({
          status: "stopped",
          finished_at: new Date().toISOString(),
        })
        .eq("share_token", token);
    } catch (err) {
      console.warn("Supabase stopSession failed:", err);
    }
  }

  return session ?? null;
}

export function getActiveViewers(token: string): Viewer[] {
  const sessionViewers = inMemoryViewers.get(token);
  if (!sessionViewers) return [];

  const now = Date.now();
  const activeThresholdMs = 45 * 1000; // 45 seconds

  const list: Viewer[] = [];
  for (const v of sessionViewers.values()) {
    const lastSeenMs = new Date(v.lastSeenAt).getTime();
    const isOnline = now - lastSeenMs <= activeThresholdMs;
    list.push({
      ...v,
      isOnline,
    });
  }

  // Sort: online first, then latest lastSeenAt
  list.sort((a, b) => {
    if (a.isOnline === b.isOnline) {
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    }
    return a.isOnline ? -1 : 1;
  });

  return list;
}

export async function registerViewer(
  token: string,
  visitorId: string,
  displayName?: string
): Promise<{ ok: boolean; activeCount: number; viewers: Viewer[] }> {
  const session = await getSession(token);
  if (!session) return { ok: false, activeCount: 0, viewers: [] };

  const now = new Date().toISOString();
  let sessionViewers = inMemoryViewers.get(token);
  if (!sessionViewers) {
    sessionViewers = new Map<string, Viewer>();
    inMemoryViewers.set(token, sessionViewers);
  }

  const existing = sessionViewers.get(visitorId);
  const cleanName =
    displayName?.trim() ||
    existing?.displayName ||
    `Penonton #${visitorId.slice(-4)}`;

  const viewer: Viewer = {
    visitorId,
    displayName: cleanName,
    joinedAt: existing?.joinedAt ?? now,
    lastSeenAt: now,
    isOnline: true,
  };
  sessionViewers.set(visitorId, viewer);

  // Sync with Supabase if available
  const supabase = getSupabaseAdmin();
  if (supabase && session.id) {
    try {
      await supabase.from("tracking_viewers").upsert(
        {
          session_id: session.id,
          visitor_id: visitorId,
          display_name: cleanName,
          last_seen_at: now,
        },
        { onConflict: "session_id, visitor_id" }
      );
    } catch (err) {
      // In-memory fallback
    }
  }

  const viewers = getActiveViewers(token);
  const activeCount = viewers.filter((v) => v.isOnline).length;
  return { ok: true, activeCount, viewers };
}

export function getCheers(token: string): Cheer[] {
  return inMemoryCheers.get(token) ?? [];
}

export async function addCheer(
  token: string,
  cheerData: { senderName: string; message?: string; emoji?: string }
): Promise<Cheer | null> {
  const session = inMemoryStore.get(token);
  if (!session) return null;

  let cheerList = inMemoryCheers.get(token);
  if (!cheerList) {
    cheerList = [];
    inMemoryCheers.set(token, cheerList);
  }

  const cheer: Cheer = {
    id: "ch_" + Math.random().toString(36).substring(2, 9),
    senderName: cheerData.senderName.trim() || "Penonton",
    message: cheerData.message?.trim(),
    emoji: cheerData.emoji || "👏",
    createdAt: new Date().toISOString(),
  };

  cheerList.unshift(cheer);
  if (cheerList.length > 50) {
    cheerList.pop();
  }

  session.cheers = cheerList;
  return cheer;
}

export async function setSos(
  token: string,
  isSos: boolean
): Promise<boolean> {
  const session = inMemoryStore.get(token);
  if (!session) return false;
  session.isSos = isSos;
  return true;
}
