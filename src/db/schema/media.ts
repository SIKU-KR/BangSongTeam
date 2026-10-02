import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * 배경 갤러리. 모든 배경은 관리자가 올리는 기본 제공 배경이다. 행은
 * `scripts/importBackgrounds.mjs`가 매니페스트(`data/backgrounds/*.json`)로 만든다.
 *
 * 행은 R2 객체가 올라간 뒤에만 만든다. 파일 없는 행이 있으면 편집기·송출이
 * 404 배경을 그린다.
 */
export const backgrounds = sqliteTable(
  "backgrounds",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["video", "image"] })
      .notNull()
      .default("video"),
    r2Key: text("r2_key").notNull().unique(),
    posterKey: text("poster_key").notNull(),
    durationSec: integer("duration_sec").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    license: text("license").notNull().default(""),
    description: text("description").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [check("backgrounds_kind", sql`${t.kind} IN ('video', 'image')`)],
);

/** 배경 검색 키워드. 스틸컷을 보고 붙인 태그 집합이다. */
export const backgroundKeywords = sqliteTable(
  "background_keywords",
  {
    backgroundId: text("background_id")
      .notNull()
      .references(() => backgrounds.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
  },
  (t) => [primaryKey({ columns: [t.backgroundId, t.keyword] })],
);

export type Background = typeof backgrounds.$inferSelect;
export type NewBackground = typeof backgrounds.$inferInsert;
export type BackgroundKeyword = typeof backgroundKeywords.$inferSelect;
