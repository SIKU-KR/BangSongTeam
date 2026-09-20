-- FTS5 Trigram 검색 인덱스 (Deck용)
CREATE VIRTUAL TABLE IF NOT EXISTS decks_fts USING fts5(
  deck_id UNINDEXED,
  title,
  artist,
  tokenize='trigram'
);
--> statement-breakpoint
-- Trigram 동기화 트리거
CREATE TRIGGER IF NOT EXISTS trg_decks_insert AFTER INSERT ON decks
WHEN new.visibility = 'public'
BEGIN
  INSERT INTO decks_fts (deck_id, title, artist) VALUES (new.id, new.title, new.artist);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_decks_update AFTER UPDATE ON decks
BEGIN
  DELETE FROM decks_fts WHERE deck_id = old.id;
  INSERT INTO decks_fts (deck_id, title, artist)
  SELECT new.id, new.title, new.artist WHERE new.visibility = 'public';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_decks_delete AFTER DELETE ON decks
BEGIN
  DELETE FROM decks_fts WHERE deck_id = old.id;
END;
