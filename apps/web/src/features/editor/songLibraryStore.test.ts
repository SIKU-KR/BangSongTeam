import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_DECK_STYLE } from "@repo/shared";
import {
  closeOfflineDB,
  OFFLINE_DB_NAME,
  LEGACY_SONGS_KEY,
  LEGACY_SONGS_BACKUP_KEY,
} from "../../lib/storage";
import {
  getUserSongs,
  saveSongToLibrary,
  deleteUserSong,
  resetSongLibraryStore,
  getAvailableSongs,
  hydrateSongLibrary,
} from "./songLibraryStore";

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("songLibraryStore", () => {
  beforeEach(async () => {
    localStorage.clear();
    await resetDatabase();
    await resetSongLibraryStore();
  });

  afterEach(closeOfflineDB);

  it("새로운 곡을 저장하고 내 곡 목록에서 조회할 수 있어야 한다", () => {
    expect(getUserSongs()).toEqual([]);

    const saved = saveSongToLibrary({
      title: "꽃들도",
      artist: "JWorship",
      lyricsRaw: "이곳에 생명 샘 솟아나\n눈물 골짝 지나갈 때에",
    });

    expect(saved.id).toBeDefined();
    expect(saved.title).toBe("꽃들도");
    expect(saved.artist).toBe("JWorship");
    expect(saved.slides.length).toBeGreaterThan(0);

    const userSongs = getUserSongs();
    expect(userSongs.length).toBe(1);
    expect(userSongs[0].title).toBe("꽃들도");
  });

  it("getAvailableSongs()는 내 곡과 커뮤니티 곡을 함께 제공해야 한다", () => {
    const initialAvailable = getAvailableSongs();
    expect(initialAvailable.length).toBeGreaterThan(0);
    expect(initialAvailable.every((s) => s.source === "community")).toBe(true);

    saveSongToLibrary({
      title: "은혜 아래 있네",
      artist: "마커스",
      lyricsRaw: "주의 은혜 아래 나 거하며",
    });

    const updated = getAvailableSongs();
    expect(updated[0].deck.title).toBe("은혜 아래 있네");
    expect(updated[0].source).toBe("mine");
  });

  it("저장된 곡을 삭제할 수 있어야 한다", () => {
    const saved = saveSongToLibrary({
      title: "삭제할 곡",
      lyricsRaw: "가사 한 줄",
    });

    expect(getUserSongs().length).toBe(1);

    deleteUserSong(saved.id);
    expect(getUserSongs().length).toBe(0);
  });

  it("저장한 곡은 하이드레이션 후에도 남아 있어야 한다 (IndexedDB 영속)", async () => {
    saveSongToLibrary({
      title: "다시 불러올 곡",
      artist: "테스트",
      lyricsRaw: "한 줄\n\n두 줄",
    });

    // 새 탭 시뮬레이션: 메모리 캐시만 비우고 저장소에서 다시 읽는다
    await hydrateSongLibrary();
    expect(getUserSongs().map((d) => d.title)).toContain("다시 불러올 곡");
  });

  it("삭제한 곡은 하이드레이션 후에도 사라진 상태여야 한다", async () => {
    const saved = saveSongToLibrary({
      title: "사라질 곡",
      lyricsRaw: "가사",
    });
    deleteUserSong(saved.id);

    await hydrateSongLibrary();
    expect(getUserSongs()).toHaveLength(0);
  });

  it("구 localStorage 보관함을 IndexedDB로 이관하고, 손상 항목이 있어도 나머지를 살린다", async () => {
    // 이전 구현이 남긴 형식. 3개 중 1개가 손상된 상태.
    const legacyDeck = (title: string) => ({
      id: crypto.randomUUID(),
      userId: "00000000-0000-4000-8000-000000000001",
      catalogId: null,
      scope: "library",
      presentationId: null,
      title,
      artist: "레거시",
      lyricsRaw: "가사 한 줄",
      slides: [{ id: "s_1", order: 0, lines: ["가사 한 줄"] }],
      backgroundId: null,
      style: DEFAULT_DECK_STYLE,
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const a = legacyDeck("레거시 곡 A");
    const b = legacyDeck("레거시 곡 B");
    localStorage.setItem(
      LEGACY_SONGS_KEY,
      JSON.stringify([a, { id: "broken", title: 999 }, b]),
    );

    await hydrateSongLibrary();

    const titles = getUserSongs().map((d) => d.title);
    expect(titles).toContain("레거시 곡 A");
    expect(titles).toContain("레거시 곡 B");
    // 원본은 지우지 않고 백업 키로 남긴다 (손상 항목 복구 가능)
    expect(localStorage.getItem(LEGACY_SONGS_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_SONGS_BACKUP_KEY)).not.toBeNull();
  });
});
