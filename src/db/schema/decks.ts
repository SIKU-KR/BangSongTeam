import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { backgrounds } from "./media";
import { presentations } from "./presentations";

/**
 * 곡. 보관함 곡과 프레젠테이션 사본을 한 테이블에 담는다.
 *
 * - `presentation_id`가 없으면 보관함 곡, 있으면 그 프레젠테이션 전용 사본이다.
 *   사본만 프레젠테이션 안의 자리(`item_id`·`position`)를 가지며 공개할 수 없다.
 *   두 규칙은 CHECK 제약이 강제한다.
 * - `forked_from`: 보관함 곡이면 가져온 공개 곡, 사본이면 담아 온 보관함 곡.
 *   `forked_from_author_name`은 원작 표시 스냅샷이라 원본이 지워져도 남는다.
 *   이 값이 있으면 공유 라이브러리에서 가져온 곡(`origin='fork'`)이다.
 * - 한 사람은 같은 공개 곡을 보관함에 한 번만 가져온다 (`idx_decks_fork_once`).
 * - `fork_count`는 이 곡을 가져간 보관함 곡 수다. 공개 곡 정렬 인덱스에 쓰려고
 *   저장하며 앱이 아니라 트리거(`0001_initial`)가 유지한다.
 */
export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    presentationId: text("presentation_id").references(() => presentations.id, {
      onDelete: "cascade",
    }),
    itemId: text("item_id"),
    position: integer("position"),

    title: text("title").notNull(),
    artist: text("artist").notNull().default(""),
    lyricsRaw: text("lyrics_raw").notNull(),
    slides: text("slides").notNull(),
    style: text("style").notNull(),
    backgroundId: text("background_id").references(() => backgrounds.id, {
      onDelete: "set null",
    }),

    forkedFrom: text("forked_from").references(
      (): AnySQLiteColumn => decks.id,
      { onDelete: "set null" },
    ),
    forkedFromAuthorName: text("forked_from_author_name"),

    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    takedownAt: integer("taken_down_at", { mode: "timestamp_ms" }),
    forkCount: integer("fork_count").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    check(
      "decks_presentation_slot",
      sql`(${t.presentationId} IS NULL) = (${t.itemId} IS NULL) AND (${t.presentationId} IS NULL) = (${t.position} IS NULL)`,
    ),
    check(
      "decks_presentation_copy_private",
      sql`${t.presentationId} IS NULL OR (${t.visibility} = 'private' AND ${t.publishedAt} IS NULL AND ${t.takedownAt} IS NULL AND ${t.forkCount} = 0)`,
    ),
    check(
      "decks_taken_down_private",
      sql`${t.visibility} = 'private' OR ${t.takedownAt} IS NULL`,
    ),
    check("decks_visibility", sql`${t.visibility} IN ('private', 'public')`),
    check("decks_fork_count", sql`${t.forkCount} >= 0`),
    check("decks_slides_json", sql`json_valid(${t.slides})`),
    check("decks_style_json", sql`json_valid(${t.style})`),
    uniqueIndex("idx_decks_item").on(t.itemId),
    index("idx_decks_library")
      .on(t.userId, t.updatedAt)
      .where(sql`${t.presentationId} IS NULL`),
    index("idx_decks_presentation")
      .on(t.presentationId, t.position)
      .where(sql`${t.presentationId} IS NOT NULL`),
    index("idx_decks_public")
      .on(t.forkCount, t.updatedAt)
      .where(
        sql`${t.presentationId} IS NULL AND ${t.visibility} = 'public' AND ${t.takedownAt} IS NULL`,
      ),
    index("idx_decks_forked_from").on(t.forkedFrom),
    uniqueIndex("idx_decks_fork_once")
      .on(t.userId, t.forkedFrom)
      .where(sql`${t.presentationId} IS NULL AND ${t.forkedFrom} IS NOT NULL`),
  ],
);

/**
 * FTS5 가상 테이블을 Drizzle 쿼리 빌더에서 참조하기 위한 테이블 정의.
 * 실제 DDL은 마이그레이션(0001_initial)에 수기로 관리된다.
 */
export const decksFts = sqliteTable("decks_fts", {
  deckId: text("deck_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  lyrics: text("lyrics").notNull(),
});

export type Deck = typeof decks.$inferSelect;
export type NewDeck = typeof decks.$inferInsert;
export type DeckFts = typeof decksFts.$inferSelect;
