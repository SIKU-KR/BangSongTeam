import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createId, DEFAULT_DECK_STYLE, type Deck } from "#shared";
import {
  getOfflineDB,
  closeOfflineDB,
  OFFLINE_DB_NAME,
  type WorshipOfflineDB,
} from "./db";
import {
  saveSong,
  loadAllSongs,
  deleteSong,
  clearAllSongs,
  migrateLegacySongs,
  LEGACY_SONGS_KEY,
  LEGACY_SONGS_BACKUP_KEY,
} from "./songRepository";

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  const now = new Date().toISOString();
  return {
    id: createId(),
    userId: "00000000x000000000001",
    scope: "library",
    presentationId: null,
    title: "은혜",
    artist: "테스트",
    lyricsRaw: "한 줄\n\n두 줄",
    slides: [
      { id: "s_1", order: 0, lines: ["한 줄"] },
      { id: "s_2", order: 1, lines: ["두 줄"] },
    ],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function seedRawDeck(record: unknown): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("decks", "readwrite");
  await tx.store.put(record as WorshipOfflineDB["decks"]["value"]);
  await tx.done;
}

describe("songRepository", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDatabase();
  });

  afterEach(closeOfflineDB);

  it("보관함 곡을 저장하고 다시 읽는다", async () => {
    const deck = makeDeck({ title: "시간을 뚫고" });

    await saveSong(deck);
    const { valid, corrupted } = await loadAllSongs();

    expect(corrupted).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].title).toBe("시간을 뚫고");
  });

  it("곡을 삭제할 수 있다", async () => {
    const deck = makeDeck();
    await saveSong(deck);

    await deleteSong(deck.id);

    expect((await loadAllSongs()).valid).toHaveLength(0);
  });

  it("손상된 곡은 분리해 반환하고 저장소에 그대로 남긴다", async () => {
    await saveSong(makeDeck({ title: "정상 곡" }));
    await seedRawDeck({ id: "broken-deck", title: null });

    const { valid, corrupted } = await loadAllSongs();

    expect(valid.map((d) => d.title)).toEqual(["정상 곡"]);
    expect(corrupted.map((c) => c.id)).toEqual(["broken-deck"]);
    expect((await loadAllSongs()).corrupted).toHaveLength(1);
  });

  it("clearAllSongs는 보관함을 비운다", async () => {
    await saveSong(makeDeck());

    await clearAllSongs();

    expect((await loadAllSongs()).valid).toHaveLength(0);
  });

  describe("localStorage 마이그레이션", () => {
    it("유효한 곡만 옮기고 원본은 백업 키로 남긴다", async () => {
      const good1 = makeDeck({ title: "곡 A" });
      const good2 = makeDeck({ title: "곡 B" });
      const broken = { id: "broken", title: 123 };
      localStorage.setItem(
        LEGACY_SONGS_KEY,
        JSON.stringify([good1, broken, good2]),
      );

      const result = await migrateLegacySongs();

      expect(result.migrated).toBe(2);
      expect(result.skipped).toBe(1);

      const { valid } = await loadAllSongs();
      expect(valid.map((d) => d.title).sort()).toEqual(["곡 A", "곡 B"]);

      expect(localStorage.getItem(LEGACY_SONGS_KEY)).toBeNull();
      const backup = localStorage.getItem(LEGACY_SONGS_BACKUP_KEY);
      expect(backup).not.toBeNull();
      expect(JSON.parse(backup as string)).toHaveLength(3);
    });

    it("옮길 데이터가 없으면 아무것도 하지 않는다", async () => {
      const result = await migrateLegacySongs();

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(localStorage.getItem(LEGACY_SONGS_BACKUP_KEY)).toBeNull();
    });

    it("이미 마이그레이션한 뒤에는 다시 실행해도 중복 생성하지 않는다", async () => {
      const deck = makeDeck({ title: "한 번만" });
      localStorage.setItem(LEGACY_SONGS_KEY, JSON.stringify([deck]));

      await migrateLegacySongs();
      await migrateLegacySongs();

      expect((await loadAllSongs()).valid).toHaveLength(1);
    });

    it("JSON이 깨져 있으면 백업만 남기고 넘어간다", async () => {
      localStorage.setItem(LEGACY_SONGS_KEY, "{not json");

      const result = await migrateLegacySongs();

      expect(result.migrated).toBe(0);
      expect(localStorage.getItem(LEGACY_SONGS_BACKUP_KEY)).toBe("{not json");
    });
  });
});
