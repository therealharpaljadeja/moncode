# Moncode - Comprehensive PRD (Technical + Product)

## Context

Moncode is a Monad-first vibe-coding web app. A signed-in user creates projects, chats with a Claude Code agent, watches that agent build a Next.js Monad dApp inside a Vercel Sandbox, inspects the generated file tree, previews the running app, and can connect GitHub so the agent can create repositories, push workspace code, and open pull requests through Moncode-controlled credentials.

This PRD consolidates the current product surface, implementation architecture, route map, database schema, and roadmap signals found in the Moncode codebase and planning documents.

**Target launch:** Mid-August.

**Code reference:** Tracked codebase facts are based on Git commit `bb6c10da2002a177ef65f176846d9c49859f61ba` (`HEAD` when this PRD was drafted).

---

## 1. Architecture Overview

```
+------------------------------+
|  Moncode Web App             |
|  Next.js 15 App Router       |
|                              |
|  - Privy auth UI             |
|  - Project hub               |
|  - Chat workspace            |
|  - Preview iframe            |
|  - Read-only file explorer   |
|  - GitHub connection UI      |
+--------------+---------------+
               |
               | Next.js API routes
               | Bearer auth + SSE
+--------------v---------------+        +-----------------------------+
|  Moncode Backend             |        |  PostgreSQL                 |
|  Next.js route handlers      |<------>|  Drizzle ORM                |
|                              |        |                             |
|  - Project CRUD              |        |  - projects                 |
|  - Sandbox lifecycle         |        |  - connections              |
|  - Agent turn streaming      |        +-----------------------------+
|  - GitHub/Nango broker       |
+--------------+---------------+
               |
               | @vercel/sandbox
               | runCommand/fs/domain
+--------------v---------------+
|  Per-Project Vercel Sandbox  |
|  Node 22                     |
|  /vercel/sandbox             |
|                              |
|  - Next.js starter dApp      |
|  - npm run dev on port 3000  |
|  - agent.mjs                 |
|  - Claude Agent SDK          |
|  - Monskills plugin clone    |
|  - Moncode project skill     |
+------------------------------+
```

The Moncode project skill is loaded from `sandbox-assets/skills/moncode/SKILL.md` and written into the sandbox at `.claude/skills/moncode/SKILL.md` during boot.

### Current Implementation Stack

| Layer | Technology |
|-------|------------|
| App framework | Current host app uses Next.js App Router (`next` declared as `^15.1.0`, currently resolved to `15.5.15`); current sandbox starter pins Next.js `15.1.0` |
| Runtime | Node.js >= 20.18.1; sandbox runtime `node22` |
| Frontend | React 19, TypeScript 5.7, Tailwind CSS 3.4 |
| UI primitives | shadcn/Radix UI, lucide-react, react-resizable-panels |
| Auth and embedded wallet | Privy (`@privy-io/react-auth`, `@privy-io/server-auth`) |
| Chain config | Monad Testnet, chain ID `10143`, MON, `https://testnet-rpc.monad.xyz` |
| Sandbox | Vercel Sandbox (`@vercel/sandbox`) |
| AI agent | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) inside the sandbox |
| Agent model | `claude-opus-4-6` for coding turns; `claude-haiku-4-5-20251001` for project title generation and API-key preflight |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Integration broker | Nango |
| GitHub API | GitHub REST API via host-side user OAuth token from Nango |
| Package manager | npm (`package-lock.json` present) |

These are the versions observed in the current codebase, not fixed product requirements. They are taken from the root `package.json`, root `package-lock.json`, and `sandbox-assets/starter/package.json`; App Router is inferred from the repository's `app/` route structure.

### Repository Structure

```
moncode/
|-- app/
|   |-- page.tsx                         # Authenticated project hub
|   |-- login/page.tsx                   # Privy login screen
|   |-- connections/page.tsx             # Connected accounts UI
|   |-- project/[id]/page.tsx            # Chat + preview + files workspace
|   `-- api/                             # Next.js route handlers
|-- components/
|   |-- ai-elements/                     # Chat, code, file tree, preview UI
|   |-- providers/privy-provider.tsx     # Privy provider config
|   |-- github-connection-card.tsx       # GitHub connection card
|   `-- wallet-badge.tsx                 # Embedded wallet badge
|-- hooks/
|   |-- use-auth-fetch.ts                # Privy bearer-token fetch wrapper
|   `-- use-github-connection.ts         # Nango Connect client flow
|-- lib/
|   |-- auth.ts                          # Privy token verification
|   |-- bootstrap.ts                     # Sandbox creation/bootstrap
|   |-- agent-runner.ts                  # Agent turn invocation/parsing
|   |-- github.ts                        # GitHub API operations
|   |-- github-workspace.ts              # Push sandbox files to GitHub
|   |-- sandbox-workspace.ts             # Workspace file collection limits
|   |-- projects.ts                      # Project persistence
|   `-- db/                              # Drizzle client/schema
|-- sandbox-assets/
|   |-- agent.mjs                        # In-sandbox Claude Agent SDK runner
|   |-- skills/moncode/SKILL.md          # Moncode agent rules
|   `-- starter/                         # Uploaded Next.js starter dApp
|-- drizzle/                             # SQL migrations
`-- package.json
```

### Frontend-Backend Communication

- **Auth:** In the current implementation, `components/auth-gate.tsx` redirects unauthenticated client views to `/login`. Protected API routes call `requireUser()` or `requireOwnedProject()` from `lib/auth.ts`, which expects an `Authorization: Bearer <Privy token>` header and verifies it with Privy.
- **API wrapper:** Client components use `useAuthFetch()`, which calls `getAccessToken()` from Privy and attaches the bearer token.
- **Sandbox boot:** The project page calls `POST /api/projects/{id}/sandbox`, then opens `GET /api/projects/{id}/sandbox/stream` as SSE for high-level boot phases.
- **Agent turns:** Chat submission calls `POST /api/projects/{id}/chat`. The route invokes `node agent.mjs` inside the sandbox and streams SDK messages to the browser as SSE.
- **GitHub operations:** In the current implementation, `sandbox-assets/agent.mjs` defines a Moncode MCP server whose GitHub tool calls POST to `/api/github/op` with `X-Moncode-Agent-Secret` and `X-Moncode-Project-Id`; `lib/agent-auth.ts` verifies those headers, and `lib/github.ts` retrieves GitHub credentials through Nango on the host.
- **Preview:** The backend exposes `sandbox.domain(3000)` and the frontend renders it in a preview iframe.

---

## 2. Database Schema (Drizzle)

The current Moncode database schema is intentionally small. It should appear before the product object model because later sections refer to `projects.*` and `connections.*` columns.

### Core Tables

```
projects
  id                TEXT PRIMARY KEY
  user_id           TEXT NOT NULL
  title             TEXT
  sandbox_id        TEXT
  agent_session_id  TEXT
  created_at        BIGINT NOT NULL
  updated_at        BIGINT NOT NULL

connections
  id                   TEXT PRIMARY KEY
  user_id              TEXT NOT NULL
  provider             TEXT NOT NULL
  nango_connection_id  TEXT NOT NULL
  display_name         TEXT
  created_at           BIGINT NOT NULL
  updated_at           BIGINT NOT NULL
```

### Indexes

| Index | Purpose |
|-------|---------|
| `projects_user_id_idx` | Fast project listing by user. |
| `connections_user_id_idx` | Fast connection listing by user. |
| `connections_user_provider_idx` | One connection per provider per user. |
| `connections_nango_id_idx` | Lookup by Nango connection ID and uniqueness enforcement. |

### Data Not Currently Stored by Moncode

| Data | Current Owner |
|------|---------------|
| User profile/auth records | Privy |
| Wallet records | Privy |
| Chat messages | Claude Code JSONL inside sandbox |
| Transactions | Not implemented |
| Credits/billing | Not implemented |
| Secrets/env vars | Not implemented |

---

## 3. Information Architecture

### Product Inputs

| Input | Answer |
|-------|--------|
| Target launch | Mid-August |
| Beta/test timing | Separate from launch; exact beta/test date or window still TBD |
| Primary MVP users | General hackathon participants, including Blitz participants; Web2 developers; Solana developers; nontechnical Monad users |
| First-run success | User signs in, creates a project, sends one prompt, sandbox boots, and the app preview changes successfully |
| MVP auth scope | Email login only, because it is the most accessible and easiest login option |
| MVP project management scope | Create projects only; no delete, rename, archive, or project-share flows in MVP |
| MVP chat persistence direction | Security-team review pending; likely durable storage in Neon/Postgres rather than relying only on sandbox JSONL |
| Production GitHub token direction | Keep GitHub tokens outside the sandbox; security-team review pending on whether to use short-lived GitHub App installation tokens, and whether that model supports creating new repositories |
| First onchain actions | Faucet and deploy contract |
| MVP free usage limit | Total usage worth $2 in API credits per user; open to security-team suggestions |
| Production hosting direction | Vercel for the Moncode host app; Neon for Postgres; Vercel Sandbox for per-project runtimes because it provides automatic public domain allocation for sharing hosted apps |
| First-week launch KPIs | 100+ signups and 30+ apps created |
| First-month launch KPIs | 300+ signups and 50+ apps created |

### Primary Objects

| Object | Description | Current Persistence |
|--------|-------------|---------------------|
| User | Privy-authenticated person using Moncode | Stored by Privy; Moncode stores only Privy user ID references |
| Embedded wallet | Privy-created Ethereum wallet, configured for Monad testnet | Managed by Privy; surfaced in UI as a badge |
| Project | A user-owned coding workspace | `projects` table |
| Sandbox session | Runtime execution environment for a project | In-memory session map plus `projects.sandbox_id` for reattach |
| Agent session | Claude Code conversation session ID captured by `lib/agent-runner.ts` | Persisted as `projects.agent_session_id`; transcript is read from sandbox JSONL by `app/api/projects/[id]/transcript/route.ts` |
| Connection | External account connection, currently GitHub | `connections` table |

### Pages

| Route | Access | Description |
|-------|--------|-------------|
| `/login` | Public | Privy login page. Redirects authenticated users to `/`. |
| `/` | Auth required | Project hub. Lists user projects, creates new projects, links to Connections, shows wallet badge. |
| `/project/{id}` | Auth + ownership required | Main workspace: chat, queued prompts, todos, live preview, read-only files, GitHub connection cards when needed. |
| `/connections` | Auth required | Connected accounts page. Current provider: GitHub. |

### Workspace Tabs

| Tab | Description |
|-----|-------------|
| Preview | Iframe pointed at the sandbox dev server URL; supports manual reload and opening in a new tab. |
| Files | Filtered, read-only sandbox file tree and syntax-highlighted file viewer. |

---

## 4. Project System

### Project Creation

1. User clicks **New project** on `/`.
2. Client calls `POST /api/projects`.
3. Backend validates Privy auth and inserts a project row with:
   - 16-byte random hex ID
   - Privy `userId`
   - `title = null`
   - `sandboxId = null`
   - `agentSessionId = null`
   - millisecond `createdAt` / `updatedAt`
4. Client navigates to `/project/{id}`.

### Project Listing

- `GET /api/projects` returns projects for the authenticated user ordered by `updatedAt DESC`.
- Public project summaries include `id`, `title`, `createdAt`, and `updatedAt`.
- MVP scope intentionally excludes delete, rename, archive, duplicate, and project-share flows. Creating a project and sharing the hosted app after GitHub push is sufficient for MVP.

### Project Title Generation

- First user prompt can trigger `POST /api/projects/{id}/title`.
- If a title already exists, the route returns the cached title.
- New titles are generated with Anthropic `claude-haiku-4-5-20251001`.
- Output is normalized to a maximum of 48 characters.
- The title is persisted to `projects.title`.

### Project Ownership

- Every project API route uses Privy bearer-token auth.
- `requireOwnedProject()` returns `404 not found` if the project does not exist or belongs to another user.

---

## 5. Workspace Experience

### Layout

The project workspace is a full-screen horizontal resizable split:

- **Left panel:** Chat thread, assistant/tool/result/error messages, current todo list, prompt input, prompt queue, title header, GitHub connect cards when the agent needs GitHub.
- **Right panel:** Preview/files tabs.

### Chat Behavior

- The user submits one prompt at a time.
- If the user submits while an agent turn is busy, the prompt is added to a local queue and sent when the current turn finishes.
- The frontend deduplicates replayed SDK messages by UUID.
- `TodoWrite` tool-use payloads are parsed into a todo UI.
- After every agent turn, the frontend refetches files and bumps the iframe nonce to refresh preview.

### Message Types Rendered

| Type | Source | UI Behavior |
|------|--------|-------------|
| User | Local prompt submission | Appended immediately |
| Assistant text | Claude Agent SDK assistant message | Rendered as assistant response |
| Tool use | Claude Agent SDK `tool_use` block | Rendered as expandable tool card |
| Result | Claude Agent SDK result message | Rendered as final result |
| Error | Route, agent, or parser error | Rendered as error message |
| stderr | Agent command stderr | Coalesced into stderr message |
| GitHub auth | Moncode MCP event | Renders GitHub connection card |

### File Browser

- `GET /api/projects/{id}/files` returns a filtered recursive tree from `/vercel/sandbox`.
- Skipped directories: `node_modules`, `.next`, `.git`, `.claude-plugins`, `.claude`.
- Dotfiles are hidden except `.env.example`.
- Maximum tree entries: 2,000.
- `GET /api/projects/{id}/files/{path}` reads a single file.
- Paths containing `..` are rejected.
- Maximum readable file size: 1 MB.
- Browser-side file editing is **not implemented**.

---

## 6. Sandbox Runtime

### Overview

Each active project gets a Vercel Sandbox running a Next.js starter and the Claude Agent SDK. The host keeps an in-memory `Map<projectId, Session>` and stores `sandboxId` / `agentSessionId` on the project row for reattach.

### Sandbox Creation

`createSandboxForProject(projectId)`:

1. Requires `ANTHROPIC_API_KEY`.
2. Preflights the key against Anthropic Messages API.
3. Creates a Vercel Sandbox with:
   - runtime `node22`
   - port `3000`
   - env `ANTHROPIC_API_KEY`
   - optional `MONCODE_DEBUG`
   - timeout 45 minutes
4. Persists `sandbox.sandboxId` to `projects.sandbox_id`.
5. Boots the workspace.

### Boot Steps

| Phase | Behavior |
|-------|----------|
| `preflight` | Validate Anthropic API key. |
| `creating-sandbox` | Create Vercel Sandbox. |
| `writing-files` | Upload starter files, `agent.mjs`, and Moncode skill. |
| `installing-deps` | Run `npm install` inside `/vercel/sandbox`. |
| `installing-sdk` | Install `@anthropic-ai/claude-agent-sdk` and `zod`. |
| `cloning-skills` | Clone Monskills from `MONCODE_MONSKILLS_GIT_URL` or `https://github.com/therealharpaljadeja/monskills`. |
| `starting-server` | Run `npm run dev` detached. |
| `waiting-preview` | Poll `sandbox.domain(3000)` for readiness. |
| `ready` | Workspace is ready. |

### Reattach

- On host cold start or missing in-memory session, Moncode checks `projects.sandbox_id`.
- If present, it calls `Sandbox.get({ sandboxId })`.
- On success, the session is marked ready without re-running boot.
- On failure, `sandboxId` and `agentSessionId` are cleared and a fresh sandbox is created.

### Starter Template

The current starter under `sandbox-assets/starter` is a minimal Next.js app:

| Field | Value |
|-------|-------|
| Framework | Current: Next.js 15.1.0 |
| React | Current: 19.0.0 |
| TypeScript | Current: 5.7.2 |
| EVM library | Current: viem 2.21.55 |
| Dev command | `next dev -p 3000 -H 0.0.0.0` |

---

## 7. Agent System

### In-Sandbox Runner

The backend invokes `node agent.mjs <payload>` inside `/vercel/sandbox` for each chat turn. The script:

- Imports `query`, `createSdkMcpServer`, and `tool` from the Claude Agent SDK.
- Receives `prompt`, `sessionId`, `projectId`, `apiBaseUrl`, and `agentSecret`.
- Runs `query()` in single-message mode.
- Uses `continue: Boolean(sessionId)` after the first turn.
- Writes each SDK message as JSON Lines to stdout.
- Emits Moncode-specific events for GitHub auth requirements.

### Agent Configuration

| Setting | Value |
|---------|-------|
| CWD | `/vercel/sandbox` |
| Model | `claude-opus-4-6` |
| Effort | `medium` |
| Permission mode | `bypassPermissions` |
| System prompt | Claude Code preset + Moncode appended notes |
| Settings sources | `user`, `project` |
| Plugin | Local Monskills clone at `/vercel/sandbox/.claude-plugins/monskills` |
| MCP servers | `moncode` in-process MCP server |
| Allowed tools | `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Skill`, `TodoWrite` |

### Moncode Agent Rules

The Moncode skill and appended system notes enforce:

- Build inside `/vercel/sandbox`.
- Generated dApps should be Next.js 15 App Router projects.
- Prefer `viem`; never add `ethers`.
- Use user-wallet UX such as wagmi + ConnectKit or RainbowKit when needed.
- Monad testnet only.
- Do not assume a private key exists.
- v0 has no deploy mechanism; do not write or run private-key deploy scripts.
- GitHub work must go through Moncode MCP tools.

### Transcript Model

- Moncode does not store chat messages in a database.
- The Claude Code transcript is read from sandbox JSONL at `$HOME/.claude/projects/*/{sessionId}.jsonl`.
- `GET /api/projects/{id}/transcript` parses `user`, `assistant`, and `result` entries and skips sidechain entries.
- Transcript survives page reloads and host process restarts only if the sandbox and stored `agentSessionId` are still available.
- MVP durable chat history is still pending security-team review. Product direction is leaning toward storing chat history in Neon/Postgres so conversations are not dependent only on sandbox JSONL.

---

## 8. Auth & Wallet Management

### Auth

- Provider: Privy.
- MVP login method: email only, because it is the most accessible and easiest login option for the target users.
- `AuthGate` protects all product pages except `/login`.
- API routes verify Privy bearer tokens server-side via `PrivyClient.verifyAuthToken()`.
- Missing server credentials produce a 500 response with setup guidance.

### Embedded Wallet

- Privy embedded Ethereum wallets are created on login for users without wallets.
- Default and supported chain: Monad Testnet.
- Header wallet badge shows the first Privy embedded wallet, or first available wallet, truncated with a tooltip containing the full address.

### Future Wallet Direction

Moncode plans to use the user's embedded wallet for onchain actions initiated by the agent. In the planned flow, the agent will call an onchain tool such as contract deployment, Moncode will surface an approval UI to the user, and the approved transaction will be signed/broadcast through the user's embedded wallet. This is not currently implemented; faucet and deploy contract are the first MVP priorities.

### Current Wallet Scope

Implemented:

- Embedded wallet creation through Privy configuration.
- Monad testnet chain configuration.
- Header wallet badge.

Not implemented:

- Wallet drawer.
- Transaction history.
- Agent-triggered wallet approval cards.
- Faucet.
- Deploy/send/sign/read wallet tools backed by the user's embedded wallet.

MVP onchain priority: faucet and deploy contract should ship first. Contract deployment should be initiated by the agent through an onchain tool, then approved and signed by the user through the embedded wallet flow described above.

---

## 9. GitHub Connections

### Overview

GitHub integration lets the agent create repositories, list repositories, push sandbox workspace files, and open pull requests without exposing credentials inside the sandbox.

Production direction: GitHub tokens must stay outside the sandbox. Security-team review is needed to choose the exact production setup. One candidate is short-lived GitHub App installation tokens, but it must be confirmed whether that approach supports Moncode's create-repository flow.

### Connection Flow

1. User opens `/connections` or an inline chat connection card.
2. Client calls `POST /api/connections/session`.
3. Backend either restores an existing Nango connection, creates a reconnect session, or creates a connect session.
4. Client opens Nango Connect UI.
5. After successful authorization, client calls `POST /api/connections/sync`.
6. Moncode stores or updates a `connections` row.
7. Display name is synced from Nango/GitHub when available.

### Disconnect Flow

- `DELETE /api/connections/github` removes the local Moncode link.
- `DELETE /api/connections/github?revoke=true` also attempts to delete the Nango connection.

### Nango Webhook

- `POST /api/nango/webhook` handles Nango auth webhooks.
- If `NANGO_WEBHOOK_SECRET` is configured, HMAC verification is required.
- Successful GitHub auth upserts the local connection.
- Failed auth refresh clears the GitHub connection.

### Agent GitHub Operations

The in-sandbox MCP server exposes:

| Tool | Description |
|------|-------------|
| `github_request_connection` | Emits a Moncode event so the UI shows a GitHub connection card. |
| `github_api` | Calls host-side GitHub operations with credentials kept on the host. |

Supported `github_api` operations:

| Operation | Backend Behavior |
|-----------|------------------|
| `get_user` | Calls `GET /user`. |
| `list_repos` | Calls `GET /user/repos`. |
| `create_repo` | Calls `POST /user/repos` with `auto_init: true`. |
| `create_pr` | Calls `POST /repos/{owner}/{repo}/pulls`. |
| `push_workspace` | Reads filtered sandbox files and writes blobs/tree/commit/ref through GitHub Git Data API. |

### Current Workspace Push Guardrails

These limits describe the current implementation, not the final security model. Moncode should continue exploring a stronger alternative for agent-assisted GitHub pushes, with security-team input on file exfiltration risk, explicit user consent/preview, safer file allowlists, and credential boundaries.

| Limit | Value |
|-------|-------|
| Skipped directories | `node_modules`, `.next`, `.git`, `.claude-plugins`, `.claude`, `.moncode` |
| Hidden files | Skipped except `.env.example` |
| Max individual file | 1 MB |
| Max files | 500 |
| Max total bytes | 8 MB |
| Default branch | `main` unless specified |

---

## 10. Pages & Routes

| Route | Access | Description |
|-------|--------|-------------|
| `/login` | Public | Login page using Privy `login()`. |
| `/` | Auth | Project hub. Lists projects and creates new ones. |
| `/project/{id}` | Auth + owner | Main coding workspace. |
| `/connections` | Auth | Connected accounts page. |

---

## 11. Key User Flows

### New User to First Project

1. User visits `/`.
2. `AuthGate` redirects unauthenticated user to `/login`.
3. User clicks **Continue with email** and authenticates through Privy.
4. Privy creates an embedded wallet if the user has no wallet.
5. User lands on `/`.
6. User clicks **New project**.
7. Moncode creates a project and routes to `/project/{id}`.
8. Workspace boots a sandbox and displays boot phases.
9. User sends a prompt.
10. Agent edits the starter app inside the sandbox.
11. Preview and file tree refresh after the turn.

### Returning User to Resume Project

1. User signs in.
2. Project hub loads existing projects ordered by recent update.
3. User opens a project.
4. Moncode attempts to reattach to the saved `sandboxId`.
5. If reattach succeeds, the workspace is ready immediately.
6. If reattach fails, the saved sandbox/session IDs are cleared and a fresh sandbox boots.
7. If an `agentSessionId` exists, transcript is loaded from sandbox JSONL.

### Agent Needs GitHub

1. User asks the agent to create a repo, push code, or open a PR.
2. Agent calls `github_api`.
3. If no valid GitHub connection exists, backend returns `GITHUB_CONNECTION_REQUIRED`.
4. Agent emits a Moncode event.
5. Chat renders an inline GitHub connection card.
6. User connects GitHub through Nango.
7. User can continue the request after connection.

### Push Workspace to GitHub

1. Agent calls `github_api` with `op: "push_workspace"`.
2. Host verifies the agent secret and project ID.
3. Host collects filtered sandbox files.
4. Host creates blobs, tree, commit, and branch ref using GitHub API.
5. Result returns branch, commit SHA, file count, and GitHub commit URL.

---

## 12. API Endpoints

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List current user's projects. |
| `POST` | `/api/projects` | Create a new project. |

### Sandbox

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/{id}/sandbox` | Ensure sandbox exists; create/reattach if needed. |
| `GET` | `/api/projects/{id}/sandbox` | Read sandbox status if initialized. |
| `GET` | `/api/projects/{id}/sandbox/stream` | SSE stream for boot phase/status. |

### Agent and Transcript

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/{id}/chat` | Send prompt and stream agent events over SSE. |
| `GET` | `/api/projects/{id}/transcript` | Read Claude Code JSONL transcript from sandbox. |
| `POST` | `/api/projects/{id}/title` | Generate/cache a short project title from the first prompt. |

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects/{id}/files` | List filtered sandbox file tree. |
| `GET` | `/api/projects/{id}/files/{path}` | Read one sandbox file as UTF-8. |

### Connections

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/connections` | List current connection statuses; sync GitHub first. |
| `POST` | `/api/connections/session` | Create/restore/reconnect a Nango GitHub session. |
| `POST` | `/api/connections/sync` | Sync GitHub connection after Nango Connect succeeds. |
| `DELETE` | `/api/connections/{provider}` | Disconnect provider; `?revoke=true` also deletes Nango connection. |

### GitHub and Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/github/op` | Agent-only GitHub operation endpoint. |
| `GET` | `/api/github/op?projectId={id}` | Agent-only GitHub connection status endpoint. |
| `POST` | `/api/nango/webhook` | Nango auth webhook receiver. |

---

## 13. Environment Variables

| Variable | Required For | Notes |
|----------|--------------|-------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Client auth | Missing value shows setup screen. |
| `PRIVY_APP_SECRET` | Server auth | Required to verify Privy bearer tokens. |
| `DATABASE_URL` | Database | Required by Drizzle runtime and migrations. |
| `ANTHROPIC_API_KEY` | Sandbox boot, agent, titles | Preflighted before sandbox creation. |
| `VERCEL_TEAM_ID` | Vercel Sandbox | Present in planning/docs as part of local setup. |
| `VERCEL_PROJECT_ID` | Vercel Sandbox | Present in planning/docs as part of local setup. |
| `VERCEL_TOKEN` | Vercel Sandbox | Present in planning/docs as part of local setup. |
| `MONCODE_MONSKILLS_GIT_URL` | Optional skills source | Defaults to `https://github.com/therealharpaljadeja/monskills`. |
| `MONCODE_DEBUG` | Optional debug mode | Passed into sandbox when set. |
| `MONCODE_API_BASE_URL` | Optional agent callback base URL | Defaults to request origin. |
| `MONCODE_AGENT_SECRET` | Agent-to-host auth | Exact source is in `lib/agent-auth.ts`; required for protected agent callbacks. |
| `NANGO_SECRET_KEY` | GitHub connections | Required for Nango server operations. |
| `NANGO_GITHUB_INTEGRATION_ID` | GitHub connections | Defaults to `github`. |
| `NANGO_WEBHOOK_SECRET` | Nango webhook verification | Optional; enables HMAC verification. |

---

## 14. Production Hosting Targets

| Layer | Preferred Target | Rationale |
|-------|------------------|-----------|
| Moncode host app | Vercel | Natural fit for the current Next.js app. |
| Database | Neon Postgres | Preferred managed Postgres target; also likely target for durable chat history if approved. |
| Per-project runtimes | Vercel Sandbox | Preferred because it provides automatic public domain allocation, which supports sharing sandbox-hosted apps. |

Evaluated alternatives:

| Alternative | Notes |
|-------------|-------|
| Modal | Considered, but no built-in feature for publicly sharing sandbox-hosted apps. |
| Claude Managed Agents | Considered; impressive security feature set, but no built-in feature for publicly sharing sandbox-hosted apps. |

Security-team review remains open for the sandbox/runtime choice and deployment architecture.

---

## 15. Success Metrics

First-run success is defined as: user signs in, creates a project, sends one prompt, sandbox boots, and the app preview changes successfully.

Launch KPI targets:

| Window | Target |
|--------|--------|
| First week after launch | 100+ signups; 30+ apps created |
| First month after launch | 300+ signups; 50+ apps created |

Additional baseline and retention targets are not yet defined.

Recommended metrics to define:

| Metric | Why It Matters |
|--------|----------------|
| First-run success rate | Measures the full activation loop from sign-in through visible preview change. |
| New project creation rate | Measures activation after login. |
| First successful preview rate | Measures sandbox boot and first-run success. |
| First prompt to visible change time | Measures core vibe-coding loop quality. |
| Agent turn success rate | Measures agent/runtime reliability. |
| GitHub connection conversion | Measures value of repository/push/PR workflows. |
| Push-to-GitHub success rate | Measures end-to-end shipping utility. |
| Returning project resume rate | Measures persistence and user trust. |

---

## 16. Roadmap

### Implemented in Current Codebase

| Area | Status |
|------|--------|
| Privy email auth | Implemented |
| Privy embedded wallet creation | Implemented |
| Monad testnet chain config | Implemented |
| Authenticated project hub | Implemented |
| Project persistence in Postgres | Implemented |
| Per-project Vercel Sandbox boot | Implemented |
| Sandbox reattach by saved sandbox ID | Implemented |
| Claude Agent SDK inside sandbox | Implemented |
| Monskills plugin clone | Implemented |
| Moncode skill injection | Implemented |
| Live preview iframe | Implemented |
| Read-only sandbox file tree/viewer | Implemented |
| SSE boot phase streaming | Implemented |
| SSE chat event streaming | Implemented |
| Todo parsing from `TodoWrite` | Implemented |
| Project title generation | Implemented |
| Nango-backed GitHub connection | Implemented |
| Agent-mediated GitHub operations | Implemented |
| Push sandbox workspace to GitHub | Implemented |

### Planned or Referenced but Not Implemented

| Feature | Source Signal |
|---------|---------------|
| Wallet drawer | `PLAN.md` |
| Inline wallet approval cards | `PLAN.md` |
| `monad_deploy_contract`, `monad_send_transaction`, `monad_sign_message`, `monad_read_contract`, `monad_request_faucet` MCP tools | `PLAN.md`; product direction is for deploy/send/sign transactions to be initiated by the agent and approved/signed through the user's embedded wallet |
| In-app Monad testnet faucet | `PLAN.md` |
| MVP onchain action priority: faucet and deploy contract | Product input |
| Transactions panel | `PLAN.md` |
| Credit system and daily free grant | `PLAN.md` |
| MVP free usage limit: $2 in API credits per user | Product input; open to security-team suggestions |
| Secrets/env var storage | `PLAN.md` |
| Network egress allowlist via Vercel `networkPolicy` | `PLAN.md` |
| Browser-side file editing | `PLAN.md` and `V0_PLAN.md` |
| Snapshot history and restore | `PLAN.md` |
| Long-lived agent process / mid-task interrupts | `V0_PLAN.md` |
| Curated Monskills bundle or lockfile | `V0_PLAN.md` |
| Paid plans and entitlements | `PLAN.md` |

---

## 17. Risks & Mitigations

| Risk | Current Mitigation | Gap |
|------|--------------------|-----|
| Sandbox boot failures | Boot phases, Anthropic preflight, readiness polling, boot error display. | Need operational retry/backoff policy and analytics. |
| Host memory session loss | `sandboxId` saved on project; reattach via `Sandbox.get`. | Sessions still rely on active sandbox lifetime. |
| Transcript loss | `agentSessionId` saved and JSONL read from sandbox. | No DB-backed durable message history. |
| GitHub credential exposure | Credentials stay on host; agent only gets MCP tools. | Security-team review needed for production token model; short-lived GitHub App installation tokens are a candidate, but create-repo support must be confirmed. `app/api/github/op/route.ts` currently logs owner/repo/message debug values. |
| Workspace push safety | Current implementation uses skipped directories plus file count, per-file, and total-byte limits. | Better alternative under consideration; needs security-team input on explicit preview/approval, allowlists, and exfiltration controls. |
| Agent deploys with private keys | Moncode skill/system notes forbid private-key deploy scripts. | Permission mode is `bypassPermissions`; no wallet/deploy approval tools yet. |
| Network egress abuse | Sandbox is isolated. | No implemented `networkPolicy` allowlist. |
| Multi-instance backend | Project rows persist IDs. | In-memory session map is not shared across backend replicas. |
| Nango webhook spoofing | Optional HMAC verification if signing key is configured. | Must ensure signing key is set in production. |
| Business/usage cost overruns | MVP target is $2 in API credits per user. | Credits/billing/usage accounting not implemented; security-team suggestions welcome. |

---

## 18. Implementation Status

### Phase 1: v0 Vibe-Coding Loop

1. Implemented: Next.js host app.
2. Implemented: Vercel Sandbox boot with local starter.
3. Implemented: Claude Agent SDK installation inside sandbox.
4. Implemented: Monskills clone and Moncode skill.
5. Implemented: Chat-to-agent SSE loop.
6. Implemented: Preview iframe.
7. Implemented: Read-only file explorer.

### Phase 2: Authenticated Projects

1. Implemented: Privy auth gate.
2. Implemented: Email login.
3. Implemented: Embedded wallet badge.
4. Implemented: Project database model.
5. Implemented: Project hub.
6. Implemented: Project ownership checks.
7. Implemented: Sandbox reattach from saved `sandboxId`.
8. Implemented: Agent session persistence by saved `agentSessionId`.

### Phase 3: GitHub Integration

1. Implemented: Nango connect/reconnect/restore flow.
2. Implemented: Local `connections` table.
3. Implemented: Nango webhook handler.
4. Implemented: GitHub status sync and display name sync.
5. Implemented: Agent MCP GitHub tools.
6. Implemented: Host-side GitHub API operations.
7. Implemented: Workspace push via GitHub Git Data API.

### Phase 4: Monad Wallet and Onchain Capabilities

1. Not implemented: Wallet drawer.
2. Not implemented: Transaction approval UI.
3. Not implemented: Onchain MCP wallet tools.
4. MVP priority, not implemented: Faucet.
5. MVP priority, not implemented: Deploy contract through agent-triggered embedded-wallet approval.
6. Not implemented: Transaction history.

### Phase 5: Scale, Billing, and Production Hardening

1. Not implemented: Credit accounting for MVP $2 API-credit usage limit.
2. Not implemented: Paid plans.
3. Pending security review: Durable DB-backed chat history, likely in Neon/Postgres.
4. Not implemented: Multi-instance session coordination.
5. Not implemented: Egress allowlist.
6. Not implemented: Snapshot history UI.
7. Not implemented: Secrets manager.

---

## 19. Product Input Required

The following answers were not discoverable from the codebase and should be filled in by the product owner:

| Question | Needed For |
|----------|------------|
| What does the security team recommend for durable chat history storage and retention? | Persistence architecture; likely Neon/Postgres implementation details. |
| What exact GitHub scopes/integration type should production use, and can short-lived GitHub App installation tokens create new repositories? | Nango/GitHub setup and security. |
| What security-team guidance applies to the $2 API-credit free usage limit? | Credits and billing design. |

---

## 20. Technical Decisions Log

| Decision | Rationale |
|----------|-----------|
| Run Claude Agent SDK inside the sandbox | Agent tools operate directly on the same filesystem as the preview app, reducing sync complexity. |
| Use Vercel Sandbox as execution boundary | User code and agent commands run away from the host app. |
| Use Privy bearer tokens for API auth | Client can fetch tokens through Privy and backend can verify with `PrivyClient`. |
| Store project records in Postgres | Needed for project listing, ownership, sandbox reattach, and title persistence. |
| Store only `agentSessionId`, not chat messages | Current transcript source is Claude Code JSONL inside the sandbox. |
| Use `continue: Boolean(sessionId)` for follow-up turns | Code comment notes that `resume` in one-shot stream-json mode exited without new messages after a result. |
| Keep GitHub credentials host-side | Agent can perform GitHub actions without writing tokens to the sandbox. |
| Push workspace via GitHub Git Data API | Avoids `git push` and avoids placing credentials inside the sandbox. |
| Configure Monad testnet as the only Privy-supported chain | Keeps the current product testnet-only. |
| Mark browser file explorer read-only | Current API only lists/reads files; edits are performed by the agent inside the sandbox. |
