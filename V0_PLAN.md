# Moncode v0 — Minimal Vibe-Coding Loop

The smallest thing that proves the architecture: open Moncode, type a
prompt, watch the agent build a Next.js Monad dApp inside a Vercel
Sandbox, and view the running app live in the right pane. **No auth, no
wallet, no deploys, no DB, no billing.** This validates the Vercel
Sandbox + Claude Agent SDK + curated-skills loop end-to-end before we
add any of those.

## Status (2026-05-05)
End-to-end loop is functionally working: page load boots a sandbox,
chat runs the SDK in the sandbox, file edits land, preview iframe
reflects them. UI rebuilt on shadcn primitives. Remaining v0 gaps:
curated skills bundle (still cloning all of Monskills), starter
hardening, multi-turn UX (interrupting / replying mid-task — see
`Follow-ups discovered during build` below).

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
- [x] `Sandbox.create({ runtime: 'node22', ports: [3000], env: { ANTHROPIC_API_KEY }, timeout: 45m })`.
      Starter is shipped *in this repo* under `sandbox-assets/starter/`
      and uploaded via `writeFiles` (no git source). Hand-rolled minimal
      Next.js scaffold; no viem yet.
- [x] Boot script (sequential `runCommand`s):
  1. `writeFiles` starter, `agent.mjs`, and `skills/moncode/SKILL.md`.
  2. `npm install` (the starter's deps).
  3. `npm i @anthropic-ai/claude-agent-sdk` in the project (so
     `agent.mjs` can `import` it).
  4. `git clone https://github.com/therealharpaljadeja/monskills
     /vercel/sandbox/.claude-plugins/monskills` — the SDK only accepts
     `plugins: [{ type: 'local', path }]`, so we materialize the
     plugin on disk first.
  5. `npm run dev` with `{ detached: true }` on port 3000; dev-server
     logs piped into the boot stream as `[dev] …`.
- [x] Poll `sandbox.domain(3000)` for HTTP 2xx–4xx with a 5-min deadline
      before returning the URL to the frontend.
- [x] Surface boot logs over a dedicated SSE stream
      (`/api/sandbox/stream`) so the user sees "Spinning up your
      workspace…" with line output instead of a blank loader.

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
      Currently we clone the **whole** Monskills repo without curation —
      the deploy-with-private-key skills are still on disk. Mitigation
      lives in `agent.mjs`'s system-prompt note ("do not write or run
      deploy scripts; use end-user wallet connect"). Real curation
      deferred.
- [ ] **Drop / rewrite**: developer-side deploy paths that use
      `PRIVATE_KEY` env (`vercel-deploy`, deploy scripts in `scaffold`,
      `wallet`'s dev-side flows). v0 has no deploy mechanism, so just
      omit them. Not done yet — see above.
- [x] **Add `skills/moncode/SKILL.md`** at top priority (highest-
      priority project skill). Shipped in `sandbox-assets/skills/moncode/SKILL.md`
      and dropped into the sandbox at `.claude/skills/moncode/SKILL.md`
      during boot.
- [ ] Pin curated set with a `skills-lock.json` so prompts are
      reproducible.

## Backend endpoints
- [x] `POST /api/sandbox` → ensures a sandbox exists for the session
      cookie. Returns `{ sandboxUrl, status }`. Idempotent.
- [x] `GET /api/sandbox/stream` (SSE) → boot-log + status events for
      the right-pane "Spinning up…" view.
- [x] `POST /api/chat` (SSE) → body `{ message }`. Invokes
      `runCommand({ cmd: 'node', args: ['agent.mjs', JSON.stringify({
      prompt, sessionId })] })` inside the sandbox, streams stdout via
      `command.logs()`, parses each line as `SDKMessage`, and forwards
      each as an SSE message.
  - `sessionId` capture: from `system:init` and from the final
    `result` message (lib/agent-runner.ts:82).
  - Turn is "done" on `type === "result"` — server emits a `done` SSE
    event and closes the stream.
- [x] `GET /api/files` → recursive readdir over `/vercel/sandbox`,
      filtered to skip `node_modules`, `.next`, `.git`,
      `.claude-plugins`. Returns a tree.
- [x] `GET /api/files/[...path]` → reads file contents from the
      sandbox.
- [x] No auth in v0; single in-memory session map keyed by cookie.

## Frontend layout
- [x] Single page, resizable two-pane split (shadcn
      `ResizablePanelGroup`, defaults 40/60):
  - **Left**: chat. Renders `SDKMessage` events: `assistant` text
    blocks, `tool_use` cards (collapsed by default, expandable to
    show tool name + params + result), `result` final answer,
    `error` cards.
  - **Right**: shadcn `Tabs` switcher (`forceMount` so the iframe
    survives tab switches).
    - **Preview**: `<iframe src={sandboxUrl}>` with an "Open ↗"
      button to the live URL.
    - **Files**: nested resizable split — tree on the left, `<pre>`
      viewer on the right. Read-only.
- [x] Boot state: right pane swaps to a streaming boot-log panel
      until `bootStatus === "ready"`.
- [x] After each chat turn ends, the client refetches `/api/files`
      and bumps an `iframeNonce` to force a preview reload (since
      starter HMR isn't always reliable for new files).
- [x] UI built on shadcn primitives (`Button`, `Textarea`, `Tabs`,
      `ScrollArea`, `Resizable`, `Collapsible`, `Card`) on top of
      Tailwind — replaces the inline-styled prototype.

## Local dev
- [x] `.env.example` lists `ANTHROPIC_API_KEY`, `VERCEL_TEAM_ID`,
      `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`, `MONCODE_MONSKILLS_GIT_URL`.
- [x] `npm run dev` starts the host on `localhost:3000`. Page load
      auto-triggers sandbox boot via `POST /api/sandbox`.
- [x] On server restart, the in-memory map clears — fine for v0;
      the user gets a fresh sandbox on next page load.

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
- [x] **Starter template**: hand-rolled minimal Next.js scaffold in
      `sandbox-assets/starter/`, uploaded via `writeFiles`. No viem
      yet — agent installs what it needs per turn.
- [ ] **Curated skills mechanism**: still cloning the full Monskills
      repo. Need to either fork-with-deletions or ship a
      `monskills-curated` plugin here. Default plan: our own bundle.
- [x] **Sandbox lifetime**: 45-minute timeout set at `Sandbox.create`
      (`FORTY_FIVE_MINUTES_MS` in `lib/bootstrap.ts`). No
      lazy-extension on chat — simpler.
- [x] **One sandbox per cookie**: implemented via a `moncode_session`
      cookie + in-memory `Map<sessionId, Session>` (lib/session.ts,
      lib/sandbox.ts). Two browser tabs share one sandbox per cookie.

## Follow-ups discovered during build
- [x] **Ongoing conversation, not one-shot turns.** Chat should be a
      single continuous conversation, not a fresh `query()` per
      message. Today each turn spawns a new `node agent.mjs` and we
      stitch turns together by passing `resume: sessionId` — works,
      but every turn pays cold-start cost and loses any in-flight
      tool state. Move to a long-lived `query()` driven by
      streaming-input mode (see interrupt item below — same
      mechanism). Resumability across page reloads / future
      multi-project switching: persist `sessionId` per project so the
      user can leave and come back; `resume` reloads the transcript
      from `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
      inside the sandbox. Multi-project UI is out of v0, but the
      session-id plumbing should land now so v1 just adds the picker.
      Refs: Agent SDK sessions / resume docs.
      **Status:** resumability shipped (`lib/session-store.ts`,
      `reattachSession` in `lib/bootstrap.ts`, `GET /api/transcript`,
      and `app/page.tsx` rehydration). Survives page reload + `npm
      run dev` restart; dies with the sandbox. Long-lived `query()` /
      streaming-input mode still deferred — bundled with the
      mid-task-interrupt item below.
- [ ] **Todo tracking UI.** The SDK emits `TodoWrite` tool-use events
      with a structured task list (pending / in_progress / completed).
      Render an accordion above the chat input showing the current
      list, collapsed by default, that expands to show per-task
      status. Updates come from streaming `tool_use` blocks for the
      `TodoWrite` tool — parse the input payload and replace local
      state on each emit. Ref:
      https://code.claude.com/docs/en/agent-sdk/todo-tracking
- [ ] **Mid-task user input / interrupt.** Today every turn spawns a
      fresh `node agent.mjs` with `prompt: string` (single-message
      mode). To let the user reply while the agent is mid-task or to
      interrupt, we need streaming-input mode (`prompt:
      AsyncIterable<SDKUserMessage>`) — which requires a long-lived
      agent process. Vercel Sandbox `runCommand` does **not** expose
      writable stdin on a running command (confirmed against the SDK
      reference), so the design will be: agent.mjs runs an HTTP server
      on a second exposed port (e.g. 3001) holding the long-lived
      `query()` iterable, with `POST /message`, `POST /interrupt`, and
      `GET /events` (SSE). Next route proxies to it. Auth via a
      per-sandbox shared secret in env. This is the same long-lived
      process that powers the "ongoing conversation" item above —
      build them together.
- [ ] **Hydration warning on first load.** Symptom unclear; likely
      either browser-extension attribute injection on `<body>`
      (`suppressHydrationWarning` fix) or `react-resizable-panels` SSR
      mismatch (gate the panel group on a "mounted" flag). Need exact
      console message to pick.
- [ ] **"Invalid API key · Fix external API key" path.** Surface the
      Anthropic 401 cleanly in the chat stream instead of letting it
      look like a generic chat error. Add a host-side preflight ping to
      Anthropic before booting the sandbox so we fail fast with a
      clearer message.
- [ ] **Cross-platform `package-lock.json`.** Lockfile was first
      generated on Linux during shadcn install and dropped the
      `darwin-arm64` SWC native binary, breaking `next dev` on the
      author's Mac. Fix on next regeneration: run install on each
      target platform once or use `--include=optional` before
      committing.

## Out of v0, queued for v1
- Privy auth + per-user sandbox naming (`moncode-<userId>-<projectId>`).
- `monad_*` MCP tools via `createSdkMcpServer()` + `canUseTool` wallet
  bridge (with our own callback timeout — SDK doesn't time out).
- Browser-side file editing (writes through `sandbox.fs.writeFile`).
- Snapshot / resume across server restarts (persistent sandboxes).
- Multi-instance backend (move sandbox map to Redis).
- Egress `networkPolicy` allowlist.
- Faucet, transactions panel, credits.
