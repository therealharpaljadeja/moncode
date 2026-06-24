import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { listConnections } from "@/lib/connections";
import {
  getGithubConnectionStatus,
  syncGithubDisplayName,
} from "@/lib/github";
import { GITHUB_PROVIDER } from "@/lib/nango";
import { upsertConnection } from "@/lib/connections";
import { syncGithubConnectionForUser } from "@/lib/nango-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConnectionSummary = {
  provider: string;
  connected: boolean;
  displayName: string | null;
  connectionId: string | null;
  invalid?: boolean;
};

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;

  let syncError: string | null = null;
  try {
    await syncGithubConnectionForUser(auth.userId);
  } catch (err) {
    syncError =
      err instanceof Error ? err.message : "Could not sync from Nango.";
  }

  const rows = await listConnections(auth.userId);
  const githubStatus = await getGithubConnectionStatus(auth.userId);

  const githubRow = rows.find((r) => r.provider === GITHUB_PROVIDER);
  let githubDisplay = githubRow?.displayName ?? githubStatus.username ?? null;
  if (githubStatus.connected && githubRow && !githubDisplay) {
    githubDisplay = await syncGithubDisplayName(auth.userId, githubRow);
    if (githubDisplay) {
      await upsertConnection({
        userId: auth.userId,
        provider: GITHUB_PROVIDER,
        nangoConnectionId: githubRow.nangoConnectionId,
        displayName: githubDisplay,
      });
    }
  }

  const connections: ConnectionSummary[] = [
    {
      provider: GITHUB_PROVIDER,
      connected: githubStatus.connected,
      displayName: githubDisplay,
      connectionId: githubRow?.nangoConnectionId ?? null,
      invalid: githubStatus.invalid,
    },
  ];

  return NextResponse.json({
    connections,
    ...(syncError ? { syncWarning: syncError } : {}),
  });
}
