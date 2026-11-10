import { NextResponse } from "next/server";
import { z } from "zod";
import { addLocation } from "../../../../lib/tracking-store";

const schema = z.object({
  token: z.string().uuid(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracy: z.number().nonnegative(),
  battery: z.number().int().gte(0).lte(100),
  recordedAt: z.string().datetime(),
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

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Malformed request payload" },
      { status: 400 }
    );
  }
}
