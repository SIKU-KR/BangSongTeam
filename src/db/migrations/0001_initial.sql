-- 초기 스키마. 첫 배포 전에 정규화하며 0001부터 다시 만들었다 (2026-10-02).
--
-- drizzle-kit 생성본(테이블·인덱스·뷰)에 공개 곡 검색용 FTS5 가상 테이블, 동기화
-- 트리거, `decks.fork_count` 유지 트리거를 손으로 덧붙였다. drizzle-kit은 `decks_fts`를
-- 일반 테이블로 알고 있으므로 생성된 `CREATE TABLE decks_fts`는 지운다.
--
-- 배경 행은 넣지 않는다. R2에 파일이 없는 배경 행은 편집기·송출에서 깨진 배경이
-- 되므로, 배경은 R2 업로드 뒤 `src/db/ops/backgroundSql.ts`로 등록한다.
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
CREATE INDEX `idx_account_user` ON `account` (`user_id`);--> statement-breakpoint
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
CREATE INDEX `idx_session_user` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`terms_agreed_at` integer,
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
CREATE TABLE `background_keywords` (
	`background_id` text NOT NULL,
	`keyword` text NOT NULL,
	PRIMARY KEY(`background_id`, `keyword`),
	FOREIGN KEY (`background_id`) REFERENCES `backgrounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `backgrounds` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'video' NOT NULL,
	`r2_key` text NOT NULL,
	`poster_key` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`license` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "backgrounds_kind" CHECK("backgrounds"."kind" IN ('video', 'image'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backgrounds_r2_key_unique` ON `backgrounds` (`r2_key`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`presentation_id` text,
	`item_id` text,
	`position` integer,
	`title` text NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`lyrics_raw` text NOT NULL,
	`slides` text NOT NULL,
	`style` text NOT NULL,
	`background_id` text,
	`forked_from` text,
	`forked_from_author_name` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`published_at` integer,
	`taken_down_at` integer,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`background_id`) REFERENCES `backgrounds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`forked_from`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "decks_presentation_slot" CHECK(("decks"."presentation_id" IS NULL) = ("decks"."item_id" IS NULL) AND ("decks"."presentation_id" IS NULL) = ("decks"."position" IS NULL)),
	CONSTRAINT "decks_presentation_copy_private" CHECK("decks"."presentation_id" IS NULL OR ("decks"."visibility" = 'private' AND "decks"."published_at" IS NULL AND "decks"."taken_down_at" IS NULL AND "decks"."fork_count" = 0)),
	CONSTRAINT "decks_taken_down_private" CHECK("decks"."visibility" = 'private' OR "decks"."taken_down_at" IS NULL),
	CONSTRAINT "decks_visibility" CHECK("decks"."visibility" IN ('private', 'public')),
	CONSTRAINT "decks_fork_count" CHECK("decks"."fork_count" >= 0),
	CONSTRAINT "decks_slides_json" CHECK(json_valid("decks"."slides")),
	CONSTRAINT "decks_style_json" CHECK(json_valid("decks"."style"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_decks_item` ON `decks` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_decks_library` ON `decks` (`user_id`,`updated_at`) WHERE "decks"."presentation_id" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_decks_presentation` ON `decks` (`presentation_id`,`position`) WHERE "decks"."presentation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_decks_public` ON `decks` (`fork_count`,`updated_at`) WHERE "decks"."presentation_id" IS NULL AND "decks"."visibility" = 'public' AND "decks"."taken_down_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_decks_forked_from` ON `decks` (`forked_from`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_decks_fork_once` ON `decks` (`user_id`,`forked_from`) WHERE "decks"."presentation_id" IS NULL AND "decks"."forked_from" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `drive_tombstones` (
	`item_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "drive_tombstones_kind" CHECK("drive_tombstones"."kind" IN ('folder', 'presentation'))
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
CREATE TABLE `presentation_members` (
	`presentation_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`presentation_id`, `user_id`),
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_presentation_members_user` ON `presentation_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `presentations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`service_date` text NOT NULL,
	`folder_id` text,
	`trashed_at` integer,
	`link_access` text DEFAULT 'off' NOT NULL,
	`link_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "presentations_link_access" CHECK("presentations"."link_access" IN ('off', 'view'))
);
--> statement-breakpoint
CREATE INDEX `idx_presentations_user_date` ON `presentations` (`user_id`,`service_date`);--> statement-breakpoint
CREATE INDEX `idx_presentations_user_folder` ON `presentations` (`user_id`,`folder_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_presentations_link_token` ON `presentations` (`link_token`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text,
	`deck_id` text,
	`reason` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolved_at` integer,
	`resolution_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reports_reason" CHECK("reports"."reason" IN ('lyrics_error', 'inappropriate', 'copyright', 'correction')),
	CONSTRAINT "reports_status" CHECK("reports"."status" IN ('pending', 'resolved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `idx_reports_status_created` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_deck` ON `reports` (`deck_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reports_pending` ON `reports` (`reporter_id`,`deck_id`) WHERE "reports"."status" = 'pending';--> statement-breakpoint
CREATE VIEW `background_usage` AS select "backgrounds"."id" as "background_id", count("decks"."id") as "deck_count" from "backgrounds" left join "decks" on "decks"."background_id" = "backgrounds"."id" group by "backgrounds"."id";--> statement-breakpoint
CREATE VIEW `public_decks` AS select "decks"."id", "decks"."user_id", "user"."name" as "author_name", "decks"."title", "decks"."artist", "decks"."lyrics_raw", "decks"."slides", "decks"."style", "decks"."background_id", "decks"."forked_from", "decks"."forked_from_author_name", "decks"."fork_count", "decks"."published_at", "decks"."created_at", "decks"."updated_at" from "decks" inner join "user" on "user"."id" = "decks"."user_id" where ("decks"."presentation_id" is null and "decks"."visibility" = 'public' and "decks"."taken_down_at" is null);

--> statement-breakpoint

-- 공개 곡 검색 인덱스 (FTS5 Trigram)
--
-- 색인 대상은 '보관함 곡 + 공개 + 게시 중단 아님'이다. 조건은 `public_decks` 뷰와
-- 부분 인덱스 `idx_decks_public`의 조건과 같다. 셋 중 하나만 바꾸지 않는다.
CREATE VIRTUAL TABLE decks_fts USING fts5(
  deck_id UNINDEXED,
  title,
  artist,
  lyrics,
  tokenize='trigram'
);
--> statement-breakpoint
-- 트리거는 '색인 대상이었던/대상이 된' 행에만 FTS를 건드린다. 프레젠테이션 저장은
-- 사본 행을 자주 쓰는데, 조건 없이 걸면 곡마다 FTS를 훑는다.
CREATE TRIGGER trg_decks_fts_insert AFTER INSERT ON decks
WHEN new.presentation_id IS NULL AND new.visibility = 'public' AND new.taken_down_at IS NULL
BEGIN
  INSERT INTO decks_fts (deck_id, title, artist, lyrics)
  VALUES (new.id, new.title, new.artist, new.lyrics_raw);
END;
--> statement-breakpoint
-- 갱신은 트리거 하나로 '빼고 → 넣기' 순서를 보장한다. 두 트리거로 나누면 SQLite가
-- 나중에 만든 트리거를 먼저 실행해, 방금 넣은 행을 지우는 일이 생긴다. 색인 내용과
-- 공개 조건 컬럼이 바뀔 때만 돈다. `fork_count` 트리거가 원본 곡을 고칠 때 FTS를 다시
-- 쓰지 않게 하려는 것이다.
CREATE TRIGGER trg_decks_fts_update
AFTER UPDATE OF title, artist, lyrics_raw, visibility, taken_down_at, presentation_id ON decks
BEGIN
  DELETE FROM decks_fts
  WHERE old.presentation_id IS NULL AND old.visibility = 'public' AND old.taken_down_at IS NULL
    AND deck_id = old.id;
  INSERT INTO decks_fts (deck_id, title, artist, lyrics)
  SELECT new.id, new.title, new.artist, new.lyrics_raw
  WHERE new.presentation_id IS NULL AND new.visibility = 'public' AND new.taken_down_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER trg_decks_fts_delete AFTER DELETE ON decks
WHEN old.presentation_id IS NULL AND old.visibility = 'public' AND old.taken_down_at IS NULL
BEGIN
  DELETE FROM decks_fts WHERE deck_id = old.id;
END;
--> statement-breakpoint

-- 가져간 횟수 (`decks.fork_count`)
--
-- 원천은 '`forked_from`이 이 곡인 보관함 곡'이고, 이 값은 공개 곡 정렬 인덱스에 쓰려고
-- 저장한 파생값이다. 앱은 쓰지 않고 아래 트리거만 고친다. 어긋나면 다음으로 다시 센다:
-- UPDATE decks SET fork_count = (SELECT count(*) FROM decks f WHERE f.forked_from = decks.id AND f.presentation_id IS NULL);
CREATE TRIGGER trg_decks_fork_count_insert AFTER INSERT ON decks
WHEN new.presentation_id IS NULL AND new.forked_from IS NOT NULL
BEGIN
  UPDATE decks SET fork_count = fork_count + 1 WHERE id = new.forked_from;
END;
--> statement-breakpoint
CREATE TRIGGER trg_decks_fork_count_delete AFTER DELETE ON decks
WHEN old.presentation_id IS NULL AND old.forked_from IS NOT NULL
BEGIN
  UPDATE decks SET fork_count = fork_count - 1 WHERE id = old.forked_from;
END;
--> statement-breakpoint
CREATE TRIGGER trg_decks_fork_count_update AFTER UPDATE OF forked_from, presentation_id ON decks
WHEN old.forked_from IS NOT new.forked_from OR old.presentation_id IS NOT new.presentation_id
BEGIN
  UPDATE decks SET fork_count = fork_count - 1
  WHERE old.presentation_id IS NULL AND id = old.forked_from;
  UPDATE decks SET fork_count = fork_count + 1
  WHERE new.presentation_id IS NULL AND id = new.forked_from;
END;
