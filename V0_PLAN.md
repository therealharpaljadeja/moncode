# Moncode v0 — Minimal Vibe-Coding Loop

The smallest thing that proves the architecture: open Moncode, type a
prompt, watch the agent build a Next.js Monad dApp inside a Vercel
Sandbox, and view the running app live in the right pane. **No auth, no
wallet, no deploys, no DB, no billing.** This validates the Vercel
Sandbox + Claude Agent SDK + curated-skills loop end-to-end before we
add any of those.

## Goal
A developer runs `npm run dev` locally, opens `localhost:3000`, sees a
Moncode shell with a chat sidebar and a right pane. First page load
boots a Vercel Sandbox with a Next.js starter, the dev server starts
inside, and the right pane embeds the live app. Each chat message runs
the **Claude Agent SDK** inside the sandbox; file edits HMR-reload the
preview iframe.

## Non-goals (explicit)
- No Privy / no auth — single user, single sandbox per server process.
- No wallet UI, no `monad_*` tools, no deploys, no faucet.
- No DB, no credits, no persistence across server restarts.
- No browser-side file editing — file explorer is read-only.
- No multi-instance backend. In-memory sandbox map is fine.
- No snapshots / resume — refresh = new sandbox.

## Architecture (one paragraph)
Next.js host on `localhost:3000`. Server-side keeps an in-memory
`Map<sessionCookie, { sandbox, sandboxUrl, sessionId }>`. On first chat
message (or page load) we call `Sandbox.create` with a Next.js + Monad
starter as a git source, install the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`), git-clone the curated Monskills
plugin onto the sandbox FS, drop the `moncode` skill into
`.claude/skills/`, start `npm run dev` detached on port 3000, and
return `sandbox.domain(3000)`. Each chat message runs a small
**`agent.mjs`** Node script *inside* the sandbox that imports the SDK
and calls `query()` (single-message mode), printing each `SDKMessage`
as a JSON line to stdout. The backend invokes that script via
`runCommand`, streams stdout via `command.logs()`, parses lines, and
forwards events to the browser over SSE.

## Repo layout
```
app/
  page.tsx                // chat + preview/files split
  api/
    sandbox/route.ts      // POST: ensure sandbox, return preview URL
    chat/route.ts         // POST (SSE): run agent.mjs in sandbox, stream events
    files/
      route.ts            // GET: list tree
      [...path]/route.ts  // GET: read file contents
lib/
  sandbox.ts              // Sandbox.create / get / runCommand wrappers + in-memory map
  bootstrap.ts            // ordered boot steps for a fresh sandbox
  agent-runner.ts         // builds agent.mjs invocation, parses SDKMessage stream
sandbox-assets/
  agent.mjs               // copied into the sandbox; imports the SDK and runs query()
  skills/
    moncode/SKILL.md      // tool contract + Moncode-specific rules
prompt.md                 // optional: initial bootstrap prompt for new sandboxes
.env.example
package.json
```

## Sandbox bootstrap
- [ ] `Sandbox.create({ name?, source: { type: 'git', url: <starter>, revision }, ports: [3000], env: { ANTHROPIC_API_KEY }, timeout: 45m })`.
      Choose a Next.js + viem starter (TBD — Monskills' scaffold is the
      candidate; otherwise a vanilla `create-next-app` + viem snippet).
- [ ] Boot script (sequential `runCommand`s):
  1. `npm install` (the starter's deps).
  2. `npm i @anthropic-ai/claude-agent-sdk` in the project (so
     `agent.mjs` can `import` it).
  3. `git clone https://github.com/therealharpaljadeja/monskills
     /vercel/sandbox/.claude-plugins/monskills` — the SDK only accepts
     `plugins: [{ type: 'local', path }]`, so we materialize the
     plugin on disk first.
  4. `writeFiles` to drop `agent.mjs` and `skills/moncode/SKILL.md`
     into the sandbox.
  5. `npm run dev` with `{ detached: true }` on port 3000.
- [ ] Poll `sandbox.domain(3000)` for HTTP 200 (or wait for the dev
      server's "ready" line in `command.logs()`) before returning the
      URL to the frontend.
- [ ] Surface boot logs over the same SSE stream the chat uses, so the
      user sees "Spinning up your workspace…" with line output instead
      of a blank loader.

## `agent.mjs` — the in-sandbox runner
A ~50-line Node script the backend invokes per chat message. Pseudocode:
```js
import { query } from "@anthropic-ai/claude-agent-sdk";

const { prompt, sessionId } = JSON.parse(process.argv[2]);

const q = query({
  prompt,
  options: {
    cwd: "/vercel/sandbox",
    resume: sessionId || undefined,           // first turn: undefined
    permissionMode: "bypassPermissions",       // sandbox is the safety boundary
    settingSources: ["user", "project"],       // load .claude/skills/, CLAUDE.md
    systemPrompt: { type: "preset", preset: "claude_code",
                    append: MONCODE_SYSTEM_NOTES },
    plugins: [{ type: "local",
                path: "/vercel/sandbox/.claude-plugins/monskills" }],
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob",
                   "Grep", "WebFetch", "WebSearch", "Skill"],
  },
});

for await (const m of q) {
  process.stdout.write(JSON.stringify(m) + "\n");
}
```
Notes:
- **Single-message mode** (`prompt` is a string). One process per chat
  turn. Resume the next turn via the `session_id` we capture from the
  first `system`/`init` message and from the final `result` message.
- **`bypassPermissions`** is correct here: the sandbox is the isolation
  boundary, and v0 has no MCP wallet tools to gate. When v1 adds
  `monad_*` tools, switch to `default` and add `canUseTool`.
- **`settingSources: ['user', 'project']`** is required to load the
  curated skills bundle and Monskills (passing the option overrides
  the default — must list every source we want).
- **`systemPrompt: preset claude_code`** is required to get the full
  coding system prompt. Default is minimal.
- **`Skill` must be in `allowedTools`** for skills to be invokable
  (frontmatter `allowed-tools` is ignored by the SDK).

## Skills bundle (curated, not blanket-installed)
Monskills ships wallet/deploy patterns that assume a private key. In
Moncode the agent has no key. Curate:
- [ ] **Reuse from Monskills as-is** (pure knowledge + end-user
      patterns): `why-monad`, `addresses`, `gas`, `concepts`, `api`,
      `wallet-integration`, frontend parts of `scaffold`. Generated
      dApps are shared with anyone — they need standard wallet-connect
      code, which these skills provide. Loaded via the plugin path.
- [ ] **Drop / rewrite**: developer-side deploy paths that use
      `PRIVATE_KEY` env (`vercel-deploy`, deploy scripts in `scaffold`,
      `wallet`'s dev-side flows). v0 has no deploy mechanism, so just
      omit them. We do this by either (a) forking the Monskills repo
      with deletions, or (b) copying only the safe skills into a new
      `monskills-curated` plugin we ship in this repo. Decision below.
- [ ] **Add `skills/moncode/SKILL.md`** at top priority (highest-
      priority project skill). Content:
  - Project conventions (TypeScript, Next.js, viem).
  - Monad testnet chain id, RPC URL, Monadscan URL.
  - "v0 has no deploy tool — generate contracts and a frontend, but do
    not write or run deploy scripts. When the user asks to deploy,
    explain that deployment is coming in a later version."
  - "Generated dApps must use standard end-user wallet connect
    (RainbowKit / ConnectKit / wagmi) — never assume a private key."
- [ ] Pin curated set with a `skills-lock.json` so prompts are
      reproducible.

## Backend endpoints
- [ ] `POST /api/sandbox` → ensures a sandbox exists for the session
      cookie. Returns `{ sandboxUrl, status }`. Idempotent.
- [ ] `POST /api/chat` (SSE) → body `{ message }`. Invokes
      `runCommand({ cmd: 'node', args: ['agent.mjs', JSON.stringify({
      prompt, sessionId })] })` inside the sandbox, streams stdout via
      `command.logs()`, parses each line as `SDKMessage`, and forwards
      each as an SSE message.
  - Track `sessionId`: capture from the first `system`/`init` message
    on the first turn so we have it before the turn finishes; persist
    on the `result` message in case it changes (it shouldn't).
  - Turn is "done" on `type === "result"` — close the SSE stream.
- [ ] `GET /api/files` → `sandbox.fs.readdir('/vercel/sandbox', {
      recursive: true })`, filtered to skip `node_modules`, `.next`,
      `.git`, `.claude-plugins`. Returns a tree.
- [ ] `GET /api/files/[...path]` → `sandbox.fs.readFile(path, 'utf8')`.
- [ ] No auth on any of these in v0; bind to `localhost` only.

## Frontend layout
- [ ] Single page, two columns:
  - **Left (≈40%)**: chat. Message list + input box. Renders
    `SDKMessage` events: `assistant` text blocks, `tool_use` cards
    (collapsed by default, expandable to show tool name + params),
    `tool_result` cards, `result` final answer.
  - **Right (≈60%)**: tab switcher.
    - **Preview**: `<iframe src={sandboxUrl}>` with a "Open in new tab"
      button and a refresh button.
    - **Files**: tree on the left of the right pane, viewer on the
      right. Read-only Monaco or just `<pre>` for v0.
- [ ] Boot state: while the sandbox is provisioning, show a status
      panel in the right pane streaming the boot log.
- [ ] After each chat turn ends (`result` event), refetch
      `/api/files` so the tree reflects the agent's edits. Preview
      iframe reloads automatically via Next dev-server HMR.

## Local dev
- [ ] `.env.local` with `ANTHROPIC_API_KEY`, `VERCEL_TEAM_ID`,
      `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.
- [ ] `npm run dev` starts the host on `localhost:3000`. First chat
      message (or page load) triggers sandbox boot.
- [ ] On server restart, the in-memory map clears — that's fine for
      v0; the user just gets a fresh sandbox.

## SDK gotchas to bake in
- **Default systemPrompt is minimal**, not Claude Code. Always pass
  `systemPrompt: { type: 'preset', preset: 'claude_code' }`.
- **`settingSources` overrides the default** when set. Must include
  `'project'` to load `.claude/skills/`, `CLAUDE.md`, `.mcp.json`.
- **`Skill` must be in `allowedTools`** (or `tools`) for skills to be
  invokable. Frontmatter is ignored.
- **`bypassPermissions` ignores `allowedTools`** — only
  `disallowedTools` and hooks gate. Fine for v0; revisit in v1 when
  wallet tools land.
- **Plugin install is `type: "local"` only** — must clone Monskills
  onto the sandbox FS first.
- **Sessions pin to `cwd`** — `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
  Keep `cwd: "/vercel/sandbox"` constant.
- **Tool handler throws kill the loop** — N/A for v0 (no custom
  tools), but bake into the v1 wallet-tool work.
- **Process model**: SDK spawns the bundled Claude Code binary as a
  child process over JSON-RPC stdio. So inside our sandbox there are
  two processes: `node agent.mjs` (parent, runs custom MCP servers in
  v1) and the spawned Claude Code binary (child, runs the model loop).

## Open decisions
- [ ] **Starter template URL**: pick one Next.js + viem + Monad-aware
      starter and pin it. Candidates: a Monskills scaffold, or a
      hand-rolled minimal one in this repo's `templates/`.
- [ ] **Curated skills mechanism**: fork Monskills with deletions, or
      ship a `monskills-curated` plugin in this repo that imports only
      the safe skills? Forking is less code, our own bundle is more
      hermetic. Default to our own bundle for v0.
- [ ] **Sandbox lifetime**: extend to the 45-min Hobby cap on boot, or
      lazy-extend on each chat message? Lazy is cheaper.
- [ ] **One sandbox per cookie vs one per server process**: cookie is
      slightly more code but lets you open two tabs without them
      colliding. Default to per-process for v0 unless we decide
      otherwise.

## Out of v0, queued for v1
- Privy auth + per-user sandbox naming (`moncode-<userId>-<projectId>`).
- `monad_*` MCP tools via `createSdkMcpServer()` + `canUseTool` wallet
  bridge (with our own callback timeout — SDK doesn't time out).
- Browser-side file editing (writes through `sandbox.fs.writeFile`).
- Snapshot / resume across server restarts (persistent sandboxes).
- Multi-instance backend (move sandbox map to Redis).
- Egress `networkPolicy` allowlist.
- Faucet, transactions panel, credits.
