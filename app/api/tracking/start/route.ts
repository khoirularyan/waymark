import { NextResponse } from "next/server";
import { z } from "zod";
import { startSession } from "../../../../lib/tracking-store";

const schema = z.object({
  runnerName: z.string().trim().min(1).max(80),
  eventName: z.string().trim().min(1).max(160),
  route: z
    .object({
      routeGeojson: z.any(),
      totalDistance: z.number().nonnegative(),
      elevationGain: z.number().optional(),
    })
    .optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid session details", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const routeData = parsed.data.route
      ? {
          routeGeojson: parsed.data.route.routeGeojson,
          totalDistance: parsed.data.route.totalDistance,
          elevationGain: parsed.data.route.elevationGain,
        }
      : undefined;

    const session = await startSession(
      parsed.data.runnerName,
      parsed.data.eventName,
      routeData
    );

    return NextResponse.json(
      {
        shareToken: session.shareToken,
        publicUrl: `/live/${session.shareToken}`,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Malformed request payload" },
      { status: 400 }
    );
  }
}
