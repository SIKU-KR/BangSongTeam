import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const backgrounds = sqliteTable("backgrounds", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  r2Key: text("r2_key").notNull(),
  posterKey: text("poster_key").notNull(),
  durationSec: integer("duration_sec").notNull(),
  license: text("license").notNull(),
  tags: text("tags").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

export type Background = typeof backgrounds.$inferSelect;
export type NewBackground = typeof backgrounds.$inferInsert;
