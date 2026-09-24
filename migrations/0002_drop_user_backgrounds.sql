-- 사용자 배경 업로드를 없앴다. 배경은 관리자가 올리는 기본 제공 배경뿐이다.
-- 테이블·컬럼은 그대로 둔다: backgrounds는 decks의 부모 테이블이라 다시 만들면 안 되고,
-- owner_user_id는 외래키라 DROP COLUMN이 되지 않는다. 이 행을 쓰던 곡은
-- decks.background_id의 ON DELETE SET NULL로 배경 없음이 된다.
DELETE FROM `backgrounds` WHERE `source` = 'user';
