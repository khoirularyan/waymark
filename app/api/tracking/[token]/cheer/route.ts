import { NextResponse } from "next/server";
import { z } from "zod";
import { addCheer, getCheers } from "../../../../../lib/tracking-store";

interface RouteProps {
  params: Promise<{ token: string }>;
}

const cheerSchema = z.object({
  senderName: z.string().max(80).optional(),
  emoji: z.string().max(16).optional(),
  message: z.string().max(280).optional(),
  audioData: z.string().max(800000).optional(), // base64 voice note
  durationSeconds: z.number().nonnegative().max(60).optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const body = await request.json();
    const parsed = cheerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid cheer payload", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const cheer = await addCheer(token, {
      senderName: parsed.data.senderName || "Penonton",
      emoji: parsed.data.emoji || (parsed.data.audioData ? "🎙️" : "👏"),
      message: parsed.data.message,
      audioData: parsed.data.audioData,
      durationSeconds: parsed.data.durationSeconds,
    });

    if (!cheer) {
      return NextResponse.json(
        { error: "Session not found or inactive" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, cheer }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Malformed request payload" },
      { status: 400 }
    );
  }
}

export async function GET(_request: Request, { params }: RouteProps) {
  const { token } = await params;
  const cheers = getCheers(token);
  return NextResponse.json({ cheers });
}
