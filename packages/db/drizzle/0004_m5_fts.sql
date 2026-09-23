-- M5 공유 라이브러리 검색 인덱스 재구성 (docs/tasks/m5/tasks_1.md Task 1.5)
--
-- 0001의 트리거는 `visibility='public'`만 보고 색인했다. 그래서 공개 샘플 곡을
-- 세트에 담은 복제본(scope='presentation')까지 공개 검색 대상이 됐다.
-- 조건을 '보관함 덱 + 공개 + 게시 중단 아님'으로 좁히고, 가사 본문 검색용
-- lyrics 컬럼을 더해 다시 만든다.

DROP TRIGGER IF EXISTS trg_decks_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_decks_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_decks_delete;
--> statement-breakpoint
DROP TABLE IF EXISTS decks_fts;
--> statement-breakpoint

-- 데이터 정리: 지금까지 공개 전환 경로가 없었으므로, 공개 상태인 덱은 모두
-- 샘플 곡에서 흘러든 값이다. 동의 기록(published_at)이 없는 공개는 무효로 본다.
UPDATE decks SET visibility = 'private', fork_count = 0 WHERE scope = 'presentation';
--> statement-breakpoint
UPDATE decks SET visibility = 'private' WHERE visibility = 'public' AND published_at IS NULL;
--> statement-breakpoint

CREATE VIRTUAL TABLE IF NOT EXISTS decks_fts USING fts5(
  deck_id UNINDEXED,
  title,
  artist,
  lyrics,
  tokenize='trigram'
);
--> statement-breakpoint
INSERT INTO decks_fts (deck_id, title, artist, lyrics)
SELECT id, title, COALESCE(artist, ''), lyrics_raw FROM decks
WHERE scope = 'library' AND visibility = 'public' AND takedown_at IS NULL;
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

-- 가사 라이브러리(곡 단위 대표 가사) 제목·아티스트 검색
CREATE VIRTUAL TABLE IF NOT EXISTS lyrics_catalog_fts USING fts5(
  catalog_id UNINDEXED,
  title,
  artist,
  tokenize='trigram'
);
--> statement-breakpoint
INSERT INTO lyrics_catalog_fts (catalog_id, title, artist)
SELECT id, title, COALESCE(artist, '') FROM lyrics_catalog;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_lyrics_catalog_fts_insert AFTER INSERT ON lyrics_catalog
BEGIN
  INSERT INTO lyrics_catalog_fts (catalog_id, title, artist)
  VALUES (new.id, new.title, COALESCE(new.artist, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_lyrics_catalog_fts_update AFTER UPDATE OF title, artist ON lyrics_catalog
BEGIN
  DELETE FROM lyrics_catalog_fts WHERE catalog_id = old.id;
  INSERT INTO lyrics_catalog_fts (catalog_id, title, artist)
  VALUES (new.id, new.title, COALESCE(new.artist, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_lyrics_catalog_fts_delete AFTER DELETE ON lyrics_catalog
BEGIN
  DELETE FROM lyrics_catalog_fts WHERE catalog_id = old.id;
END;
