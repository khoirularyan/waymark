import { NextResponse } from "next/server";
import { z } from "zod";
import { stopSession } from "../../../../lib/tracking-store";

const schema = z.object({
  token: z.string().min(1).max(128),
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
        { error: "Invalid token", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const session = await stopSession(parsed.data.token);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, status: session.status });
  } catch {
    return NextResponse.json(
      { error: "Malformed request payload" },
      { status: 400 }
    );
  }
}
