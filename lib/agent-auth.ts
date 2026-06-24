import { NextResponse } from "next/server";

import { getProject } from "@/lib/projects";

export function getAgentSecret(): string | null {
  return process.env.MONCODE_AGENT_SECRET ?? null;
}

export async function verifyAgentRequest(
  req: Request,
  projectId: string,
): Promise<{ userId: string } | NextResponse> {
  const secret = getAgentSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "agent auth is not configured" },
      { status: 500 },
    );
  }

  const headerSecret = req.headers.get("x-moncode-agent-secret");
  const headerProjectId = req.headers.get("x-moncode-project-id");
  if (!headerSecret || headerSecret !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!headerProjectId || headerProjectId !== projectId) {
    return NextResponse.json({ error: "invalid project" }, { status: 400 });
  }

  return await getProjectUserId(projectId);
}

async function getProjectUserId(
  projectId: string,
): Promise<{ userId: string } | NextResponse> {
  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  return { userId: project.userId };
}
