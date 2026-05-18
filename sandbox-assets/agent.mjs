// Runs inside the Vercel Sandbox. The Moncode backend invokes this script
// per chat turn via `sandbox.runCommand`. It reads { prompt, sessionId } from
// argv[2], starts a single-message Claude Agent SDK query, and writes each
// SDKMessage as a JSON line on stdout.
//
// The host parses each line and forwards it to the browser over SSE. Keep
// stdout clean — no incidental console.log calls.

import { existsSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

const DEBUG = Boolean(process.env.MONCODE_DEBUG);
const debug = (line) => {
  if (DEBUG) process.stderr.write(line.endsWith("\n") ? line : line + "\n");
};

// The SDK's optional native deps include both glibc and musl Linux variants
// and `npm i` inside the sandbox often installs both. The SDK probes the musl
// path first; on a glibc sandbox that ELF can't be loaded (its interpreter
// /lib/ld-musl-x86_64.so.1 is absent) and the spawn ENOENTs out as "binary
// not found". Pin the right variant explicitly so the SDK doesn't guess.
function pickClaudeExecutable() {
  if (process.platform !== "linux" || process.arch !== "x64") return undefined;
  const isMusl = existsSync("/lib/ld-musl-x86_64.so.1");
  const pkg = isMusl
    ? "@anthropic-ai/claude-agent-sdk-linux-x64-musl"
    : "@anthropic-ai/claude-agent-sdk-linux-x64";
  const path = `/vercel/sandbox/node_modules/${pkg}/claude`;
  return existsSync(path) ? path : undefined;
}
const pathToClaudeCodeExecutable = pickClaudeExecutable();
debug(
  `agent.mjs: claude binary = ${pathToClaudeCodeExecutable ?? "<sdk default>"}`,
);

{
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "";
  debug(
    `agent.mjs: ANTHROPIC_API_KEY=${key ? `present (${key.length} chars, prefix ${key.slice(0, 7)})` : "MISSING"}; ` +
      `CLAUDE_CODE_OAUTH_TOKEN=${oauth ? `present (${oauth.length} chars)` : "absent"}`,
  );
}

const MONCODE_SYSTEM_NOTES = [
  "You are running inside Moncode, a sandboxed workspace for vibe-coding Monad dApps.",
  "The repo is a Next.js 15 + viem starter at /vercel/sandbox.",
  "v0 has no deploy mechanism. Generate contracts and a frontend, but do not write or run deploy scripts. If the user asks to deploy, explain deployment is coming in a later version.",
  "Generated dApps must use standard end-user wallet connect (RainbowKit / ConnectKit / wagmi) — never assume a private key.",
  "The dev server runs on port 3000 and HMR-reloads the user's preview iframe automatically.",
].join("\n");

let raw = process.argv[2];
if (!raw) {
  process.stderr.write("agent.mjs: missing argv[2] payload\n");
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (err) {
  process.stderr.write(`agent.mjs: invalid JSON payload: ${err.message}\n`);
  process.exit(2);
}

const { prompt, sessionId } = payload;
if (typeof prompt !== "string" || prompt.length === 0) {
  process.stderr.write("agent.mjs: prompt must be a non-empty string\n");
  process.exit(2);
}

// `continue: true` picks up the most recent conversation in cwd. We use it for
// every turn after the first instead of `resume: <sid>` — in stream-json
// one-shot mode, resuming a session that already has a `result` message exits
// without emitting any new messages, so follow-up turns produced no output.
const q = query({
  prompt,
  options: {
    cwd: "/vercel/sandbox",
    continue: Boolean(sessionId),
    pathToClaudeCodeExecutable,
    model: "claude-opus-4-6",
    effort: "medium",
    permissionMode: "bypassPermissions",
    settingSources: ["user", "project"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: MONCODE_SYSTEM_NOTES,
    },
    plugins: [
      { type: "local", path: "/vercel/sandbox/.claude-plugins/monskills" },
    ],
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch",
      "Skill",
      "TodoWrite",
    ],
  },
});

try {
  for await (const message of q) {
    process.stdout.write(JSON.stringify(message) + "\n");
  }
} catch (err) {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stdout.write(
    JSON.stringify({ type: "moncode_error", error: msg }) + "\n",
  );
  process.exit(1);
}
