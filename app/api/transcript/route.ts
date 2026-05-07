import { NextResponse } from "next/server";
import { readSessionId } from "@/lib/session";
import { getSession, SANDBOX_CWD } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{8,}$/;

export async function GET() {
  const cookieId = await readSessionId();
  if (!cookieId) {
    return NextResponse.json({ messages: [] });
  }
  const session = getSession(cookieId);
  if (!session || session.bootStatus !== "ready" || !session.sandbox) {
    return NextResponse.json({ messages: [] });
  }
  const sid = session.agentSessionId;
  if (!sid || !SESSION_ID_PATTERN.test(sid)) {
    return NextResponse.json({ messages: [] });
  }

  // Glob across any home dir / cwd-encoding scheme. Two-pass: try the expected
  // -vercel-sandbox bucket first, then fall back to any project bucket.
  const cmd = await session.sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `cat $HOME/.claude/projects/*/${sid}.jsonl 2>/dev/null || true`,
    ],
    cwd: SANDBOX_CWD,
    detached: true,
  });

  let stdout = "";
  for await (const log of cmd.logs()) {
    if (log.stream === "stdout") stdout += log.data.toString();
  }
  await cmd.wait();

  const messages = parseTranscript(stdout);
  return NextResponse.json({ messages });
}

function parseTranscript(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.isSidechain === true) continue;
    const type = entry.type;
    if (type !== "user" && type !== "assistant" && type !== "result") continue;
    out.push(entry);
  }
  return out;
}
