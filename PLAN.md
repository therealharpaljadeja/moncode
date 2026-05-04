# Moncode Roadmap and Build Plan

Moncode is a Monad-first vibe-coding web app. The agent is built on the
**Claude Code SDK** (`@anthropic-ai/claude-agent-sdk`) running server-side and
driving a per-project **Vercel Sandbox** as its workspace. Domain knowledge
comes from **Monskills** loaded as a Claude Code plugin. **Testnet only** —
no mainnet code paths anywhere in this plan.

## Architecture and Foundations
- [ ] Pin the runtime topology: Next.js web app, agent-runner service (Node
      process running the Claude Code SDK), and a Vercel Sandbox per active
      project. The agent-runner reads/writes the sandbox filesystem via the
      sandbox's API; it does **not** run inside the sandbox itself, so SDK
      session files live on our infra and survive sandbox recycling.
- [ ] Define data models: users, projects, sessions (maps 1:1 to SDK
      `session_id`), messages, credits, transactions. Wallets are owned by
      Privy — we only store the Privy user id and read wallet info from
      Privy on demand.
- [ ] Set up environment configs for local, staging, and production.
- [ ] Add observability baseline (logs, traces, error tracking) with
      per-session correlation ids that match the SDK `session_id`.

## Authentication and Wallets (Privy)
- [ ] Integrate Privy authentication (social/email wallet onboarding).
- [ ] Pull wallet address, linked socials, and balances from Privy at
      request time — do not duplicate this in our DB.
- [ ] Lock the network to **Monad testnet** (chain id, RPC URLs, explorer =
      Monadscan testnet). No network switcher.

## Wallet UI Placement (think hard, decide once)
The wallet must be reachable without hijacking the chat or stealing screen
real estate from code/preview. Proposed layout:
- [ ] **Header pill** (always visible): truncated address, MON balance,
      testnet badge. Click opens the wallet drawer.
- [ ] **Right-side wallet drawer** (slide-out, not a sidebar): full wallet
      view — address + QR, balances, transaction history with Monadscan
      links, faucet button, environment-variable manager. Drawer overlays
      the preview pane; does not push layout.
- [ ] **Inline approval cards in the chat**: when the agent calls a wallet
      tool (deploy, send tx, sign message), an "Action required" card
      appears as the next message in the chat thread with Approve / Reject
      and a tx preview. This is where the user's eyes already are when the
      agent is working, and it preserves chat continuity.
- [ ] **Reject the alternatives** and document why: replacing chat with
      wallet UI breaks the agent loop; a permanent left/right sidebar
      cannibalizes editor or preview width; bottom drawer hides tx history
      behind an extra click. Header pill + slide-out drawer + inline
      approvals is the chosen pattern.

## Sandbox Runtime (Vercel Sandbox)
- [ ] Implement provider abstraction over Vercel Sandbox: create, exec,
      read/write file, stream logs, stop, snapshot/restore.
- [ ] **Resumability strategy** — concretely:
  - Each project owns one logical workspace. When the user opens a project,
    we either (a) reattach to its still-warm sandbox if one is running, or
    (b) create a fresh sandbox and restore the workspace from the last
    snapshot before the agent runs.
  - Workspace state = the project directory tarball + `node_modules` cache
    + any committed env. We snapshot to object storage (S3/R2) on
    `PostToolUse` for `Edit|Write|Bash` (debounced) and on session end.
  - Agent state = the SDK session JSONL at
    `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. This lives on
    the agent-runner host, backed up to object storage, and is loaded via
    `resume: <session_id>` when the user returns. This is independent of
    the sandbox's lifecycle.
  - Idle sandboxes are stopped after N minutes; on next user message the
    runner restores from snapshot and resumes the SDK session.
- [ ] Sandbox health checks and auto-recovery (restore snapshot, replay
      last user message, resume SDK session).

## Agent Orchestration
- [ ] **Per-session long-running worker** (replacing the old "queue + worker"
      framing). When a user sends a message, the web app routes it to the
      agent-runner service, which spawns or attaches to a Node process for
      that `session_id`. That process runs the SDK `query()`, streams
      `AssistantMessage` / `ResultMessage` events over WebSocket back to
      the browser, and exits when the run completes. We need this because
      agent runs are minutes-long and HTTP responses are not.
- [ ] Use the **SDK's built-in tools** for code work: `Read`, `Write`,
      `Edit`, `Bash`, `Glob`, `Grep`, `WebFetch`, `WebSearch`. **Do not
      reimplement a tool layer.**
- [ ] Use SDK `hooks.PostToolUse` matching `Edit|Write` to emit
      file-change events to the frontend (file-explorer refresh, preview
      reload).
- [ ] Use SDK `hooks.PostToolUse` matching `Bash` to detect long-running
      dev servers and surface the preview URL.
- [ ] Iterative edit loop: on every user message, resume the existing
      session (`resume: session_id`) rather than starting fresh.

## Custom Wallet Tools (the only tools we build)
The SDK covers code editing. We only add MCP tools for things Claude Code
cannot do: anything that requires the user's wallet.
- [ ] Build an in-process MCP server via `createSdkMcpServer()` exposing:
  - `monad_deploy_contract(bytecode, abi, args)`
  - `monad_send_transaction(to, value, data)`
  - `monad_sign_message(message)`
  - `monad_read_contract(address, abi, fn, args)` (no approval needed)
  - `monad_request_faucet()`
- [ ] Gate every write tool through a **`canUseTool` callback** that:
  1. Pauses the SDK run.
  2. Pushes an "Action required" card into the chat with the decoded tx
     preview (function, args, gas, value).
  3. Awaits the user's Approve/Reject from the wallet drawer or inline
     card. The Privy wallet signs on Approve.
  4. Returns `{ behavior: "allow", updatedInput }` with the tx hash, or
     `{ behavior: "deny" }`. The agent sees the result and continues.
- [ ] All tx hashes are persisted to the project's transactions table and
      surfaced in the wallet drawer with Monadscan links (see
      Transactions Panel below).

## Editor, File Explorer, and Live Preview
- [ ] File explorer tree, syntax-highlighted code panel, live preview
      panel, streaming build/runtime logs.
- [ ] **User edits to files** flow:
  1. User edits a file in the in-browser editor (Monaco/CodeMirror).
  2. On save (Cmd-S or debounced), frontend POSTs the new contents to the
     agent-runner, which writes to the sandbox FS via the sandbox API.
  3. The runner emits the same `file-changed` event the SDK hook would
     emit, so the file explorer and preview pane react identically to
     user edits and agent edits.
  4. The dev server inside the sandbox (Vite/Next) HMRs the change; the
     preview iframe reloads.
  5. The next agent turn naturally sees the updated file because the SDK
     re-reads on `Read`.
- [ ] Snapshot history per project (uses the same snapshot stream as the
      Sandbox section) with one-click restore.

## Monad Domain Knowledge via Monskills
Replaces the previous "Monad-Specific Developer Experience" section.
Monskills (`therealharpaljadeja/monskills`) is a Claude Code plugin that
ships Monad skills for contracts, deployment, wallet integration, gas,
indexers, scaffolding, tooling, and Vercel deploy.
- [ ] Install Monskills as a Claude Code plugin in the agent-runner so
      skills auto-load from `.claude/skills/`. The agent picks the right
      skill per task based on each `SKILL.md` description; no custom
      retrieval layer needed.
- [ ] Pin a Monskills version in `skills-lock.json` so prompts are
      reproducible across deploys.
- [ ] Add a thin Moncode-specific skill on top: project conventions,
      Monad testnet RPC + chain id, Monadscan URLs, the wallet-tool
      contract, and "always use the wallet tools, never call Bash to send
      transactions."
- [ ] Add starter templates as project scaffolds the agent can clone
      (token, NFT, dApp, dashboard) — these come from Monskills'
      `scaffold` and `wallet-integration` skills.

## Credit System and Billing
- [ ] Keep usage model compatible with existing credit consumption logic.
- [ ] Daily free grant: 5 credits per user per day.
- [ ] **Idempotent daily grant job**: a scheduled job (cron / Inngest)
      that issues one grant row per `(user_id, grant_date)` with a unique
      constraint on those columns, so re-running the job for the same day
      cannot double-grant. Job is safe to run on retries, on multiple
      workers, and after partial failures.
- [ ] Build usage UI (remaining credits, refill timer, plan CTA).
- [ ] **Defer paid plans**, but design the credits/entitlements schema so
      adding plan tiers, Stripe webhooks, and entitlement sync later is a
      drop-in (no schema migration of existing rows). One-line check:
      `entitlements.credits_per_day` and `entitlements.plan_id` columns
      from day one, even if only the free plan exists.

## Faucet
- [ ] In-app faucet for **Monad testnet only**.
- [ ] Strict rate limits (per user, per wallet, per IP, per device).
- [ ] Anti-abuse checks and cooldown UX messaging.

## Transactions Panel (faucet + every wallet action)
- [ ] Live transaction list in the wallet drawer covering **all** txs to
      and from the user's wallet — agent-driven deploys, agent-driven
      sends, faucet drips, manual signs. Each row links to Monadscan
      testnet.
- [ ] Status states: pending → mined → confirmed → failed, updated from
      RPC subscriptions (or polling fallback).
- [ ] Filter by project; click a row to jump to the chat message that
      triggered it.

## Secrets / Env Var Storage (think hard)
The agent and the user's app both need env vars (RPC keys, third-party
API keys). We must never log them, must inject them into the sandbox at
boot only, and must let the user view/edit them in the wallet drawer.
- [ ] **Decision pending**: pick one and document the tradeoff:
  - **Option A — Managed secrets (Infisical or Doppler)**: per-user
    project in the secrets provider, fetched server-side at sandbox
    boot and injected as env. Pros: rotation, audit log, no key
    material on our DB. Cons: extra vendor, per-user provisioning.
  - **Option B — Local encryption**: store ciphertexts in our DB,
    encrypted with a KMS-managed master key (AWS KMS / GCP KMS /
    Vercel encrypted env). Decrypt only in the agent-runner just
    before sandbox boot. Pros: no extra vendor, simpler. Cons: we
    own the blast radius.
  - **Option C — Vercel Sandbox project env**: if Vercel Sandbox
    exposes per-sandbox encrypted env via its own API, use it
    directly (verify before committing).
- [ ] Whichever option wins: never echo plaintext to logs, never expose
      via SDK `Read` (filter `.env*` from the agent's allowed paths
      unless the user opts in), and surface a UI in the wallet drawer
      to add/edit/delete keys.

## Interactive Agent Requests (built on `canUseTool`)
- [ ] Reuse the same approval mechanism the wallet tools use for any
      agent prompt that needs structured user input (e.g. "paste your
      Alchemy key", "pick a contract name").
- [ ] Resume flow is automatic — the SDK `canUseTool` callback simply
      returns once user input is provided.

## Security and Reliability
- [ ] Sandbox egress allowlist (Monad RPC, Monadscan, npm registry,
      Vercel, GitHub, anything Monskills explicitly needs).
- [ ] Abuse detection for prompts, faucet use, and automation loops.
- [ ] Backup, incident response, and kill-switch controls.

## QA, Launch, and Iteration
- [ ] End-to-end test coverage for: auth, project create, agent
      iteration, wallet approval, faucet, secret injection, snapshot
      restore.
- [ ] Load tests for concurrent agent runs and preview traffic.
- [ ] Beta feedback channel and prioritization process.

## Milestones
- [ ] **M1 (MVP)**: Privy auth, Vercel Sandbox per project, Claude Code
      SDK + Monskills agent loop, file explorer + preview, header pill +
      wallet drawer, inline approval cards, `monad_deploy_contract` and
      `monad_send_transaction` tools, daily credit grant, faucet,
      transactions panel.
- [ ] **M2**: Snapshot/resume across sandbox restarts, env-var manager,
      starter templates, snapshot history with restore.
- [ ] **M3**: Paid plans + entitlement webhooks, advanced templates,
      preflight tx simulation, team workflows.
