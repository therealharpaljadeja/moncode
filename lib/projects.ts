import { randomBytes } from "crypto";
import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { projects as projectsTable } from "@/lib/db/schema";

export type Project = {
  id: string;
  userId: string;
  title: string | null;
  sandboxId: string | null;
  agentSessionId: string | null;
  createdAt: number;
  updatedAt: number;
};

type ProjectRow = typeof projectsTable.$inferSelect;

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    sandboxId: row.sandboxId,
    agentSessionId: row.agentSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPublicProject(project: Project) {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export async function getProject(
  projectId: string,
): Promise<Project | undefined> {
  const rows = await getDb()
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  return rows[0] ? toProject(rows[0]) : undefined;
}

export async function listProjectsForUser(userId: string): Promise<Project[]> {
  const rows = await getDb()
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.userId, userId))
    .orderBy(desc(projectsTable.updatedAt));
  return rows.map(toProject);
}

export async function createProject(userId: string): Promise<Project> {
  const now = Date.now();
  const project: Project = {
    id: randomBytes(16).toString("hex"),
    userId,
    title: null,
    sandboxId: null,
    agentSessionId: null,
    createdAt: now,
    updatedAt: now,
  };

  await getDb().insert(projectsTable).values({
    id: project.id,
    userId: project.userId,
    title: project.title,
    sandboxId: project.sandboxId,
    agentSessionId: project.agentSessionId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });

  return project;
}

export async function updateProject(
  projectId: string,
  patch: Partial<
    Pick<Project, "title" | "sandboxId" | "agentSessionId" | "updatedAt">
  >,
): Promise<void> {
  const updates: Partial<typeof projectsTable.$inferInsert> = {
    updatedAt: patch.updatedAt ?? Date.now(),
  };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.sandboxId !== undefined) updates.sandboxId = patch.sandboxId;
  if (patch.agentSessionId !== undefined) {
    updates.agentSessionId = patch.agentSessionId;
  }

  await getDb()
    .update(projectsTable)
    .set(updates)
    .where(eq(projectsTable.id, projectId));
}

export async function clearProjectSandbox(projectId: string): Promise<void> {
  await updateProject(projectId, {
    sandboxId: null,
    agentSessionId: null,
  });
}
