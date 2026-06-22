import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import {
  createProject,
  listProjectsForUser,
  toPublicProject,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const projects = await listProjectsForUser(auth.userId);
    return NextResponse.json({
      projects: projects.map(toPublicProject),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const project = await createProject(auth.userId);
    return NextResponse.json(toPublicProject(project));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
