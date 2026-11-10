import { getSupabaseAdmin } from "./supabase";

export type Location = {
  latitude: number;
  longitude: number;
  accuracy: number;
  battery: number;
  recordedAt: string;
};

export type RouteData = {
  routeGeojson: any;
  totalDistance: number;
  elevationGain?: number;
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
};

// Global singleton memory store for Next.js across route module boundaries
const inMemoryStore: Map<string, Session> =
  (globalThis as any).__waymarkStore ??= new Map<string, Session>();

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
    return memorySession ?? null;
  }

  try {
    const { data: sessionRow, error: sessionErr } = await supabase
      .from("tracking_sessions")
      .select("id, share_token, runner_name, event_name, status, started_at, finished_at")
      .eq("share_token", token)
      .maybeSingle();

    if (sessionErr || !sessionRow) {
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

    const session: Session = {
      id: sessionRow.id,
      shareToken: sessionRow.share_token,
      runnerName: sessionRow.runner_name,
      eventName: sessionRow.event_name,
      status: sessionRow.status,
      startedAt: sessionRow.started_at,
      finishedAt: sessionRow.finished_at,
      locations: locations.length > 0 ? locations : (memorySession?.locations ?? []),
      route: routeRow
        ? {
            routeGeojson: routeRow.route_geojson,
            totalDistance: routeRow.total_distance,
            elevationGain: routeRow.elevation_gain,
          }
        : memorySession?.route ?? null,
    };

    inMemoryStore.set(token, session);
    return session;
  } catch (err) {
    console.warn("Supabase getSession fallback to in-memory:", err);
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
    return activeSession;
  }

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
