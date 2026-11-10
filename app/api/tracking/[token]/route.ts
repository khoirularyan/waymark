import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/tracking-store";

interface RouteProps {
  params: Promise<{ token: string }>;
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function GET(_: Request, { params }: RouteProps) {
  const { token } = await params;
  const session = await getSession(token);

  if (!session) {
    return NextResponse.json(
      { error: "Tracking session not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    runnerName: session.runnerName,
    eventName: session.eventName,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt ?? null,
    latestLocation: session.locations.at(-1) ?? null,
    locations: session.locations,
    route: session.route ?? null,
  });
}
