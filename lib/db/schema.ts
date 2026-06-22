import { bigint, index, pgTable, text } from "drizzle-orm/pg-core";

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
