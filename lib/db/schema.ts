import { bigint, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title"),
    sandboxId: text("sandbox_id"),
    agentSessionId: text("agent_session_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [index("projects_user_id_idx").on(table.userId)],
);

export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    nangoConnectionId: text("nango_connection_id").notNull(),
    displayName: text("display_name"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("connections_user_id_idx").on(table.userId),
    uniqueIndex("connections_user_provider_idx").on(table.userId, table.provider),
    uniqueIndex("connections_nango_id_idx").on(table.nangoConnectionId),
  ],
);
