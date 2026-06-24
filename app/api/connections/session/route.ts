import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getConnection } from "@/lib/connections";
import {
  getGithubIntegrationId,
  getNango,
  isNangoConfigured,
} from "@/lib/nango";
import {
  findGithubNangoConnectionId,
  tryRestoreGithubFromNango,
} from "@/lib/nango-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;

  if (!isNangoConfigured()) {
    return NextResponse.json(
      { error: "Nango is not configured. Set NANGO_SECRET_KEY." },
      { status: 500 },
    );
  }

  let body: { provider?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const provider = body.provider;
  if (provider !== "github") {
    return NextResponse.json({ error: "unsupported provider" }, { status: 400 });
  }

  const restored = await tryRestoreGithubFromNango(auth.userId);
  if (restored) {
    return NextResponse.json({
      mode: "restored",
      connection: {
        provider: "github",
        connected: true,
        displayName: restored.username ?? null,
        connectionId: restored.connectionId ?? null,
      },
    });
  }

  const integrationId = getGithubIntegrationId();
  const nango = getNango();

  const local = await getConnection(auth.userId, "github");
  const nangoConnectionId =
    local?.nangoConnectionId ??
    (await findGithubNangoConnectionId(auth.userId));

  if (nangoConnectionId) {
    const { data } = await nango.createReconnectSession({
      connection_id: nangoConnectionId,
      integration_id: integrationId,
      tags: {
        end_user_id: auth.userId,
        end_user_display_name: auth.userId,
      },
    });
    return NextResponse.json({ sessionToken: data.token, mode: "reconnect" });
  }

  const { data } = await nango.createConnectSession({
    tags: {
      end_user_id: auth.userId,
      end_user_display_name: auth.userId,
    },
    allowed_integrations: [integrationId],
  });

  return NextResponse.json({ sessionToken: data.token, mode: "connect" });
}
