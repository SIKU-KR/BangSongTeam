import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signInAsTestUser, signOutForTests } from "../../test/sessionFixture";
import { createId, DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "#shared";
import {
  closeOfflineDB,
  getOfflineDB,
  OFFLINE_DB_NAME,
} from "../../lib/storage/db";
import { deleteSong, loadAllSongs, saveSong } from "../../lib/storage";
import { __resetStorageChannelForTests } from "../../lib/storage/storageChannel";
import { installFakeBroadcastChannel } from "../../test/fakeBroadcastChannel";
import {
  __resetPersistenceStatusForTests,
  getPersistenceError,
} from "../../lib/storage/persistenceStatus";
import { MAX_BACKOFF_MS } from "../../lib/sync/backoff";
import {
  LEGACY_SONGS_KEY,
  LEGACY_SONGS_BACKUP_KEY,
} from "../../lib/storage/songRepository";
import {
  getUserSongs,
  saveSongToLibrary,
  deleteUserSong,
  resetSongLibraryStore,
  hydrateSongLibrary,
  upsertLibraryDeck,
  applyServerDeckFields,
  applyServerLibraryDecks,
  dropDeletedLibraryDeck,
  getDeletedSongIds,
  getLibraryDeck,
  reloadSongsFromStorage,
  resumeSongDeletes,
  updateLibrarySongInfo,
} from "./songLibraryStore";
import {
  flushDeckSync,
  setDeckSyncEnabled,
  setServerDeckListener,
  wasDeckDeleted,
  __setDeckTransportForTests,
  __resetDeckSyncForTests,
} from "../../lib/sync/deckSync";
import {
  listPendingDeckDeletes,
  rememberDeckDelete,
} from "../../lib/sync/pendingDeckDeletes";
import { mergeLibraryDecks } from "../../lib/sync/mergeLibraryDecks";
import { SEED_USER_ID } from "../../test/presentationFixture";

vi.mock("../../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage")>();
  return {
    ...actual,
    loadAllSongs: vi.fn(actual.loadAllSongs),
    saveSong: vi.fn(actual.saveSong),
    deleteSong: vi.fn(actual.deleteSong),
  };
});

function libraryDeck(id: string, overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id,
    userId: SEED_USER_ID,
    scope: "library",
    title: "서버에서 받은 곡",
    lyricsRaw: "가사",
    slides: [{ id: "s1", order: 0, lines: ["가사"] }],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function storedSongIds(): Promise<string[]> {
  return loadAllSongs().then(({ valid }) => valid.map((deck) => deck.id));
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

describe("songLibraryStore", () => {
  beforeEach(async () => {
    localStorage.clear();
    __resetPersistenceStatusForTests();
    await resetDatabase();
    signInAsTestUser();
    await resetSongLibraryStore();
  });

  afterEach(async () => {
    await resetSongLibraryStore();
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

  it("보관함 곡의 제목·아티스트를 고치면 하이드레이션 후에도 남는다", async () => {
    const saved = saveSongToLibrary({
      title: "옛 제목",
      artist: "옛 아티스트",
      lyricsRaw: "가사 한 줄",
    });

    const updated = updateLibrarySongInfo(saved.id, {
      title: "새 제목",
      artist: "",
    });
    expect(updated).toMatchObject({
      id: saved.id,
      title: "새 제목",
      artist: "",
    });
    expect(updated?.lyricsRaw).toBe(saved.lyricsRaw);
    expect(updateLibrarySongInfo(createId(), { title: "x", artist: "" })).toBe(
      undefined,
    );

    await hydrateSongLibrary();
    expect(getLibraryDeck(saved.id)?.title).toBe("새 제목");
  });

  it("가져온 곡의 시각보다 시계가 늦어도 제목을 고치면 그 시각보다 1ms 뒤로 찍는다", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-25T00:00:00.000Z"));
      const forked = upsertLibraryDeck(
        libraryDeck("c000000000000000000f3", {
          origin: "fork",
          forkedFrom: "c000000000000000000f0",
          forkedFromAuthorName: "원작자",
          createdAt: "2026-09-25T00:02:00.000Z",
          updatedAt: "2026-09-25T00:02:00.000Z",
        }),
        { push: false },
      );

      const renamed = updateLibrarySongInfo(forked.id, {
        title: "새 제목",
        artist: "",
      });

      expect(renamed?.updatedAt).toBe("2026-09-25T00:02:00.001Z");
    } finally {
      vi.useRealTimers();
    }
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
    let push: ReturnType<typeof vi.fn<(deck: Deck) => Promise<Deck>>>;
    let remove: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;

    beforeEach(() => {
      push = vi.fn(async (deck: Deck) => deck);
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

    it("push 응답이 로컬보다 새 곡이면 통째로 따른다", async () => {
      const saved = saveSongToLibrary({
        title: "로컬 제목",
        lyricsRaw: "가사",
      });
      const newer = {
        ...saved,
        title: "다른 기기에서 고친 제목",
        forkCount: 2,
        updatedAt: new Date(Date.parse(saved.updatedAt) + 60_000).toISOString(),
      };

      applyServerDeckFields(newer);

      expect(getLibraryDeck(saved.id)).toEqual(newer);
      await hydrateSongLibrary();
      expect(getLibraryDeck(saved.id)).toEqual(newer);
    });

    it("내용이 같고 시각만 다른 push 응답(서버가 줄인 시각)은 서버 시각을 따른다", () => {
      const saved = saveSongToLibrary({ title: "제목", lyricsRaw: "가사" });
      const clamped = {
        ...saved,
        visibility: "public" as const,
        createdAt: "2026-09-25T00:05:00.000Z",
        updatedAt: "2026-09-25T00:05:00.000Z",
      };

      applyServerDeckFields(clamped);

      expect(getLibraryDeck(saved.id)).toEqual(clamped);
    });

    it("기기 시계보다 한참 앞선 로컬 곡은 push 응답을 통째로 따른다", () => {
      const future = upsertLibraryDeck(
        libraryDeck("c000000000000000000e2", {
          title: "미래 시각의 제목",
          updatedAt: "9999-12-31T00:00:00.000Z",
        }),
        { push: false },
      );
      const server = libraryDeck(future.id, {
        title: "서버 제목",
        updatedAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });

      applyServerDeckFields(server);

      expect(getLibraryDeck(future.id)).toEqual(server);
    });

    it("부팅 병합 결과로 보관함을 교체하고 로컬에 남긴다", async () => {
      const saved = saveSongToLibrary({ title: "기존", lyricsRaw: "가사" });
      await applyServerLibraryDecks([
        {
          ...saved,
          title: "서버에서 받은 곡",
          updatedAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ]);
      expect(getUserSongs().map((d) => d.title)).toEqual(["서버에서 받은 곡"]);

      await hydrateSongLibrary();
      expect(getUserSongs().map((d) => d.title)).toEqual(["서버에서 받은 곡"]);
    });

    it("올리는 중에 지운 곡은 push 응답이 와도 보관함에 되살아나지 않는다", async () => {
      let resolvePush: () => void = () => undefined;
      push.mockImplementationOnce(
        (deck: Deck) =>
          new Promise<Deck>((resolve) => {
            resolvePush = () => resolve({ ...deck, forkCount: 1 });
          }),
      );
      setServerDeckListener(applyServerDeckFields);
      const saved = saveSongToLibrary({ title: "지울 곡", lyricsRaw: "가사" });
      const flushing = flushDeckSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      deleteUserSong(saved.id);
      resolvePush();
      await flushing;
      await flushDeckSync();

      expect(getUserSongs()).toEqual([]);
      expect(remove).toHaveBeenCalledWith(saved.id);
      await hydrateSongLibrary();
      expect(getUserSongs()).toEqual([]);
    });

    it("보관함에 없는 곡의 서버 응답은 보관함에 넣지 않는다", async () => {
      applyServerDeckFields(libraryDeck("c000000000000000000e1"));

      expect(getUserSongs()).toEqual([]);
      await hydrateSongLibrary();
      expect(getUserSongs()).toEqual([]);
    });

    it("병합에서 지운 곡은 저장본에서도 지운다", async () => {
      const gone = saveSongToLibrary({ title: "지운 곡", lyricsRaw: "가사" });
      const kept = saveSongToLibrary({ title: "남길 곡", lyricsRaw: "가사" });

      await applyServerLibraryDecks([kept], [gone.id]);

      expect(getUserSongs().map((d) => d.id)).toEqual([kept.id]);
      expect(await storedSongIds()).toEqual([kept.id]);
    });

    it("서버가 지운 곡은 DELETE 없이 보관함과 저장본에서 내려놓는다", async () => {
      const gone = saveSongToLibrary({ title: "지운 곡", lyricsRaw: "가사" });
      await flushDeckSync();

      dropDeletedLibraryDeck(gone.id);
      await flushDeckSync();

      expect(remove).not.toHaveBeenCalled();
      expect(getUserSongs()).toEqual([]);
      await hydrateSongLibrary();
      expect(getUserSongs()).toEqual([]);
    });

    it("지우기를 보내기 전에 다시 넣은 곡은 서버에서 지우지 않는다", async () => {
      const fork = libraryDeck("c000000000000000000f1", {
        origin: "fork",
        forkedFrom: "c000000000000000000f0",
        forkedFromAuthorName: "원작자",
      });
      upsertLibraryDeck(fork, { push: false });
      deleteUserSong(fork.id);

      upsertLibraryDeck(fork, { push: false });
      await flushDeckSync();

      expect(remove).not.toHaveBeenCalled();
      expect(getUserSongs().map((d) => d.id)).toEqual([fork.id]);
      expect(getDeletedSongIds().has(fork.id)).toBe(false);
    });

    it("지운 곡을 기억한다", () => {
      const gone = saveSongToLibrary({ title: "지운 곡", lyricsRaw: "가사" });
      deleteUserSong(gone.id);

      expect(getDeletedSongIds().has(gone.id)).toBe(true);
    });

    it("resumeSongDeletes는 지금 계정이 앞선 페이지에서 지운 곡만 다시 보낸다", async () => {
      const mine = "c000000000000000000d4";
      const theirs = "c000000000000000000d5";
      rememberDeckDelete(SEED_USER_ID, mine);
      rememberDeckDelete("999999999999999999999", theirs);

      resumeSongDeletes();
      await flushDeckSync();

      expect(remove.mock.calls).toEqual([[mine]]);
    });
  });

  describe("새로고침 뒤에도 남는 곡 삭제 기록", () => {
    it("지우면 동기화가 꺼져 있어도 지금 계정의 삭제 기록에 남긴다", () => {
      const saved = saveSongToLibrary({ title: "지울 곡", lyricsRaw: "가사" });

      deleteUserSong(saved.id);

      expect(listPendingDeckDeletes(SEED_USER_ID)).toEqual([saved.id]);
    });

    it("서버에서 지우기를 기다리는 곡은 저장본에 남아 있어도 불러올 때 감추고 저장본에서 지운다", async () => {
      const pending = libraryDeck("c000000000000000000d1");
      const kept = libraryDeck("c000000000000000000d2");
      await saveSong(pending);
      await saveSong(kept);
      rememberDeckDelete(SEED_USER_ID, pending.id);

      await hydrateSongLibrary();

      expect(getUserSongs().map((d) => d.id)).toEqual([kept.id]);
      expect(await storedSongIds()).toEqual([kept.id]);
    });

    it("앞선 페이지에서 지우고 서버에서 아직 지우지 못한 곡도 지운 곡으로 본다", () => {
      rememberDeckDelete(SEED_USER_ID, "c000000000000000000d3");

      expect(getDeletedSongIds().has("c000000000000000000d3")).toBe(true);
    });

    it("서버에서 지우기를 기다리는 곡을 다시 넣으면 삭제 기록에서 뺀다", () => {
      const fork = libraryDeck("c000000000000000000f2", {
        origin: "fork",
        forkedFrom: "c000000000000000000f0",
      });
      rememberDeckDelete(SEED_USER_ID, fork.id);

      upsertLibraryDeck(fork, { push: false });

      expect(listPendingDeckDeletes(SEED_USER_ID)).toEqual([]);
      expect(getDeletedSongIds().has(fork.id)).toBe(false);
    });

    it("초기화하면 지금 계정의 삭제 기록도 지운다", async () => {
      rememberDeckDelete(SEED_USER_ID, "c000000000000000000d6");

      await resetSongLibraryStore();

      expect(listPendingDeckDeletes(SEED_USER_ID)).toEqual([]);
    });
  });

  describe("부팅 병합 저장", () => {
    const LATER = "2026-09-30T00:00:00.000Z";

    beforeEach(async () => {
      await hydrateSongLibrary();
    });

    it("서버에서 바뀐 곡만 저장소에 다시 쓴다", async () => {
      const unchanged = upsertLibraryDeck(
        libraryDeck("c000000000000000000a1"),
        {
          push: false,
        },
      );
      const newer = upsertLibraryDeck(libraryDeck("c000000000000000000a2"), {
        push: false,
      });
      const forked = upsertLibraryDeck(libraryDeck("c000000000000000000a3"), {
        push: false,
      });
      await hydrateSongLibrary();
      vi.mocked(saveSong).mockClear();

      const created = libraryDeck("c000000000000000000a4");
      await applyServerLibraryDecks([
        { ...unchanged },
        { ...newer, title: "서버에서 고친 곡", updatedAt: LATER },
        { ...forked, forkCount: 3 },
        created,
      ]);

      expect(
        vi
          .mocked(saveSong)
          .mock.calls.map(([deck]) => deck.id)
          .sort(),
      ).toEqual([newer.id, forked.id, created.id].sort());
    });

    it("저장하는 동안 지운 곡은 저장본에 되살리지 않는다", async () => {
      const decks = Array.from({ length: 20 }, (_, n) =>
        libraryDeck(`c${String(n).padStart(20, "0")}`),
      );

      const applying = applyServerLibraryDecks(decks);
      deleteUserSong(decks[15].id);
      await applying;

      expect(await storedSongIds()).not.toContain(decks[15].id);
    });

    it("저장하는 동안 고친 곡은 고친 내용으로 남는다", async () => {
      const decks = Array.from({ length: 20 }, (_, n) =>
        libraryDeck(`c${String(n).padStart(20, "0")}`),
      );

      const applying = applyServerLibraryDecks(decks);
      updateLibrarySongInfo(decks[15].id, { title: "고친 곡", artist: "" });
      await applying;

      const { valid } = await loadAllSongs();
      expect(valid.find((deck) => deck.id === decks[15].id)?.title).toBe(
        "고친 곡",
      );
    });

    it("보관함을 읽지 못하면 앞 계정의 곡을 비우고 병합 결과를 저장소에 쓰지 않는다", async () => {
      saveSongToLibrary({ title: "앞 계정의 곡", lyricsRaw: "가사" });
      await hydrateSongLibrary();

      const otherUser = "999999999999999999999";
      signInAsTestUser(otherUser);
      vi.mocked(loadAllSongs).mockRejectedValueOnce(new Error("읽기 실패"));
      await hydrateSongLibrary();

      expect(getUserSongs()).toEqual([]);
      expect(getPersistenceError()).not.toBeNull();

      vi.mocked(saveSong).mockClear();
      const theirs = libraryDeck("c000000000000000000b1", {
        userId: otherUser,
      });
      await applyServerLibraryDecks([theirs]);

      expect(getUserSongs().map((d) => d.id)).toEqual([theirs.id]);
      expect(saveSong).not.toHaveBeenCalled();
    });
  });

  describe("다른 탭이 쓴 저장본 다시 읽기", () => {
    let push: ReturnType<typeof vi.fn<(deck: Deck) => Promise<Deck>>>;
    let remove: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;

    async function writeFromOtherTab(record: unknown): Promise<void> {
      const db = await getOfflineDB();
      await db.put("decks", record as Deck);
    }

    async function deleteFromOtherTab(id: string): Promise<void> {
      const db = await getOfflineDB();
      await db.delete("decks", id);
    }

    async function settleWrites(): Promise<void> {
      await loadAllSongs();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    beforeEach(async () => {
      await hydrateSongLibrary();
      push = vi.fn(async (deck: Deck) => deck);
      remove = vi.fn(async () => {});
      __setDeckTransportForTests({ push, remove });
      setDeckSyncEnabled(true);
    });

    it("다른 탭이 고친 곡과 만든 곡을 보관함에 싣는다", async () => {
      const mine = saveSongToLibrary({
        title: "이 탭의 곡",
        lyricsRaw: "가사",
      });
      await settleWrites();
      const edited = {
        ...mine,
        title: "다른 탭에서 고친 제목",
        updatedAt: new Date(Date.parse(mine.updatedAt) + 1000).toISOString(),
      };
      const created = libraryDeck("c000000000000000000a7", {
        title: "다른 탭에서 만든 곡",
      });
      await writeFromOtherTab(edited);
      await writeFromOtherTab(created);

      await reloadSongsFromStorage([mine.id, created.id]);

      expect(getLibraryDeck(mine.id)).toEqual(edited);
      expect(getLibraryDeck(created.id)).toEqual(created);
    });

    it("다른 탭에서 지운 곡은 이 탭이 다시 올리지 않는다: 대기 중인 PUT은 버리고 지우기는 남긴다", async () => {
      const edited = saveSongToLibrary({ title: "고칠 곡", lyricsRaw: "가사" });
      const deletedHere = saveSongToLibrary({
        title: "이 탭에서도 지운 곡",
        lyricsRaw: "가사",
      });
      await flushDeckSync();
      push.mockClear();
      updateLibrarySongInfo(edited.id, {
        title: "올리기를 기다리는 제목",
        artist: "",
      });
      deleteUserSong(deletedHere.id);
      await settleWrites();
      await deleteFromOtherTab(edited.id);

      await reloadSongsFromStorage([edited.id, deletedHere.id]);
      await flushDeckSync();

      expect(push).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledExactlyOnceWith(deletedHere.id);
      expect(getUserSongs().map((deck) => deck.id)).not.toContain(edited.id);
      expect(wasDeckDeleted(edited.id)).toBe(true);
      expect(getDeletedSongIds().has(edited.id)).toBe(true);
    });

    it("이 탭이 다시 넣어 저장하는 중인 곡은 다른 탭의 지움 알림으로 빼지 않는다", async () => {
      const fork = libraryDeck("c000000000000000000f1", {
        origin: "fork",
        forkedFrom: "c000000000000000000f0",
        forkedFromAuthorName: "원작자",
      });
      upsertLibraryDeck(fork, { push: false });
      await settleWrites();
      await deleteFromOtherTab(fork.id);

      upsertLibraryDeck(fork, { push: false });
      await reloadSongsFromStorage([fork.id]);

      expect(getLibraryDeck(fork.id)).toEqual(fork);
      expect(wasDeckDeleted(fork.id)).toBe(false);
    });

    it("읽는 동안 이 탭에서 고친 곡은 읽은 저장본으로 바꾸지 않는다", async () => {
      const mine = saveSongToLibrary({
        title: "이 탭의 곡",
        lyricsRaw: "가사",
      });
      await settleWrites();
      await writeFromOtherTab({ ...mine, title: "다른 탭에서 고친 제목" });

      const reloading = reloadSongsFromStorage([mine.id]);
      updateLibrarySongInfo(mine.id, {
        title: "읽는 동안 고친 제목",
        artist: "",
      });
      await reloading;

      expect(getLibraryDeck(mine.id)?.title).toBe("읽는 동안 고친 제목");
    });

    it("읽지 못한 저장본과 다른 계정의 곡은 그대로 둔다", async () => {
      const mine = saveSongToLibrary({
        title: "이 탭의 곡",
        lyricsRaw: "가사",
      });
      await settleWrites();
      const before = getLibraryDeck(mine.id);
      await writeFromOtherTab({ id: mine.id, title: null });
      const foreign = libraryDeck("c000000000000000000a8", {
        userId: "999999999999999999999",
      });
      await writeFromOtherTab(foreign);

      await reloadSongsFromStorage([mine.id, foreign.id]);

      expect(getLibraryDeck(mine.id)).toBe(before);
      expect(getLibraryDeck(foreign.id)).toBeUndefined();
      expect(wasDeckDeleted(mine.id)).toBe(false);
    });

    it("다시 읽기는 저장소에 쓰지도 서버에 올리지도 않는다", async () => {
      const mine = saveSongToLibrary({
        title: "이 탭의 곡",
        lyricsRaw: "가사",
      });
      await flushDeckSync();
      await settleWrites();
      push.mockClear();
      vi.mocked(saveSong).mockClear();
      await writeFromOtherTab({ ...mine, title: "다른 탭에서 고친 제목" });

      await reloadSongsFromStorage([mine.id]);
      await flushDeckSync();
      await settleWrites();

      expect(saveSong).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    });

    it("읽는 동안 다시 읽기를 멈추면 곡을 바꾸거나 빼지 않고, 지운 곡으로 기억하지도 않고 읽은 id를 돌려준다", async () => {
      const mine = saveSongToLibrary({
        title: "이 탭의 곡",
        lyricsRaw: "가사",
      });
      const removed = saveSongToLibrary({
        title: "다른 탭에서 지운 곡",
        lyricsRaw: "가사",
      });
      await flushDeckSync();
      push.mockClear();
      updateLibrarySongInfo(removed.id, {
        title: "올리기를 기다리는 제목",
        artist: "",
      });
      await settleWrites();
      await writeFromOtherTab({ ...mine, title: "다른 탭에서 고친 제목" });
      await deleteFromOtherTab(removed.id);
      let paused = false;

      const reloading = reloadSongsFromStorage(
        [mine.id, removed.id],
        () => paused,
      );
      paused = true;
      const held = await reloading;
      await flushDeckSync();

      expect(held).toEqual([mine.id, removed.id]);
      expect(getLibraryDeck(mine.id)?.title).toBe("이 탭의 곡");
      expect(getLibraryDeck(removed.id)?.title).toBe("올리기를 기다리는 제목");
      expect(wasDeckDeleted(removed.id)).toBe(false);
      expect(push).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: removed.id }),
      );
      expect(await reloadSongsFromStorage([mine.id], () => false)).toEqual([]);
    });

    it("이 탭이 지우는 중인 곡은 다른 탭이 늦게 쓴 저장본을 읽어도 보관함에 다시 넣지 않는다", async () => {
      const queued = saveSongToLibrary({ title: "지울 곡", lyricsRaw: "가사" });
      const sending = saveSongToLibrary({
        title: "지우기를 보내는 중인 곡",
        lyricsRaw: "가사",
      });
      await flushDeckSync();
      let finishDelete: () => void = () => undefined;
      remove.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishDelete = resolve;
          }),
      );
      deleteUserSong(sending.id);
      const deleting = flushDeckSync();
      await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
      deleteUserSong(queued.id);
      await settleWrites();
      await writeFromOtherTab(queued);
      await writeFromOtherTab(sending);

      await reloadSongsFromStorage([queued.id, sending.id]);
      finishDelete();
      await deleting;
      await flushDeckSync();

      expect(getLibraryDeck(queued.id)).toBeUndefined();
      expect(getLibraryDeck(sending.id)).toBeUndefined();
      expect(remove.mock.calls.map(([id]) => id)).toEqual([
        sending.id,
        queued.id,
      ]);
      expect(wasDeckDeleted(queued.id)).toBe(true);
      expect(wasDeckDeleted(sending.id)).toBe(true);
    });

    it("다른 탭이 지우는 중인 곡(삭제 기록이 남은 곡)은 늦게 쓴 저장본을 읽어도 싣지 않는다", async () => {
      const mine = saveSongToLibrary({
        title: "다른 탭이 지운 곡",
        lyricsRaw: "가사",
      });
      await settleWrites();
      rememberDeckDelete(SEED_USER_ID, mine.id);
      await deleteFromOtherTab(mine.id);
      await reloadSongsFromStorage([mine.id]);
      await writeFromOtherTab(mine);

      await reloadSongsFromStorage([mine.id]);

      expect(getLibraryDeck(mine.id)).toBeUndefined();
      expect(wasDeckDeleted(mine.id)).toBe(true);
    });

    it("다른 탭이 지우는 중인 곡은 저장본이 남아 있어도 지운 곡으로 보고 보관함에서 빼며 올리려던 PUT을 버린다", async () => {
      const mine = saveSongToLibrary({
        title: "다른 탭이 지운 곡",
        lyricsRaw: "가사",
      });
      await flushDeckSync();
      push.mockClear();
      updateLibrarySongInfo(mine.id, {
        title: "올리기를 기다리는 제목",
        artist: "",
      });
      await settleWrites();
      rememberDeckDelete(SEED_USER_ID, mine.id);

      await reloadSongsFromStorage([mine.id]);
      await flushDeckSync();

      expect(getLibraryDeck(mine.id)).toBeUndefined();
      expect(wasDeckDeleted(mine.id)).toBe(true);
      expect(push).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });

    it("다른 탭에서 지운 곡의 저장본이 다시 생기면 지운 곡으로 기억하지 않고 보관함에 싣는다", async () => {
      const fork = libraryDeck("c000000000000000000f2", {
        origin: "fork",
        forkedFrom: "c000000000000000000f0",
        forkedFromAuthorName: "원작자",
      });
      upsertLibraryDeck(fork, { push: false });
      await settleWrites();
      await deleteFromOtherTab(fork.id);
      await reloadSongsFromStorage([fork.id]);
      expect(wasDeckDeleted(fork.id)).toBe(true);
      await writeFromOtherTab(fork);

      await reloadSongsFromStorage([fork.id]);

      expect(getLibraryDeck(fork.id)).toEqual(fork);
      expect(wasDeckDeleted(fork.id)).toBe(false);
      expect(
        mergeLibraryDecks(getUserSongs(), [fork], {
          deletedIds: getDeletedSongIds(),
        }).removedIds,
      ).toEqual([]);
    });
  });

  describe("저장 실패와 다시 저장", () => {
    const SONG = "c000000000000000000d1";
    const OTHER_SONG = "c000000000000000000d2";
    const quotaError = (): DOMException =>
      new DOMException("가득 참", "QuotaExceededError");

    async function storedTitle(id: string): Promise<string | undefined> {
      const { valid } = await loadAllSongs();
      return valid.find((deck) => deck.id === id)?.title;
    }

    async function retryFailedWrites(): Promise<void> {
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);
      await loadAllSongs();
    }

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await hydrateSongLibrary();
      upsertLibraryDeck(libraryDeck(SONG), { push: false });
      upsertLibraryDeck(libraryDeck(OTHER_SONG), { push: false });
      await loadAllSongs();
      vi.mocked(saveSong).mockClear();
      vi.mocked(deleteSong).mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("저장에 실패한 곡은 다른 곡이 저장돼도 경고를 남기고, 백오프 뒤 마지막 사본으로 다시 저장한다", async () => {
      vi.mocked(saveSong)
        .mockRejectedValueOnce(quotaError())
        .mockRejectedValueOnce(quotaError());
      updateLibrarySongInfo(SONG, { title: "첫 수정", artist: "" });
      updateLibrarySongInfo(SONG, { title: "마지막 수정", artist: "" });
      await loadAllSongs();
      expect(getPersistenceError("deck")?.kind).toBe("quota");

      updateLibrarySongInfo(OTHER_SONG, { title: "저장한 곡", artist: "" });
      await loadAllSongs();

      expect(getPersistenceError("deck")?.kind).toBe("quota");
      expect(await storedTitle(SONG)).toBe("서버에서 받은 곡");

      vi.mocked(saveSong).mockClear();
      await retryFailedWrites();

      expect(
        vi.mocked(saveSong).mock.calls.map(([deck]) => deck.title),
      ).toEqual(["마지막 수정"]);
      expect(await storedTitle(SONG)).toBe("마지막 수정");
      expect(getPersistenceError()).toBeNull();
    });

    it("지우지 못한 곡은 지우기로 다시 시도한다", async () => {
      vi.mocked(deleteSong).mockRejectedValueOnce(new Error("disk"));

      deleteUserSong(SONG);
      await loadAllSongs();

      expect(getPersistenceError("deck")?.kind).toBe("unknown");
      expect(await storedSongIds()).toContain(SONG);

      await retryFailedWrites();

      expect(deleteSong).toHaveBeenCalledTimes(2);
      expect(saveSong).not.toHaveBeenCalled();
      expect(await storedSongIds()).not.toContain(SONG);
      expect(getPersistenceError()).toBeNull();
    });

    it("사용자가 지우지 않았는데 보관함에서 사라진 곡의 실패한 저장은 저장하지도 지우지도 않고 경고만 푼다", async () => {
      vi.mocked(saveSong).mockRejectedValueOnce(quotaError());
      updateLibrarySongInfo(SONG, { title: "저장하지 못한 수정", artist: "" });
      await loadAllSongs();
      signOutForTests();
      await applyServerLibraryDecks([]);
      vi.mocked(saveSong).mockClear();

      await retryFailedWrites();

      expect(saveSong).not.toHaveBeenCalled();
      expect(deleteSong).not.toHaveBeenCalled();
      expect(await storedTitle(SONG)).toBe("서버에서 받은 곡");
      expect(getPersistenceError()).toBeNull();
    });

    it("보관함을 다시 불러오면 불러오지 못한 경고를 지운다", async () => {
      vi.mocked(loadAllSongs).mockRejectedValueOnce(new Error("읽기 실패"));
      await hydrateSongLibrary();
      expect(getPersistenceError("deck")?.kind).toBe("unknown");

      await hydrateSongLibrary();

      expect(getPersistenceError()).toBeNull();
    });

    it("보관함을 다시 불러오면 앞서 저장하지 못한 곡의 경고와 다시 시도를 버린다", async () => {
      vi.mocked(saveSong).mockRejectedValueOnce(quotaError());
      updateLibrarySongInfo(SONG, { title: "저장하지 못한 수정", artist: "" });
      await loadAllSongs();
      expect(getPersistenceError("deck")?.kind).toBe("quota");

      await hydrateSongLibrary();

      expect(getPersistenceError()).toBeNull();

      vi.mocked(saveSong).mockClear();
      await retryFailedWrites();

      expect(saveSong).not.toHaveBeenCalled();
      expect(getPersistenceError()).toBeNull();
    });
  });

  describe("다른 탭에 알리기", () => {
    let tabs: ReturnType<typeof installFakeBroadcastChannel>;

    beforeEach(() => {
      tabs = installFakeBroadcastChannel();
      __resetStorageChannelForTests();
    });

    afterEach(() => {
      __resetStorageChannelForTests();
      vi.unstubAllGlobals();
    });

    it("곡을 저장소에 쓰거나 지운 뒤에 그 id를 알린다", async () => {
      const other = tabs.otherTab("chiton:storage");

      const saved = saveSongToLibrary({ title: "알릴 곡", lyricsRaw: "가사" });
      await loadAllSongs();
      deleteUserSong(saved.id);
      await loadAllSongs();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const change = {
        v: 1,
        userId: SEED_USER_ID,
        kind: "decks",
        ids: [saved.id],
      };
      expect(other.received).toEqual([change, change]);
      other.close();
    });
  });
});
