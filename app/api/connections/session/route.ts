import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { getConnection } from "@/lib/connections";
import {
  getGithubIntegrationId,
  getNango,
  isNangoConfigured,
} from "@/lib/nango";

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

  let body: { provider?: unknown; reconnect?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const provider = body.provider;
  if (provider !== "github") {
    return NextResponse.json({ error: "unsupported provider" }, { status: 400 });
  }

  const integrationId = getGithubIntegrationId();
  const nango = getNango();

  const existing = await getConnection(auth.userId, "github");
  if (body.reconnect && existing) {
    const { data } = await nango.createReconnectSession({
      connection_id: existing.nangoConnectionId,
      integration_id: integrationId,
    });
    return NextResponse.json({ sessionToken: data.token });
  }

  const { data } = await nango.createConnectSession({
    tags: {
      end_user_id: auth.userId,
      end_user_display_name: auth.userId,
    },
    allowed_integrations: [integrationId],
  });

  return NextResponse.json({ sessionToken: data.token });
}
