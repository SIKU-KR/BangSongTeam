import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

// ============================================================================
// 가사 카탈로그 및 버전 테이블 (LLM 정규화 파이프라인 & 1인 1표 보장)
// ============================================================================
export const lyricsCatalog = sqliteTable(
  "lyrics_catalog",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    artist: text("artist").default(""),
    titleNorm: text("title_norm").notNull(), // 공백·특수문자 제거, 소문자
    artistNorm: text("artist_norm").notNull(),
    lyricsCanonical: text("lyrics_canonical").notNull(),
    versionCount: integer("version_count").notNull().default(1),
    status: text("status", { enum: ["single", "normalized", "locked"] })
      .notNull()
      .default("single"),
    normalizedAt: integer("normalized_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => [
    index("idx_lyrics_catalog_norm").on(t.titleNorm, t.artistNorm),
    index("idx_lyrics_catalog_status").on(t.status),
  ],
);

export const lyricsVersions = sqliteTable(
  "lyrics_versions",
  {
    id: text("id").primaryKey(),
    catalogId: text("catalog_id")
      .notNull()
      .references(() => lyricsCatalog.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    deckId: text("deck_id").notNull(), // 루트 덱 ID
    lyrics: text("lyrics").notNull(),
    source: text("source").default("user"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => [
    index("idx_lyrics_versions_catalog").on(t.catalogId),
    // 1인 1표 보장을 위한 복합 고유 인덱스
    uniqueIndex("idx_lyrics_versions_user_catalog").on(t.userId, t.catalogId),
  ],
);

export type LyricsCatalog = typeof lyricsCatalog.$inferSelect;
export type NewLyricsCatalog = typeof lyricsCatalog.$inferInsert;
export type LyricsVersion = typeof lyricsVersions.$inferSelect;
export type NewLyricsVersion = typeof lyricsVersions.$inferInsert;
