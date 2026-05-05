import path from "path";
import fs from "fs/promises";
import { Sandbox } from "@vercel/sandbox";
import {
  APP_PORT,
  SANDBOX_CWD,
  Session,
  appendBootLog,
} from "@/lib/sandbox";

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
  label: string,
  cmd: string,
  args: string[],
  opts: { cwd?: string; sudo?: boolean } = {},
): Promise<void> {
  appendBootLog(session, `$ ${label}`);
  const command = await session.sandbox.runCommand({
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

export function bootSandbox(session: Session): Promise<void> {
  return (async () => {
    try {
      appendBootLog(session, "Spinning up your workspace…");

      const starterFiles = await collectStarterFiles();
      const agentScript = await readAssetBuffer("agent.mjs");
      const moncodeSkill = await readAssetBuffer(
        "skills",
        "moncode",
        "SKILL.md",
      );

      appendBootLog(
        session,
        `Writing ${starterFiles.length} starter files into ${SANDBOX_CWD}…`,
      );
      await session.sandbox.writeFiles(
        starterFiles.map((f) => ({
          path: f.sandboxPath,
          content: f.content,
        })),
      );

      await session.sandbox.writeFiles([
        {
          path: path.relative(SANDBOX_CWD, AGENT_SCRIPT_PATH),
          content: agentScript,
        },
        {
          path: path.relative(SANDBOX_CWD, MONCODE_SKILL_PATH),
          content: moncodeSkill,
        },
      ]);

      await runStep(session, "npm install", "npm", ["install"]);

      await runStep(session, "install Claude Agent SDK", "npm", [
        "i",
        "@anthropic-ai/claude-agent-sdk",
      ]);

      await runStep(session, "clone Monskills", "git", [
        "clone",
        "--depth",
        "1",
        MONSKILLS_GIT_URL,
        MONSKILLS_PATH,
      ]);

      appendBootLog(session, "Starting dev server…");
      const dev = await session.sandbox.runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: SANDBOX_CWD,
        detached: true,
      });

      // Pipe dev-server logs into the boot stream in the background so the user
      // sees the "ready" line and any compile errors. We don't await this.
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

      const url = session.sandbox.domain(APP_PORT);
      session.sandboxUrl = url;
      await pollReadiness(session, url);

      session.bootStatus = "ready";
      appendBootLog(session, "Workspace ready.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      session.bootStatus = "failed";
      session.bootError = msg;
      appendBootLog(session, `ERROR: ${msg}`);
      throw err;
    }
  })();
}

export async function createSandboxForSession(): Promise<Session> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const sandbox = await Sandbox.create({
    runtime: "node22",
    ports: [APP_PORT],
    env: { ANTHROPIC_API_KEY: apiKey },
    timeout: FORTY_FIVE_MINUTES_MS,
  });

  const session: Session = {
    sandbox,
    sandboxUrl: sandbox.domain(APP_PORT),
    agentSessionId: null,
    bootPromise: Promise.resolve(),
    bootStatus: "pending",
    bootLog: [],
    bootListeners: new Set(),
  };

  session.bootPromise = bootSandbox(session);
  return session;
}
