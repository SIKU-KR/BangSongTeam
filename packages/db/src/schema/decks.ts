import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { lyricsCatalog } from "./lyrics";
import { backgrounds } from "./media";
import { setlists } from "./setlists";

// ============================================================================
// 덱 (Deck) - 찬양 1곡 단위 (라이브러리 마스터 vs 콘티 복제 격리)
// ============================================================================
export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    catalogId: text("catalog_id").references(() => lyricsCatalog.id, {
      onDelete: "set null",
    }),

    // 스코프 격리 및 콘티 종속성
    scope: text("scope", { enum: ["library", "setlist"] })
      .notNull()
      .default("library"),
    setlistId: text("setlist_id").references(() => setlists.id, {
      onDelete: "cascade",
    }),

    title: text("title").notNull(),
    artist: text("artist").default(""),
    lyricsRaw: text("lyrics_raw").notNull(),
    slides: text("slides").notNull(), // JSON TEXT: Slide[]
    backgroundId: text("background_id").references(() => backgrounds.id, {
      onDelete: "set null",
    }),
    style: text("style").notNull(), // JSON TEXT: DeckStyle

    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    forkedFrom: text("forked_from"), // 원본 덱 ID (Clone-on-Add 또는 Fork 출처)
    forkCount: integer("fork_count").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => [
    index("idx_decks_user_scope").on(t.userId, t.scope), // 내 보관함 필터링 최적화
    index("idx_decks_setlist").on(t.setlistId), // 세트 종속 덱 조회
    index("idx_decks_visibility_forks").on(t.visibility, t.forkCount),
    index("idx_decks_catalog").on(t.catalogId),
  ],
);

// FTS5 가상 테이블을 Drizzle 쿼리 빌더에서 참조하기 위한 테이블 정의
export const decksFts = sqliteTable("decks_fts", {
  deckId: text("deck_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
});

export type Deck = typeof decks.$inferSelect;
export type NewDeck = typeof decks.$inferInsert;
export type DeckFts = typeof decksFts.$inferSelect;
