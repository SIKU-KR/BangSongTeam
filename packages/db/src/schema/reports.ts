import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

// ============================================================================
// 오류 신고 및 저작권 요청
// ============================================================================
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id),
    targetType: text("target_type", { enum: ["deck", "catalog"] }).notNull(),
    targetId: text("target_id").notNull(),
    // lyrics_error | inappropriate | copyright | correction
    reason: text("reason").notNull(),
    details: text("details"),
    status: text("status", { enum: ["pending", "resolved", "rejected"] })
      .notNull()
      .default("pending"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolutionNote: text("resolution_note"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => [
    index("idx_reports_status_created").on(t.status, t.createdAt), // 운영자 대기열
    index("idx_reports_target").on(t.targetType, t.targetId),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
