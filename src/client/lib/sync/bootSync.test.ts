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
  deleteUserSong,
  getUserSongs,
  resetSongLibraryStore,
  saveSongToLibrary,
} from "../../features/editor/songLibraryStore";
import {
  __resetBootSyncForTests,
  shouldRunBootSync,
  runBootSync,
} from "./bootSync";
import {
  __resetDeckSyncForTests,
  __setDeckTransportForTests,
  flushDeckSync,
  scheduleDeckPush,
} from "./deckSync";
import {
  __resetSyncSchedulerForTests,
  flushPendingSync,
  scheduleDocumentPush,
} from "./syncScheduler";
import {
  __resetFolderSyncForTests,
  __setFolderPusherForTests,
} from "./folderSync";
import {
  __loadFoldersForTests,
  getFolders,
  resetFolderStore,
} from "../../features/drive/folderStore";
import { listPresentations } from "../../features/presentation";
import {
  __loadDocumentsForTests,
  renamePresentation,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import { SEED_USER_ID as TEST_USER_ID } from "../../test/presentationFixture";
import { OfflineError, ServerRejectedError } from "../api/request";
import { MAX_BACKOFF_MS } from "./backoff";
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
  pullPresentations: vi.fn(async () => []),
  pushPresentation: vi.fn<(doc: unknown) => Promise<boolean>>(async () => true),
  pullDecks: vi.fn(async (): Promise<Deck[]> => []),
  pullFolders: vi.fn(async (): Promise<FolderListResponse> => ({
    folders: [],
    tombstones: { folderIds: [], presentationIds: [] },
  })),
}));

vi.mock("./presentationSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./presentationSync")>();
  return { ...actual, ...presentationSync };
});

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
  let push: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    signInAsTestUser();
    await resetSongLibraryStore();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    push = vi.fn(async (deck: Deck) => deck);
    __setDeckTransportForTests({ push });
    presentationSync.pullDecks.mockResolvedValue([]);
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
  });

  afterEach(() => {
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
  });

  it("adopts library decks from the server", async () => {
    presentationSync.pullDecks.mockResolvedValue([serverDeck()]);
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
    presentationSync.pullDecks.mockResolvedValue([]);
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
    presentationSync.pullDecks.mockResolvedValue([]);
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

    expect(getSyncSnapshot()).toEqual({ status: "synced", lastFailure: null });
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
      return [];
    });

    await runBootSync();

    expect(getSyncSnapshot().status).toBe("offline");
  });

  it("오프라인이라 받지 못한 단계는 연결이 돌아오면 다시 받아 동기화됨으로 돌아온다", async () => {
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());

    await runBootSync();
    expect(getSyncSnapshot().status).toBe("offline");

    window.dispatchEvent(new Event("online"));

    await vi.waitFor(() => {
      expect(getSyncSnapshot().status).toBe("synced");
    });
  });

  it("오프라인으로 부팅한 뒤 송출 화면으로 가면 연결이 돌아와도 송출을 마칠 때까지 다시 받지 않는다", async () => {
    const startPath = window.location.pathname;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    presentationSync.pullFolders.mockClear();
    presentationSync.pullFolders.mockRejectedValueOnce(new OfflineError());

    try {
      await runBootSync();
      window.history.pushState({}, "", "/present/abc/fullscreen");
      window.dispatchEvent(new Event("online"));
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
      return [];
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
