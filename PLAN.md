# Moncode Roadmap and Build Plan

## Product Scope
- [ ] Finalize product positioning: Monad-first vibe coding app for developers
- [ ] Define target users and key workflows (build, iterate, deploy, wallet usage)
- [ ] Define success metrics (activation, project completion rate, daily retention)

## Architecture and Foundations
- [ ] Choose system architecture (web app, worker/orchestrator, sandbox service)
- [ ] Define data models for users, projects, sessions, messages, credits, wallets
- [ ] Set up environment configs for local, staging, and production
- [ ] Add observability baseline (logs, traces, error tracking)

## Authentication and Wallets (Privy)
- [ ] Integrate Privy authentication (social/email wallet onboarding)
- [ ] Provision wallet per user and persist wallet metadata
- [ ] Build wallet UI (address, network, token balances)
- [ ] Add Monad testnet/mainnet network switch and RPC fallbacks

## Sandbox Runtime (Vercel Sandbox)
- [ ] Replace E2B-specific logic with Vercel Sandbox provider abstraction
- [ ] Implement sandbox lifecycle: create, reconnect, run command, stop
- [ ] Implement workspace persistence using snapshots/checkpoints
- [ ] Reuse running sandbox per project/session for iterative coding
- [ ] Implement sandbox health checks and auto-recovery paths

## Agent Orchestration and Prompt Loop
- [ ] Implement asynchronous orchestration for agent runs (queue + worker)
- [ ] Build iterative edit loop for existing project workspaces
- [ ] Add tool layer: terminal, read/write files, diff, lint/test
- [ ] Add guardrails: command allowlist, timeout, network policy, retries

## Editor, File Explorer, and Live Preview
- [ ] Build file explorer tree with active file state and search
- [ ] Build code panel with syntax highlighting and copy/diff actions
- [ ] Build live app preview panel with refresh and open-in-new-tab
- [ ] Stream build/runtime logs to the UI while generation is running
- [ ] Add snapshot history and restore capability per project

## Credit System and Billing
- [ ] Keep usage model compatible with existing credit consumption logic
- [ ] Implement daily free grant: 5 credits per user per day
- [ ] Add idempotent daily grant job (one grant per user/day)
- [ ] Build usage UI (remaining credits, refill timer, plan CTA)
- [ ] Add paid plans and webhook-based entitlement sync

## Faucet and Token Utilities
- [ ] Build in-app faucet for Monad testnet only
- [ ] Implement strict rate limits (user, wallet, IP, device)
- [ ] Add anti-abuse checks and cooldown UX messaging
- [ ] Add transaction status panel for faucet requests

## Interactive Agent Requests (Custom Tools UX)
- [ ] Design structured agent request schema for missing user inputs
- [ ] Build floating dialog/task panel for "Action required" prompts
- [ ] Add secure API key input flow with encrypted storage
- [ ] Add resume flow so agent continues after user input is provided

## Monad-Specific Developer Experience
- [ ] Ship one-click Monad starter templates (dApp, token, NFT, dashboard)
- [ ] Add chain-aware checks (wrong network, missing RPC, gas estimate)
- [ ] Add contract interaction helpers and ABI-driven UI generation
- [ ] Add preflight simulator for high-risk transactions

## Security, Compliance, and Reliability
- [ ] Define secret management policy for user-provided credentials
- [ ] Restrict sandbox egress with explicit domain allowlists
- [ ] Add abuse detection for prompts, faucet use, and automation loops
- [ ] Add backup, incident response, and kill-switch controls

## QA, Launch, and Iteration
- [ ] Build end-to-end test coverage for core flows
- [ ] Run load tests for concurrent generations and preview traffic
- [ ] Prepare launch checklist and staged rollout plan
- [ ] Collect beta feedback and prioritize iteration backlog

## Milestones
- [ ] Milestone 1 (MVP): auth + wallet + iterative sandbox + preview + credits
- [ ] Milestone 2: custom tool prompts + secure secrets + faucet
- [ ] Milestone 3: Monad advanced templates + simulation + team workflows
