-- 앱이 쓰지 않는 값을 지우는 첫 단계. 배포 때 마이그레이션이 먼저 돌고 이전 버전이 잠시
-- 새 스키마에서 돌므로, 컬럼은 코드가 쓰지 않게 된 다음 배포(0008)에서 지운다.
-- 사용자 업로드 배경을 없앤 뒤 owner_user_id 인덱스는 쓰이지 않는다.
DROP INDEX `idx_backgrounds_owner`;--> statement-breakpoint
-- drive_tombstones.deleted_at을 nullable로 바꾼다. 새 코드는 쓰지 않고 이전 코드는 계속
-- 쓸 수 있다. 자식 테이블이 없어 다시 만들어도 다른 행에 영향이 없다.
CREATE TABLE `__new_drive_tombstones` (
	`item_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_drive_tombstones`("item_id", "user_id", "kind", "deleted_at") SELECT "item_id", "user_id", "kind", "deleted_at" FROM `drive_tombstones`;--> statement-breakpoint
DROP TABLE `drive_tombstones`;--> statement-breakpoint
ALTER TABLE `__new_drive_tombstones` RENAME TO `drive_tombstones`;--> statement-breakpoint
CREATE INDEX `idx_drive_tombstones_user` ON `drive_tombstones` (`user_id`);
