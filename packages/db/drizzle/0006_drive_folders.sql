-- 드라이브 폴더 트리 (홈 `/presentations` 재개편).
--
-- drizzle-kit 생성본을 두 군데 손봤다.
-- 1. `presentations`는 반드시 ALTER TABLE ADD COLUMN으로 넓힌다. 테이블을 다시
--    만들면(DROP TABLE) D1이 `presentation_items`와 세트 복제 덱을 cascade로
--    지운다 (0005에서 겪은 일).
-- 2. drizzle-kit이 ADD COLUMN의 `ON DELETE SET NULL`을 빠뜨린다. 폴더가 어떤
--    경로로 사라지든 파일은 루트로 떨어져야 하므로 직접 적는다.
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
ALTER TABLE `presentations` ADD `folder_id` text REFERENCES folders(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `presentations` ADD `trashed_at` integer;--> statement-breakpoint
CREATE INDEX `idx_presentations_user_folder` ON `presentations` (`user_id`,`folder_id`);