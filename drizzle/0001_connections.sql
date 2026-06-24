CREATE TABLE IF NOT EXISTS "connections" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "provider" text NOT NULL,
  "nango_connection_id" text NOT NULL,
  "display_name" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_user_id_idx" ON "connections" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connections_user_provider_idx" ON "connections" USING btree ("user_id", "provider");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connections_nango_id_idx" ON "connections" USING btree ("nango_connection_id");
