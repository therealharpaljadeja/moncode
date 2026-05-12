import { NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/session";
import { getSession, setSession } from "@/lib/sandbox";
import {
  createSandboxForSession,
  reattachSession,
} from "@/lib/bootstrap";
import { getStored } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const sessionId = await getOrCreateSessionId();
  let session = getSession(sessionId);

  if (!session) {
    try {
      const reattached = await reattachSession(sessionId);
      if (reattached) {
        setSession(sessionId, reattached);
        session = reattached;
      } else {
        session = createSandboxForSession(sessionId);
        setSession(sessionId, session);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { status: "failed", error: message },
        { status: 500 },
      );
    }
  }

  const stored = await getStored(sessionId);
  return NextResponse.json({
    status: session.bootStatus,
    sandboxUrl: session.bootStatus === "ready" ? session.sandboxUrl : null,
    bootError: session.bootError ?? null,
    title: stored?.title ?? null,
  });
}

export async function GET() {
  const sessionId = await getOrCreateSessionId();
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ status: "uninitialized" });
  }
  const stored = await getStored(sessionId);
  return NextResponse.json({
    status: session.bootStatus,
    sandboxUrl: session.bootStatus === "ready" ? session.sandboxUrl : null,
    bootError: session.bootError ?? null,
    title: stored?.title ?? null,
  });
}
