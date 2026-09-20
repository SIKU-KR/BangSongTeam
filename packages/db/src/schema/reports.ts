import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

// ============================================================================
// 오류 신고 및 저작권 요청
// ============================================================================
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => user.id),
  targetType: text("target_type", { enum: ["deck", "catalog"] }).notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["pending", "resolved", "rejected"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
