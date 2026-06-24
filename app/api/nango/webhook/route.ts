import { NextResponse } from "next/server";

import {
  deleteConnection,
  getConnectionByNangoId,
  upsertConnection,
} from "@/lib/connections";
import { syncGithubDisplayName } from "@/lib/github";
import { getGithubIntegrationId, GITHUB_PROVIDER } from "@/lib/nango";
import {
  getNangoWebhookSigningKey,
  verifyNangoWebhookSignature,
} from "@/lib/nango-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NangoAuthWebhook = {
  type?: string;
  operation?: string;
  success?: boolean;
  connectionId?: string;
  providerConfigKey?: string;
  tags?: Record<string, string>;
  error?: { type?: string; description?: string };
};

export async function POST(req: Request) {
  const rawBody = await req.text();

  const signingKey = getNangoWebhookSigningKey();
  if (signingKey) {
    const signature = req.headers.get("x-nango-hmac-sha256");
    if (!verifyNangoWebhookSignature(rawBody, signature, signingKey)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let body: NangoAuthWebhook;
  try {
    body = JSON.parse(rawBody) as NangoAuthWebhook;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (body.type !== "auth" || !body.connectionId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const integrationId = body.providerConfigKey ?? getGithubIntegrationId();
  if (integrationId !== getGithubIntegrationId()) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (body.success === false) {
    const removed = await clearGithubConnectionForAuthFailure(body);
    return NextResponse.json({
      ok: true,
      disconnected: removed,
      operation: body.operation ?? null,
    });
  }

  if (!body.success) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const userId = body.tags?.end_user_id;
  if (!userId) {
    return NextResponse.json({ error: "missing end_user_id tag" }, { status: 400 });
  }

  const row = await upsertConnection({
    userId,
    provider: GITHUB_PROVIDER,
    nangoConnectionId: body.connectionId,
  });

  const displayName = await syncGithubDisplayName(userId, row);
  if (displayName) {
    await upsertConnection({
      userId,
      provider: GITHUB_PROVIDER,
      nangoConnectionId: body.connectionId,
      displayName,
    });
  }

  return NextResponse.json({ ok: true, connected: true });
}

/**
 * Nango sends `type: auth`, `operation: refresh`, `success: false` when
 * credentials can no longer be refreshed (e.g. user uninstalled the GitHub App).
 */
async function clearGithubConnectionForAuthFailure(
  body: NangoAuthWebhook,
): Promise<boolean> {
  const userId = body.tags?.end_user_id;
  if (userId) {
    return deleteConnection(userId, GITHUB_PROVIDER);
  }

  const connectionId = body.connectionId;
  if (!connectionId) return false;

  const row = await getConnectionByNangoId(connectionId);
  if (!row) return false;

  return deleteConnection(row.userId, GITHUB_PROVIDER);
}
