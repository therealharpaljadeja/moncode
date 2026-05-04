# Moncode v0 — Minimal Vibe-Coding Loop

The smallest thing that proves the architecture: open Moncode, type a
prompt, watch the agent build a Next.js Monad dApp inside a Vercel
Sandbox, and view the running app live in the right pane. **No auth, no
wallet, no deploys, no DB, no billing.** This validates the Vercel
Sandbox + Claude Code + curated-skills loop end-to-end before we add any
of those.

## Goal
A developer runs `npm run dev` locally, opens `localhost:3000`, sees a
Moncode shell with a chat sidebar and a right pane. First page load
boots a Vercel Sandbox with a Next.js starter, the dev server starts
inside, and the right pane embeds the live app. Each chat message runs
the Claude Code CLI inside the sandbox; file edits HMR-reload the
preview iframe.

## Non-goals (explicit)
- No Privy / no auth — single user, single sandbox per server process.
- No wallet UI, no `monad_*` tools, no deploys, no faucet.
- No DB, no credits, no persistence across server restarts.
- No browser-side file editing — file explorer is read-only.
- No multi-instance backend. In-memory sandbox map is fine.
- No snapshots / resume — refresh = new sandbox.

## Architecture (one paragraph)
Next.js app on `localhost:3000`. Server-side keeps an in-memory
`Map<sessionCookie, { sandbox, sandboxUrl, sessionId }>`. On first chat
message (or page load) we call `Sandbox.create` with a Next.js + Monad
starter as a git source, install Claude Code CLI + curated skills, start
`npm run dev` detached on port 3000, and return `sandbox.domain(3000)`.
Each chat message executes `claude --print --output-format stream-json
--resume <sessionId> "<prompt>"` inside the sandbox via `runCommand`,
streams stdout, parses each JSON line, and forwards events to the
browser over SSE.

## Repo layout
```
app/
  page.tsx                // chat + preview/files split
  api/
    sandbox/route.ts      // POST: ensure sandbox, return preview URL
    chat/route.ts         // POST (SSE): run claude in sandbox, stream events
    files/
      route.ts            // GET: list tree
      [...path]/route.ts  // GET: read file contents
lib/
  sandbox.ts              // Sandbox.create / get / runCommand wrappers + in-memory map
  skills.ts               // resolves the curated skills bundle path
  claude.ts               // builds the claude CLI command, parses stream-json
skills/
  moncode/SKILL.md        // tool contract + Moncode-specific rules
  monskills-curated/      // pinned subset (see Skills section)
prompt.md                 // optional: initial bootstrap prompt for new sandboxes
.env.example
package.json
```

## Sandbox bootstrap
- [ ] `Sandbox.create({ name?, source: { type: 'git', url: <starter>, revision }, ports: [3000], env: { ANTHROPIC_API_KEY }, timeout: 45m })`.
      Choose a Next.js + viem starter (TBD — Monskills' scaffold is the
      candidate; otherwise a vanilla `create-next-app` + viem snippet).
- [ ] Boot script (sequential `runCommand`s):
  1. `npm install`
  2. `npm i -g @anthropic-ai/claude-code`
  3. Copy curated skills bundle into `/vercel/sandbox/.claude/skills/`
     via `writeFiles`.
  4. `npm run dev` with `{ detached: true }` on port 3000.
- [ ] Poll `sandbox.domain(3000)` for HTTP 200 (or wait for the dev
      server's "ready" line in `command.logs()`) before returning the
      URL to the frontend.
- [ ] Surface boot logs (steps 1–4) over the same SSE stream the chat
      uses, so the user sees "Spinning up your workspace…" with line
      output instead of a blank loader.

## Skills bundle (curated, not blanket-installed)
Monskills ships wallet/deploy patterns that assume a private key. In
Moncode the agent has no key. Curate:
- [ ] **Reuse from Monskills as-is** (pure knowledge + end-user
      patterns): `why-monad`, `addresses`, `gas`, `concepts`, `api`,
      `indexer`, `wallet-integration`, frontend parts of `scaffold`.
      Generated dApps are shared with anyone — they need standard
      wallet-connect code, which these skills provide.
- [ ] **Drop / rewrite**: developer-side deploy paths that use
      `PRIVATE_KEY` env (`vercel-deploy`, deploy scripts in `scaffold`,
      `wallet`'s dev-side flows). v0 has no deploy mechanism, so just
      omit them — the agent will produce contracts but won't try to
      deploy.
- [ ] **Add `skills/moncode/SKILL.md`** at top priority. Content:
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
- [ ] `POST /api/chat` (SSE) → body `{ message }`. Runs
      `claude --print --output-format stream-json --resume <sessionId>
      "<message>"` inside the sandbox via `runCommand`, parses stdout
      line by line as JSON events, forwards each as an SSE message.
      Tracks `sessionId` from the first run's init event so subsequent
      messages resume the same Claude Code session.
- [ ] `GET /api/files` → `sandbox.fs.readdir('/vercel/sandbox', {
      recursive: true })`, filtered to skip `node_modules`, `.next`,
      `.git`. Returns a tree.
- [ ] `GET /api/files/[...path]` → `sandbox.fs.readFile(path, 'utf8')`.
- [ ] No auth on any of these in v0; bind to `localhost` only.

## Frontend layout
- [ ] Single page, two columns:
  - **Left (≈40%)**: chat. Message list + input box. Renders Claude
    Code stream-json events: `assistant` text blocks, `tool_use` cards
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

## Open decisions
- [ ] **Starter template URL**: pick one Next.js + viem + Monad-aware
      starter and pin it. Candidates: a Monskills scaffold, or a
      hand-rolled minimal one in this repo's `templates/`.
- [ ] **Sandbox lifetime**: extend to the 45-min Hobby cap on boot, or
      lazy-extend on each chat message? Lazy is cheaper.
- [ ] **One sandbox per cookie vs one per server process**: cookie is
      slightly more code but lets you open two tabs without them
      colliding. Default to per-process for v0 unless we decide
      otherwise.
- [ ] **CLI vs SDK** inside sandbox: v0 plan uses the **CLI** with
      `--output-format stream-json` because it's the shortest path to
      structured events. If we hit a limitation (e.g. no `canUseTool`
      wiring needed yet, but if we add it in v1 we'll switch to the
      SDK).

## Out of v0, queued for v1
- Privy auth + per-user sandbox naming (`moncode-<userId>-<projectId>`).
- `monad_*` MCP tools + `canUseTool` wallet bridge.
- Browser-side file editing (writes through `sandbox.fs.writeFile`).
- Snapshot / resume across server restarts (persistent sandboxes).
- Multi-instance backend (move sandbox map to Redis).
- Egress `networkPolicy` allowlist.
- Faucet, transactions panel, credits.
