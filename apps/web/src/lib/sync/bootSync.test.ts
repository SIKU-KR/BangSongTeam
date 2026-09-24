import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
  type Folder,
  type FolderListResponse,
  type Presentation,
} from "@repo/shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_USER_ID as TEST_USER_ID } from "../../features/presentation";
import {
  getUserSongs,
  resetSongLibraryStore,
  saveSongToLibrary,
} from "../../features/editor/songLibraryStore";
import { shouldRunBootSync, runBootSync } from "./bootSync";
import {
  __resetDeckSyncForTests,
  __setDeckTransportForTests,
} from "./deckSync";
import { __resetSyncSchedulerForTests } from "./syncScheduler";
import {
  __resetFolderSyncForTests,
  __setFolderPusherForTests,
} from "./folderSync";
import {
  __loadFoldersForTests,
  getFolders,
  resetFolderStore,
} from "../../features/drive/folderStore";
import {
  __loadDocumentsForTests,
  listPresentations,
  resetPresentationStore,
} from "../../features/presentation";

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
    id: "c0000000-0000-4000-8000-0000000000ff",
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

  it("runs on editing screens and the worship prep screen", () => {
    expect(shouldRunBootSync("/presentations")).toBe(true);
    expect(shouldRunBootSync("/editor/abc")).toBe(true);
    expect(shouldRunBootSync("/present/abc/ready")).toBe(true);
  });
});

describe("runBootSync — library decks (M5-2)", () => {
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

  it("uploads local-only decks (first sign-in after M5)", async () => {
    // 부팅 전 로컬에만 있던 곡. 동기화가 꺼져 있어 예약 push는 없다.
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

const PARENT = "a0000000-0000-4000-8000-000000000001";
const CHILD = "b0000000-0000-4000-8000-000000000002";
const DOC = "d0000000-0000-4000-8000-000000000003";

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
