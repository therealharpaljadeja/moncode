import { NextResponse } from "next/server";
import { readSessionId } from "@/lib/session";
import { SANDBOX_CWD, getSession } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1024 * 1024;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "no session" }, { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session || session.bootStatus !== "ready") {
    return NextResponse.json({ error: "sandbox not ready" }, { status: 409 });
  }

  const { path: segments } = await ctx.params;
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
