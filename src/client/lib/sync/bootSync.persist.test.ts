import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
  type FolderListResponse,
  type Presentation,
} from "#shared";
import {
  seedPresentationsIntoStorage,
  seedSongsIntoStorage,
  signInAsTestUser,
} from "../../test/sessionFixture";
import {
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "../../test/presentationFixture";
import {
  clearPersistenceError,
  loadAllPresentations,
  loadAllSongs,
  savePresentation,
  saveSong,
} from "../storage";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage/db";
import { getPersistenceError } from "../storage/persistenceStatus";
import {
  flushPendingWrites,
  getPresentationById,
  hydrateFromStorage,
  renamePresentation,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import {
  deleteUserSong,
  getUserSongs,
  hydrateSongLibrary,
  resetSongLibraryStore,
  updateLibrarySongInfo,
} from "../../features/editor/songLibraryStore";
import { resetFolderStore } from "../../features/drive/folderStore";
import { OfflineError } from "../api/request";
import { __resetBootSyncForTests, runBootSync } from "./bootSync";
import {
  __resetDeckSyncForTests,
  __setDeckTransportForTests,
  flushDeckSync,
} from "./deckSync";
import { __resetFolderSyncForTests } from "./folderSync";
import { __resetSyncSchedulerForTests } from "./syncScheduler";
import { resetSyncStatus } from "./syncStatus";

const EMPTY_FOLDER_LIST: FolderListResponse = {
  folders: [],
  tombstones: { folderIds: [], presentationIds: [] },
};

const presentationSync = vi.hoisted(() => ({
  pullPresentations: vi.fn(async (): Promise<unknown[]> => []),
  pushPresentation: vi.fn(async (): Promise<boolean> => true),
  pullDecks: vi.fn(
    async (): Promise<{ decks: Deck[]; deletedIds: string[] }> => ({
      decks: [],
      deletedIds: [],
    }),
  ),
  pullFolders: vi.fn(async (): Promise<FolderListResponse> => ({
    folders: [],
    tombstones: { folderIds: [], presentationIds: [] },
  })),
}));

vi.mock("./presentationSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./presentationSync")>();
  return { ...actual, ...presentationSync };
});

const storageHooks = vi.hoisted(() => ({
  beforeSavePresentation: null as
    null | ((doc: { id: string }) => Promise<void>),
  beforeSaveSong: null as null | ((deck: { id: string }) => Promise<void>),
}));

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  return {
    ...actual,
    loadAllPresentations: vi.fn(actual.loadAllPresentations),
    savePresentation: vi.fn(async (doc: Presentation) => {
      const hook = storageHooks.beforeSavePresentation;
      storageHooks.beforeSavePresentation = null;
      if (hook) await hook(doc);
      return actual.savePresentation(doc);
    }),
    saveSong: vi.fn(async (deck: Deck) => {
      const hook = storageHooks.beforeSaveSong;
      storageHooks.beforeSaveSong = null;
      if (hook) await hook(deck);
      return actual.saveSong(deck);
    }),
  };
});

const LATER = "2026-09-30T00:00:00.000Z";
const SONG_A = "c000000000000000000a1";
const SONG_B = "c000000000000000000b1";

function song(id: string, overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id,
    userId: SEED_USER_ID,
    scope: "library",
    title: "원래 곡",
    lyricsRaw: "가사",
    slides: [{ id: "s1", order: 0, lines: ["가사"] }],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function copyOf(
  doc: Presentation,
  changes: Partial<Presentation> = {},
): Presentation {
  return { ...structuredClone(doc), ...changes };
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

function writtenIds(save: typeof savePresentation | typeof saveSong): string[] {
  return vi
    .mocked(save)
    .mock.calls.map(([item]) => item.id)
    .sort();
}

async function storedTitle(id: string): Promise<string | undefined> {
  const { valid } = await loadAllPresentations();
  return valid.find((doc) => doc.id === id)?.title;
}

async function storedSong(id: string): Promise<Deck | undefined> {
  const { valid } = await loadAllSongs();
  return valid.find((deck) => deck.id === id);
}

describe("runBootSync — 병합 결과 저장", () => {
  const [DOC, OTHER, MOVED, SHARED] = SEED_PRESENTATIONS;

  beforeEach(async () => {
    localStorage.clear();
    await resetDatabase();
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    await resetSongLibraryStore();
    resetSyncStatus();
    clearPersistenceError();
    __resetBootSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    __setDeckTransportForTests({
      push: vi.fn(async (): Promise<Deck> => {
        throw new OfflineError();
      }),
      remove: vi.fn(async () => undefined),
    });
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pushPresentation.mockReset();
    presentationSync.pushPresentation.mockResolvedValue(true);
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    storageHooks.beforeSavePresentation = null;
    storageHooks.beforeSaveSong = null;
    vi.mocked(savePresentation).mockClear();
    vi.mocked(saveSong).mockClear();
    vi.mocked(loadAllPresentations).mockClear();
  });

  afterEach(() => {
    __resetBootSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    closeOfflineDB();
  });

  it("부팅 병합 저장 중 고친 세트는 고친 내용으로 남는다", async () => {
    await seedPresentationsIntoStorage([DOC, OTHER]);
    await hydrateFromStorage();
    presentationSync.pullPresentations.mockImplementation(async () => {
      storageHooks.beforeSavePresentation = async () => {
        renamePresentation(OTHER.id, "고친 세트");
        void flushPendingWrites();
      };
      return [
        copyOf(DOC, { updatedAt: LATER }),
        copyOf(OTHER, { updatedAt: LATER }),
      ];
    });

    await runBootSync();
    await flushPendingWrites();

    expect(getPresentationById(OTHER.id)?.title).toBe("고친 세트");
    expect(await storedTitle(OTHER.id)).toBe("고친 세트");
  });

  it("보관함 병합 저장 중 고친 곡은 고친 내용으로 남는다", async () => {
    await seedSongsIntoStorage([song(SONG_A), song(SONG_B)]);
    await hydrateSongLibrary();
    presentationSync.pullDecks.mockImplementation(async () => {
      storageHooks.beforeSaveSong = async (saving) => {
        const other = saving.id === SONG_A ? SONG_B : SONG_A;
        updateLibrarySongInfo(other, { title: "고친 곡", artist: "" });
        await new Promise((resolve) => setTimeout(resolve, 30));
      };
      return {
        decks: [
          song(SONG_A, { title: "서버 곡", updatedAt: LATER }),
          song(SONG_B, { title: "서버 곡", updatedAt: LATER }),
        ],
        deletedIds: [],
      };
    });

    await runBootSync();

    const titles = await Promise.all([storedSong(SONG_A), storedSong(SONG_B)]);
    expect(titles.map((deck) => deck?.title).sort()).toEqual([
      "고친 곡",
      "서버 곡",
    ]);
  });

  it("보관함 병합 저장 중 지운 곡은 되살아나지 않는다", async () => {
    await seedSongsIntoStorage([song(SONG_A), song(SONG_B)]);
    await hydrateSongLibrary();
    let deletedId = "";
    presentationSync.pullDecks.mockImplementation(async () => {
      storageHooks.beforeSaveSong = async (saving) => {
        deletedId = saving.id === SONG_A ? SONG_B : SONG_A;
        deleteUserSong(deletedId);
        await new Promise((resolve) => setTimeout(resolve, 30));
      };
      return {
        decks: [
          song(SONG_A, { updatedAt: LATER }),
          song(SONG_B, { updatedAt: LATER }),
        ],
        deletedIds: [],
      };
    });

    await runBootSync();
    await flushDeckSync();

    expect(deletedId).not.toBe("");
    expect(getUserSongs().map((deck) => deck.id)).not.toContain(deletedId);
    expect(await storedSong(deletedId)).toBeUndefined();
  });

  it("병합 결과를 저장소에 쓰지 못하면 저장 실패 경고를 올린다", async () => {
    await seedPresentationsIntoStorage([DOC]);
    await hydrateFromStorage();
    presentationSync.pullPresentations.mockImplementation(async () => {
      storageHooks.beforeSavePresentation = () =>
        Promise.reject(new DOMException("가득 참", "QuotaExceededError"));
      return [copyOf(DOC, { updatedAt: LATER })];
    });

    await runBootSync();
    await flushPendingWrites();

    expect(getPersistenceError()?.kind).toBe("quota");
  });

  it("서버와 같은 세트는 다시 쓰지 않고 서버에서 바뀐 세트만 쓴다", async () => {
    const synced = copyOf(DOC);
    const localWon = copyOf(OTHER, {
      title: "로컬에서 고침",
      updatedAt: LATER,
    });
    const moved = copyOf(MOVED, { folderId: "a00000000000000000001" });
    const newer = SEED_PRESENTATIONS[4];
    await seedPresentationsIntoStorage([synced, localWon, moved, newer]);
    await hydrateFromStorage();
    vi.mocked(savePresentation).mockClear();
    presentationSync.pullPresentations.mockResolvedValue([
      copyOf(synced),
      copyOf(OTHER),
      copyOf(moved, { folderId: null }),
      copyOf(newer, { title: "서버에서 고침", updatedAt: LATER }),
      {
        ...copyOf(SHARED),
        id: "1s0000000000000000001",
        access: { ownerName: "인도자" },
      },
    ]);

    await runBootSync();
    await flushPendingWrites();

    expect(writtenIds(savePresentation)).toEqual(
      [moved.id, newer.id, "1s0000000000000000001"].sort(),
    );
    expect(await storedTitle(localWon.id)).toBe("로컬에서 고침");
    expect(await storedTitle(newer.id)).toBe("서버에서 고침");
  });

  it("서버와 같은 곡은 다시 쓰지 않고, 같은 시각이어도 가져간 횟수가 바뀐 곡은 쓴다", async () => {
    await seedSongsIntoStorage([song(SONG_A), song(SONG_B)]);
    await hydrateSongLibrary();
    vi.mocked(saveSong).mockClear();
    presentationSync.pullDecks.mockResolvedValue({
      decks: [song(SONG_A), song(SONG_B, { forkCount: 4 })],
      deletedIds: [],
    });

    await runBootSync();

    expect(writtenIds(saveSong)).toEqual([SONG_B]);
    expect((await storedSong(SONG_B))?.forkCount).toBe(4);
  });

  it("저장본을 읽지 못하면 부팅 병합이 서버 사본으로 덮지 않는다", async () => {
    await seedPresentationsIntoStorage([
      copyOf(DOC, { title: "오프라인에서 고친 세트", updatedAt: LATER }),
    ]);
    vi.mocked(loadAllPresentations).mockRejectedValueOnce(
      new DOMException("Failed to read large IndexedDB value", "UnknownError"),
    );
    await hydrateFromStorage();
    presentationSync.pullPresentations.mockResolvedValue([copyOf(DOC)]);

    await runBootSync();
    await flushPendingWrites();

    expect(getPresentationById(DOC.id)?.title).toBe(DOC.title);
    expect(await storedTitle(DOC.id)).toBe("오프라인에서 고친 세트");
  });
});
