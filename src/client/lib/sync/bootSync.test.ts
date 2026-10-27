import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
  type Folder,
  type FolderListResponse,
  type Presentation,
} from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  __setSessionFetcherForTests,
  __setSessionForTests,
  type SessionFetcher,
} from "../auth/sessionStore";
import type { SessionUser } from "../auth/sessionCache";
import {
  deleteUserSong,
  getUserSongs,
  hydrateSongLibrary,
  resetSongLibraryStore,
  saveSongToLibrary,
  updateLibrarySongInfo,
} from "../../features/editor/songLibraryStore";
import {
  __resetBootSyncForTests,
  BOOT_PULL_WAIT_MS,
  isBootPullPending,
  retryBootSyncIfNeeded,
  runDeferredBootSync,
  shouldRunBootSync,
  startBootSync,
  runBootSync,
} from "./bootSync";
import {
  __resetDeckSyncForTests,
  __setDeckBackoffRandomForTests,
  __setDeckTransportForTests,
  flushDeckSync,
  hasPendingDeckSync,
  retryDeckSyncNow,
  scheduleDeckPush,
} from "./deckSync";
import {
  listPendingDeckDeletes,
  rememberDeckDelete,
} from "./pendingDeckDeletes";
import {
  __resetSyncSchedulerForTests,
  __setBackoffRandomForTests,
  flushPendingSync,
  retryPendingSyncNow,
  scheduleDocumentPush,
} from "./syncScheduler";
import {
  __resetFolderSyncForTests,
  __setFolderBackoffRandomForTests,
  __setFolderPusherForTests,
  flushFolderSync,
  retryFolderSyncNow,
} from "./folderSync";
import {
  loadAllPresentations,
  loadAllSongs,
  saveFolders,
  savePresentation,
  saveSong,
} from "../storage";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage/db";
import {
  __loadFoldersForTests,
  getFolders,
  renameFolder,
  resetFolderStore,
} from "../../features/drive/folderStore";
import { listPresentations } from "../../features/presentation";
import {
  __loadDocumentsForTests,
  flushPendingWrites,
  hydrateFromStorage,
  removePresentationsLocally,
  renamePresentation,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import { SEED_USER_ID as TEST_USER_ID } from "../../test/presentationFixture";
import { OfflineError, ServerRejectedError } from "../api/request";
import { UnsyncableDocumentError } from "./presentationSync";
import { ERROR_COPY } from "#copy/common";
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS } from "./backoff";
import {
  getSyncSnapshot,
  recordSyncFailure,
  resetSyncStatus,
} from "./syncStatus";

const EMPTY_FOLDER_LIST: FolderListResponse = {
  folders: [],
  tombstones: { folderIds: [], presentationIds: [] },
};

const presentationSync = vi.hoisted(() => ({
  pullPresentations: vi.fn(async (): Promise<Presentation[]> => []),
  pushPresentation: vi.fn<(doc: unknown) => Promise<unknown>>(async () => {}),
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
  holdSaveFolders: null as Promise<void> | null,
}));

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  return {
    ...actual,
    saveFolders: vi.fn(
      async (folders: Parameters<typeof actual.saveFolders>[0]) => {
        if (storageHooks.holdSaveFolders) await storageHooks.holdSaveFolders;
        return actual.saveFolders(folders);
      },
    ),
  };
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function serverDeck(overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id: "c000000000000000000ff",
    userId: TEST_USER_ID,
    scope: "library",
    title: "다른 PC에서 만든 곡",
    lyricsRaw: "가사",
    slides: [],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "public",
    forkCount: 2,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

describe("shouldRunBootSync", () => {
  it("skips projection windows to keep Zero-Fetch", () => {
    expect(shouldRunBootSync("/present/abc/fullscreen")).toBe(false);
    expect(shouldRunBootSync("/present/abc/fullscreen/")).toBe(false);
  });

  it("runs on editing screens", () => {
    expect(shouldRunBootSync("/presentations")).toBe(true);
    expect(shouldRunBootSync("/editor/abc")).toBe(true);
  });
});

describe("runBootSync — library decks", () => {
  let push: ReturnType<typeof vi.fn<(deck: Deck) => Promise<Deck>>>;

  beforeEach(async () => {
    signInAsTestUser();
    await resetSongLibraryStore();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    push = vi.fn(async (deck: Deck) => deck);
    __setDeckTransportForTests({ push });
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
  });

  afterEach(() => {
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
  });

  it("adopts library decks from the server", async () => {
    presentationSync.pullDecks.mockResolvedValue({
      decks: [serverDeck()],
      deletedIds: [],
    });
    await runBootSync();
    expect(getUserSongs().map((d) => d.title)).toEqual(["다른 PC에서 만든 곡"]);
    expect(getUserSongs()[0].forkCount).toBe(2);
  });

  it("uploads local-only decks on first sign-in", async () => {
    const local = saveSongToLibrary({ title: "로컬 곡", lyricsRaw: "가사" });
    await runBootSync();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].id).toBe(local.id);
  });

  it("keeps working when the deck pull fails", async () => {
    presentationSync.pullDecks.mockRejectedValue(new Error("500"));
    const local = saveSongToLibrary({ title: "로컬 곡", lyricsRaw: "가사" });
    await runBootSync();
    expect(getUserSongs().map((d) => d.id)).toEqual([local.id]);
  });
});

function folder(id: string, overrides: Partial<Folder> = {}): Folder {
  return {
    id,
    userId: TEST_USER_ID,
    parentId: null,
    name: id.slice(0, 4),
    trashedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

function presentation(id: string): Presentation {
  return {
    id,
    userId: TEST_USER_ID,
    title: "세트",
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };
}

const PARENT = "a00000000000000000001";
const CHILD = "b00000000000000000002";
const DOC = "d00000000000000000003";

describe("runBootSync — drive folders", () => {
  let pushFolder: ReturnType<typeof vi.fn<(f: Folder) => Promise<Folder>>>;

  beforeEach(async () => {
    signInAsTestUser();
    await resetSongLibraryStore();
    resetFolderStore();
    resetPresentationStore();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    __setDeckTransportForTests({ push: vi.fn(async (deck: Deck) => deck) });
    pushFolder = vi.fn(async (f: Folder) => f);
    __setFolderPusherForTests(pushFolder);
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pushPresentation.mockClear();
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
  });

  afterEach(() => {
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
  });

  it("다른 기기에서 만든 폴더를 받는다", async () => {
    presentationSync.pullFolders.mockResolvedValue({
      ...EMPTY_FOLDER_LIST,
      folders: [folder(PARENT), folder(CHILD, { parentId: PARENT })],
    });
    await runBootSync();
    expect(
      getFolders()
        .map((f) => f.id)
        .sort(),
    ).toEqual([PARENT, CHILD]);
    expect(pushFolder).not.toHaveBeenCalled();
  });

  it("로컬에만 있는 폴더를 부모부터 올리고, 세트는 그 뒤에 올린다", async () => {
    const order: string[] = [];
    pushFolder.mockImplementation(async (f: Folder) => {
      order.push(`folder:${f.id}`);
      return f;
    });
    presentationSync.pushPresentation.mockImplementation(async (doc) => {
      order.push(`doc:${(doc as Presentation).id}`);
      return true;
    });
    __loadFoldersForTests([
      folder(CHILD, { parentId: PARENT }),
      folder(PARENT),
    ]);
    __loadDocumentsForTests([{ ...presentation(DOC), folderId: CHILD }]);

    await runBootSync();

    expect(order).toEqual([
      `folder:${PARENT}`,
      `folder:${CHILD}`,
      `doc:${DOC}`,
    ]);
  });

  it("다른 기기에서 영구 삭제한 폴더·세트는 되살리지 않고 로컬에서도 지운다", async () => {
    __loadFoldersForTests([folder(PARENT)]);
    __loadDocumentsForTests([presentation(DOC)]);
    presentationSync.pullFolders.mockResolvedValue({
      folders: [],
      tombstones: { folderIds: [PARENT], presentationIds: [DOC] },
    });

    await runBootSync();

    expect(getFolders()).toEqual([]);
    expect(listPresentations()).toEqual([]);
    expect(pushFolder).not.toHaveBeenCalled();
    expect(presentationSync.pushPresentation).not.toHaveBeenCalled();
  });

  it("폴더를 받지 못하면(서버 오류) 세트도 올리지 않는다", async () => {
    presentationSync.pullFolders.mockRejectedValue(new Error("500"));
    __loadDocumentsForTests([presentation(DOC)]);
    await runBootSync();
    expect(presentationSync.pushPresentation).not.toHaveBeenCalled();
  });
});

describe("runBootSync — 동기화 상태", () => {
  beforeEach(async () => {
    signInAsTestUser();
    await resetSongLibraryStore();
    resetFolderStore();
    resetPresentationStore();
    resetSyncStatus();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    __setDeckTransportForTests({ push: vi.fn(async (deck: Deck) => deck) });
    __setFolderPusherForTests(vi.fn(async (f: Folder) => f));
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pushPresentation.mockReset();
    presentationSync.pushPresentation.mockResolvedValue(true);
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
  });

  afterEach(() => {
    __resetBootSyncForTests();
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
  });

  it("프레젠테이션 push가 거절되면 곡·폴더 동기화가 성공해도 동기화 실패로 남는다", async () => {
    __loadFoldersForTests([folder(PARENT)]);
    __loadDocumentsForTests([presentation(DOC)]);
    saveSongToLibrary({ title: "로컬 곡", lyricsRaw: "가사" });
    presentationSync.pushPresentation.mockRejectedValue(
      new ServerRejectedError(400, "거절"),
    );

    await runBootSync();

    expect(getSyncSnapshot().status).toBe("error");
  });

  it("부팅 때 보낼 수 없는 프레젠테이션은 이유와 함께 동기화 실패로 남기고, 다시 시도하면 다시 올린다", async () => {
    __loadDocumentsForTests([presentation(DOC)]);
    presentationSync.pushPresentation.mockRejectedValueOnce(
      new UnsyncableDocumentError(),
    );

    await runBootSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: DOC,
      kind: "presentation",
      reason: ERROR_COPY.documentInvalid,
    });

    retryPendingSyncNow("manual");
    await flushPendingSync();

    expect(presentationSync.pushPresentation).toHaveBeenCalledTimes(2);
    expect(presentationSync.pushPresentation.mock.calls[1][0]).toMatchObject({
      id: DOC,
    });
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("곡을 받지 못하고 오프라인이면 offline으로 남는다", async () => {
    presentationSync.pullDecks.mockRejectedValue(new OfflineError());

    await runBootSync();

    expect(getSyncSnapshot().status).toBe("offline");
  });

  it("폴더를 받지 못하고 오프라인이면 offline으로 남는다", async () => {
    presentationSync.pullFolders.mockRejectedValue(new OfflineError());

    await runBootSync();

    expect(getSyncSnapshot().status).toBe("offline");
  });

  it("앞서 남은 실패 기록을 지우고 시작한다", async () => {
    recordSyncFailure({
      id: DOC,
      kind: "presentation",
      message: "이전 사용자의 실패",
      failedAt: 1,
    });

    await runBootSync();

    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("부팅 때 거절된 프레젠테이션은 다른 프레젠테이션이 올라가도 동기화 실패로 남는다", async () => {
    const OTHER = "e00000000000000000004";
    __loadDocumentsForTests([presentation(DOC)]);
    presentationSync.pushPresentation.mockImplementation(async (doc) => {
      if ((doc as Presentation).id === DOC) {
        throw new ServerRejectedError(400, "거절");
      }
      return true;
    });

    await runBootSync();
    scheduleDocumentPush(presentation(OTHER));
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure?.id).toBe(DOC);
  });

  it("곡 큐가 오프라인으로 다시 시도할 곡을 들고 있으면 부팅 성공으로 덮지 않는다", async () => {
    const queued = serverDeck({ id: "c000000000000000000aa" });
    __setDeckTransportForTests({
      push: vi.fn(async () => {
        throw new OfflineError();
      }),
    });
    presentationSync.pullDecks.mockImplementation(async () => {
      scheduleDeckPush(queued);
      await flushDeckSync();
      return { decks: [], deletedIds: [] };
    });

    await runBootSync();

    expect(getSyncSnapshot().status).toBe("offline");
  });

  it("오프라인이라 받지 못한 단계는 연결이 돌아오면 다시 받아 동기화됨으로 돌아온다", async () => {
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());

    await runBootSync();
    expect(getSyncSnapshot().status).toBe("offline");

    await expect(retryBootSyncIfNeeded("reconnect")).resolves.toBe(true);

    expect(getSyncSnapshot().status).toBe("synced");
    await expect(retryBootSyncIfNeeded("reconnect")).resolves.toBe(false);
  });

  it("포커스 같은 가벼운 회복 신호에는 서버가 거절해 기다리는 단계를 앞당기지 않는다", async () => {
    presentationSync.pullFolders.mockRejectedValueOnce(
      new ServerRejectedError(503),
    );
    await runBootSync();
    presentationSync.pullFolders.mockClear();

    await expect(retryBootSyncIfNeeded("wake")).resolves.toBe(false);
    expect(presentationSync.pullFolders).not.toHaveBeenCalled();

    await expect(retryBootSyncIfNeeded("reconnect")).resolves.toBe(true);
    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);
  });

  it("네트워크 실패로 기다리는 단계는 가벼운 회복 신호에도 곧바로 다시 받는다", async () => {
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());
    await runBootSync();

    await expect(retryBootSyncIfNeeded("wake")).resolves.toBe(true);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("거절돼 포기한 단계는 사용자가 다시 시도할 때만 다시 받는다", async () => {
    presentationSync.pullFolders.mockRejectedValueOnce(
      new ServerRejectedError(400),
    );
    await runBootSync();
    expect(getSyncSnapshot().status).toBe("error");

    await expect(retryBootSyncIfNeeded("reconnect")).resolves.toBe(false);
    await expect(retryBootSyncIfNeeded("manual")).resolves.toBe(true);

    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("받기를 끝내 실패하면 그 요청의 상관 ID를 문의 코드로 남긴다", async () => {
    const requestId = "4bf92f3577b34da6a3ce929d0e0e4736";
    presentationSync.pullPresentations.mockRejectedValueOnce(
      new ServerRejectedError(400, undefined, undefined, {
        requestId,
        route: "/api/presentations",
      }),
    );

    await runBootSync();

    expect(getSyncSnapshot()).toMatchObject({
      status: "error",
      failureRequestId: requestId,
    });
  });

  it("받지 못한 단계가 없으면 회복 때 다시 받지 않는다", async () => {
    await runBootSync();
    presentationSync.pullFolders.mockClear();
    presentationSync.pullPresentations.mockClear();
    presentationSync.pullDecks.mockClear();

    await expect(retryBootSyncIfNeeded("reconnect")).resolves.toBe(false);

    expect(presentationSync.pullFolders).not.toHaveBeenCalled();
    expect(presentationSync.pullPresentations).not.toHaveBeenCalled();
    expect(presentationSync.pullDecks).not.toHaveBeenCalled();
  });

  it("회복 신호가 겹쳐도 받지 못한 단계는 한 번만 다시 받는다", async () => {
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());
    await runBootSync();
    presentationSync.pullFolders.mockClear();

    const results = await Promise.all([
      retryBootSyncIfNeeded("reconnect"),
      retryBootSyncIfNeeded("reconnect"),
    ]);

    expect(results).toEqual([true, false]);
    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);
  });

  it("곡을 받지 못한 단계도 회복 때 다시 받는다", async () => {
    presentationSync.pullDecks.mockClear();
    presentationSync.pullDecks.mockRejectedValueOnce(new OfflineError());

    await runBootSync();
    expect(getSyncSnapshot().status).toBe("offline");

    await expect(retryBootSyncIfNeeded("reconnect")).resolves.toBe(true);

    expect(presentationSync.pullDecks).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("오프라인으로 부팅한 뒤 송출 화면으로 가면 연결이 돌아와도 송출을 마칠 때까지 다시 받지 않는다", async () => {
    const startPath = window.location.pathname;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    presentationSync.pullFolders.mockClear();
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());

    try {
      await runBootSync();
      window.history.pushState({}, "", "/present/abc/fullscreen");
      await expect(retryBootSyncIfNeeded("reconnect")).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);

      expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);
      expect(getSyncSnapshot().status).toBe("offline");

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

      expect(presentationSync.pullFolders).toHaveBeenCalledTimes(2);
      expect(getSyncSnapshot().status).toBe("synced");
    } finally {
      vi.useRealTimers();
      window.history.pushState({}, "", startPath);
    }
  });

  it("부팅 때 일시 오류로 올리지 못한 곡은 큐가 다시 올려 동기화됨으로 돌아온다", async () => {
    const push = vi
      .fn(async (deck: Deck) => deck)
      .mockRejectedValueOnce(new ServerRejectedError(503));
    __setDeckTransportForTests({ push });
    const local = saveSongToLibrary({ title: "로컬 곡", lyricsRaw: "가사" });

    await runBootSync();
    expect(getSyncSnapshot().status).toBe("offline");

    await flushDeckSync();

    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1][0].id).toBe(local.id);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("부팅이 올리지 못한 세트를 그사이 고쳤으면 고친 내용을 큐에 넘긴다", async () => {
    __loadDocumentsForTests([presentation(DOC)]);
    presentationSync.pushPresentation.mockImplementationOnce(async () => {
      renamePresentation(DOC, "고친 세트");
      throw new OfflineError();
    });

    await runBootSync();
    await flushPendingSync();

    const titles = presentationSync.pushPresentation.mock.calls.map(
      ([doc]) => (doc as Presentation).title,
    );
    expect(titles.at(-1)).toBe("고친 세트");
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("부팅이 올리지 못한 곡을 그사이 지웠으면 다시 올리지 않고 지운다", async () => {
    const remove = vi.fn(async () => undefined);
    const push = vi.fn(async (deck: Deck): Promise<Deck> => {
      deleteUserSong(deck.id);
      throw new OfflineError();
    });
    __setDeckTransportForTests({ push, remove });
    const local = saveSongToLibrary({ title: "로컬 곡", lyricsRaw: "가사" });

    await runBootSync();
    await flushDeckSync();

    expect(push).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(local.id);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("부팅이 올리던 곡을 그사이 지웠으면 거절돼도 실패로 남기지 않는다", async () => {
    const remove = vi.fn(async () => undefined);
    const push = vi.fn(async (deck: Deck): Promise<Deck> => {
      deleteUserSong(deck.id);
      await flushDeckSync();
      throw new ServerRejectedError(400, "거절");
    });
    __setDeckTransportForTests({ push, remove });
    const local = saveSongToLibrary({ title: "곧 지울 곡", lyricsRaw: "가사" });

    await runBootSync();
    await retryDeckSyncNow("manual");

    expect(push).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(local.id);
    expect(getUserSongs()).toEqual([]);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("부팅이 올리던 세트를 그사이 영구 삭제했으면 거절돼도 실패로 남기지 않는다", async () => {
    __loadDocumentsForTests([presentation(DOC)]);
    presentationSync.pushPresentation.mockImplementationOnce(async () => {
      await removePresentationsLocally([DOC]);
      throw new ServerRejectedError(400, "거절");
    });

    await runBootSync();
    retryPendingSyncNow("manual");
    await flushPendingSync();

    expect(presentationSync.pushPresentation).toHaveBeenCalledTimes(1);
    expect(listPresentations()).toEqual([]);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("부팅이 큐에 넘긴 세트를 큐가 먼저 올렸으면 오프라인으로 남지 않는다", async () => {
    const OTHER = "e00000000000000000004";
    __loadDocumentsForTests([presentation(DOC), presentation(OTHER)]);
    let calls = 0;
    presentationSync.pushPresentation.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new OfflineError();
      if (calls === 2) await flushPendingSync();
      return true;
    });

    await runBootSync();

    expect(calls).toBe(3);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("큐가 세트를 올리는 중이면 부팅이 먼저 동기화됨을 띄우지 않는다", async () => {
    let release: (() => void) | undefined;
    presentationSync.pushPresentation.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    presentationSync.pullPresentations.mockImplementation(async () => {
      scheduleDocumentPush(presentation(DOC));
      void flushPendingSync();
      return [];
    });

    await runBootSync();
    expect(getSyncSnapshot().status).toBe("syncing");

    release?.();
    await flushPendingSync();
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("큐가 곡을 올리는 중이면 부팅이 먼저 동기화됨을 띄우지 않는다", async () => {
    let release: (() => void) | undefined;
    __setDeckTransportForTests({
      push: vi.fn(
        (deck: Deck) =>
          new Promise<Deck>((resolve) => {
            release = () => resolve(deck);
          }),
      ),
    });
    presentationSync.pullDecks.mockImplementation(async () => {
      scheduleDeckPush(serverDeck({ id: "c000000000000000000aa" }));
      void flushDeckSync();
      return { decks: [], deletedIds: [] };
    });

    await runBootSync();
    expect(getSyncSnapshot().status).toBe("syncing");

    release?.();
    await flushDeckSync();
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("다시 부팅하면 앞선 부팅의 늦은 실패가 새 상태를 덮지 않는다", async () => {
    let failFirst: (() => void) | undefined;
    presentationSync.pullFolders.mockImplementationOnce(
      () =>
        new Promise<FolderListResponse>((_, reject) => {
          failFirst = () => reject(new OfflineError());
        }),
    );

    const first = runBootSync();
    await runBootSync();
    expect(getSyncSnapshot().status).toBe("synced");

    failFirst?.();
    await first;

    expect(getSyncSnapshot().status).toBe("synced");
  });
});

describe("runBootSync — 부팅이 올리는 동안 바뀐 항목", () => {
  beforeEach(async () => {
    signInAsTestUser();
    await resetSongLibraryStore();
    resetFolderStore();
    resetPresentationStore();
    resetSyncStatus();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    __setDeckTransportForTests({ push: vi.fn(async (deck: Deck) => deck) });
    __setFolderPusherForTests(vi.fn(async (f: Folder) => f));
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pushPresentation.mockReset();
    presentationSync.pushPresentation.mockResolvedValue(true);
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
  });

  afterEach(() => {
    __resetBootSyncForTests();
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
  });

  it("앞 곡을 올리는 동안 지운 곡은 올리지 않고 서버에서도 지운다", async () => {
    const first = saveSongToLibrary({ title: "첫 곡", lyricsRaw: "가사" });
    const second = saveSongToLibrary({ title: "둘째 곡", lyricsRaw: "가사" });
    const remove = vi.fn(async () => undefined);
    const pushed: string[] = [];
    const push = vi.fn(async (deck: Deck): Promise<Deck> => {
      if (pushed.length === 0) {
        deleteUserSong(deck.id === first.id ? second.id : first.id);
      }
      pushed.push(deck.id);
      return deck;
    });
    __setDeckTransportForTests({ push, remove });

    await runBootSync();
    await flushDeckSync();

    const deletedId = pushed[0] === first.id ? second.id : first.id;
    expect(pushed).not.toContain(deletedId);
    expect(remove).toHaveBeenCalledWith(deletedId);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("앞 곡을 올리는 동안 고친 곡은 고친 내용으로 올린다", async () => {
    const first = saveSongToLibrary({ title: "첫 곡", lyricsRaw: "가사" });
    const second = saveSongToLibrary({ title: "둘째 곡", lyricsRaw: "가사" });
    const pushed: Deck[] = [];
    const push = vi.fn(async (deck: Deck): Promise<Deck> => {
      if (pushed.length === 0) {
        updateLibrarySongInfo(deck.id === first.id ? second.id : first.id, {
          title: "고친 곡",
          artist: "",
        });
      }
      pushed.push(deck);
      return deck;
    });
    __setDeckTransportForTests({ push });

    await runBootSync();
    await flushDeckSync();

    const editedId = pushed[0].id === first.id ? second.id : first.id;
    const editedPushes = pushed.filter((deck) => deck.id === editedId);
    expect(editedPushes.length).toBeGreaterThan(0);
    expect(editedPushes.every((deck) => deck.title === "고친 곡")).toBe(true);
  });

  it("앞 폴더를 올리는 동안 이름을 바꾼 폴더는 바뀐 이름으로 올리고 큐의 것도 잃지 않는다", async () => {
    __loadFoldersForTests([
      folder(PARENT, { name: "부모" }),
      folder(CHILD, { parentId: PARENT, name: "자식" }),
    ]);
    const pushed: Folder[] = [];
    __setFolderPusherForTests(
      vi.fn(async (f: Folder) => {
        if (f.id === PARENT) renameFolder(CHILD, "새 이름");
        pushed.push(f);
        return f;
      }),
    );

    await runBootSync();
    await flushFolderSync();

    const childPushes = pushed.filter((f) => f.id === CHILD);
    expect(childPushes.length).toBeGreaterThan(0);
    expect(childPushes.every((f) => f.name === "새 이름")).toBe(true);
    expect(getFolders().find((f) => f.id === CHILD)?.name).toBe("새 이름");
  });

  it("앞 세트를 올리는 동안 고친 세트는 고친 내용으로 올린다", async () => {
    const OTHER = "e00000000000000000004";
    __loadDocumentsForTests([presentation(DOC), presentation(OTHER)]);
    const pushed: Presentation[] = [];
    presentationSync.pushPresentation.mockImplementation(async (doc) => {
      const current = doc as Presentation;
      if (pushed.length === 0) {
        renamePresentation(current.id === DOC ? OTHER : DOC, "고친 세트");
      }
      pushed.push(current);
      return true;
    });

    await runBootSync();
    await flushPendingSync();

    const editedId = pushed[0].id === DOC ? OTHER : DOC;
    const editedPushes = pushed.filter((doc) => doc.id === editedId);
    expect(editedPushes.length).toBeGreaterThan(0);
    expect(editedPushes.every((doc) => doc.title === "고친 세트")).toBe(true);
  });
});

describe("runBootSync — 지운 항목과 밀린 push", () => {
  const later = (): string => new Date(Date.now() + 60_000).toISOString();
  let push: ReturnType<typeof vi.fn<(deck: Deck) => Promise<Deck>>>;
  let remove: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  let pushFolder: ReturnType<typeof vi.fn<(f: Folder) => Promise<Folder>>>;

  beforeEach(async () => {
    signInAsTestUser();
    await resetSongLibraryStore();
    resetFolderStore();
    resetPresentationStore();
    resetSyncStatus();
    __resetBootSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    push = vi.fn(async (deck: Deck) => deck);
    remove = vi.fn(async () => undefined);
    pushFolder = vi.fn(async (f: Folder) => f);
    __setDeckTransportForTests({ push, remove });
    __setFolderPusherForTests(pushFolder);
    __setDeckBackoffRandomForTests(() => 1);
    __setFolderBackoffRandomForTests(() => 1);
    __setBackoffRandomForTests(() => 1);
    presentationSync.pullDecks.mockReset();
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    presentationSync.pullPresentations.mockReset();
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pushPresentation.mockReset();
    presentationSync.pushPresentation.mockResolvedValue(true);
    presentationSync.pullFolders.mockReset();
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
  });

  afterEach(() => {
    __resetBootSyncForTests();
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
  });

  async function storedSongIds(): Promise<string[]> {
    const { valid } = await loadAllSongs();
    return valid.map((deck) => deck.id);
  }

  function failOffline(): Promise<never> {
    return Promise.reject(new OfflineError());
  }

  it("서버가 지운 곡은 올리지 않고 보관함과 저장본에서 지운다", async () => {
    const local = saveSongToLibrary({ title: "지운 곡", lyricsRaw: "가사" });
    presentationSync.pullDecks.mockResolvedValue({
      decks: [],
      deletedIds: [local.id],
    });

    await runBootSync();

    expect(push).not.toHaveBeenCalled();
    expect(getUserSongs()).toEqual([]);
    expect(await storedSongIds()).not.toContain(local.id);
  });

  it("부팅이 올린 곡을 서버가 이미 지운 곡이라고 하면 실패 없이 보관함에서 지운다", async () => {
    push.mockRejectedValue(new ServerRejectedError(410, "이미 지운 곡"));
    const local = saveSongToLibrary({ title: "지운 곡", lyricsRaw: "가사" });

    await runBootSync();
    await flushDeckSync();

    expect(push).toHaveBeenCalledTimes(1);
    expect(getUserSongs()).toEqual([]);
    expect(await storedSongIds()).not.toContain(local.id);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });

    await retryDeckSyncNow("manual");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("큐가 올린 곡을 서버가 이미 지운 곡이라고 하면 보관함에서 내려놓는다", async () => {
    await runBootSync();
    push.mockRejectedValue(new ServerRejectedError(410, "이미 지운 곡"));
    const local = saveSongToLibrary({ title: "지운 곡", lyricsRaw: "가사" });

    await flushDeckSync();

    expect(getUserSongs()).toEqual([]);
    expect(await storedSongIds()).not.toContain(local.id);
    expect(getSyncSnapshot().lastFailure).toBeNull();
  });

  it("곡 목록을 받는 동안 지우고 서버가 지운 곡은 되살리지 않는다", async () => {
    const local = saveSongToLibrary({ title: "지울 곡", lyricsRaw: "가사" });
    presentationSync.pullDecks.mockImplementation(async () => {
      deleteUserSong(local.id);
      await flushDeckSync();
      return { decks: [local], deletedIds: [] };
    });

    await runBootSync();

    expect(remove).toHaveBeenCalledWith(local.id);
    expect(push).not.toHaveBeenCalled();
    expect(getUserSongs()).toEqual([]);
    expect(await storedSongIds()).not.toContain(local.id);
  });

  it("오프라인 부팅 뒤 고친 곡을 다시 받은 목록이 지운 곡이라고 하면 올리지 않는다", async () => {
    push.mockImplementation(failOffline);
    const local = saveSongToLibrary({ title: "곡", lyricsRaw: "가사" });
    presentationSync.pullDecks.mockRejectedValueOnce(new OfflineError());
    await runBootSync();
    updateLibrarySongInfo(local.id, { title: "오프라인에서 고침", artist: "" });
    await flushDeckSync();
    expect(push).toHaveBeenCalledTimes(1);

    presentationSync.pullDecks.mockResolvedValueOnce({
      decks: [],
      deletedIds: [local.id],
    });
    await retryBootSyncIfNeeded("reconnect");
    await retryDeckSyncNow("reconnect");

    expect(push).toHaveBeenCalledTimes(1);
    expect(getUserSongs()).toEqual([]);
  });

  it("오프라인 부팅 뒤 이름을 바꾼 폴더를 다시 받은 기록이 영구 삭제했다고 하면 올리지 않는다", async () => {
    pushFolder.mockImplementation(failOffline);
    __loadFoldersForTests([folder(PARENT)]);
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());
    await runBootSync();
    renameFolder(PARENT, "오프라인에서 바꾼 이름");
    await flushFolderSync();
    expect(pushFolder).toHaveBeenCalledTimes(1);

    presentationSync.pullFolders.mockResolvedValueOnce({
      folders: [],
      tombstones: { folderIds: [PARENT], presentationIds: [] },
    });
    await retryBootSyncIfNeeded("reconnect");
    await retryFolderSyncNow("reconnect");

    expect(pushFolder).toHaveBeenCalledTimes(1);
    expect(getFolders()).toEqual([]);
  });

  it("오프라인 부팅 뒤 이름을 바꾼 세트를 다시 받은 기록이 영구 삭제했다고 하면 올리지 않는다", async () => {
    presentationSync.pushPresentation.mockImplementation(failOffline);
    __loadDocumentsForTests([presentation(DOC)]);
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());
    await runBootSync();
    renamePresentation(DOC, "오프라인에서 바꾼 이름");
    await flushPendingSync();
    expect(presentationSync.pushPresentation).toHaveBeenCalledTimes(1);

    presentationSync.pullFolders.mockResolvedValueOnce({
      folders: [],
      tombstones: { folderIds: [], presentationIds: [DOC] },
    });
    await retryBootSyncIfNeeded("reconnect");
    retryPendingSyncNow("reconnect");
    await flushPendingSync();

    expect(presentationSync.pushPresentation).toHaveBeenCalledTimes(1);
    expect(listPresentations()).toEqual([]);
  });

  it("오프라인 부팅 뒤 고친 세트는 다시 받은 서버 사본이 더 새로우면 올리지 않는다", async () => {
    presentationSync.pushPresentation.mockImplementation(failOffline);
    __loadDocumentsForTests([presentation(DOC)]);
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());
    await runBootSync();
    renamePresentation(DOC, "오프라인 제목");
    await flushPendingSync();
    presentationSync.pushPresentation.mockReset();
    presentationSync.pushPresentation.mockResolvedValue(true);

    presentationSync.pullPresentations.mockResolvedValueOnce([
      { ...presentation(DOC), title: "다른 기기 제목", updatedAt: later() },
    ]);
    await retryBootSyncIfNeeded("reconnect");
    retryPendingSyncNow("reconnect");
    await flushPendingSync();

    expect(presentationSync.pushPresentation).not.toHaveBeenCalled();
    expect(listPresentations().map((doc) => doc.title)).toEqual([
      "다른 기기 제목",
    ]);
  });

  it("오프라인 부팅 뒤 이름을 바꾼 폴더는 다시 받은 서버 사본이 더 새로우면 올리지 않는다", async () => {
    pushFolder.mockImplementation(failOffline);
    __loadFoldersForTests([folder(PARENT)]);
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());
    await runBootSync();
    renameFolder(PARENT, "오프라인 이름");
    await flushFolderSync();
    pushFolder.mockReset();
    pushFolder.mockImplementation(async (f: Folder) => f);

    presentationSync.pullFolders.mockResolvedValueOnce({
      ...EMPTY_FOLDER_LIST,
      folders: [folder(PARENT, { name: "다른 기기 이름", updatedAt: later() })],
    });
    await retryBootSyncIfNeeded("reconnect");
    await retryFolderSyncNow("reconnect");

    expect(pushFolder).not.toHaveBeenCalled();
    expect(getFolders().map((f) => f.name)).toEqual(["다른 기기 이름"]);
  });

  it("오프라인 부팅 뒤 고친 곡은 다시 받은 서버 사본이 더 새로우면 올리지 않는다", async () => {
    push.mockImplementation(failOffline);
    const local = saveSongToLibrary({ title: "곡", lyricsRaw: "가사" });
    presentationSync.pullDecks.mockRejectedValueOnce(new OfflineError());
    await runBootSync();
    updateLibrarySongInfo(local.id, { title: "오프라인 제목", artist: "" });
    await flushDeckSync();
    push.mockReset();
    push.mockImplementation(async (deck: Deck) => deck);

    presentationSync.pullDecks.mockResolvedValueOnce({
      decks: [{ ...local, title: "다른 기기 제목", updatedAt: later() }],
      deletedIds: [],
    });
    await retryBootSyncIfNeeded("reconnect");
    await retryDeckSyncNow("reconnect");

    expect(push).not.toHaveBeenCalled();
    expect(getUserSongs().map((deck) => deck.title)).toEqual([
      "다른 기기 제목",
    ]);
  });
});

describe("runBootSync — 새로고침 뒤에도 남는 곡 삭제", () => {
  let push: ReturnType<typeof vi.fn<(deck: Deck) => Promise<Deck>>>;
  let remove: ReturnType<typeof vi.fn<(id: string) => Promise<boolean | void>>>;

  beforeEach(async () => {
    localStorage.clear();
    signInAsTestUser();
    await resetSongLibraryStore();
    resetFolderStore();
    resetPresentationStore();
    resetSyncStatus();
    __resetBootSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    push = vi.fn(async (deck: Deck) => deck);
    remove = vi.fn(async () => true);
    __setDeckTransportForTests({ push, remove });
    __setFolderPusherForTests(vi.fn(async (f: Folder) => f));
    presentationSync.pullDecks.mockReset();
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    presentationSync.pullPresentations.mockReset();
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pushPresentation.mockReset();
    presentationSync.pushPresentation.mockResolvedValue(undefined);
    presentationSync.pullFolders.mockReset();
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
  });

  afterEach(() => {
    __resetBootSyncForTests();
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    localStorage.clear();
  });

  async function reload(): Promise<void> {
    __resetBootSyncForTests();
    __resetDeckSyncForTests();
    __setDeckTransportForTests({ push, remove });
    await hydrateSongLibrary();
  }

  async function storedSongIds(): Promise<string[]> {
    const { valid } = await loadAllSongs();
    return valid.map((deck) => deck.id);
  }

  async function uploadedSong(): Promise<Deck> {
    const song = saveSongToLibrary({ title: "지울 곡", lyricsRaw: "가사" });
    await runBootSync();
    expect(push).toHaveBeenCalledWith(song);
    return song;
  }

  it("오프라인에서 지운 곡은 새로고침한 뒤 서버 목록에 있어도 보관함에 넣지 않고, 서버에서 지운다", async () => {
    const song = await uploadedSong();
    remove.mockRejectedValueOnce(new OfflineError());
    deleteUserSong(song.id);
    await flushDeckSync();
    expect(remove).toHaveBeenCalledTimes(1);

    await reload();
    presentationSync.pullDecks.mockResolvedValue({
      decks: [song],
      deletedIds: [],
    });
    await runBootSync();

    expect(getUserSongs()).toEqual([]);
    await flushDeckSync();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith(song.id);
    expect(listPendingDeckDeletes(TEST_USER_ID)).toEqual([]);
    expect(await storedSongIds()).not.toContain(song.id);
  });

  it("지우고 2초 안에 탭을 닫아도 새로고침한 뒤 감추고 서버에서 지운다", async () => {
    const song = await uploadedSong();
    deleteUserSong(song.id);
    await loadAllSongs();
    await saveSong(song);
    expect(remove).not.toHaveBeenCalled();

    await reload();
    expect(getUserSongs()).toEqual([]);
    expect(await storedSongIds()).not.toContain(song.id);
    presentationSync.pullDecks.mockResolvedValue({
      decks: [song],
      deletedIds: [],
    });
    await runBootSync();

    expect(getUserSongs()).toEqual([]);
    await flushDeckSync();
    expect(remove).toHaveBeenCalledWith(song.id);
    expect(listPendingDeckDeletes(TEST_USER_ID)).toEqual([]);
  });

  it("이 계정의 곡이 아니라는 답(404)을 받은 삭제는 기록을 남겨 다음 부팅에 다시 보낸다", async () => {
    const song = await uploadedSong();
    remove.mockResolvedValueOnce(false);
    deleteUserSong(song.id);
    await flushDeckSync();
    expect(listPendingDeckDeletes(TEST_USER_ID)).toEqual([song.id]);

    await reload();
    await runBootSync();
    await flushDeckSync();

    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith(song.id);
    expect(listPendingDeckDeletes(TEST_USER_ID)).toEqual([]);
  });

  it("부팅 때 목록을 받지 못해도 앞선 페이지에서 지운 곡의 삭제를 곧바로 큐에 넣는다", async () => {
    const gone = "c000000000000000000e9";
    rememberDeckDelete(TEST_USER_ID, gone);
    presentationSync.pullFolders.mockRejectedValue(new OfflineError());

    const booting = runBootSync();
    expect(hasPendingDeckSync()).toBe(true);
    await booting;
    await flushDeckSync();

    expect(remove).toHaveBeenCalledWith(gone);
    expect(listPendingDeckDeletes(TEST_USER_ID)).toEqual([]);
  });

  it("서버가 끝내 지우지 못한 곡은 기록을 지워, 새로고침하면 서버의 곡이 보관함에 돌아온다", async () => {
    const song = await uploadedSong();
    remove.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
    deleteUserSong(song.id);
    await flushDeckSync();
    expect(getSyncSnapshot().lastFailure).toMatchObject({ id: song.id });
    expect(listPendingDeckDeletes(TEST_USER_ID)).toEqual([]);

    await reload();
    presentationSync.pullDecks.mockResolvedValue({
      decks: [song],
      deletedIds: [],
    });
    await runBootSync();

    expect(getUserSongs().map((deck) => deck.id)).toEqual([song.id]);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("runBootSync — 한 브라우저의 소유자 저장본과 공유받은 사본", () => {
  const MEMBER = "0000000x0000000member";
  const SHARED = "p00000000000000000001";

  function leaderCopy(): Presentation {
    return {
      ...presentation(SHARED),
      title: "로컬 수정",
      updatedAt: "2026-09-30T00:00:00.000Z",
    };
  }

  function memberCopy(): Presentation {
    return {
      ...presentation(SHARED),
      title: "서버",
      access: { ownerName: "인도자", memberId: MEMBER },
    };
  }

  async function storedPresentations(): Promise<Presentation[]> {
    return (await loadAllPresentations()).valid;
  }

  beforeEach(async () => {
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    await resetSongLibraryStore();
    resetFolderStore();
    resetPresentationStore();
    resetSyncStatus();
    __resetBootSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    __setDeckTransportForTests({ push: vi.fn(async (deck: Deck) => deck) });
    __setFolderPusherForTests(vi.fn(async (f: Folder) => f));
    presentationSync.pullDecks.mockReset();
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    presentationSync.pullPresentations.mockReset();
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pushPresentation.mockReset();
    presentationSync.pushPresentation.mockResolvedValue(undefined);
    presentationSync.pullFolders.mockReset();
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
  });

  afterEach(() => {
    __resetBootSyncForTests();
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    signInAsTestUser();
    closeOfflineDB();
  });

  it("공유받은 사람의 부팅 병합이 소유자의 더 새로운 저장본을 덮지 않는다", async () => {
    await savePresentation(leaderCopy());
    signInAsTestUser(MEMBER);
    await hydrateFromStorage();
    presentationSync.pullPresentations.mockResolvedValue([memberCopy()]);

    await runBootSync();
    await flushPendingWrites();

    expect(listPresentations().map((doc) => doc.id)).toEqual([SHARED]);
    expect(await storedPresentations()).toEqual([leaderCopy()]);
  });

  it("공유가 끝난 사본은 저장본에서도 지운다", async () => {
    await savePresentation(memberCopy());
    signInAsTestUser(MEMBER);
    await hydrateFromStorage();
    expect(listPresentations().map((doc) => doc.id)).toEqual([SHARED]);

    await runBootSync();
    await flushPendingWrites();

    expect(listPresentations()).toEqual([]);
    expect(await storedPresentations()).toEqual([]);
  });

  it("소유자의 부팅 병합은 공유받은 사본만 있던 자리를 소유자의 서버본으로 바꾼다", async () => {
    const owners: Presentation = {
      ...presentation(SHARED),
      title: "서버",
      folderId: null,
    };
    await savePresentation(memberCopy());
    signInAsTestUser(TEST_USER_ID);
    await hydrateFromStorage();
    presentationSync.pullPresentations.mockResolvedValue([owners]);

    await runBootSync();
    await flushPendingWrites();

    expect(listPresentations()).toEqual([owners]);
    expect(await storedPresentations()).toEqual([owners]);
  });

  it("공유가 끝난 사본의 자리에 그사이 소유자의 저장본이 들어왔으면 지우지 않는다", async () => {
    await savePresentation(memberCopy());
    signInAsTestUser(MEMBER);
    await hydrateFromStorage();
    await savePresentation(leaderCopy());

    await runBootSync();
    await flushPendingWrites();

    expect(listPresentations()).toEqual([]);
    expect(await storedPresentations()).toEqual([leaderCopy()]);
  });
});

const HOUR = 60 * 60 * 1000;
const OTHER_USER_ID = "999999999999999999999";

function sessionUser(userId: string = TEST_USER_ID): SessionUser {
  return {
    userId,
    name: "테스트 봉사자",
    image: null,
    expiresAt: Date.now() + HOUR,
  };
}

async function resetBootSyncDependencies(): Promise<void> {
  signInAsTestUser();
  await resetSongLibraryStore();
  resetFolderStore();
  resetPresentationStore();
  resetSyncStatus();
  __resetBootSyncForTests();
  __resetDeckSyncForTests();
  __resetSyncSchedulerForTests();
  __resetFolderSyncForTests();
  __setDeckTransportForTests({ push: vi.fn(async (deck: Deck) => deck) });
  __setFolderPusherForTests(vi.fn(async (f: Folder) => f));
  storageHooks.holdSaveFolders = null;
  vi.mocked(saveFolders).mockClear();
  presentationSync.pullDecks.mockReset();
  presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
  presentationSync.pullPresentations.mockReset();
  presentationSync.pullPresentations.mockResolvedValue([]);
  presentationSync.pushPresentation.mockReset();
  presentationSync.pushPresentation.mockResolvedValue(true);
  presentationSync.pullFolders.mockReset();
  presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
}

function cleanUpBootSync(): void {
  storageHooks.holdSaveFolders = null;
  window.history.pushState({}, "", "/");
  __resetBootSyncForTests();
  __resetFolderSyncForTests();
  __resetDeckSyncForTests();
  __resetSyncSchedulerForTests();
}

async function settleMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function bootSettled(): Promise<void> {
  await vi.waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));
}

describe("startBootSync — 송출 화면에서 부팅한 탭", () => {
  let fetcher: ReturnType<typeof vi.fn<SessionFetcher>>;

  beforeEach(async () => {
    await resetBootSyncDependencies();
    fetcher = vi.fn<SessionFetcher>(async () => sessionUser());
    __setSessionFetcherForTests(fetcher);
  });

  afterEach(cleanUpBootSync);

  it("송출 화면에서 부팅하면 서버에 묻지 않고, 송출을 마치면 세션을 확인하고 부팅 동기화를 한 번 돈다", async () => {
    window.history.pushState({}, "", "/present/abc/fullscreen");
    startBootSync(window.location.pathname);
    runDeferredBootSync();
    await settleMicrotasks();

    expect(presentationSync.pullFolders).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/presentations");
    runDeferredBootSync();
    await bootSettled();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);

    scheduleDocumentPush(presentation(DOC));
    await flushPendingSync();
    expect(presentationSync.pushPresentation).toHaveBeenCalledWith(
      expect.objectContaining({ id: DOC }),
    );

    runDeferredBootSync();
    await settleMicrotasks();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);
  });

  it("송출을 마칠 때 로그아웃돼 있으면 미뤄 두었다가 같은 계정이 다시 로그인한 뒤에 돈다", async () => {
    window.history.pushState({}, "", "/present/abc/fullscreen");
    startBootSync(window.location.pathname);
    __setSessionForTests(null);
    window.history.pushState({}, "", "/presentations");
    runDeferredBootSync();
    await settleMicrotasks();

    expect(presentationSync.pullFolders).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();

    __setSessionForTests(sessionUser());
    runDeferredBootSync();
    await bootSettled();

    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("미뤄 둔 부팅은 다른 계정이 부팅하면 버린다", async () => {
    window.history.pushState({}, "", "/present/abc/fullscreen");
    startBootSync(window.location.pathname);
    window.history.pushState({}, "", "/presentations");
    __setSessionForTests(sessionUser(OTHER_USER_ID));
    startBootSync(window.location.pathname);
    await bootSettled();

    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);

    __setSessionForTests(sessionUser());
    runDeferredBootSync();
    await settleMicrotasks();

    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("부팅 첫 받기 대기 (isBootPullPending)", () => {
  beforeEach(resetBootSyncDependencies);

  afterEach(() => {
    vi.useRealTimers();
    cleanUpBootSync();
  });

  it("받기 전에는 폴더·프레젠테이션 모두 기다리고, 폴더는 메모리에 넣자마자, 프레젠테이션은 병합하면 끝난다", async () => {
    const folders = deferred<FolderListResponse>();
    const presentations = deferred<Presentation[]>();
    const saving = deferred<void>();
    presentationSync.pullFolders.mockReturnValueOnce(folders.promise);
    presentationSync.pullPresentations.mockReturnValueOnce(
      presentations.promise,
    );
    storageHooks.holdSaveFolders = saving.promise;

    const booting = runBootSync();

    expect(isBootPullPending("folder")).toBe(true);
    expect(isBootPullPending("presentation")).toBe(true);

    folders.resolve({ ...EMPTY_FOLDER_LIST, folders: [folder(PARENT)] });
    await vi.waitFor(() => expect(saveFolders).toHaveBeenCalled());

    expect(isBootPullPending("folder")).toBe(false);
    expect(getFolders().map((f) => f.id)).toEqual([PARENT]);
    expect(isBootPullPending("presentation")).toBe(true);
    expect(presentationSync.pullPresentations).not.toHaveBeenCalled();

    saving.resolve();
    await vi.waitFor(() =>
      expect(presentationSync.pullPresentations).toHaveBeenCalled(),
    );
    expect(isBootPullPending("presentation")).toBe(true);

    const decks = deferred<{ decks: Deck[]; deletedIds: string[] }>();
    presentationSync.pullDecks.mockReturnValueOnce(decks.promise);
    presentations.resolve([presentation(DOC)]);
    await vi.waitFor(() =>
      expect(presentationSync.pullDecks).toHaveBeenCalled(),
    );

    expect(isBootPullPending("presentation")).toBe(false);
    expect(listPresentations().map((doc) => doc.id)).toEqual([DOC]);

    decks.resolve({ decks: [], deletedIds: [] });
    await booting;
  });

  it("받기가 오프라인으로 실패해도 기다림을 끝낸다", async () => {
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());

    await runBootSync();

    expect(isBootPullPending("folder")).toBe(false);
    expect(isBootPullPending("presentation")).toBe(false);
  });

  it("앞선 부팅이 늦게 끝나도 새 부팅의 기다림을 끝내지 않는다", async () => {
    const first = deferred<FolderListResponse>();
    const second = deferred<FolderListResponse>();
    presentationSync.pullFolders
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const firstBoot = runBootSync();
    const secondBoot = runBootSync();
    first.resolve(EMPTY_FOLDER_LIST);
    await firstBoot;

    expect(isBootPullPending("folder")).toBe(true);
    expect(isBootPullPending("presentation")).toBe(true);

    second.resolve(EMPTY_FOLDER_LIST);
    await secondBoot;

    expect(isBootPullPending("folder")).toBe(false);
    expect(isBootPullPending("presentation")).toBe(false);
  });

  it("받기가 끝나지 않아도 BOOT_PULL_WAIT_MS가 지나면 기다림을 끝낸다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    presentationSync.pullFolders.mockReturnValueOnce(new Promise(() => {}));

    void runBootSync();
    await vi.advanceTimersByTimeAsync(BOOT_PULL_WAIT_MS - 1);

    expect(isBootPullPending("folder")).toBe(true);
    expect(isBootPullPending("presentation")).toBe(true);

    await vi.advanceTimersByTimeAsync(1);

    expect(isBootPullPending("folder")).toBe(false);
    expect(isBootPullPending("presentation")).toBe(false);
  });
});

describe("runBootSync — 부팅 중에 시작한 송출", () => {
  beforeEach(async () => {
    await resetBootSyncDependencies();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanUpBootSync();
  });

  it("부팅 동기화 중 송출을 시작하면 병합과 다음 요청을 송출을 마칠 때까지 미룬다", async () => {
    const folders = deferred<FolderListResponse>();
    presentationSync.pullFolders.mockReturnValueOnce(folders.promise);

    const booting = runBootSync();
    window.history.pushState({}, "", "/present/abc/fullscreen");
    folders.resolve({ ...EMPTY_FOLDER_LIST, folders: [folder(PARENT)] });
    await booting;

    expect(presentationSync.pullPresentations).not.toHaveBeenCalled();
    expect(getFolders()).toEqual([]);

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);
    expect(presentationSync.pullPresentations).not.toHaveBeenCalled();
    expect(getFolders()).toEqual([]);

    window.history.pushState({}, "", "/presentations");
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
    await vi.waitFor(() =>
      expect(presentationSync.pullPresentations).toHaveBeenCalledTimes(1),
    );

    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(2);
    expect(
      presentationSync.pullFolders.mock.invocationCallOrder[1],
    ).toBeLessThan(
      presentationSync.pullPresentations.mock.invocationCallOrder[0],
    );
  });

  it("부팅이 폴더를 올리는 중에 송출을 시작하면 프레젠테이션 목록을 송출을 마친 뒤에 받는다", async () => {
    const pushing = deferred<Folder>();
    const pushFolder = vi.fn<(f: Folder) => Promise<Folder>>(
      () => pushing.promise,
    );
    __setFolderPusherForTests(pushFolder);
    __loadFoldersForTests([folder(PARENT)]);

    const booting = runBootSync();
    await vi.waitFor(() => expect(pushFolder).toHaveBeenCalledTimes(1));
    window.history.pushState({}, "", "/present/abc/fullscreen");
    pushing.resolve(folder(PARENT));
    await booting;

    expect(presentationSync.pullPresentations).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(1);
    expect(presentationSync.pullPresentations).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/presentations");
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
    await vi.waitFor(() =>
      expect(presentationSync.pullPresentations).toHaveBeenCalledTimes(1),
    );

    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(2);
  });

  it("프레젠테이션 목록을 받는 중에 송출을 시작하면 병합과 곡 목록 받기를 송출을 마칠 때까지 미룬다", async () => {
    const presentations = deferred<Presentation[]>();
    presentationSync.pullPresentations.mockReturnValueOnce(
      presentations.promise,
    );

    const booting = runBootSync();
    await vi.waitFor(() =>
      expect(presentationSync.pullPresentations).toHaveBeenCalledTimes(1),
    );
    window.history.pushState({}, "", "/present/abc/fullscreen");
    presentations.resolve([presentation(DOC)]);
    await booting;

    expect(listPresentations()).toEqual([]);
    expect(presentationSync.pullDecks).not.toHaveBeenCalled();
    expect(isBootPullPending("presentation")).toBe(false);

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

    expect(listPresentations()).toEqual([]);
    expect(presentationSync.pullDecks).not.toHaveBeenCalled();
    expect(presentationSync.pullPresentations).toHaveBeenCalledTimes(1);

    presentationSync.pullPresentations.mockResolvedValue([presentation(DOC)]);
    window.history.pushState({}, "", "/presentations");
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
    await vi.waitFor(() =>
      expect(listPresentations().map((doc) => doc.id)).toEqual([DOC]),
    );

    expect(presentationSync.pullFolders).toHaveBeenCalledTimes(2);
  });

  it("부팅이 프레젠테이션을 올리는 중에 송출을 시작하면 곡 목록을 송출을 마친 뒤에 받는다", async () => {
    const pushing = deferred<boolean>();
    presentationSync.pushPresentation.mockReturnValueOnce(pushing.promise);
    __loadDocumentsForTests([presentation(DOC)]);

    const booting = runBootSync();
    await vi.waitFor(() =>
      expect(presentationSync.pushPresentation).toHaveBeenCalledTimes(1),
    );
    window.history.pushState({}, "", "/present/abc/fullscreen");
    pushing.resolve(true);
    await booting;
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

    expect(presentationSync.pullDecks).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/presentations");
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
    await vi.waitFor(() =>
      expect(presentationSync.pullDecks).toHaveBeenCalledTimes(1),
    );
  });

  it("곡 목록을 받는 중에 송출을 시작하면 곡 병합을 송출을 마칠 때까지 미룬다", async () => {
    const decks = deferred<{ decks: Deck[]; deletedIds: string[] }>();
    presentationSync.pullDecks.mockReturnValueOnce(decks.promise);

    const booting = runBootSync();
    await vi.waitFor(() =>
      expect(presentationSync.pullDecks).toHaveBeenCalledTimes(1),
    );
    window.history.pushState({}, "", "/present/abc/fullscreen");
    decks.resolve({ decks: [serverDeck()], deletedIds: [] });
    await booting;
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

    expect(getUserSongs()).toEqual([]);
    expect(presentationSync.pullDecks).toHaveBeenCalledTimes(1);

    presentationSync.pullDecks.mockResolvedValue({
      decks: [serverDeck()],
      deletedIds: [],
    });
    window.history.pushState({}, "", "/presentations");
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
    await vi.waitFor(() =>
      expect(getUserSongs().map((deck) => deck.title)).toEqual([
        "다른 PC에서 만든 곡",
      ]),
    );

    expect(presentationSync.pullDecks).toHaveBeenCalledTimes(2);
  });
});
