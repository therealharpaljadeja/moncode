import path from "path";
import fs from "fs/promises";
import { SANDBOX_CWD, Session } from "@/lib/sandbox";
import { updateProject } from "@/lib/projects";

let cachedAgentScript: Buffer | null = null;
async function loadAgentScript(): Promise<Buffer> {
  if (cachedAgentScript) return cachedAgentScript;
  const abs = path.join(process.cwd(), "sandbox-assets", "agent.mjs");
  cachedAgentScript = await fs.readFile(abs);
  return cachedAgentScript;
}

export type AgentEvent =
  | { type: "sdk_message"; message: Record<string, unknown> }
  | { type: "agent_stderr"; data: string }
  | { type: "parse_error"; raw: string; error: string }
  | { type: "agent_exit"; exitCode: number };

export async function* runAgentTurn(
  session: Session,
  prompt: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const payload = JSON.stringify({
    prompt,
    sessionId: session.agentSessionId,
  });

  if (!session.sandbox) {
    throw new Error("sandbox is not ready");
  }

  // Re-upload agent.mjs each turn so reattached or pre-existing sandboxes
  // pick up host-side changes without needing a fresh boot.
  const script = await loadAgentScript();
  await session.sandbox.writeFiles([{ path: "agent.mjs", content: script }]);

  const command = await session.sandbox.runCommand({
    cmd: "node",
    args: ["agent.mjs", payload],
    cwd: SANDBOX_CWD,
    detached: true,
    signal,
  });

  let stdoutBuffer = "";

  for await (const log of command.logs({ signal })) {
    const chunk = log.data.toString();

    if (log.stream === "stderr") {
      yield { type: "agent_stderr", data: chunk };
      continue;
    }

    stdoutBuffer += chunk;
    const newlineIndex = lastNewlineIndex(stdoutBuffer);
    if (newlineIndex < 0) continue;

    const complete = stdoutBuffer.slice(0, newlineIndex);
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

    for (const line of complete.split("\n")) {
      yield* parseLine(session, line);
    }
  }

  if (stdoutBuffer.length > 0) {
    yield* parseLine(session, stdoutBuffer);
  }

  const finished = await command.wait();
  if (finished.exitCode !== 0) {
    yield { type: "agent_exit", exitCode: finished.exitCode };
  }
}

function lastNewlineIndex(s: string): number {
  return s.lastIndexOf("\n");
}

function* parseLine(
  session: Session,
  line: string,
): Generator<AgentEvent> {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const message = JSON.parse(trimmed) as Record<string, unknown>;
    captureSessionId(session, message);
    yield { type: "sdk_message", message };
  } catch (err) {
    yield {
      type: "parse_error",
      raw: trimmed,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function captureSessionId(
  session: Session,
  message: Record<string, unknown>,
): void {
  const type = message.type;
  const subtype = message.subtype;
  const sid = message.session_id;
  if (typeof sid !== "string") return;
  if (
    (type === "system" && subtype === "init") ||
    type === "result"
  ) {
    if (session.agentSessionId === sid) return;
    session.agentSessionId = sid;
    void updateProject(session.projectId, { agentSessionId: sid });
  }
}
