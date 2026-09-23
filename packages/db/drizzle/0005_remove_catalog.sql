-- 가사 라이브러리(곡 단위 대표 가사·LLM 정규화) 제거 — MVP 범위에서 뺀다.
-- 공유는 공개 덱 게시판(중복 허용, 가져간 횟수순)만 남는다.
--
-- decks.catalog_id는 lyrics_catalog를 참조하는 외래키라 DROP COLUMN이 안 되고,
-- 부모 테이블만 지우면 decks에 쓰는 모든 문장이 'no such table'로 실패한다.
-- 그래서 decks를 다시 만든다. drizzle-kit이 만든 원안은 D1에서 위험해 손으로 고쳤다:
--
-- 1. D1은 마이그레이션 안에서 `PRAGMA foreign_keys=OFF`를 무시한다. 외래키가 켜진 채
--    `DROP TABLE decks`를 하면 암묵적 DELETE가 presentation_items를 CASCADE로 지운다.
--    → presentation_items를 백업해 두고 decks를 다시 만든 뒤 되돌린다.
--    `defer_foreign_keys`는 그 사이의 일시적 위반만 커밋 시점까지 미룬다.
-- 2. DROP TABLE은 decks에 걸린 FTS 트리거도 함께 지운다.
--    → 0004_m5_fts의 트리거를 다시 만들고 decks_fts를 새로 채운다.

PRAGMA defer_foreign_keys = on;
--> statement-breakpoint

-- 데이터 정리
UPDATE decks SET origin = 'user' WHERE origin = 'catalog';
--> statement-breakpoint
DELETE FROM reports WHERE target_type = 'catalog';
--> statement-breakpoint

-- 가사 라이브러리 검색 인덱스
DROP TRIGGER IF EXISTS trg_lyrics_catalog_fts_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_lyrics_catalog_fts_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_lyrics_catalog_fts_delete;
--> statement-breakpoint
DROP TABLE IF EXISTS lyrics_catalog_fts;
--> statement-breakpoint

-- decks 재생성 (catalog_id, contribute_to_catalog 제거)
CREATE TABLE `__backup_presentation_items` AS SELECT * FROM `presentation_items`;
--> statement-breakpoint
CREATE TABLE `__new_decks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text DEFAULT 'library' NOT NULL,
	`presentation_id` text,
	`title` text NOT NULL,
	`artist` text DEFAULT '',
	`lyrics_raw` text NOT NULL,
	`slides` text NOT NULL,
	`background_id` text,
	`style` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`forked_from` text,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'user' NOT NULL,
	`forked_from_author_name` text,
	`published_at` integer,
	`takedown_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`background_id`) REFERENCES `backgrounds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_decks`("id", "user_id", "scope", "presentation_id", "title", "artist", "lyrics_raw", "slides", "background_id", "style", "visibility", "forked_from", "fork_count", "origin", "forked_from_author_name", "published_at", "takedown_at", "created_at", "updated_at") SELECT "id", "user_id", "scope", "presentation_id", "title", "artist", "lyrics_raw", "slides", "background_id", "style", "visibility", "forked_from", "fork_count", "origin", "forked_from_author_name", "published_at", "takedown_at", "created_at", "updated_at" FROM `decks`;
--> statement-breakpoint
-- lyrics_versions.deck_id가 decks를 참조하므로 decks보다 먼저 지운다
DROP TABLE `lyrics_versions`;
--> statement-breakpoint
DROP TABLE `decks`;
--> statement-breakpoint
ALTER TABLE `__new_decks` RENAME TO `decks`;
--> statement-breakpoint
-- 외래키가 꺼진 SQLite(테스트)에서는 CASCADE가 일어나지 않아 행이 남아 있다. 비우고 되돌린다.
DELETE FROM `presentation_items`;
--> statement-breakpoint
INSERT INTO `presentation_items` SELECT * FROM `__backup_presentation_items`;
--> statement-breakpoint
DROP TABLE `__backup_presentation_items`;
--> statement-breakpoint
CREATE INDEX `idx_decks_user_scope` ON `decks` (`user_id`,`scope`);
--> statement-breakpoint
CREATE INDEX `idx_decks_presentation` ON `decks` (`presentation_id`);
--> statement-breakpoint
CREATE INDEX `idx_decks_visibility_forks` ON `decks` (`visibility`,`fork_count`);
--> statement-breakpoint
CREATE INDEX `idx_decks_forked_from` ON `decks` (`user_id`,`forked_from`);
--> statement-breakpoint

-- lyrics_catalog는 decks.catalog_id가 사라진 뒤에 지운다
DROP TABLE `lyrics_catalog`;
--> statement-breakpoint

-- 공개 덱 검색 인덱스 복구 (0004_m5_fts와 같은 정의)
DELETE FROM decks_fts;
--> statement-breakpoint
INSERT INTO decks_fts (deck_id, title, artist, lyrics)
SELECT id, title, COALESCE(artist, ''), lyrics_raw FROM decks
WHERE scope = 'library' AND visibility = 'public' AND takedown_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_decks_fts_insert AFTER INSERT ON decks
WHEN new.scope = 'library' AND new.visibility = 'public' AND new.takedown_at IS NULL
BEGIN
  INSERT INTO decks_fts (deck_id, title, artist, lyrics)
  VALUES (new.id, new.title, COALESCE(new.artist, ''), new.lyrics_raw);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_decks_fts_update AFTER UPDATE ON decks
BEGIN
  DELETE FROM decks_fts
  WHERE old.scope = 'library' AND old.visibility = 'public' AND old.takedown_at IS NULL
    AND deck_id = old.id;
  INSERT INTO decks_fts (deck_id, title, artist, lyrics)
  SELECT new.id, new.title, COALESCE(new.artist, ''), new.lyrics_raw
  WHERE new.scope = 'library' AND new.visibility = 'public' AND new.takedown_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_decks_fts_delete AFTER DELETE ON decks
WHEN old.scope = 'library' AND old.visibility = 'public' AND old.takedown_at IS NULL
BEGIN
  DELETE FROM decks_fts WHERE deck_id = old.id;
END;
