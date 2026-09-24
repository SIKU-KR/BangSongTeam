-- 엔터티 id를 UUID에서 NanoID(21자)로 바꾼다 (2026-09-24).
--
-- `@repo/shared`의 `IdSchema`는 이제 NanoID만 받고 옛 UUID는 호환하지 않는다.
-- UUID로 저장된 행을 남겨 두면 읽을 때마다 Zod 검증이 실패하고, 그 id를 참조하는
-- 새 NanoID 행과 섞여 동기화가 깨진다. 실사용자 데이터가 없다는 전제에서 사용자
-- 데이터 전체와 UUID 배경 시드를 지운다. 새 배경 시드는 0007이 넣는다.
--
-- 클라이언트 쪽 짝: IndexedDB v3 업그레이드(`apps/web/src/lib/storage/db.ts`)가
-- 로컬 문서·보관함·세션 캐시를 비운다.
--
-- 배포 순서: 운영 D1에 이 마이그레이션(0006·0007)을 먼저 적용한 뒤 Worker를
-- 배포한다. 반대로 하면 새 Worker가 옛 UUID 행을 읽다가 검증에 실패한다.

PRAGMA defer_foreign_keys = on;
--> statement-breakpoint

-- reports.user_id는 CASCADE가 아니라 user보다 먼저 지운다
DELETE FROM `reports`;
--> statement-breakpoint
DELETE FROM `presentation_items`;
--> statement-breakpoint
-- trg_decks_fts_delete가 공개 덱의 검색 색인도 지운다. 남은 것이 없게 아래에서 한 번 더 비운다.
DELETE FROM `decks`;
--> statement-breakpoint
DELETE FROM decks_fts;
--> statement-breakpoint
DELETE FROM `presentations`;
--> statement-breakpoint
DELETE FROM `session`;
--> statement-breakpoint
DELETE FROM `account`;
--> statement-breakpoint
DELETE FROM `verification`;
--> statement-breakpoint
DELETE FROM `user`;
--> statement-breakpoint

-- 0002가 넣은 UUID 배경 10건. 같은 영상을 새 NanoID로 0007이 다시 넣는다.
DELETE FROM `backgrounds`;
