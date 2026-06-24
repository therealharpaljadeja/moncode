// Runs inside the Vercel Sandbox. The Moncode backend invokes this script
// per chat turn via `sandbox.runCommand`. It reads { prompt, sessionId } from
// argv[2], starts a single-message Claude Agent SDK query, and writes each
// SDKMessage as a JSON line on stdout.
//
// The host parses each line and forwards it to the browser over SSE. Keep
// stdout clean — no incidental console.log calls.

import { existsSync } from "node:fs";
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

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
  "",
  "## GitHub",
  "All GitHub work goes through Moncode MCP tools — credentials never enter the sandbox.",
  "Use `mcp__moncode__github_api` for get_user, list_repos, create_repo, create_pr, and push_workspace.",
  "push_workspace reads files from this sandbox on the host and commits via GitHub API — do not run git push or store tokens in the workspace.",
  "If GitHub is not connected, call `mcp__moncode__github_request_connection` with a short reason — the user will see a connect card in chat.",
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

const { prompt, sessionId, projectId, apiBaseUrl, agentSecret } = payload;
if (typeof prompt !== "string" || prompt.length === 0) {
  process.stderr.write("agent.mjs: prompt must be a non-empty string\n");
  process.exit(2);
}

function emitMoncodeEvent(event, extra = {}) {
  process.stdout.write(
    JSON.stringify({ type: "moncode_event", event, ...extra }) + "\n",
  );
}

async function callGithubApi(op) {
  if (!apiBaseUrl || !projectId || !agentSecret) {
    throw new Error(
      "GitHub integration is not configured on this workspace (missing apiBaseUrl, projectId, or agent secret).",
    );
  }
  const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/github/op`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Moncode-Agent-Secret": agentSecret,
      "X-Moncode-Project-Id": projectId,
    },
    body: JSON.stringify({ projectId, op }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === "GITHUB_CONNECTION_REQUIRED") {
    emitMoncodeEvent("github_auth_required", {
      reason:
        typeof data.error === "string"
          ? data.error
          : "Connect GitHub to continue.",
    });
    throw new Error("GITHUB_CONNECTION_REQUIRED");
  }
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `GitHub API failed (${res.status})`,
    );
  }
  return data.result;
}

const moncodeMcp = createSdkMcpServer({
  name: "moncode",
  version: "1.0.0",
  alwaysLoad: true,
  tools: [
    tool(
      "github_request_connection",
      "Ask the user to connect their GitHub account in Moncode. Use when GitHub is required but not connected.",
      { reason: z.string().describe("Why GitHub access is needed right now") },
      async ({ reason }) => {
        emitMoncodeEvent("github_auth_required", { reason });
        return {
          content: [
            {
              type: "text",
              text: "Waiting for the user to connect GitHub in the chat card. Ask them to connect, then continue once they confirm.",
            },
          ],
        };
      },
    ),
    tool(
      "github_api",
      "Run a GitHub operation via the user's connected Moncode account. Credentials stay on the Moncode host — never use git push or tokens in the sandbox. Supports get_user, list_repos, create_repo, create_pr, push_workspace.",
      {
        op: z.enum([
          "get_user",
          "list_repos",
          "create_repo",
          "create_pr",
          "push_workspace",
        ]),
        name: z.string().optional(),
        description: z.string().optional(),
        private: z.boolean().optional(),
        per_page: z.number().optional(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        title: z.string().optional(),
        head: z.string().optional(),
        base: z.string().optional(),
        body: z.string().optional(),
        branch: z.string().optional(),
        message: z.string().optional(),
      },
      async (args) => {
        const result = await callGithubApi(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
    ),
  ],
});

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
    mcpServers: {
      moncode: moncodeMcp,
    },
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
