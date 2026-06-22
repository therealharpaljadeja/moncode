import path from "path";
import fs from "fs/promises";
import type { Sandbox } from "@vercel/sandbox";
import {
  APP_PORT,
  SANDBOX_CWD,
  Session,
  appendBootLog,
  setBootPhase,
} from "@/lib/sandbox";
import {
  getProject,
  updateProject,
} from "@/lib/projects";

const FORTY_FIVE_MINUTES_MS = 45 * 60 * 1000;
const READINESS_TIMEOUT_MS = 5 * 60 * 1000;
const READINESS_POLL_INTERVAL_MS = 2000;

const MONSKILLS_GIT_URL =
  process.env.MONCODE_MONSKILLS_GIT_URL ??
  "https://github.com/therealharpaljadeja/monskills";

const MONSKILLS_PATH = `${SANDBOX_CWD}/.claude-plugins/monskills`;
const AGENT_SCRIPT_PATH = `${SANDBOX_CWD}/agent.mjs`;
const MONCODE_SKILL_PATH = `${SANDBOX_CWD}/.claude/skills/moncode/SKILL.md`;

type StarterFile = { sandboxPath: string; content: Buffer; mode?: number };

async function collectStarterFiles(): Promise<StarterFile[]> {
  const root = path.join(process.cwd(), "sandbox-assets", "starter");
  const entries: StarterFile[] = [];

  async function walk(dir: string): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(abs);
      } else if (item.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        const content = await fs.readFile(abs);
        entries.push({ sandboxPath: rel, content });
      }
    }
  }

  await walk(root);
  return entries;
}

async function readAssetBuffer(...rel: string[]): Promise<Buffer> {
  const abs = path.join(process.cwd(), "sandbox-assets", ...rel);
  return fs.readFile(abs);
}

async function runStep(
  session: Session,
  sandbox: Sandbox,
  label: string,
  cmd: string,
  args: string[],
  opts: { cwd?: string; sudo?: boolean } = {},
): Promise<void> {
  appendBootLog(session, `$ ${label}`);
  const command = await sandbox.runCommand({
    cmd,
    args,
    cwd: opts.cwd ?? SANDBOX_CWD,
    sudo: opts.sudo,
    detached: true,
  });
  for await (const log of command.logs()) {
    const text = log.data.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      appendBootLog(session, line);
    }
  }
  const finished = await command.wait();
  if (finished.exitCode !== 0) {
    throw new Error(`step "${label}" failed (exit ${finished.exitCode})`);
  }
}

/**
 * Pings Anthropic with a tiny request before booting the sandbox. A 401 here
 * means the host's ANTHROPIC_API_KEY is bad; failing now gives a clear error
 * instead of a confusing "Invalid API key" mid-conversation.
 */
async function preflightAnthropicKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed !== apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY has leading or trailing whitespace — strip it from your .env",
    );
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  if (res.status === 401 || res.status === 403) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ? ` — ${body.error.message}` : "";
    } catch {
      // ignore
    }
    throw new Error(
      `ANTHROPIC_API_KEY rejected by Anthropic (HTTP ${res.status})${detail}`,
    );
  }
  if (!res.ok && res.status !== 429) {
    // 429 = rate limited; the key is valid, proceed. Any other non-2xx is
    // suspicious but not necessarily auth — log and continue.
    const text = await res.text().catch(() => "");
    throw new Error(
      `Anthropic preflight failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }
}

async function pollReadiness(session: Session, url: string): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || (res.status >= 200 && res.status < 500)) {
        appendBootLog(session, `Preview ready at ${url}`);
        return;
      }
    } catch {
      // dev server not up yet
    }
    await new Promise((r) => setTimeout(r, READINESS_POLL_INTERVAL_MS));
  }
  throw new Error(`dev server did not become ready within ${READINESS_TIMEOUT_MS}ms`);
}

async function bootSandbox(session: Session, sandbox: Sandbox): Promise<void> {
  try {
    const starterFiles = await collectStarterFiles();
    const agentScript = await readAssetBuffer("agent.mjs");
    const moncodeSkill = await readAssetBuffer(
      "skills",
      "moncode",
      "SKILL.md",
    );

    setBootPhase(session, {
      key: "writing-files",
      label: "Writing starter files…",
    });
    await sandbox.writeFiles(
      starterFiles.map((f) => ({
        path: f.sandboxPath,
        content: f.content,
      })),
    );

    await sandbox.writeFiles([
      {
        path: path.relative(SANDBOX_CWD, AGENT_SCRIPT_PATH),
        content: agentScript,
      },
      {
        path: path.relative(SANDBOX_CWD, MONCODE_SKILL_PATH),
        content: moncodeSkill,
      },
    ]);

    setBootPhase(session, {
      key: "installing-deps",
      label: "Installing project dependencies…",
    });
    await runStep(session, sandbox, "npm install", "npm", ["install"]);

    setBootPhase(session, {
      key: "installing-sdk",
      label: "Installing Claude Agent SDK…",
    });
    await runStep(session, sandbox, "install Claude Agent SDK", "npm", [
      "i",
      "@anthropic-ai/claude-agent-sdk",
    ]);

    setBootPhase(session, {
      key: "cloning-skills",
      label: "Fetching Monad skills…",
    });
    await runStep(session, sandbox, "clone Monskills", "git", [
      "clone",
      "--depth",
      "1",
      MONSKILLS_GIT_URL,
      MONSKILLS_PATH,
    ]);

    setBootPhase(session, {
      key: "starting-server",
      label: "Starting the dev server…",
    });
    const dev = await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "dev"],
      cwd: SANDBOX_CWD,
      detached: true,
    });

    // Keep piping dev-server output into the debug buffer so failures can be
    // diagnosed via bootLog, but the user only sees the phase label.
    void (async () => {
      try {
        for await (const log of dev.logs()) {
          for (const line of log.data.toString().split(/\r?\n/)) {
            if (line.length === 0) continue;
            appendBootLog(session, `[dev] ${line}`);
          }
        }
      } catch {
        // sandbox stopped or stream ended
      }
    })();

    const url = sandbox.domain(APP_PORT);
    session.sandboxUrl = url;
    setBootPhase(session, {
      key: "waiting-preview",
      label: "Waiting for the preview to come up…",
    });
    await pollReadiness(session, url);

    session.bootStatus = "ready";
    setBootPhase(session, { key: "ready", label: "Workspace ready." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    session.bootStatus = "failed";
    session.bootError = msg;
    appendBootLog(session, `ERROR: ${msg}`);
    throw err;
  }
}

/**
 * Returns a Session immediately so the caller can register it in the in-memory
 * map and start streaming boot logs. The sandbox itself is created inside
 * bootPromise — the user sees "Creating sandbox…" right away instead of a
 * silent stall while Sandbox.create runs.
 */
export function createSandboxForProject(projectId: string): Session {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const session: Session = {
    projectId,
    sandbox: null,
    sandboxUrl: "",
    agentSessionId: null,
    bootPromise: Promise.resolve(),
    bootStatus: "pending",
    bootLog: [],
    bootListeners: new Set(),
    bootPhase: { key: "preflight", label: "Validating your API key…" },
    bootPhaseListeners: new Set(),
  };

  session.bootPromise = (async () => {
    try {
      await preflightAnthropicKey(apiKey);

      setBootPhase(session, {
        key: "creating-sandbox",
        label: "Spinning up a fresh sandbox…",
      });
      const { Sandbox } = await import("@vercel/sandbox");
      const env: Record<string, string> = { ANTHROPIC_API_KEY: apiKey };
      if (process.env.MONCODE_DEBUG) {
        env.MONCODE_DEBUG = process.env.MONCODE_DEBUG;
      }
      const sandbox = await Sandbox.create({
        runtime: "node22",
        ports: [APP_PORT],
        env,
        timeout: FORTY_FIVE_MINUTES_MS,
      });
      session.sandbox = sandbox;
      session.sandboxUrl = sandbox.domain(APP_PORT);
      appendBootLog(session, `Sandbox ${sandbox.sandboxId} ready.`);

      await updateProject(projectId, {
        sandboxId: sandbox.sandboxId,
        agentSessionId: null,
      });

      await bootSandbox(session, sandbox);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (session.bootStatus !== "failed") {
        session.bootStatus = "failed";
        session.bootError = msg;
        appendBootLog(session, `ERROR: ${msg}`);
      }
    }
  })();

  return session;
}

/**
 * On host cold-start, try to reconnect to a sandbox we previously created for
 * this cookie. The dev server inside the sandbox kept running, so we skip the
 * full boot path and mark the session ready immediately.
 *
 * Returns null if there's no record, or if Sandbox.get fails (sandbox expired
 * or was stopped). In both cases the disk record is cleared so the caller
 * boots a fresh sandbox.
 */
export async function reattachSession(
  projectId: string,
): Promise<Session | null> {
  const stored = await getProject(projectId);
  if (!stored?.sandboxId) return null;

  try {
    const { Sandbox } = await import("@vercel/sandbox");
    const sandbox = await Sandbox.get({ sandboxId: stored.sandboxId });
    return {
      projectId,
      sandbox,
      sandboxUrl: sandbox.domain(APP_PORT),
      agentSessionId: stored.agentSessionId ?? null,
      bootPromise: Promise.resolve(),
      bootStatus: "ready",
      bootLog: ["Reconnected to existing workspace."],
      bootListeners: new Set(),
      bootPhase: { key: "ready", label: "Workspace ready." },
      bootPhaseListeners: new Set(),
    };
  } catch {
    await updateProject(projectId, {
      sandboxId: null,
      agentSessionId: null,
    }).catch(() => {});
    return null;
  }
}
