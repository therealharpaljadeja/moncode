import { PrivyClient } from "@privy-io/server-auth";
import { NextResponse } from "next/server";

import { getProject, type Project } from "@/lib/projects";

let privy: PrivyClient | null = null;

function getPrivy(): PrivyClient {
  if (privy) return privy;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Privy server credentials are not configured");
  }
  privy = new PrivyClient(appId, appSecret);
  return privy;
}

export type AuthUser = { userId: string };

export async function requireUser(
  req: Request,
): Promise<AuthUser | NextResponse> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      {
        error:
          "Server auth is not configured. Set PRIVY_APP_SECRET in .env.local.",
      },
      { status: 500 },
    );
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const claims = await getPrivy().verifyAuthToken(token);
    return { userId: claims.userId };
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export type OwnedProject = { user: AuthUser; project: Project };

export async function requireOwnedProject(
  req: Request,
  projectId: string,
): Promise<OwnedProject | NextResponse> {
  const user = await requireUser(req);
  if (user instanceof NextResponse) return user;

  const project = await getProject(projectId);
  if (!project || project.userId !== user.userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return { user, project };
}
