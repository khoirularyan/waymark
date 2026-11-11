import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveViewers, registerViewer } from "../../../../../lib/tracking-store";

interface RouteProps {
  params: Promise<{ token: string }>;
}

const viewerSchema = z.object({
  visitorId: z.string().min(3).max(120),
  displayName: z.string().max(80).optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const body = await request.json();
    const parsed = viewerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid viewer payload", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const result = await registerViewer(
      token,
      parsed.data.visitorId,
      parsed.data.displayName
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: "Session not found or inactive" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Malformed request payload" },
      { status: 400 }
    );
  }
}

export async function GET(_: Request, { params }: RouteProps) {
  const { token } = await params;
  const viewers = getActiveViewers(token);
  const activeCount = viewers.filter((v) => v.isOnline).length;

  return NextResponse.json({
    activeCount,
    viewers,
  });
}
