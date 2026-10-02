-- 앱이 쓰지 않는 값을 지우는 둘째 단계. 0007이 들어간 버전부터 코드가 두 컬럼을 쓰지
-- 않으므로, 그 버전이 배포된 뒤에만 적용한다.
ALTER TABLE `drive_tombstones` DROP COLUMN `deleted_at`;--> statement-breakpoint
ALTER TABLE `presentation_members` DROP COLUMN `joined_at`;
