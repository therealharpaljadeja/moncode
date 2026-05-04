# Moncode Roadmap and Build Plan

Moncode is a Monad-first vibe-coding web app. Each project owns a
**persistent Vercel Sandbox** (microVM, `iad1`) with the **Claude Code SDK**
(`@anthropic-ai/claude-agent-sdk`) installed *inside* it. The sandbox runs
the agent, the user's project, and the dev server. Domain knowledge comes
from **Monskills** loaded as a Claude Code plugin. **Testnet only** — no
mainnet code paths anywhere in this plan.

## Architecture and Foundations
- [ ] Pin the runtime topology:
  - **Web app** (Next.js): chat UI, editor, file explorer, wallet drawer.
  - **Backend API** (Next.js routes / dedicated service): Privy session
    auth, sandbox lifecycle (create/get/stop/snapshot), wallet-tool
    callbacks (Privy server-side signing), credit accounting, secrets
    fetch, transactions DB.
  - **Per-project Vercel Sandbox**: runs `@anthropic-ai/claude-agent-sdk`,
    the user's project, and the dev server. The SDK runs **inside** the
    sandbox (per Vercel's official Claude Agent SDK guide) so all
    Read/Write/Edit/Bash tool calls are local — no remote round-trip per
    tool — and the SDK session JSONL persists with the sandbox snapshot.
  - **Communication**: backend ↔ sandbox over a long-lived WS to a small
    Node bridge running inside the sandbox. The bridge forwards user
    chat input into the SDK and streams `AssistantMessage` /
    `ResultMessage` events back. Wallet tool callbacks make outbound
    HTTPS from the sandbox to our backend with a per-sandbox short-lived
    token issued at boot.
- [ ] Define data models: users, projects, sessions (1:1 to SDK
      `session_id`), messages, credits, transactions, snapshots
      (`snapshotId` + sandbox name). Wallets are owned by Privy — store
      only the Privy user id.
- [ ] Set up environment configs for local, staging, and production.
      Auth to Vercel Sandbox via `VERCEL_OIDC_TOKEN` (12-hour) in
      production, or `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` +
      `VERCEL_TOKEN` for long-running services.
- [ ] Add observability baseline (logs, traces, error tracking) with
      per-session correlation ids that match the SDK `session_id` and
      the sandbox name.
- [ ] Note region constraint: Vercel Sandbox runs in `iad1` only —
      colocate backend and DB in `us-east` to keep callback latency low.

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
We use the `@vercel/sandbox` Node SDK and rely on first-class primitives
rather than rolling our own persistence.
- [ ] **Provider abstraction** with thin wrappers around the SDK:
      `Sandbox.create`, `Sandbox.get`, `runCommand` (blocking +
      `detached`), `sandbox.fs.*`, `writeFiles`, `readFile`,
      `extendTimeout`, `stop`, `snapshot`, `domain(port)`,
      `updateNetworkPolicy`.
- [ ] **Persistent sandboxes (beta)** — one per project, named
      `moncode-<project_id>`. Vercel auto-snapshots on stop and resumes
      by name. **Drop the previously planned S3/R2 tar pipeline** — it
      is redundant.
  - Open project → `Sandbox.get({ name })`. If running, reattach. If
    stopped, this triggers auto-resume from the latest snapshot.
  - First time → `Sandbox.create({ name, source, ports, env,
    networkPolicy })` with the starter template as `source: { type:
    'git', url, revision }`.
- [ ] **Lifecycle**: default 5-min timeout, extended via
      `extendTimeout()` up to **45 min on Hobby / 5 hr on Pro**. We
      target Pro for production so a coding session can last hours.
      Idle sandboxes are stopped (manual `stop()` on inactivity); next
      message auto-resumes them.
- [ ] **Snapshot points**: rely on persistent-sandbox auto-snapshot on
      stop. Add an explicit `sandbox.snapshot()` call on
      "save checkpoint" and on session end. No debounced PostToolUse
      snapshotting needed — the FS rides along inside the persistent
      sandbox.
- [ ] **Filesystem**: 32 GB ephemeral NVMe per sandbox; working dir
      `/vercel/sandbox`; user `vercel-sandbox` with sudo. All file ops
      from the backend go through `sandbox.fs.*` and `writeFiles` /
      `readFile` (the latter returns a `ReadableStream` for large
      files).
- [ ] **Live preview**: `Sandbox.create({ ports: [3000, 8545, ...] })`
      then `sandbox.domain(port)` for the public URL. Up to 15 ports
      per sandbox. Dev server started via `runCommand({ detached:
      true })` and its `command.logs()` async iterator streamed to the
      browser logs panel.
- [ ] **Health checks and recovery**: detect dead sandboxes, call
      `Sandbox.get({ name })` to auto-resume from the latest snapshot,
      replay last user message if the in-flight turn was lost, and
      resume the SDK session via `resume: <session_id>` (the JSONL is
      already inside the sandbox FS).
- [ ] **Debug**: rely on Vercel's `sandbox connect <id>` interactive
      shell + the Observability > Sandboxes dashboard for support.

## Agent Orchestration (SDK runs inside the sandbox)
- [ ] **In-sandbox agent process**: a small Node bridge inside each
      sandbox imports `@anthropic-ai/claude-agent-sdk`, opens a WS to
      our backend, and on each user message calls `query()` with the
      project's `session_id`. Outputs are streamed back over the WS.
- [ ] Use the **SDK's built-in tools** for code work: `Read`, `Write`,
      `Edit`, `Bash`, `Glob`, `Grep`, `WebFetch`, `WebSearch`. **Do not
      reimplement a tool layer.**
- [ ] **Hooks** fire locally (no proxy round-trip):
  - `PostToolUse` matching `Edit|Write` → bridge POSTs `file-changed`
    events to our backend, which fans out to the browser for file
    explorer + preview reload.
  - `PostToolUse` matching `Bash` → detect long-running dev servers
    and surface their port via `sandbox.domain(port)` to the preview
    iframe.
- [ ] Iterative edit loop: every user message uses
      `resume: <session_id>` (or `continue: true`) so the agent picks
      up the full prior history. JSONL at
      `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` lives
      inside the sandbox FS and is preserved by snapshots.
- [ ] **Why inside, not outside**: Vercel's KB guide
      (`vercel.com/kb/guide/using-vercel-sandbox-claude-agent-sdk`)
      endorses this pattern; tool calls avoid network latency; SDK
      session storage is automatically captured by snapshots; the user
      app and the agent share one FS so there's no sync drift.

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
  1. Pauses the SDK run inside the sandbox.
  2. Makes outbound HTTPS to our backend with the per-sandbox token,
     passing the decoded tx (function, args, gas, value).
  3. Backend pushes an "Action required" card into the user's chat over
     WS. Awaits Approve/Reject from the wallet drawer or inline card.
  4. On Approve, backend uses Privy server-side wallet to sign and
     broadcast on Monad testnet, returns the tx hash to the held
     callback.
  5. The callback returns `{ behavior: "allow", updatedInput }` with
     the tx hash, or `{ behavior: "deny" }`. The agent continues.
- [ ] All tx hashes are persisted to the project's transactions table
      and surfaced in the wallet drawer with Monadscan links (see
      Transactions Panel below).

## Editor, File Explorer, and Live Preview
- [ ] File explorer tree, syntax-highlighted code panel, live preview
      panel, streaming build/runtime logs.
- [ ] **User edits to files** flow:
  1. User edits a file in the in-browser editor (Monaco/CodeMirror).
  2. On save (Cmd-S or debounced), frontend POSTs the new contents to
     the backend, which calls `sandbox.fs.writeFile(path, content)`.
  3. The backend emits the same `file-changed` event the SDK
     `PostToolUse` hook would emit, so the file explorer and preview
     pane react identically to user edits and agent edits.
  4. The dev server inside the sandbox (Vite/Next) HMRs the change
     automatically (it's watching the same FS); the preview iframe
     refreshes via HMR.
  5. The next agent turn naturally sees the updated file because the
     SDK reads from the same FS.
- [ ] Snapshot history per project (uses `sandbox.snapshot()` and the
      persistent-sandbox auto-snapshots) with one-click restore via
      `Sandbox.create({ source: { type: 'snapshot', snapshotId } })`.

## Monad Domain Knowledge via Monskills
Replaces the previous "Monad-Specific Developer Experience" section.
Monskills (`therealharpaljadeja/monskills`) is a Claude Code plugin that
ships Monad skills for contracts, deployment, wallet integration, gas,
indexers, scaffolding, tooling, and Vercel deploy.
- [ ] Install Monskills as a Claude Code plugin inside the sandbox image
      so skills auto-load from `.claude/skills/`. The agent picks the
      right skill per task based on each `SKILL.md` description; no
      custom retrieval layer needed.
- [ ] Pin a Monskills version in `skills-lock.json` so prompts are
      reproducible across deploys.
- [ ] Add a thin Moncode-specific skill on top: project conventions,
      Monad testnet RPC + chain id, Monadscan URLs, the wallet-tool
      contract, and "always use the wallet tools, never call Bash to
      send transactions."
- [ ] Add starter templates as project scaffolds the agent can clone via
      `Sandbox.create({ source: { type: 'git', url, revision } })` —
      these come from Monskills' `scaffold` and `wallet-integration`
      skills.

## Credit System and Billing
- [ ] Keep usage model compatible with existing credit consumption logic.
- [ ] Daily free grant: 5 credits per user per day.
- [ ] **Idempotent daily grant job**: a scheduled job (cron / Inngest)
      that issues one grant row per `(user_id, grant_date)` with a
      unique constraint on those columns, so re-running the job for the
      same day cannot double-grant. Job is safe to run on retries, on
      multiple workers, and after partial failures.
- [ ] Build usage UI (remaining credits, refill timer, plan CTA).
- [ ] **Defer paid plans**, but design the credits/entitlements schema
      so adding plan tiers, Stripe webhooks, and entitlement sync later
      is a drop-in (no migration of existing rows).
      `entitlements.credits_per_day` and `entitlements.plan_id` columns
      from day one, even if only the free plan exists.
- [ ] **Cost model awareness**: Vercel Sandbox bills active CPU-hr +
      provisioned RAM-hr + creations + egress + snapshot storage
      ($0.08/GB-mo). Track sandbox usage per project to inform future
      paid-plan pricing.

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
API keys). Vercel Sandbox accepts env at create or per-command, but does
**not** offer a separate managed-secrets primitive — env injection is
the *delivery* mechanism, not the storage. Where the plaintext lives
before injection is the real question. Pick one, document the tradeoff:
- [ ] **Option A — Credentials brokering (Vercel firewall, Pro/Ent)**:
      configure Vercel's firewall to inject auth headers at the proxy
      for specific outbound hosts (e.g. RPC providers). Tokens never
      enter the sandbox at all. Best for high-value tokens that match
      a host-based pattern. Cons: requires Pro/Ent plan; only works
      for header-based auth.
- [ ] **Option B — Local KMS encryption**: store ciphertexts in our DB,
      encrypted with a KMS-managed master key (AWS KMS / GCP KMS /
      Vercel encrypted env). Decrypt at sandbox boot, inject via
      `Sandbox.create({ env })`. Pros: no extra vendor, simpler. Cons:
      we own the blast radius.
- [ ] **Option C — Managed secrets (Infisical / Doppler)**: per-user
      project in the secrets provider, fetched server-side at sandbox
      boot and injected via `env`. Pros: rotation, audit log. Cons:
      extra vendor, per-user provisioning.
- [ ] **Recommended hybrid for M1**: Option B by default; Option A for
      RPC tokens once we are on Pro; Option C deferred unless users
      ask for it.
- [ ] Whichever option wins: never echo plaintext to logs; surface
      add/edit/delete in the wallet drawer; the agent's `Read` tool
      can see `.env` so the dev server works, but mask values in the
      file explorer UI and in chat transcripts.

## Network Egress (use Vercel's firewall, not a hand-rolled allowlist)
- [ ] Configure `networkPolicy` at sandbox create with an explicit
      allow list: Monad testnet RPC, Monadscan, npm registry, Vercel
      APIs, GitHub, our backend, Privy, and anything Monskills
      requires.
- [ ] Update via `sandbox.updateNetworkPolicy(...)` if the user
      installs a package that needs another host (with confirmation
      UI).
- [ ] SNI-based filtering and subnet allow/deny per Vercel's docs.

## Interactive Agent Requests (built on `canUseTool`)
- [ ] Reuse the same approval mechanism the wallet tools use for any
      agent prompt that needs structured user input (e.g. "paste your
      Alchemy key", "pick a contract name").
- [ ] Resume flow is automatic — the SDK `canUseTool` callback simply
      returns once user input is provided.

## Security and Reliability
- [ ] Sandbox isolation: Firecracker microVM, dedicated kernel — built
      for untrusted code. We don't add a second layer.
- [ ] Use `networkPolicy` for egress (above).
- [ ] Per-sandbox short-lived auth token for callbacks, rotated on
      sandbox restart.
- [ ] Abuse detection for prompts, faucet use, and automation loops.
- [ ] Backup, incident response, and kill-switch controls.

## QA, Launch, and Iteration
- [ ] End-to-end test coverage for: auth, project create from git
      template, agent iteration, wallet approval, faucet, secret
      injection, sandbox stop/auto-resume, snapshot restore.
- [ ] Load tests for concurrent agent runs and preview traffic — note
      Hobby caps at 10 concurrent sandboxes, Pro at 2000.
- [ ] Beta feedback channel and prioritization process.

## Milestones
- [ ] **M1 (MVP)**: Privy auth, persistent Vercel Sandbox per project
      (`Sandbox.create` + `Sandbox.get` by name), Claude Code SDK +
      Monskills installed inside the sandbox image, file explorer +
      preview via `sandbox.domain(port)`, header pill + wallet drawer,
      inline approval cards, `monad_deploy_contract` and
      `monad_send_transaction` tools, daily credit grant, faucet,
      transactions panel, KMS-encrypted secrets (Option B),
      `networkPolicy` egress allowlist.
- [ ] **M2**: Snapshot history with restore, env-var manager UI,
      starter templates via git source, credentials brokering for RPC
      tokens (Option A), Vercel Pro plan migration for 5-hour
      sessions.
- [ ] **M3**: Paid plans + entitlement webhooks, advanced templates,
      preflight tx simulation, team workflows.
