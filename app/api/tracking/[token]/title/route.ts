import { NextResponse } from "next/server";
import { z } from "zod";
import { updateSessionTitle } from "../../../../../lib/tracking-store";

interface RouteProps {
  params: Promise<{ token: string }>;
}

const titleSchema = z.object({
  title: z.string().min(1).max(120),
});

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const body = await request.json();
    const parsed = titleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid title", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const ok = await updateSessionTitle(token, parsed.data.title);
    if (!ok) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, title: parsed.data.title });
  } catch {
    return NextResponse.json(
      { error: "Malformed request payload" },
      { status: 400 }
    );
  }
}
