import { NextResponse } from "next/server";
import { z } from "zod";
import { addLocation, addLocations } from "../../../../lib/tracking-store";

const locationItemSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracy: z.number().nonnegative(),
  battery: z.number().int().gte(0).lte(100),
  altitude: z.number().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  isSos: z.boolean().optional(),
  recordedAt: z.string().datetime(),
});

const singleSchema = locationItemSchema.extend({
  token: z.string().min(1).max(128),
});

const batchSchema = z.object({
  token: z.string().min(1).max(128),
  locations: z.array(locationItemSchema).min(1).max(500),
});

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (Array.isArray(body.locations)) {
      const parsedBatch = batchSchema.safeParse(body);
      if (!parsedBatch.success) {
        return NextResponse.json(
          { error: "Invalid batch location data", details: parsedBatch.error.format() },
          { status: 400 }
        );
      }

      const session = await addLocations(
        parsedBatch.data.token,
        parsedBatch.data.locations
      );

      if (!session) {
        return NextResponse.json(
          { error: "Session unavailable or already stopped" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        ok: true,
        syncedCount: parsedBatch.data.locations.length,
        activeViewerCount: session.activeViewerCount ?? 0,
        viewers: session.viewers ?? [],
        cheers: session.cheers ?? [],
      });
    }

    const parsed = singleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid location data", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const session = await addLocation(parsed.data.token, parsed.data);
    if (!session) {
      return NextResponse.json(
        { error: "Session unavailable or already stopped" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      activeViewerCount: session.activeViewerCount ?? 0,
      viewers: session.viewers ?? [],
      cheers: session.cheers ?? [],
    });
  } catch {
    return NextResponse.json(
      { error: "Malformed request payload" },
      { status: 400 }
    );
  }
}
