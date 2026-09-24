-- 초기 스키마 (첫 배포 전 0000~0008을 하나로 합쳤다, 2026-09-24).
--
-- drizzle-kit 생성본(테이블·인덱스)에 손으로 쓴 두 부분을 덧붙였다.
-- 1. 공개 덱 검색용 FTS5 가상 테이블과 동기화 트리거. drizzle-kit은 `decks_fts`를
--    일반 테이블로 알고 있으므로 생성된 `CREATE TABLE decks_fts`는 지운다.
-- 2. 사전 주입 배경 시드 10건.
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
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
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
-- `src/queries/publicScope.ts`의 publicDeckCondition()과 같다. 둘 중 하나만 바꾸지 않는다.
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
--> statement-breakpoint

-- 사전 주입 모션 루프 배경 10건 (PRD 6.3 / M0 산출물).
--
-- 이 행들이 없으면 `decks.background_id` 외래키 때문에 배경이 붙은 곡을 저장할 수
-- 없다. D1은 SQLite와 달리 외래키를 기본으로 강제하므로 배치 전체가 롤백되고
-- 동기화가 500으로 죽는다. 그래서 시드를 별도 스크립트가 아니라 마이그레이션으로
-- 둔다 — 로컬과 운영이 같은 명령(`db:migrate:local` / `db:migrate:prod`)으로 함께 채워진다.
--
-- 값의 정본은 `packages/shared/src/constants/backgrounds.ts`의 INITIAL_BACKGROUNDS다.
-- 두 곳이 갈라지지 않도록 `packages/db/src/seed/backgrounds.test.ts`가 대조한다.
INSERT OR IGNORE INTO backgrounds (id, title, r2_key, poster_key, duration_sec, license, tags) VALUES
  ('mJIToShuKOc3FsbZIihi6', '은은한 빛의 흐름', 'loops/warm_light_flow.mp4', 'posters/warm_light_flow.webp', 20, 'Service Original (CC0)', '["잔잔한","따뜻한"]'),
  ('VYMY2lcaf-sSYd8Z1kSmS', '고요한 호수 물결', 'loops/calm_lake_waves.mp4', 'posters/calm_lake_waves.webp', 24, 'Service Original (CC0)', '["잔잔한","차가운"]'),
  ('Z3pQ9LTe8iF6c1WabFlqw', '깊은 밤의 별빛', 'loops/night_starlight.mp4', 'posters/night_starlight.webp', 30, 'Service Original (CC0)', '["잔잔한","어두운"]'),
  ('8UCf1VBmP1pMgdSQ0cUCp', '아침 햇살의 광채', 'loops/morning_sunlight.mp4', 'posters/morning_sunlight.webp', 18, 'Service Original (CC0)', '["밝은","따뜻한"]'),
  ('9Za1L0TVfQscdGPYbnYBf', '푸른 하늘 구름', 'loops/blue_sky_clouds.mp4', 'posters/blue_sky_clouds.webp', 22, 'Service Original (CC0)', '["밝은","차가운"]'),
  ('rQReeyGx9wxCVNvKgWpNd', '새벽 미명의 안개', 'loops/dawn_mist.mp4', 'posters/dawn_mist.webp', 25, 'Service Original (CC0)', '["밝은","어두운"]'),
  ('AuLU_pxDZUXM3B6zeXfnR', '타오르는 영광의 불꽃', 'loops/glory_fire.mp4', 'posters/glory_fire.webp', 16, 'Service Original (CC0)', '["웅장한","따뜻한"]'),
  ('4EoK1yX6-2zKmjWDiONlL', '장엄한 푸른 파도', 'loops/majestic_ocean.mp4', 'posters/majestic_ocean.webp', 20, 'Service Original (CC0)', '["웅장한","차가운"]'),
  ('qkBIjmJg_eb2xSGRnHtqP', '광활한 은하수 공간', 'loops/cosmic_galaxy.mp4', 'posters/cosmic_galaxy.webp', 30, 'Service Original (CC0)', '["웅장한","어두운"]'),
  ('my-K4dh_hYkfUCJEXkopI', '찬란한 빛의 기둥', 'loops/radiant_pillars.mp4', 'posters/radiant_pillars.webp', 22, 'Service Original (CC0)', '["웅장한","따뜻한"]');
