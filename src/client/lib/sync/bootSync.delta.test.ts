import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  Deck,
  Folder,
  FolderListResponse,
  OmittedPresentation,
  Presentation,
  PresentationDocument,
  PresentationListEntry,
} from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { mockPresentation, SEED_USER_ID } from "../../test/presentationFixture";
import {
  __loadDocumentsForTests,
  getPresentationById,
  resetPresentationStore,
} from "../../features/presentation/presentationStore";
import { listPresentations } from "../../features/presentation";
import { resetFolderStore } from "../../features/drive/folderStore";
import { resetSongLibraryStore } from "../../features/editor/songLibraryStore";
import { OfflineError } from "../api/request";
import { __resetServerClockForTests } from "../api/serverClock";
import {
  __resetBootSyncForTests,
  FRESHNESS_MS,
  refreshOwnDataIfStale,
  runBootSync,
} from "./bootSync";
import {
  __resetDeckSyncForTests,
  __setDeckTransportForTests,
} from "./deckSync";
import {
  __resetFolderSyncForTests,
  __setFolderPusherForTests,
} from "./folderSync";
import {
  notePresentationsPulled,
  PULL_SINCE_MARGIN_MS,
} from "./presentationPull";
import {
  __resetSyncSchedulerForTests,
  flushPendingSync,
} from "./syncScheduler";
import { getSyncDomainStatus, resetSyncStatus } from "./syncStatus";

const EMPTY_FOLDER_LIST: FolderListResponse = {
  folders: [],
  tombstones: { folderIds: [], presentationIds: [] },
};

const presentationSync = vi.hoisted(() => ({
  pullPresentations: vi.fn<
    (since?: string) => Promise<PresentationListEntry[]>
  >(async () => []),
  pullPresentation: vi.fn<(id: string) => Promise<PresentationDocument | null>>(
    async () => null,
  ),
  pushPresentation: vi.fn<(doc: unknown) => Promise<void>>(async () => {}),
  pullDecks: vi.fn(
    async (): Promise<{ decks: Deck[]; deletedIds: string[] }> => ({
      decks: [],
      deletedIds: [],
    }),
  ),
  pullFolders: vi.fn(
    async (): Promise<FolderListResponse> => EMPTY_FOLDER_LIST,
  ),
}));

vi.mock("./presentationSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./presentationSync")>();
  return { ...actual, ...presentationSync };
});

const T0 = Date.parse("2026-10-28T09:00:00.000Z");
const R1 = "2026-10-20T00:00:00.000Z";
const R2 = "2026-10-27T00:00:00.000Z";
const EDITED = "2026-10-28T08:00:00.000Z";
const OTHER_USER = "00000000x000000000009";
const NEW_ID = "1000000000000000000n1";

function serverDoc(
  overrides: Partial<Presentation> = {},
): PresentationDocument {
  return {
    ...structuredClone(mockPresentation),
    folderId: null,
    trashedAt: null,
    updatedAt: R1,
    ...overrides,
  } as PresentationDocument;
}

function headerOf(doc: Presentation): OmittedPresentation {
  return {
    id: doc.id,
    userId: doc.userId,
    title: doc.title,
    serviceDate: doc.serviceDate,
    folderId: doc.folderId ?? null,
    trashedAt: doc.trashedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    items: null,
    copiesOmitted: true,
  };
}

function sinceOfCall(call: number): string | undefined {
  return presentationSync.pullPresentations.mock.calls.at(call)?.[0];
}

function markedSince(at: number): string {
  return new Date(at - PULL_SINCE_MARGIN_MS).toISOString();
}

function pushedIds(): string[] {
  return presentationSync.pushPresentation.mock.calls.map(
    ([doc]) => (doc as Presentation).id,
  );
}

describe("runBootSync — 바뀐 프레젠테이션만 곡까지 받기", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    __resetServerClockForTests();
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    await resetSongLibraryStore();
    resetSyncStatus();
    __resetBootSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    __setDeckTransportForTests({ push: vi.fn(async (deck: Deck) => deck) });
    __setFolderPusherForTests(vi.fn(async (folder: Folder) => folder));
    presentationSync.pullFolders.mockReset();
    presentationSync.pullFolders.mockResolvedValue(EMPTY_FOLDER_LIST);
    presentationSync.pullDecks.mockReset();
    presentationSync.pullDecks.mockResolvedValue({ decks: [], deletedIds: [] });
    presentationSync.pullPresentations.mockReset();
    presentationSync.pullPresentations.mockResolvedValue([]);
    presentationSync.pullPresentation.mockReset();
    presentationSync.pullPresentation.mockResolvedValue(null);
    presentationSync.pushPresentation.mockReset();
    presentationSync.pushPresentation.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetBootSyncForTests();
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
  });

  it("처음 부팅은 since 없이 목록 전체를 받고, 다음 부팅은 그 받기를 시작한 때를 기준으로 받는다", async () => {
    presentationSync.pullPresentations.mockResolvedValue([serverDoc()]);

    await runBootSync();
    expect(sinceOfCall(0)).toBeUndefined();

    vi.setSystemTime(T0 + 60 * 60_000);
    await runBootSync();

    expect(sinceOfCall(1)).toBe(markedSince(T0));
  });

  it("머리로 온 같은 판의 세트는 곡을 그대로 두고, 따로 받거나 올리지 않는다", async () => {
    presentationSync.pullPresentations.mockResolvedValue([serverDoc()]);
    await runBootSync();
    const before = getPresentationById(mockPresentation.id);
    expect(before?.items).toHaveLength(mockPresentation.items.length);
    presentationSync.pullPresentations.mockResolvedValue([
      headerOf(serverDoc()),
    ]);

    await runBootSync();
    await flushPendingSync();

    expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
    expect(presentationSync.pushPresentation).not.toHaveBeenCalled();
    expect(getPresentationById(mockPresentation.id)).toEqual(before);
    expect(getSyncDomainStatus("presentation")).toBe("synced");
  });

  it("이 기기에 없는 세트의 머리가 오면 그 세트만 따로 받아 넣는다", async () => {
    notePresentationsPulled(SEED_USER_ID, { documents: [], startedAt: T0 });
    const arrived = serverDoc({ id: NEW_ID, title: "다른 기기에서 만든 세트" });
    presentationSync.pullPresentations.mockResolvedValue([headerOf(arrived)]);
    presentationSync.pullPresentation.mockResolvedValue(arrived);

    await runBootSync();

    expect(presentationSync.pullPresentation).toHaveBeenCalledWith(NEW_ID);
    expect(getPresentationById(NEW_ID)).toEqual({
      ...arrived,
      baseUpdatedAt: R1,
    });
  });

  it("올리지 않은 편집이 있는 세트는 서버 판을 따로 받아 견주고, 편집을 남겨 올린다", async () => {
    notePresentationsPulled(SEED_USER_ID, { documents: [], startedAt: T0 });
    const edited: Presentation = {
      ...serverDoc(),
      title: "이 기기에서 고친 제목",
      updatedAt: EDITED,
      baseUpdatedAt: R1,
    };
    __loadDocumentsForTests([edited]);
    presentationSync.pullPresentations.mockResolvedValue([
      headerOf(serverDoc()),
    ]);
    presentationSync.pullPresentation.mockResolvedValue(serverDoc());

    await runBootSync();
    await flushPendingSync();

    expect(presentationSync.pullPresentation).toHaveBeenCalledWith(edited.id);
    expect(getPresentationById(edited.id)?.title).toBe("이 기기에서 고친 제목");
    expect(pushedIds()).toEqual([edited.id]);
  });

  it("올리지 않은 편집의 시각이 서버 판과 같아도 이 기기의 곡으로 채우지 않고, 편집을 남겨 올린다", async () => {
    notePresentationsPulled(SEED_USER_ID, { documents: [], startedAt: T0 });
    const server = serverDoc({ updatedAt: R2 });
    const [first, ...rest] = server.items;
    const edited: Presentation = {
      ...server,
      items: [
        {
          ...first,
          deck: { ...first.deck, lyricsRaw: "이 기기에서 고친 가사" },
        },
        ...rest,
      ],
      baseUpdatedAt: R1,
    };
    __loadDocumentsForTests([edited]);
    presentationSync.pullPresentations.mockResolvedValue([headerOf(server)]);
    presentationSync.pullPresentation.mockResolvedValue(server);

    await runBootSync();
    await flushPendingSync();

    expect(presentationSync.pullPresentation).toHaveBeenCalledWith(edited.id);
    expect(getPresentationById(edited.id)?.items[0]?.deck?.lyricsRaw).toBe(
      "이 기기에서 고친 가사",
    );
    expect(pushedIds()).toEqual([edited.id]);
  });

  it("다른 기기가 고친 판의 머리가 오면 그 판을 따로 받아 바꾼다", async () => {
    presentationSync.pullPresentations.mockResolvedValue([serverDoc()]);
    await runBootSync();
    const changed = serverDoc({
      title: "다른 기기에서 고친 제목",
      updatedAt: R2,
    });
    presentationSync.pullPresentations.mockResolvedValue([headerOf(changed)]);
    presentationSync.pullPresentation.mockResolvedValue(changed);

    await runBootSync();

    expect(getPresentationById(changed.id)).toEqual({
      ...changed,
      baseUpdatedAt: R2,
    });
    expect(presentationSync.pushPresentation).not.toHaveBeenCalled();
  });

  it("목록에서 빠진 세트는 머리만 받은 부팅에서도 영구 삭제 기록대로 지운다", async () => {
    presentationSync.pullPresentations.mockResolvedValue([serverDoc()]);
    await runBootSync();
    presentationSync.pullFolders.mockResolvedValue({
      folders: [],
      tombstones: { folderIds: [], presentationIds: [mockPresentation.id] },
    });
    presentationSync.pullPresentations.mockResolvedValue([]);

    await runBootSync();

    expect(listPresentations()).toEqual([]);
    expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
  });

  it("따로 받기를 실패하면 받은 시각을 앞으로 옮기지 않고 다음 받기도 같은 때부터 받는다", async () => {
    notePresentationsPulled(SEED_USER_ID, { documents: [], startedAt: T0 });
    presentationSync.pullPresentations.mockResolvedValue([
      headerOf(serverDoc({ id: NEW_ID })),
    ]);
    presentationSync.pullPresentation.mockRejectedValue(new OfflineError());

    vi.setSystemTime(T0 + 60 * 60_000);
    await runBootSync();
    expect(getSyncDomainStatus("presentation")).toBe("offline");
    expect(getPresentationById(NEW_ID)).toBeUndefined();

    presentationSync.pullPresentations.mockResolvedValue([]);
    vi.setSystemTime(T0 + 2 * 60 * 60_000);
    await runBootSync();

    expect(sinceOfCall(0)).toBe(markedSince(T0));
    expect(sinceOfCall(1)).toBe(markedSince(T0));
  });

  it("다른 계정의 머리가 오면 따로 받지 않고 받은 목록을 버린다", async () => {
    notePresentationsPulled(SEED_USER_ID, { documents: [], startedAt: T0 });
    presentationSync.pullPresentations.mockResolvedValue([
      headerOf(serverDoc({ id: NEW_ID, userId: OTHER_USER })),
    ]);

    await runBootSync();

    expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
    expect(listPresentations()).toEqual([]);
    expect(getSyncDomainStatus("presentation")).toBe("error");
  });

  describe("열려 있는 탭의 다시 받기", () => {
    async function bootWith(doc: PresentationDocument): Promise<void> {
      presentationSync.pullPresentations.mockResolvedValue([doc]);
      await runBootSync();
      presentationSync.pullPresentations.mockClear();
      vi.setSystemTime(Date.now() + FRESHNESS_MS);
    }

    it("since로 받고, 같은 판의 머리는 그 세트를 그대로 둔다", async () => {
      await bootWith(serverDoc());
      const before = getPresentationById(mockPresentation.id);
      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(serverDoc()),
      ]);

      await refreshOwnDataIfStale("wake");

      expect(sinceOfCall(0)).toBe(markedSince(T0));
      expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
      expect(getPresentationById(mockPresentation.id)).toBe(before);
    });

    it("다른 기기가 고친 판은 따로 받아 바꾸고, 다음 다시 받기는 그 받기를 시작한 때부터 받는다", async () => {
      await bootWith(serverDoc());
      const refreshedAt = Date.now();
      const changed = serverDoc({
        title: "다른 기기에서 고친 제목",
        updatedAt: R2,
      });
      presentationSync.pullPresentations.mockResolvedValue([headerOf(changed)]);
      presentationSync.pullPresentation.mockResolvedValue(changed);

      await refreshOwnDataIfStale("wake");
      expect(getPresentationById(changed.id)?.title).toBe(
        "다른 기기에서 고친 제목",
      );

      vi.setSystemTime(refreshedAt + FRESHNESS_MS);
      await refreshOwnDataIfStale("wake");

      expect(sinceOfCall(1)).toBe(markedSince(refreshedAt));
    });

    it("올리지 않은 편집이 있는 세트는 서버 판이 앞서도 따로 받지 않고 편집을 그대로 둔다", async () => {
      await bootWith(serverDoc());
      const edited: Presentation = {
        ...serverDoc(),
        title: "이 기기에서 고친 제목",
        updatedAt: EDITED,
        baseUpdatedAt: R1,
      };
      __loadDocumentsForTests([edited]);
      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(
          serverDoc({ title: "다른 기기에서 고친 제목", updatedAt: R2 }),
        ),
      ]);

      await refreshOwnDataIfStale("manual");

      expect(presentationSync.pullPresentation).not.toHaveBeenCalled();
      expect(getPresentationById(edited.id)?.title).toBe(
        "이 기기에서 고친 제목",
      );
      expect(presentationSync.pushPresentation).not.toHaveBeenCalled();
    });

    it("받지 못하면 받은 시각을 그대로 둔다", async () => {
      await bootWith(serverDoc());
      presentationSync.pullPresentations.mockResolvedValue([
        headerOf(serverDoc({ id: NEW_ID })),
      ]);
      presentationSync.pullPresentation.mockRejectedValue(new OfflineError());

      await refreshOwnDataIfStale("manual");
      presentationSync.pullPresentations.mockResolvedValue([]);
      vi.setSystemTime(Date.now() + FRESHNESS_MS);
      await refreshOwnDataIfStale("manual");

      expect(sinceOfCall(0)).toBe(markedSince(T0));
      expect(sinceOfCall(1)).toBe(markedSince(T0));
    });
  });
});
