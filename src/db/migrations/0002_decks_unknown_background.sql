-- 모르는 배경 (`decks.background_id`)
--
-- 서버에 없는 배경 id를 쓰면 외래키 위반으로 batch 전체가 롤백되어 곡·프레젠테이션이
-- 통째로 저장되지 않는다. 배경은 장식이고 가사는 봉사자의 작업물이라, 모르는 배경은
-- '배경 없음'으로 낮춰 받는다. 즉시 외래키는 문장이 끝날 때 검사하고 AFTER 트리거는
-- 같은 문장 안에서 돌므로, 여기서 비우면 위반 없이 저장된다.
CREATE TRIGGER trg_decks_unknown_background_insert AFTER INSERT ON decks
WHEN new.background_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM backgrounds WHERE id = new.background_id)
BEGIN
  UPDATE decks SET background_id = NULL WHERE id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER trg_decks_unknown_background_update AFTER UPDATE OF background_id ON decks
WHEN new.background_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM backgrounds WHERE id = new.background_id)
BEGIN
  UPDATE decks SET background_id = NULL WHERE id = new.id;
END;
