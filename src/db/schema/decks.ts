import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { backgrounds } from "./media";
import { presentations } from "./presentations";

export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    scope: text("scope", { enum: ["library", "presentation"] })
      .notNull()
      .default("library"),
    presentationId: text("presentation_id").references(() => presentations.id, {
      onDelete: "cascade",
    }),

    title: text("title").notNull(),
    artist: text("artist").default(""),
    lyricsRaw: text("lyrics_raw").notNull(),
    slides: text("slides").notNull(),
    backgroundId: text("background_id").references(() => backgrounds.id, {
      onDelete: "set null",
    }),
    style: text("style").notNull(),

    visibility: text("visibility", { enum: ["private", "public"] })
      .notNull()
      .default("private"),
    forkedFrom: text("forked_from"),
    forkCount: integer("fork_count").notNull().default(0),

    origin: text("origin", { enum: ["user", "fork"] })
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
    index("idx_decks_user_scope").on(t.userId, t.scope),
    index("idx_decks_presentation").on(t.presentationId),
    index("idx_decks_visibility_forks").on(t.visibility, t.forkCount),
    index("idx_decks_forked_from").on(t.userId, t.forkedFrom),
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
