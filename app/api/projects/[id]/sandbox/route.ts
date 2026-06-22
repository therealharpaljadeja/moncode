import { NextResponse } from "next/server";

import { requireOwnedProject } from "@/lib/auth";
import {
  createSandboxForProject,
  reattachSession,
} from "@/lib/bootstrap";
import { getSession, setSession } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const owned = await requireOwnedProject(req, projectId);
  if (owned instanceof NextResponse) return owned;

  let session = getSession(projectId);

  if (!session) {
    try {
      const reattached = await reattachSession(projectId);
      if (reattached) {
        setSession(projectId, reattached);
        session = reattached;
      } else {
        session = createSandboxForProject(projectId);
        setSession(projectId, session);
      }
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
    title: owned.project.title,
    projectId,
  });
}

export async function GET(req: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const owned = await requireOwnedProject(req, projectId);
  if (owned instanceof NextResponse) return owned;

  const session = getSession(projectId);
  if (!session) {
    return NextResponse.json({ status: "uninitialized" });
  }

  return NextResponse.json({
    status: session.bootStatus,
    sandboxUrl: session.bootStatus === "ready" ? session.sandboxUrl : null,
    bootError: session.bootError ?? null,
    title: owned.project.title,
    projectId,
  });
}
