import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { decks } from "./decks";

/**
 * 공개 곡 신고·교정 제안. 처리는 `src/db/ops/moderationSql.ts`의 운영 SQL로 한다.
 *
 * 신고한 사람이나 곡이 지워져도 처리 기록은 남기려고 두 외래키 모두 SET NULL이다.
 * 신고 대상이 늘면 대상마다 nullable 외래키 컬럼을 더하고 CHECK로 하나만 채운다.
 */
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").references(() => user.id, {
      onDelete: "set null",
    }),
    deckId: text("deck_id").references(() => decks.id, {
      onDelete: "set null",
    }),
    reason: text("reason", {
      enum: ["lyrics_error", "inappropriate", "copyright", "correction"],
    }).notNull(),
    details: text("details"),
    status: text("status", { enum: ["pending", "resolved", "rejected"] })
      .notNull()
      .default("pending"),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolutionNote: text("resolution_note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    check(
      "reports_reason",
      sql`${t.reason} IN ('lyrics_error', 'inappropriate', 'copyright', 'correction')`,
    ),
    check(
      "reports_status",
      sql`${t.status} IN ('pending', 'resolved', 'rejected')`,
    ),
    index("idx_reports_status_created").on(t.status, t.createdAt),
    index("idx_reports_deck").on(t.deckId),
    uniqueIndex("idx_reports_pending")
      .on(t.reporterId, t.deckId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
