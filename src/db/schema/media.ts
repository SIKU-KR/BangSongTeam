import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

/**
 * 배경 갤러리. 앱은 기본 제공 배경(`source='service'`)만 만들고 내보낸다 (관리자
 * 업로드와 운영 런북 등록 모두).
 *
 * `source='user'`·`owner_user_id`는 없앤 사용자 업로드의 흔적이다. 행은
 * 마이그레이션 `0002`가 지웠고, 컬럼은 부모 테이블을 다시 만들지 않으려고 남겨 둔다
 * (`owner_user_id`는 외래키라 SQLite에서 `DROP COLUMN`이 되지 않는다).
 *
 * 행은 R2 객체가 올라간 뒤에만 만든다. 파일 없는 행이 있으면 편집기·송출이
 * 404 배경을 그린다 (`docs/ops/background-runbook.md`).
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
