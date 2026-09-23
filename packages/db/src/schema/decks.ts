import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { lyricsCatalog } from "./lyrics";
import { backgrounds } from "./media";
import { presentations } from "./presentations";

// ============================================================================
// 덱 (Deck) - 찬양 1곡 단위 (라이브러리 마스터 vs 프레젠테이션 복제 격리)
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

    // 스코프 격리 및 프레젠테이션 종속성
    scope: text("scope", { enum: ["library", "presentation"] })
      .notNull()
      .default("library"),
    presentationId: text("presentation_id").references(() => presentations.id, {
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
    // 출처 (M5):
    // - scope='library': 포크 원본 공개 덱 ID. 서버만 쓴다 (`POST /api/decks/:id/fork`)
    // - scope='presentation': 복제해 온 보관함 덱 ID (편집기 '공유'가 원본을 찾는 근거)
    forkedFrom: text("forked_from"),
    forkCount: integer("fork_count").notNull().default(0),

    // ---- M5 공유 필드 (contribute_to_catalog 외에는 서버 소유) ----
    contributeToCatalog: integer("contribute_to_catalog", { mode: "boolean" })
      .notNull()
      .default(false),
    origin: text("origin", { enum: ["user", "fork", "catalog"] })
      .notNull()
      .default("user"),
    forkedFromAuthorName: text("forked_from_author_name"),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    takedownAt: integer("takedown_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => [
    index("idx_decks_user_scope").on(t.userId, t.scope), // 내 보관함 필터링 최적화
    index("idx_decks_presentation").on(t.presentationId), // 세트 종속 덱 조회
    index("idx_decks_visibility_forks").on(t.visibility, t.forkCount),
    index("idx_decks_catalog").on(t.catalogId),
    index("idx_decks_forked_from").on(t.userId, t.forkedFrom), // 포크 멱등성 조회
  ],
);

// FTS5 가상 테이블을 Drizzle 쿼리 빌더에서 참조하기 위한 테이블 정의.
//
// 실제 DDL(가상 테이블·트리거)은 손으로 쓴 커스텀 마이그레이션(`0001_fts5`,
// `0004_m5_fts`)에만 있다. drizzle-kit이 이 정의로 만든 `*_fts` DDL은 생성된
// 마이그레이션에서 지운다 (docs/tasks/m5/tasks_1.md 가드레일 4).
export const decksFts = sqliteTable("decks_fts", {
  deckId: text("deck_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  lyrics: text("lyrics").notNull(),
});

export type Deck = typeof decks.$inferSelect;
export type NewDeck = typeof decks.$inferInsert;
export type DeckFts = typeof decksFts.$inferSelect;
