import { NextResponse } from "next/server";

import { verifyAgentRequest } from "@/lib/agent-auth";
import {
  GithubConnectionRequiredError,
  getGithubConnectionStatus,
  runGithubOp,
} from "@/lib/github";
import { pushWorkspaceToGithub } from "@/lib/github-workspace";
import { collectSandboxWorkspace } from "@/lib/sandbox-workspace";
import { getSession } from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GithubOpBody = { op?: string } & Record<string, unknown>;

export async function POST(req: Request) {
  let body: { projectId?: unknown; op?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const projectId = body.projectId;
  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const auth = await verifyAgentRequest(req, projectId);
  if (auth instanceof NextResponse) return auth;

  const op = body.op;
  if (!op || typeof op !== "object" || !("op" in op)) {
    return NextResponse.json({ error: "op is required" }, { status: 400 });
  }

  const typedOp = op as GithubOpBody;

  try {
    let result: unknown;

    if (typedOp.op === "push_workspace") {
      const owner = typedOp.owner;
      const repo = typedOp.repo;
      const message = typedOp.message;
      console.log("owner", owner);
      console.log("repo", repo);
      console.log("message", message);
      if (typeof owner !== "string" || typeof repo !== "string") {
        return NextResponse.json(
          { error: "owner and repo are required" },
          { status: 400 },
        );
      }
      if (typeof message !== "string" || !message.trim()) {
        return NextResponse.json(
          { error: "message is required" },
          { status: 400 },
        );
      }

      const session = getSession(projectId);
      if (!session?.sandbox || session.bootStatus !== "ready") {
        return NextResponse.json(
          { error: "sandbox is not ready" },
          { status: 409 },
        );
      }

      const files = await collectSandboxWorkspace(session.sandbox);
      result = await pushWorkspaceToGithub(auth.userId, files, {
        owner,
        repo,
        branch: typeof typedOp.branch === "string" ? typedOp.branch : undefined,
        message: message.trim(),
      });
    } else {
      result = await runGithubOp(
        auth.userId,
        typedOp as Parameters<typeof runGithubOp>[1],
      );
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof GithubConnectionRequiredError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
        },
        { status: 403 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const auth = await verifyAgentRequest(req, projectId);
  if (auth instanceof NextResponse) return auth;

  const status = await getGithubConnectionStatus(auth.userId);
  return NextResponse.json(status);
}
