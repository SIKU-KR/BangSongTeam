import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signInAsTestUser } from "../../test/sessionFixture";
import { createId, DEFAULT_DECK_STYLE } from "@repo/shared";
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
  hydrateSongLibrary,
  upsertLibraryDeck,
  applyServerDeckFields,
  applyServerLibraryDecks,
  getLibraryDeck,
} from "./songLibraryStore";
import {
  flushDeckSync,
  setDeckSyncEnabled,
  __setDeckTransportForTests,
  __resetDeckSyncForTests,
} from "../../lib/sync/deckSync";

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
    signInAsTestUser();
    await resetSongLibraryStore();
  });

  afterEach(() => {
    closeOfflineDB();
    __resetDeckSyncForTests();
  });

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

  it("보관함에는 내 곡만 있다 (공유 곡은 서버 검색으로 따로 본다)", () => {
    expect(getUserSongs()).toEqual([]);

    saveSongToLibrary({
      title: "은혜 아래 있네",
      artist: "마커스",
      lyricsRaw: "주의 은혜 아래 나 거하며",
    });

    expect(getUserSongs().map((d) => d.title)).toEqual(["은혜 아래 있네"]);
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
    const legacyDeck = (title: string) => ({
      id: createId(),
      userId: "00000000x000000000001",
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
    expect(localStorage.getItem(LEGACY_SONGS_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_SONGS_BACKUP_KEY)).not.toBeNull();
  });

  describe("서버 동기화", () => {
    let push: ReturnType<typeof vi.fn>;
    let remove: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      push = vi.fn(async (deck) => deck);
      remove = vi.fn(async () => {});
      __setDeckTransportForTests({ push, remove });
      setDeckSyncEnabled(true);
    });

    it("새 곡은 직접 만든 곡으로 저장되고 서버 push가 예약된다", async () => {
      const saved = saveSongToLibrary({
        title: "소원",
        lyricsRaw: "삶의 작은 일에도",
      });
      expect(saved.origin).toBe("user");

      await flushDeckSync();
      expect(push).toHaveBeenCalledTimes(1);
      expect(push.mock.calls[0][0].id).toBe(saved.id);
    });

    it("삭제하면 서버 삭제가 예약된다", async () => {
      const saved = saveSongToLibrary({ title: "삭제", lyricsRaw: "가사" });
      deleteUserSong(saved.id);
      await flushDeckSync();
      expect(remove).toHaveBeenCalledWith(saved.id);
    });

    it("upsertLibraryDeck은 push 여부를 고를 수 있다", async () => {
      const saved = saveSongToLibrary({ title: "원본", lyricsRaw: "가사" });
      await flushDeckSync();
      push.mockClear();

      upsertLibraryDeck({ ...saved, title: "가져온 곡" }, { push: false });
      await flushDeckSync();
      expect(push).not.toHaveBeenCalled();
      expect(getLibraryDeck(saved.id)?.title).toBe("가져온 곡");
    });

    it("서버가 확정한 공유 필드만 입히고 내용은 로컬을 지킨다", () => {
      const saved = saveSongToLibrary({
        title: "로컬 제목",
        lyricsRaw: "가사",
      });
      applyServerDeckFields({
        ...saved,
        title: "늦게 도착한 옛 제목",
        visibility: "public",
        forkCount: 5,
      });
      expect(getLibraryDeck(saved.id)).toMatchObject({
        title: "로컬 제목",
        visibility: "public",
        forkCount: 5,
      });
    });

    it("부팅 병합 결과로 보관함을 교체하고 로컬에 남긴다", async () => {
      const saved = saveSongToLibrary({ title: "기존", lyricsRaw: "가사" });
      await applyServerLibraryDecks([{ ...saved, title: "서버에서 받은 곡" }]);
      expect(getUserSongs().map((d) => d.title)).toEqual(["서버에서 받은 곡"]);

      await hydrateSongLibrary();
      expect(getUserSongs().map((d) => d.title)).toEqual(["서버에서 받은 곡"]);
    });
  });
});
