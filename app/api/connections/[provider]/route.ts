import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { deleteConnection, getConnection } from "@/lib/connections";
import {
  getGithubIntegrationId,
  getNango,
  isNangoConfigured,
} from "@/lib/nango";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

/**
 * Soft disconnect by default: removes Moncode's local link only.
 * Nango keeps the connection so reconnect can re-authorize without
 * uninstalling the GitHub App. Pass ?revoke=true to delete from Nango too.
 */
export async function DELETE(req: Request, context: RouteContext) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;

  const { provider } = await context.params;
  if (provider !== "github") {
    return NextResponse.json({ error: "unsupported provider" }, { status: 400 });
  }

  const row = await getConnection(auth.userId, "github");
  if (!row) {
    return NextResponse.json({ ok: true });
  }

  const revoke = new URL(req.url).searchParams.get("revoke") === "true";

  if (revoke && isNangoConfigured()) {
    try {
      const nango = getNango();
      await nango.deleteConnection(
        getGithubIntegrationId(),
        row.nangoConnectionId,
      );
    } catch {
      // Still remove local record if Nango already deleted it.
    }
  }

  await deleteConnection(auth.userId, "github");
  return NextResponse.json({ ok: true, revoked: revoke });
}
