import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

/**
 * 사전 주입 배경(`source='service'`)과 사용자 커스텀 배경(`source='user'`)을
 * 한 테이블에 둔다. `decks.background_id`가 둘 중 무엇이든 같은 외래키로 가리킨다.
 *
 * 행은 R2 객체가 올라간 뒤에만 만든다. 파일 없는 행이 있으면 편집기·송출이
 * 404 배경을 그린다 (사전 주입 등록은 `docs/ops/background-runbook.md`).
 */
export const backgrounds = sqliteTable(
  "backgrounds",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    r2Key: text("r2_key").notNull(),
    posterKey: text("poster_key").notNull(),
    durationSec: integer("duration_sec").notNull(),
    license: text("license").notNull(),
    tags: text("tags").notNull(),
    source: text("source", { enum: ["service", "user"] })
      .notNull()
      .default("service"),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", { enum: ["video", "image"] })
      .notNull()
      .default("video"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => [
    index("idx_backgrounds_source").on(t.source),
    index("idx_backgrounds_owner").on(t.ownerUserId),
  ],
);

export type Background = typeof backgrounds.$inferSelect;
export type NewBackground = typeof backgrounds.$inferInsert;
