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
  audioData?: string;
  durationSeconds?: number;
};

export type Session = {
  id?: string;
  shareToken: string;
  runnerId?: string;
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
  isStandby?: boolean;
};

export type Runner = {
  id: string;
  runnerName: string;
  activeToken?: string;
  activeSessionId?: string | null;
  lastSeenAt: string;
};

// Global singleton memory store for Next.js across route module boundaries
const inMemoryStore: Map<string, Session> =
  (globalThis as any).__waymarkStore ??= new Map<string, Session>();

const inMemoryRunners: Map<string, Runner> =
  (globalThis as any).__waymarkRunners ??= new Map<string, Runner>();

const inMemoryViewers: Map<string, Map<string, Viewer>> =
  (globalThis as any).__waymarkViewers ??= new Map<string, Map<string, Viewer>>();

const inMemoryCheers: Map<string, Cheer[]> =
  (globalThis as any).__waymarkCheers ??= new Map<string, Cheer[]>();

export async function startSession(
  runnerName: string,
  eventName: string,
  route?: RouteData,
  runnerId?: string
): Promise<Session> {
  const shareToken = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const supabase = getSupabaseAdmin();

  let sessionId: string | undefined;

  if (runnerId) {
    inMemoryRunners.set(runnerId, {
      id: runnerId,
      runnerName,
      activeToken: shareToken,
      lastSeenAt: startedAt,
    });
  }

  if (supabase) {
    try {
      if (runnerId) {
        await supabase.from("tracking_runners").upsert({
          id: runnerId,
          runner_name: runnerName,
          updated_at: startedAt,
        });
      }

      const { data: sessionRow, error: sessionError } = await supabase
        .from("tracking_sessions")
        .insert({
          share_token: shareToken,
          runner_name: runnerName,
          event_name: eventName,
          status: "live",
          started_at: startedAt,
          runner_id: runnerId ?? null,
        })
        .select("id")
        .single();

      if (!sessionError && sessionRow) {
        sessionId = sessionRow.id;

        if (runnerId) {
          await supabase
            .from("tracking_runners")
            .update({
              active_session_id: sessionId,
              updated_at: startedAt,
            })
            .eq("id", runnerId);
        }

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
    runnerId,
    runnerName,
    eventName,
    status: "live",
    startedAt,
    locations: [],
    route: route ?? null,
  };

  inMemoryStore.set(shareToken, session);
  if (runnerId) {
    inMemoryStore.set(runnerId, session);
  }

  return session;
}

export async function getSession(token: string): Promise<Session | null> {
  // 1. Check memory store by token or runnerId
  const memorySession = inMemoryStore.get(token);
  if (memorySession) {
    const viewers = getActiveViewers(token);
    memorySession.viewers = viewers;
    memorySession.activeViewerCount = viewers.filter((v) => v.isOnline).length;
    memorySession.cheers = getCheers(token);
    return memorySession;
  }

  // Check if token is runnerId in memory
  const memoryRunner = inMemoryRunners.get(token);
  if (memoryRunner?.activeToken) {
    const runnerActiveSession = inMemoryStore.get(memoryRunner.activeToken);
    if (runnerActiveSession) {
      const viewers = getActiveViewers(memoryRunner.activeToken);
      runnerActiveSession.viewers = viewers;
      runnerActiveSession.activeViewerCount = viewers.filter((v) => v.isOnline).length;
      runnerActiveSession.cheers = getCheers(memoryRunner.activeToken);
      return runnerActiveSession;
    }
  }

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    // If not found in memory and no Supabase, check if token looks like runner ID to return standby
    if (token.startsWith("runner_") || token.startsWith("wm_")) {
      const standbySession: Session = {
        shareToken: token,
        runnerId: token,
        runnerName: "Waymark Runner",
        eventName: "Belum Memulai Live",
        status: "draft",
        startedAt: new Date().toISOString(),
        locations: [],
        viewers: [],
        activeViewerCount: 0,
        cheers: getCheers(token),
        isStandby: true,
      };
      return standbySession;
    }
    return null;
  }

  try {
    // 2. Query Supabase: Try share_token first
    let sessionRow: any = null;
    const { data: byToken } = await supabase
      .from("tracking_sessions")
      .select("id, share_token, runner_name, event_name, status, started_at, finished_at, runner_id")
      .eq("share_token", token)
      .maybeSingle();

    sessionRow = byToken;

    // If not found by share_token, check if token is runner_id
    let runnerProfile: any = null;
    if (!sessionRow) {
      const { data: runnerRow } = await supabase
        .from("tracking_runners")
        .select("id, runner_name, active_session_id, updated_at")
        .eq("id", token)
        .maybeSingle();

      runnerProfile = runnerRow;

      if (runnerRow?.active_session_id) {
        const { data: byActiveSession } = await supabase
          .from("tracking_sessions")
          .select("id, share_token, runner_name, event_name, status, started_at, finished_at, runner_id")
          .eq("id", runnerRow.active_session_id)
          .maybeSingle();
        sessionRow = byActiveSession;
      }

      // If still no session, check latest session of this runner
      if (!sessionRow) {
        const { data: latestSession } = await supabase
          .from("tracking_sessions")
          .select("id, share_token, runner_name, event_name, status, started_at, finished_at, runner_id")
          .eq("runner_id", token)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        sessionRow = latestSession;
      }
    }

    if (!sessionRow) {
      // Runner is known or looks like a runner ID, but has no live session: Return Standby Session
      if (runnerProfile || token.startsWith("runner_") || token.startsWith("wm_")) {
        const standbySession: Session = {
          shareToken: token,
          runnerId: runnerProfile?.id ?? token,
          runnerName: runnerProfile?.runner_name ?? "Waymark Runner",
          eventName: "Belum Memulai Live",
          status: "draft",
          startedAt: runnerProfile?.updated_at ?? new Date().toISOString(),
          locations: [],
          viewers: [],
          activeViewerCount: 0,
          cheers: await fetchCheers(token),
          isStandby: true,
        };
        inMemoryStore.set(token, standbySession);
        return standbySession;
      }
      return null;
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

    const locations: Location[] = (locationRows || []).map((row: any) => ({
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

    // Load cheers permanently from Supabase
    const cheers = await fetchCheers(sessionRow.share_token, sessionRow.id, sessionRow.runner_id);

    const viewers = getActiveViewers(token);

    const session: Session = {
      id: sessionRow.id,
      shareToken: sessionRow.share_token,
      runnerId: sessionRow.runner_id ?? undefined,
      runnerName: sessionRow.runner_name,
      eventName: sessionRow.event_name,
      status: sessionRow.status,
      startedAt: sessionRow.started_at,
      finishedAt: sessionRow.finished_at,
      locations,
      route: routeRow
        ? {
            routeGeojson: routeRow.route_geojson,
            totalDistance: routeRow.total_distance,
            elevationGain: routeRow.elevation_gain,
          }
        : null,
      viewers,
      activeViewerCount: viewers.filter((v) => v.isOnline).length,
      cheers,
      isSos: false,
    };

    inMemoryStore.set(sessionRow.share_token, session);
    if (sessionRow.runner_id) {
      inMemoryStore.set(sessionRow.runner_id, session);
    }
    return session;
  } catch (err) {
    console.warn("Supabase getSession fallback to in-memory:", err);
    return null;
  }
}

export async function addLocation(
  token: string,
  location: Location
): Promise<Session | null> {
  let session = inMemoryStore.get(token);
  if (!session || session.status !== "live") {
    session = await getSession(token);
    if (!session || session.status !== "live") return null;
  }

  // Avoid duplicate timestamps
  if (session.locations.at(-1)?.recordedAt === location.recordedAt) {
    if (location.isSos !== undefined) session.isSos = location.isSos;
    return session;
  }

  if (location.isSos !== undefined) session.isSos = location.isSos;
  session.locations.push(location);

  const supabase = getSupabaseAdmin();
  if (supabase && session.id) {
    try {
      await supabase.from("tracking_locations").insert({
        session_id: session.id,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        battery: location.battery,
        recorded_at: location.recordedAt,
      });

      if (session.runnerId) {
        await supabase
          .from("tracking_runners")
          .update({ updated_at: location.recordedAt })
          .eq("id", session.runnerId);
      }
    } catch (err) {
      console.warn("Supabase addLocation write failed:", err);
    }
  }

  const viewers = getActiveViewers(token);
  session.viewers = viewers;
  session.activeViewerCount = viewers.filter((v) => v.isOnline).length;
  session.cheers = getCheers(token);
  return session;
}

export async function addLocations(
  token: string,
  newLocations: Location[]
): Promise<Session | null> {
  if (newLocations.length === 0) return getSession(token);

  let session = inMemoryStore.get(token);
  if (!session || session.status !== "live") {
    session = await getSession(token);
    if (!session || session.status !== "live") return null;
  }

  const existingTimestamps = new Set(
    session.locations.map((l) => l.recordedAt)
  );

  const toAdd: Location[] = [];
  for (const loc of newLocations) {
    if (!existingTimestamps.has(loc.recordedAt)) {
      existingTimestamps.add(loc.recordedAt);
      toAdd.push(loc);
      if (loc.isSos !== undefined) {
        session.isSos = loc.isSos;
      }
    }
  }

  if (toAdd.length > 0) {
    session.locations.push(...toAdd);

    const supabase = getSupabaseAdmin();
    if (supabase && session.id) {
      try {
        await supabase.from("tracking_locations").insert(
          toAdd.map((loc) => ({
            session_id: session.id,
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy,
            battery: loc.battery,
            recorded_at: loc.recordedAt,
          }))
        );

        if (session.runnerId) {
          await supabase
            .from("tracking_runners")
            .update({ updated_at: toAdd[toAdd.length - 1].recordedAt })
            .eq("id", session.runnerId);
        }
      } catch (err) {
        console.warn("Supabase addLocations batch write failed:", err);
      }
    }
  }

  const viewers = getActiveViewers(token);
  session.viewers = viewers;
  session.activeViewerCount = viewers.filter((v) => v.isOnline).length;
  session.cheers = getCheers(token);
  return session;
}

export async function saveRoute(
  token: string,
  route: RouteData
): Promise<boolean> {
  const session = await getSession(token);
  if (!session) return false;

  session.route = route;
  inMemoryStore.set(session.shareToken, session);
  if (session.runnerId) {
    inMemoryStore.set(session.runnerId, session);
  }

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
  const session = await getSession(token);
  const now = new Date().toISOString();

  if (session) {
    session.status = "stopped";
    session.finishedAt = now;
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      if (session?.id) {
        await supabase
          .from("tracking_sessions")
          .update({
            status: "stopped",
            finished_at: now,
          })
          .eq("id", session.id);
      } else {
        await supabase
          .from("tracking_sessions")
          .update({
            status: "stopped",
            finished_at: now,
          })
          .eq("share_token", token);
      }

      if (session?.runnerId) {
        await supabase
          .from("tracking_runners")
          .update({
            active_session_id: null,
            updated_at: now,
          })
          .eq("id", session.runnerId);
      }
    } catch (err) {
      console.warn("Supabase stopSession failed:", err);
    }
  }

  if (session?.runnerId) {
    const memRunner = inMemoryRunners.get(session.runnerId);
    if (memRunner) {
      memRunner.activeToken = undefined;
      memRunner.lastSeenAt = now;
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
    } catch (_) {}
  }

  const viewers = getActiveViewers(token);
  const activeCount = viewers.filter((v) => v.isOnline).length;
  return { ok: true, activeCount, viewers };
}

export function getCheers(token: string): Cheer[] {
  return inMemoryCheers.get(token) ?? [];
}

export async function fetchCheers(
  token: string,
  sessionId?: string,
  runnerId?: string
): Promise<Cheer[]> {
  const memCheers = inMemoryCheers.get(token);
  if (memCheers && memCheers.length > 0) {
    return memCheers;
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      let query = supabase.from("tracking_cheers").select("*");
      if (sessionId && runnerId) {
        query = query.or(`session_id.eq.${sessionId},runner_id.eq.${runnerId}`);
      } else if (sessionId) {
        query = query.eq("session_id", sessionId);
      } else if (runnerId) {
        query = query.eq("runner_id", runnerId);
      } else {
        query = query.eq("runner_id", token);
      }

      const { data: rows } = await query
        .order("created_at", { ascending: false })
        .limit(50);

      if (rows && rows.length > 0) {
        const mapped: Cheer[] = rows.map((r: any) => ({
          id: r.id,
          senderName: r.sender_name,
          message: r.message,
          emoji: r.emoji,
          audioData: r.audio_data,
          durationSeconds: r.duration_seconds,
          createdAt: r.created_at,
        }));
        inMemoryCheers.set(token, mapped);
        return mapped;
      }
    } catch (_) {}
  }
  return inMemoryCheers.get(token) ?? [];
}

export async function addCheer(
  token: string,
  cheerData: {
    senderName: string;
    message?: string;
    emoji?: string;
    audioData?: string;
    durationSeconds?: number;
  }
): Promise<Cheer | null> {
  const session = await getSession(token);
  const targetKey = session?.shareToken || token;
  const runnerId = session?.runnerId || (token.startsWith("runner_") || token.startsWith("wm_") ? token : undefined);

  let cheerList = inMemoryCheers.get(targetKey);
  if (!cheerList) {
    cheerList = [];
    inMemoryCheers.set(targetKey, cheerList);
  }
  if (runnerId && runnerId !== targetKey) {
    inMemoryCheers.set(runnerId, cheerList);
  }

  const cheer: Cheer = {
    id: "ch_" + Math.random().toString(36).substring(2, 9),
    senderName: cheerData.senderName.trim() || "Penonton",
    message: cheerData.message?.trim(),
    emoji: cheerData.emoji || (cheerData.audioData ? "🎙️" : "👏"),
    createdAt: new Date().toISOString(),
    audioData: cheerData.audioData,
    durationSeconds: cheerData.durationSeconds,
  };

  cheerList.unshift(cheer);
  if (cheerList.length > 50) {
    cheerList.pop();
  }

  if (session) {
    session.cheers = cheerList;
  }

  // Persist to Supabase tracking_cheers
  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      await supabase.from("tracking_cheers").insert({
        id: cheer.id,
        session_id: session?.id ?? null,
        runner_id: runnerId ?? null,
        sender_name: cheer.senderName,
        emoji: cheer.emoji,
        message: cheer.message ?? null,
        audio_data: cheer.audioData ?? null,
        duration_seconds: cheer.durationSeconds ?? null,
        created_at: cheer.createdAt,
      });
    } catch (err) {
      console.warn("Supabase addCheer write failed:", err);
    }
  }

  return cheer;
}

export async function updateSessionTitle(
  token: string,
  newTitle: string
): Promise<boolean> {
  const cleanTitle = newTitle.trim();
  if (!cleanTitle) return false;

  const session = await getSession(token);
  if (session) {
    session.eventName = cleanTitle;
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      if (session?.id) {
        await supabase
          .from("tracking_sessions")
          .update({ event_name: cleanTitle })
          .eq("id", session.id);
      } else {
        await supabase
          .from("tracking_sessions")
          .update({ event_name: cleanTitle })
          .eq("share_token", token);
      }
    } catch (_) {}
  }
  return true;
}

export async function setSos(
  token: string,
  isSos: boolean
): Promise<boolean> {
  const session = await getSession(token);
  if (!session) return false;
  session.isSos = isSos;
  return true;
}
