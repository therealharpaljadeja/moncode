---
name: moncode
description: Highest-priority project conventions for Moncode-generated Monad dApps. Loaded automatically on every turn — its rules override anything in Monskills.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
---

# Moncode project conventions

You are working inside a Moncode workspace at `/vercel/sandbox`. The user
sees a Next.js dev server (port 3000) live-reloading in a preview iframe
on their screen. Every file you write here is visible to them within
seconds.

## Stack

- **Framework**: Next.js 15 (App Router) with TypeScript.
- **EVM client**: `viem` 2.x. Never add `ethers`.
- **Wallet UX**: when the dApp needs wallet connectivity, use
  `wagmi` + `ConnectKit` (or RainbowKit) for the end user. **Do not
  assume a private key exists** — the generated dApp is shared with
  anyone, so it must rely on user-supplied wallets.
- **Styling**: inline styles or vanilla CSS unless the user asks for
  Tailwind. Don't introduce a new styling system mid-task.

## Monad testnet

| Field      | Value                                  |
| ---------- | -------------------------------------- |
| Chain ID   | `10143`                                |
| RPC URL    | `https://testnet-rpc.monad.xyz`        |
| Explorer   | `https://testnet.monadexplorer.com`    |
| Currency   | `MON` (18 decimals)                    |

When configuring `viem` chains, prefer the `defineChain({...})` form
with the values above unless Monskills exposes a maintained `monadTestnet`
helper that matches.

## Deployment

**v0 has no deploy tool.** Generate contracts and a frontend, but do
not write or run deploy scripts. If the user asks to deploy, explain:

> Deployment from Moncode is coming in a later version. For now, copy
> the generated contract into Foundry / Hardhat locally and deploy
> from there, then paste the address back into the dApp.

Never edit `package.json` to add a `deploy` script that uses a
`PRIVATE_KEY` env var. v0 has no key.

## Working style

- This is a vibe-coding loop: prefer one cohesive change per turn over
  many tiny ones. The user wants to see something work.
- Always start the dev server-friendly path: edits go under `app/`,
  `components/`, `lib/`. Don't create top-level scripts unless asked.
- When you finish, end your reply with a one-sentence "what to try
  now" pointer (e.g. "Click 'Connect wallet' in the preview pane").
- Don't create README files unless explicitly requested.

## GitHub (via Nango)

When the user asks to push code, create a repo, or open a PR, use the
`mcp__moncode__github_api` tool only. Credentials never enter the sandbox.

- `create_repo` — new GitHub repository
- `push_workspace` — host reads this workspace and commits via GitHub API
  (`owner`, `repo`, `message`, optional `branch`)
- `create_pr` — open a pull request between branches

Do **not** run `git push` or write tokens into the workspace. If GitHub is not
connected, call `mcp__moncode__github_request_connection` — Moncode shows an
inline connect card in chat.

Monskills is loaded as a plugin. Use its `why-monad`, `addresses`,
`gas`, `concepts`, `api`, and `wallet-integration` skills when relevant.
**Skip** any Monskills skill that wants a `PRIVATE_KEY` or runs a
deploy step — those are out of scope until v1.
