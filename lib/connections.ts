import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb } from "@/lib/db";
import { connections } from "@/lib/db/schema";

export type Connection = typeof connections.$inferSelect;

export type ConnectionProvider = "github";

export async function listConnections(userId: string): Promise<Connection[]> {
  return getDb()
    .select()
    .from(connections)
    .where(eq(connections.userId, userId))
    .orderBy(desc(connections.updatedAt));
}

export async function getConnection(
  userId: string,
  provider: ConnectionProvider,
): Promise<Connection | null> {
  const rows = await getDb()
    .select()
    .from(connections)
    .where(
      and(eq(connections.userId, userId), eq(connections.provider, provider)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertConnection(input: {
  userId: string;
  provider: ConnectionProvider;
  nangoConnectionId: string;
  displayName?: string | null;
}): Promise<Connection> {
  const now = Date.now();
  const existing = await getConnection(input.userId, input.provider);

  if (existing) {
    const [row] = await getDb()
      .update(connections)
      .set({
        nangoConnectionId: input.nangoConnectionId,
        displayName: input.displayName ?? existing.displayName,
        updatedAt: now,
      })
      .where(eq(connections.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await getDb()
    .insert(connections)
    .values({
      id: nanoid(),
      userId: input.userId,
      provider: input.provider,
      nangoConnectionId: input.nangoConnectionId,
      displayName: input.displayName ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function deleteConnection(
  userId: string,
  provider: ConnectionProvider,
): Promise<boolean> {
  const result = await getDb()
    .delete(connections)
    .where(
      and(eq(connections.userId, userId), eq(connections.provider, provider)),
    )
    .returning({ id: connections.id });
  return result.length > 0;
}
