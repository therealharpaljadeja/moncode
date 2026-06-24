import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { syncGithubConnectionForUser } from "@/lib/nango-sync";
import { getGithubConnectionStatus, syncGithubDisplayName } from "@/lib/github";
import { GITHUB_PROVIDER } from "@/lib/nango";
import { upsertConnection } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called right after Nango Connect UI succeeds — no webhook required. */
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;

  const row = await syncGithubConnectionForUser(auth.userId);
  if (!row) {
    return NextResponse.json(
      { error: "No GitHub connection found in Nango yet. Try again in a moment." },
      { status: 404 },
    );
  }

  const status = await getGithubConnectionStatus(auth.userId);
  let displayName = row.displayName ?? status.username ?? null;
  if (status.connected && !displayName) {
    displayName = await syncGithubDisplayName(auth.userId, row);
    if (displayName) {
      await upsertConnection({
        userId: auth.userId,
        provider: GITHUB_PROVIDER,
        nangoConnectionId: row.nangoConnectionId,
        displayName,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    connection: {
      provider: GITHUB_PROVIDER,
      connected: status.connected,
      displayName,
      connectionId: row.nangoConnectionId,
      invalid: status.invalid,
    },
  });
}
