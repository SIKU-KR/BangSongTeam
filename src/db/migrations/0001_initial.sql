-- 초기 스키마 (첫 배포 전 0000~0008을 하나로 합쳤다, 2026-09-24).
--
-- drizzle-kit 생성본(테이블·인덱스)에 공개 덱 검색용 FTS5 가상 테이블과 동기화
-- 트리거를 손으로 덧붙였다. drizzle-kit은 `decks_fts`를 일반 테이블로 알고 있으므로
-- 생성된 `CREATE TABLE decks_fts`는 지운다.
--
-- 배경 행은 넣지 않는다. R2에 파일이 없는 배경 행은 편집기·송출에서 깨진 배경이
-- 되므로, 사전 주입 배경은 R2 업로드 뒤 `docs/ops/background-runbook.md` 절차로
-- 등록한다.
--
-- 저널 idx를 1로 두어 다음 `db:generate`가 0002부터 번호를 매기게 했다.
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backgrounds` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`r2_key` text NOT NULL,
	`poster_key` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`license` text NOT NULL,
	`tags` text NOT NULL,
	`source` text DEFAULT 'service' NOT NULL,
	`owner_user_id` text,
	`kind` text DEFAULT 'video' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_backgrounds_source` ON `backgrounds` (`source`);--> statement-breakpoint
CREATE INDEX `idx_backgrounds_owner` ON `backgrounds` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `decks` (
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
CREATE INDEX `idx_decks_user_scope` ON `decks` (`user_id`,`scope`);--> statement-breakpoint
CREATE INDEX `idx_decks_presentation` ON `decks` (`presentation_id`);--> statement-breakpoint
CREATE INDEX `idx_decks_visibility_forks` ON `decks` (`visibility`,`fork_count`);--> statement-breakpoint
CREATE INDEX `idx_decks_forked_from` ON `decks` (`user_id`,`forked_from`);--> statement-breakpoint
CREATE TABLE `drive_tombstones` (
	`item_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`deleted_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_drive_tombstones_user` ON `drive_tombstones` (`user_id`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`trashed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_folders_user_parent` ON `folders` (`user_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `presentation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`presentation_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`order` integer NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_presentation_items_order` ON `presentation_items` (`presentation_id`,`order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_presentation_items_unique` ON `presentation_items` (`presentation_id`,`deck_id`);--> statement-breakpoint
CREATE TABLE `presentations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`service_date` text NOT NULL,
	`folder_id` text,
	`trashed_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_presentations_user_date` ON `presentations` (`user_id`,`service_date`);--> statement-breakpoint
CREATE INDEX `idx_presentations_user_folder` ON `presentations` (`user_id`,`folder_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_at` integer,
	`resolution_note` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reports_status_created` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_target` ON `reports` (`target_type`,`target_id`);

--> statement-breakpoint

-- 공개 덱 검색 인덱스 (FTS5 Trigram)
--
-- 색인 대상은 '보관함 덱 + 공개 + 게시 중단 아님'이다. 세트에 담긴 복제본
-- (scope='presentation')은 공개 검색에 나오지 않는다. 조건은
-- `src/db/queries/publicScope.ts`의 publicDeckCondition()과 같다. 둘 중 하나만 바꾸지 않는다.
CREATE VIRTUAL TABLE IF NOT EXISTS decks_fts USING fts5(
  deck_id UNINDEXED,
  title,
  artist,
  lyrics,
  tokenize='trigram'
);
--> statement-breakpoint
-- 트리거는 '색인 대상이었던/대상이 된' 행에만 FTS를 건드린다. 프레젠테이션 동기화는
-- 세트의 덱을 매번 지우고 다시 넣는데, 조건 없이 걸면 곡마다 FTS를 훑는다.
CREATE TRIGGER IF NOT EXISTS trg_decks_fts_insert AFTER INSERT ON decks
WHEN new.scope = 'library' AND new.visibility = 'public' AND new.takedown_at IS NULL
BEGIN
  INSERT INTO decks_fts (deck_id, title, artist, lyrics)
  VALUES (new.id, new.title, COALESCE(new.artist, ''), new.lyrics_raw);
END;
--> statement-breakpoint
-- 갱신은 트리거 하나로 '빼고 → 넣기' 순서를 보장한다. 두 트리거로 나누면 SQLite가
-- 나중에 만든 트리거를 먼저 실행해, 방금 넣은 행을 지우는 일이 생긴다.
-- old.*/new.* 조건은 테이블을 참조하지 않는 상수라 거짓이면 FTS를 훑지 않는다.
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
