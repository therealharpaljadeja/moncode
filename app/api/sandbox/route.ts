import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/session";
import { getSession, setSession } from "@/lib/sandbox";
import { createSandboxForSession } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const sessionId = await getOrCreateSessionId();
  let session = getSession(sessionId);

  if (!session) {
    try {
      session = await createSandboxForSession();
      setSession(sessionId, session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { status: "failed", error: message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    status: session.bootStatus,
    sandboxUrl: session.bootStatus === "ready" ? session.sandboxUrl : null,
    bootError: session.bootError ?? null,
  });
}

export async function GET() {
  const sessionId = await getOrCreateSessionId();
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ status: "uninitialized" });
  }
  return NextResponse.json({
    status: session.bootStatus,
    sandboxUrl: session.bootStatus === "ready" ? session.sandboxUrl : null,
    bootError: session.bootError ?? null,
  });
}
