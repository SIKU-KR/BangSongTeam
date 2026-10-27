import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
  type Folder,
  type Presentation,
} from "#shared";
import { flushBeforeSignOut, stopAccountSync } from "./accountEnd";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  scheduleDocumentPush,
  setSyncEnabled,
} from "./syncScheduler";
import {
  __resetDeckSyncForTests,
  __setDeckTransportForTests,
  flushDeckSync,
  scheduleDeckDelete,
  scheduleDeckPush,
  setDeckSyncEnabled,
} from "./deckSync";
import {
  __resetFolderSyncForTests,
  __setFolderPusherForTests,
  flushFolderSync,
  scheduleFolderPush,
  setFolderSyncEnabled,
} from "./folderSync";
import { __resetBootSyncForTests } from "./bootSync";
import { resetSyncStatus } from "./syncStatus";
import {
  __resetConnectivityForTests,
  markServerUnreachable,
} from "../api/connectivity";
import { loadAllFolders, loadAllPresentations, loadAllSongs } from "../storage";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage/db";
import {
  __resetPersistenceStatusForTests,
  getPersistenceError,
} from "../storage/persistenceStatus";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_USER_ID } from "../../test/presentationFixture";
import {
  createNewPresentation,
  flushPendingWrites,
  hydrateFromStorage,
  renamePresentation,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import {
  createFolder,
  flushFolderWrites,
  hydrateFoldersFromStorage,
  resetFolderStore,
} from "../../features/drive/folderStore";
import {
  flushSongWrites,
  hydrateSongLibrary,
  resetSongLibraryStore,
  saveSongToLibrary,
} from "../../features/editor/songLibraryStore";

const storageHooks = vi.hoisted(() => ({
  failPresentationSaves: 0,
  failFolderSaves: 0,
  failSongSaves: 0,
  holdSongSave: null as Promise<void> | null,
}));

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  const quotaError = (): DOMException =>
    new DOMException("가득 참", "QuotaExceededError");
  return {
    ...actual,
    savePresentation: vi.fn(
      async (doc: Parameters<typeof actual.savePresentation>[0]) => {
        if (storageHooks.failPresentationSaves > 0) {
          storageHooks.failPresentationSaves -= 1;
          throw quotaError();
        }
        await actual.savePresentation(doc);
      },
    ),
    saveFolder: vi.fn(
      async (saved: Parameters<typeof actual.saveFolder>[0]) => {
        if (storageHooks.failFolderSaves > 0) {
          storageHooks.failFolderSaves -= 1;
          throw quotaError();
        }
        await actual.saveFolder(saved);
      },
    ),
    saveSong: vi.fn(async (deck: Parameters<typeof actual.saveSong>[0]) => {
      if (storageHooks.holdSongSave) await storageHooks.holdSongSave;
      if (storageHooks.failSongSaves > 0) {
        storageHooks.failSongSaves -= 1;
        throw quotaError();
      }
      await actual.saveSong(deck);
    }),
  };
});

const SONG = "c0000000000000000000a";

function presentation(id = "d00000000000000000001"): Presentation {
  return {
    id,
    userId: SEED_USER_ID,
    title: "주일 예배",
    serviceDate: "2026-10-25",
    items: [],
    folderId: null,
    trashedAt: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  };
}

function libraryDeck(): Deck {
  return DeckSchema.parse({
    id: SONG,
    userId: SEED_USER_ID,
    scope: "library",
    title: "은혜로다",
    lyricsRaw: "가사",
    slides: [],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  });
}

function folder(): Folder {
  return {
    id: "a00000000000000000001",
    userId: SEED_USER_ID,
    parentId: null,
    name: "주일",
    trashedAt: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
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

function resetQueues(): void {
  __resetBootSyncForTests();
  __resetSyncSchedulerForTests();
  __resetDeckSyncForTests();
  __resetFolderSyncForTests();
  resetSyncStatus();
}

describe("계정이 끝날 때의 동기화", () => {
  let pushPresentation: ReturnType<
    typeof vi.fn<(doc: Presentation) => Promise<unknown>>
  >;
  let pushDeck: ReturnType<typeof vi.fn<(deck: Deck) => Promise<Deck>>>;
  let removeDeck: ReturnType<typeof vi.fn<(id: string) => Promise<boolean>>>;
  let pushFolder: ReturnType<typeof vi.fn<(folder: Folder) => Promise<Folder>>>;

  beforeEach(async () => {
    localStorage.clear();
    storageHooks.failPresentationSaves = 0;
    storageHooks.failFolderSaves = 0;
    storageHooks.failSongSaves = 0;
    storageHooks.holdSongSave = null;
    await resetDatabase();
    __resetPersistenceStatusForTests();
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    await resetSongLibraryStore();
    resetQueues();
    __resetConnectivityForTests();
    pushPresentation = vi.fn(async () => true);
    pushDeck = vi.fn(async (deck: Deck) => deck);
    removeDeck = vi.fn(async () => true);
    pushFolder = vi.fn(async (saved: Folder) => saved);
    __setPusherForTests(pushPresentation);
    __setDeckTransportForTests({ push: pushDeck, remove: removeDeck });
    __setFolderPusherForTests(pushFolder);
    setSyncEnabled(true);
    setDeckSyncEnabled(true);
    setFolderSyncEnabled(true);
  });

  afterEach(async () => {
    storageHooks.holdSongSave = null;
    vi.useRealTimers();
    resetQueues();
    resetPresentationStore();
    resetFolderStore();
    await resetSongLibraryStore();
    __resetConnectivityForTests();
    localStorage.clear();
    closeOfflineDB();
  });

  async function failOnceInEveryStore(): Promise<{
    presentationId: string;
    folderId: string;
    songId: string;
  }> {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await Promise.all([
      hydrateFromStorage(),
      hydrateFoldersFromStorage(),
      hydrateSongLibrary(),
    ]);
    const created = createNewPresentation();
    await flushPendingWrites();
    storageHooks.failPresentationSaves = 1;
    storageHooks.failFolderSaves = 1;
    storageHooks.failSongSaves = 1;
    renamePresentation(created.id, "저장하지 못한 이름");
    await flushPendingWrites();
    const madeFolder = createFolder(null, "저장하지 못한 폴더");
    await flushFolderWrites();
    const song = saveSongToLibrary({
      title: "저장하지 못한 곡",
      lyricsRaw: "가사",
    });
    await flushSongWrites();
    expect(getPersistenceError("presentation")?.kind).toBe("quota");
    expect(getPersistenceError("folder")?.kind).toBe("quota");
    expect(getPersistenceError("deck")?.kind).toBe("quota");
    return {
      presentationId: created.id,
      folderId: madeFolder.id,
      songId: song.id,
    };
  }

  async function expectStored(ids: {
    presentationId: string;
    folderId: string;
    songId: string;
  }): Promise<void> {
    const [presentations, folders, songs] = await Promise.all([
      loadAllPresentations(),
      loadAllFolders(),
      loadAllSongs(),
    ]);
    expect(
      presentations.valid.find((doc) => doc.id === ids.presentationId)?.title,
    ).toBe("저장하지 못한 이름");
    expect(folders.valid.map((saved) => saved.id)).toContain(ids.folderId);
    expect(songs.valid.map((deck) => deck.id)).toContain(ids.songId);
    expect(getPersistenceError()).toBeNull();
  }

  describe("flushBeforeSignOut", () => {
    it("디바운스 중인 프레젠테이션과 대기 중인 곡 삭제를 보낸 뒤 끝난다", async () => {
      scheduleDocumentPush(presentation());
      scheduleDeckDelete(SONG, SEED_USER_ID);

      await flushBeforeSignOut();

      expect(pushPresentation).toHaveBeenCalledWith(
        expect.objectContaining({ id: presentation().id }),
      );
      expect(removeDeck).toHaveBeenCalledWith(SONG);
    });

    it("서버에 닿지 못하면 서버로 보내지 않고 끝낸다", async () => {
      markServerUnreachable();
      scheduleDocumentPush(presentation());
      scheduleDeckDelete(SONG, SEED_USER_ID);

      await flushBeforeSignOut();

      expect(pushPresentation).not.toHaveBeenCalled();
      expect(removeDeck).not.toHaveBeenCalled();
    });

    it("서버에 닿지 못해도 저장본에 쓰지 못한 프레젠테이션·폴더·곡을 다시 쓴 뒤 끝난다", async () => {
      const ids = await failOnceInEveryStore();
      markServerUnreachable();

      await flushBeforeSignOut();

      await expectStored(ids);
    });

    it("서버가 답하지 않아도 3초 안에 끝낸다", async () => {
      vi.useFakeTimers();
      pushPresentation.mockImplementation(() => new Promise(() => undefined));
      scheduleDocumentPush(presentation());

      let finished = false;
      const flushing = flushBeforeSignOut().then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(2999);
      expect(pushPresentation).toHaveBeenCalledTimes(1);
      expect(finished).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await flushing;
      expect(finished).toBe(true);
    });
  });

  describe("stopAccountSync", () => {
    it("세 큐를 바로 꺼, 그 뒤에 예약한 항목은 보내지 않는다", async () => {
      const stopping = stopAccountSync();
      scheduleDocumentPush(presentation());
      scheduleDeckPush(libraryDeck());
      scheduleFolderPush(folder());
      await stopping;
      await Promise.all([
        flushFolderSync(),
        flushPendingSync(),
        flushDeckSync(),
      ]);

      expect(pushPresentation).not.toHaveBeenCalled();
      expect(pushDeck).not.toHaveBeenCalled();
      expect(pushFolder).not.toHaveBeenCalled();
    });

    it("디바운스 중인 저장본 쓰기를 마친 뒤 끝난다", async () => {
      await hydrateFromStorage();
      const created = createNewPresentation();

      await stopAccountSync();

      const { valid } = await loadAllPresentations();
      expect(valid.map((doc) => doc.id)).toContain(created.id);
      expect(pushPresentation).not.toHaveBeenCalled();
    });

    it("저장본에 쓰지 못해 다시 시도를 기다리는 프레젠테이션·폴더·곡을 다시 쓴 뒤 끝난다", async () => {
      const ids = await failOnceInEveryStore();

      await stopAccountSync();

      await expectStored(ids);
    });

    it("저장본에 쓰는 중인 곡을 다 쓴 뒤 끝난다", async () => {
      await hydrateSongLibrary();
      let release: () => void = () => undefined;
      storageHooks.holdSongSave = new Promise<void>((resolve) => {
        release = resolve;
      });
      const song = saveSongToLibrary({
        title: "쓰는 중인 곡",
        lyricsRaw: "가사",
      });

      let stopped = false;
      const stopping = stopAccountSync().then(() => {
        stopped = true;
      });
      await loadAllSongs();
      expect(stopped).toBe(false);
      release();
      await stopping;

      const { valid } = await loadAllSongs();
      expect(valid.map((deck) => deck.id)).toContain(song.id);
    });
  });
});
