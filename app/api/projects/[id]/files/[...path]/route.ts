import { NextResponse } from "next/server";

import { requireOwnedProject } from "@/lib/auth";
import { SANDBOX_CWD, getSession } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; path: string[] }> };

const MAX_BYTES = 1024 * 1024;

export async function GET(req: Request, context: RouteContext) {
  const { id: projectId, path: segments } = await context.params;
  const owned = await requireOwnedProject(req, projectId);
  if (owned instanceof NextResponse) return owned;

  const session = getSession(projectId);
  if (!session || session.bootStatus !== "ready" || !session.sandbox) {
    return NextResponse.json({ error: "sandbox not ready" }, { status: 409 });
  }

  const rel = segments.join("/");
  if (rel.includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  const abs = `${SANDBOX_CWD}/${rel}`;

  try {
    const stat = await session.sandbox.fs.stat(abs);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: "is a directory" }, { status: 400 });
    }
    if (stat.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `file too large (${stat.size} bytes)` },
        { status: 413 },
      );
    }
    const content = await session.sandbox.fs.readFile(abs, "utf8");
    return NextResponse.json({ path: rel, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
