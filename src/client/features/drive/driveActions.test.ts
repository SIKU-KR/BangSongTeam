import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { toast } from "sonner";
import {
  API_ERRORS,
  type Folder,
  type Presentation,
  type PresentationChanges,
} from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import {
  getPresentationById,
  listPresentations,
  movePresentation,
  renamePresentation,
  trashPresentation,
} from "../presentation";
import {
  __resetServerDecksForTests,
  setOwnPresentationListener,
} from "../../lib/sync/presentationSync";
import { ownPresentationListener } from "../../lib/sync/ownPresentationListener";
import { COMMON_COPY } from "#copy/common";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
} from "../presentation/presentationStore";
import {
  __loadFoldersForTests,
  createFolder,
  getFolder,
  getFolders,
  moveFolder,
  renameFolder,
  resetFolderStore,
  trashFolder,
} from "./folderStore";
import {
  deleteItemsForever,
  DriveActionError,
  moveItems,
  undoMove,
  validateItemName,
} from "./driveActions";
import {
  __resetFolderSyncForTests,
  __setFolderBackoffRandomForTests,
  __setFolderPusherForTests,
  pushFolderNow,
  setFolderSyncEnabled,
} from "../../lib/sync/folderSync";
import { MAX_RETRY_ATTEMPTS } from "../../lib/sync/backoff";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  setSyncEnabled,
} from "../../lib/sync/syncScheduler";
import {
  __resetConnectivityForTests,
  markServerUnreachable,
} from "../../lib/api/connectivity";
import { DRIVE_COPY } from "#copy/drive";
import { FOLDER_COPY } from "#copy/folders";
import {
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "../../test/presentationFixture";

const sync = vi.hoisted(() => ({
  deleteFolderRemote: vi.fn<
    (
      id: string,
      expected: { folderIds: string[]; presentationIds: string[] },
    ) => Promise<{
      ok: true;
      deletedFolderIds: string[];
      deletedPresentationIds: string[];
    }>
  >(async () => ({
    ok: true,
    deletedFolderIds: [],
    deletedPresentationIds: [],
  })),
  deletePresentationRemote: vi.fn<(id: string) => Promise<void>>(
    async () => {},
  ),
}));

vi.mock("../../lib/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/sync")>();
  return { ...actual, ...sync };
});

const { OfflineError, ServerRejectedError } = await import("../../lib/sync");

const ROOT = "a00000000000000000001";
const CHILD = "b00000000000000000002";
const OTHER = "c00000000000000000003";

function folder(id: string, parentId: string | null = null): Folder {
  return {
    id,
    userId: SEED_USER_ID,
    parentId,
    name: id.slice(0, 1),
    trashedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}

describe("driveActions", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    vi.resetAllMocks();
    __loadFoldersForTests([folder(ROOT), folder(CHILD, ROOT), folder(OTHER)]);
    __loadDocumentsForTests([
      { ...SEED_PRESENTATIONS[0], folderId: CHILD },
      { ...SEED_PRESENTATIONS[1], folderId: OTHER },
      SEED_PRESENTATIONS[2],
    ]);
  });

  describe("moveItems / undoMove", () => {
    it("폴더와 파일을 한꺼번에 옮기고 되돌린다", () => {
      const outcome = moveItems(
        [
          { kind: "folder", id: CHILD },
          { kind: "file", id: SEED_PRESENTATIONS[2].id },
        ],
        OTHER,
      );
      expect(outcome.moved).toHaveLength(2);
      expect(getFolders().find((f) => f.id === CHILD)?.parentId).toBe(OTHER);
      expect(getPresentationById(SEED_PRESENTATIONS[2].id)?.folderId).toBe(
        OTHER,
      );

      undoMove(outcome);
      expect(getFolders().find((f) => f.id === CHILD)?.parentId).toBe(ROOT);
      expect(
        getPresentationById(SEED_PRESENTATIONS[2].id)?.folderId,
      ).toBeNull();
    });

    it("사이클이 되는 폴더 이동은 건너뛰고 이유를 알린다", () => {
      const outcome = moveItems([{ kind: "folder", id: ROOT }], CHILD);
      expect(outcome.moved).toHaveLength(0);
      expect(outcome.errors).toEqual([FOLDER_COPY.cannotMoveIntoSelf]);
    });

    describe("옮기며 번호가 붙은 폴더", () => {
      const LEFT = "d00000000000000000004";
      const RIGHT = "e00000000000000000005";
      const MOVING = "f00000000000000000006";
      const TAKEN = "g00000000000000000007";
      const EMPTY = "h00000000000000000008";

      beforeEach(() => {
        __loadFoldersForTests([
          folder(LEFT),
          folder(RIGHT),
          folder(EMPTY),
          { ...folder(MOVING, LEFT), name: "찬양" },
          { ...folder(TAKEN, RIGHT), name: "찬양" },
        ]);
      });

      it("되돌리면 번호가 붙기 전 이름으로 돌아온다", () => {
        const outcome = moveItems([{ kind: "folder", id: MOVING }], RIGHT);
        expect(getFolder(MOVING)?.name).toBe("찬양 (2)");

        undoMove(outcome);

        expect(getFolder(MOVING)).toMatchObject({
          parentId: LEFT,
          name: "찬양",
        });
      });

      it("옮긴 뒤에 직접 바꾼 이름은 되돌려도 지킨다", () => {
        const outcome = moveItems([{ kind: "folder", id: MOVING }], RIGHT);
        renameFolder(MOVING, "찬양팀");

        undoMove(outcome);

        expect(getFolder(MOVING)).toMatchObject({
          parentId: LEFT,
          name: "찬양팀",
        });
      });

      it("원래 자리에 같은 이름이 생겼으면 되돌릴 때 다시 번호를 붙인다", () => {
        const outcome = moveItems([{ kind: "folder", id: MOVING }], RIGHT);
        createFolder(LEFT, "찬양");

        undoMove(outcome);

        expect(getFolder(MOVING)).toMatchObject({
          parentId: LEFT,
          name: "찬양 (2)",
        });
      });

      it("번호가 붙지 않은 이동은 되돌려도 이름을 건드리지 않는다", () => {
        const outcome = moveItems([{ kind: "folder", id: MOVING }], EMPTY);
        expect(getFolder(MOVING)?.name).toBe("찬양");
        renameFolder(MOVING, "합창");

        undoMove(outcome);

        expect(getFolder(MOVING)).toMatchObject({
          parentId: LEFT,
          name: "합창",
        });
      });
    });
  });

  describe("validateItemName", () => {
    it("폴더는 같은 위치의 이름 충돌을 거절하고 자기 이름은 허용한다", () => {
      const ref = { kind: "folder", id: ROOT } as const;
      expect(validateItemName(ref, "C")).toBe(FOLDER_COPY.nameTaken);
      expect(validateItemName(ref, " a ")).toBeNull();
    });

    it("프레젠테이션은 빈 이름과 제목 길이 제한을 넘는 이름을 거절한다", () => {
      const ref = { kind: "file", id: SEED_PRESENTATIONS[2].id } as const;
      expect(validateItemName(ref, "   ")).toBe(FOLDER_COPY.nameRequired);
      expect(validateItemName(ref, "가".repeat(101))).toBe(
        FOLDER_COPY.nameTooLong(100),
      );
      expect(validateItemName(ref, ` ${"가".repeat(100)} `)).toBeNull();
      expect(validateItemName(ref, "c")).toBeNull();
    });
  });

  describe("deleteItemsForever", () => {
    const [SEED0, SEED1, SEED2] = SEED_PRESENTATIONS;

    it("폴더를 서버에서 지운 뒤 하위 폴더·세트를 로컬에서도 지운다", async () => {
      sync.deleteFolderRemote.mockResolvedValueOnce({
        ok: true,
        deletedFolderIds: [ROOT, CHILD],
        deletedPresentationIds: [SEED0.id],
      });

      await deleteItemsForever([{ kind: "folder", id: ROOT }]);

      expect(sync.deleteFolderRemote).toHaveBeenCalledWith(ROOT, {
        folderIds: [ROOT, CHILD],
        presentationIds: [SEED0.id],
      });
      expect(getFolders().map((f) => f.id)).toEqual([OTHER]);
      expect(listPresentations().map((p) => p.id)).toEqual([
        SEED1.id,
        SEED2.id,
      ]);
    });

    it("보고 있던 하위 폴더·세트 id를 함께 보낸다", async () => {
      await deleteItemsForever([{ kind: "folder", id: ROOT }]);

      expect(sync.deleteFolderRemote).toHaveBeenCalledTimes(1);
      expect(sync.deleteFolderRemote).toHaveBeenCalledWith(ROOT, {
        folderIds: [ROOT, CHILD],
        presentationIds: [SEED0.id],
      });
    });

    it("서버가 폴더 밖에 둔 세트는 서버에서 지우지 않고 로컬에서만 지운다", async () => {
      await deleteItemsForever([{ kind: "folder", id: ROOT }]);

      expect(sync.deletePresentationRemote).not.toHaveBeenCalled();
      expect(getPresentationById(SEED0.id)).toBeUndefined();
      expect(getFolders().map((f) => f.id)).toEqual([OTHER]);
    });

    it("오프라인이면 아무것도 지우지 않고 이유를 알린다", async () => {
      sync.deletePresentationRemote.mockRejectedValueOnce(new OfflineError());
      const target = SEED2.id;

      const error = await deleteItemsForever([
        { kind: "file", id: target },
      ]).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(DriveActionError);
      expect((error as Error).message).toMatch(/오프라인/);
      expect(getPresentationById(target)).toBeDefined();
    });

    it("앞 항목을 서버가 거절해도(409) 나머지는 지우고 일부만 지웠다고 알린다", async () => {
      sync.deleteFolderRemote
        .mockRejectedValueOnce(
          new ServerRejectedError(409, API_ERRORS.trashChanged),
        )
        .mockResolvedValueOnce({
          ok: true,
          deletedFolderIds: [OTHER],
          deletedPresentationIds: [SEED1.id],
        });

      const error = await deleteItemsForever([
        { kind: "folder", id: ROOT },
        { kind: "folder", id: OTHER },
      ]).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(DriveActionError);
      expect((error as Error).message).toBe(API_ERRORS.trashChangedPartly);
      expect(sync.deleteFolderRemote).toHaveBeenCalledTimes(2);
      expect(getFolders().map((f) => f.id)).toEqual([ROOT, CHILD]);
      expect(listPresentations().map((p) => p.id)).toEqual([
        SEED0.id,
        SEED2.id,
      ]);
    });

    it("모든 항목을 서버가 거절하면 서버가 준 문장을 그대로 알리고 아무것도 지우지 않는다", async () => {
      sync.deleteFolderRemote.mockRejectedValueOnce(
        new ServerRejectedError(409, API_ERRORS.trashChanged),
      );
      sync.deletePresentationRemote.mockRejectedValueOnce(
        new ServerRejectedError(409, API_ERRORS.trashChanged),
      );

      const error = await deleteItemsForever([
        { kind: "folder", id: ROOT },
        { kind: "file", id: SEED2.id },
      ]).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(DriveActionError);
      expect((error as Error).message).toBe(API_ERRORS.trashChanged);
      expect(getFolders()).toHaveLength(3);
      expect(listPresentations()).toHaveLength(3);
    });

    it("서버가 일부만 지우고 거절하면 다른 항목을 지우지 못했어도 일부만 지웠다고 알린다", async () => {
      sync.deleteFolderRemote.mockRejectedValueOnce(
        new ServerRejectedError(409, API_ERRORS.trashChanged),
      );
      sync.deletePresentationRemote.mockRejectedValueOnce(
        new ServerRejectedError(409, API_ERRORS.trashChangedPartly),
      );

      const error = await deleteItemsForever([
        { kind: "folder", id: ROOT },
        { kind: "file", id: SEED2.id },
      ]).catch((err: unknown) => err);

      expect((error as Error).message).toBe(API_ERRORS.trashChangedPartly);
    });

    it("거절(409)이 아닌 오류에서는 남은 항목을 지우지 않고 멈춘다", async () => {
      sync.deleteFolderRemote.mockRejectedValueOnce(
        new ServerRejectedError(500, API_ERRORS.requestFailed),
      );

      const error = await deleteItemsForever([
        { kind: "folder", id: ROOT },
        { kind: "file", id: SEED2.id },
      ]).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(DriveActionError);
      expect((error as Error).message).toBe(DRIVE_COPY.deleteForeverRetry);
      expect(sync.deletePresentationRemote).not.toHaveBeenCalled();
      expect(listPresentations()).toHaveLength(3);
    });

    describe("동기화 큐를 거쳐서", () => {
      const folderPusher = vi.fn<(folder: Folder) => Promise<Folder>>();
      const documentPusher = vi.fn<(document: Presentation) => Promise<void>>();

      beforeEach(() => {
        __resetFolderSyncForTests();
        __resetSyncSchedulerForTests();
        __resetConnectivityForTests();
        folderPusher.mockReset();
        folderPusher.mockImplementation(async (saved) => saved);
        documentPusher.mockReset();
        documentPusher.mockResolvedValue(undefined);
        __setFolderPusherForTests(folderPusher);
        __setPusherForTests(documentPusher);
        setFolderSyncEnabled(true);
        setSyncEnabled(true);
      });

      afterEach(() => {
        __resetFolderSyncForTests();
        __resetSyncSchedulerForTests();
        __resetConnectivityForTests();
      });

      it("아직 올리지 않은 폴더 이동·휴지통을 먼저 올리고, 꺼낸 폴더와 그 안의 세트는 지우지 않는다", async () => {
        moveFolder(CHILD, null);
        trashFolder(ROOT);

        await deleteItemsForever([{ kind: "folder", id: ROOT }]);

        expect(folderPusher).toHaveBeenCalledWith(
          expect.objectContaining({ id: CHILD, parentId: null }),
        );
        expect(folderPusher).toHaveBeenCalledWith(
          expect.objectContaining({
            id: ROOT,
            trashedAt: expect.any(String),
          }),
        );
        expect(Math.max(...folderPusher.mock.invocationCallOrder)).toBeLessThan(
          sync.deleteFolderRemote.mock.invocationCallOrder[0],
        );
        expect(sync.deleteFolderRemote).toHaveBeenCalledWith(ROOT, {
          folderIds: [ROOT],
          presentationIds: [],
        });
        expect(getFolders().map((f) => f.id)).toEqual([CHILD, OTHER]);
        expect(getPresentationById(SEED0.id)).toBeDefined();
      });

      it("부팅이 올리는 중인 폴더 push를 기다린 뒤에 지운다", async () => {
        let release: () => void = () => undefined;
        folderPusher.mockImplementationOnce(
          (saved) =>
            new Promise<Folder>((resolve) => {
              release = () => resolve(saved);
            }),
        );
        trashFolder(ROOT);
        const booting = pushFolderNow({
          ...folder(ROOT),
          trashedAt: "2026-09-21T00:00:00.000Z",
        });
        await vi.waitFor(() => expect(folderPusher).toHaveBeenCalledTimes(1));

        const deleting = deleteItemsForever([{ kind: "folder", id: ROOT }]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(sync.deleteFolderRemote).not.toHaveBeenCalled();

        release();
        await Promise.all([booting, deleting]);

        expect(sync.deleteFolderRemote).toHaveBeenCalledTimes(1);
        expect(
          sync.deleteFolderRemote.mock.invocationCallOrder[0],
        ).toBeGreaterThan(folderPusher.mock.invocationCallOrder[0]);
      });

      it("폴더 변경을 서버가 받지 못하면(503) 아무것도 지우지 않고 다시 시도하라고 알린다", async () => {
        folderPusher.mockImplementation(async (saved) => {
          if (saved.id === CHILD) {
            throw new ServerRejectedError(503, API_ERRORS.serverBusy);
          }
          return saved;
        });
        moveFolder(CHILD, null);
        trashFolder(ROOT);

        const error = await deleteItemsForever([
          { kind: "folder", id: ROOT },
        ]).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(DriveActionError);
        expect((error as Error).message).toBe(DRIVE_COPY.deleteForeverRetry);
        expect(sync.deleteFolderRemote).not.toHaveBeenCalled();
        expect(getFolders().map((f) => f.id)).toEqual(
          expect.arrayContaining([ROOT, CHILD]),
        );
      });

      it("재시도 한도를 넘긴 서버 오류(500)로 올리지 못한 폴더 변경은 영구 삭제를 막지 않는다", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        try {
          __setFolderBackoffRandomForTests(() => 1);
          folderPusher.mockImplementation(async (saved) => {
            if (saved.id === CHILD) {
              throw new ServerRejectedError(500, API_ERRORS.requestFailed);
            }
            return saved;
          });
          moveFolder(CHILD, null);
          trashFolder(ROOT);
          await vi.advanceTimersByTimeAsync(2000);
          for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
            await vi.advanceTimersByTimeAsync(60_000);
          }

          await deleteItemsForever([{ kind: "folder", id: ROOT }]);

          expect(sync.deleteFolderRemote).toHaveBeenCalledWith(ROOT, {
            folderIds: [ROOT],
            presentationIds: [],
          });
        } finally {
          vi.useRealTimers();
        }
      });

      it("서버에 닿지 못해 올리지 못한 변경이 남으면 오프라인이라 지울 수 없다고 알린다", async () => {
        folderPusher.mockImplementation(async () => {
          markServerUnreachable();
          throw new OfflineError();
        });
        trashFolder(ROOT);

        const error = await deleteItemsForever([
          { kind: "folder", id: ROOT },
        ]).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(DriveActionError);
        expect((error as Error).message).toBe(DRIVE_COPY.deleteForeverOffline);
        expect(sync.deleteFolderRemote).not.toHaveBeenCalled();
      });

      it("폴더 밖으로 옮긴 세트를 서버가 받지 못하면(503) 폴더를 지우지 않는다", async () => {
        documentPusher.mockRejectedValue(
          new ServerRejectedError(503, API_ERRORS.serverBusy),
        );
        movePresentation(SEED0.id, null);
        trashFolder(ROOT);

        const error = await deleteItemsForever([
          { kind: "folder", id: ROOT },
        ]).catch((err: unknown) => err);

        expect(documentPusher).toHaveBeenCalledWith(
          expect.objectContaining({ id: SEED0.id, folderId: null }),
        );
        expect(error).toBeInstanceOf(DriveActionError);
        expect((error as Error).message).toBe(DRIVE_COPY.deleteForeverRetry);
        expect(sync.deleteFolderRemote).not.toHaveBeenCalled();
        expect(getPresentationById(SEED0.id)).toBeDefined();
        expect(getFolders()).toHaveLength(3);
      });
    });

    describe("지우기 전에 올린 세트의 결과", () => {
      const SYNCED_AT = "2026-09-25T00:00:00.000Z";
      const SERVER_AT = "2026-09-26T00:00:00.000Z";
      let fake: FakeApi | null = null;
      let info: MockInstance<typeof toast.info>;

      function respondToPatch(
        reply: (body: PresentationChanges) => {
          status?: number;
          body: unknown;
        },
      ): void {
        fake = installFakeApi({
          "PATCH /api/presentations/*": ({ body }) =>
            reply(body as PresentationChanges),
          "PUT /api/folders/*": ({ body }) => ({ body: { folder: body } }),
        });
      }

      function serverCopyOf(doc: Presentation): Presentation {
        return {
          ...structuredClone(doc),
          title: "다른 기기에서 고친 제목",
          updatedAt: SERVER_AT,
        };
      }

      function copies(): Presentation[] {
        return listPresentations().filter((doc) =>
          doc.title.endsWith(COMMON_COPY.copySuffix),
        );
      }

      beforeEach(() => {
        __resetFolderSyncForTests();
        __resetSyncSchedulerForTests();
        __resetServerDecksForTests();
        setFolderSyncEnabled(true);
        setSyncEnabled(true);
        setOwnPresentationListener(ownPresentationListener);
        info = vi.spyOn(toast, "info");
        __loadDocumentsForTests([
          {
            ...SEED_PRESENTATIONS[0],
            folderId: CHILD,
            baseUpdatedAt: SYNCED_AT,
            updatedAt: SYNCED_AT,
          },
          {
            ...SEED_PRESENTATIONS[2],
            baseUpdatedAt: SYNCED_AT,
            updatedAt: SYNCED_AT,
          },
        ]);
      });

      afterEach(() => {
        info.mockRestore();
        fake?.restore();
        fake = null;
        setOwnPresentationListener(null);
        __resetFolderSyncForTests();
        __resetSyncSchedulerForTests();
      });

      it("휴지통을 비우며 올린 세트가 다른 기기와 엇갈려도(412) 사본을 남기지 않는다", async () => {
        respondToPatch(() => ({
          status: 412,
          body: {
            error: API_ERRORS.presentation.conflict,
            presentation: serverCopyOf(SEED2),
          },
        }));
        trashPresentation(SEED2.id);

        await deleteItemsForever([{ kind: "file", id: SEED2.id }]);

        expect(fake?.calls.map(({ method }) => method)).toEqual(["PATCH"]);
        expect(copies()).toEqual([]);
        expect(getPresentationById(SEED2.id)).toBeUndefined();
        expect(info).not.toHaveBeenCalled();
      });

      it("지우는 폴더 안의 세트가 엇갈려도 사본을 남기지 않는다", async () => {
        respondToPatch(() => ({
          status: 412,
          body: {
            error: API_ERRORS.presentation.conflict,
            presentation: { ...serverCopyOf(SEED0), folderId: CHILD },
          },
        }));
        renamePresentation(SEED0.id, "지우기 전에 고친 제목");
        trashFolder(ROOT);

        await deleteItemsForever([{ kind: "folder", id: ROOT }]);

        expect(copies()).toEqual([]);
        expect(info).not.toHaveBeenCalled();
      });

      it("올린 세트를 서버가 이미 영구 삭제했다고 하면(410) 사본도 알림도 없이 지운다", async () => {
        respondToPatch(() => ({
          status: 410,
          body: { error: API_ERRORS.presentation.deleted },
        }));
        trashPresentation(SEED2.id);

        await deleteItemsForever([{ kind: "file", id: SEED2.id }]);

        expect(copies()).toEqual([]);
        expect(getPresentationById(SEED2.id)).toBeUndefined();
        expect(info).not.toHaveBeenCalled();
      });

      it("휴지통에 넣고 3초 안에 비워도 휴지통에 넣은 판을 먼저 올리고 지운다", async () => {
        respondToPatch((body) => ({
          body: { ok: true, updatedAt: body.updatedAt },
        }));
        trashPresentation(SEED2.id);

        await deleteItemsForever([{ kind: "file", id: SEED2.id }]);

        expect(fake?.calls).toHaveLength(1);
        expect(fake?.calls[0].body).toMatchObject({
          id: SEED2.id,
          trashedAt: expect.any(String),
        });
        expect(sync.deletePresentationRemote).toHaveBeenCalledExactlyOnceWith(
          SEED2.id,
        );
        expect(getPresentationById(SEED2.id)).toBeUndefined();
      });

      it("영구 삭제를 마친 뒤의 엇갈림은 다시 사본을 남긴다", async () => {
        sync.deletePresentationRemote.mockRejectedValueOnce(
          new ServerRejectedError(409, API_ERRORS.trashChanged),
        );
        respondToPatch((body) => ({
          body: { ok: true, updatedAt: body.updatedAt },
        }));
        trashPresentation(SEED2.id);
        await deleteItemsForever([{ kind: "file", id: SEED2.id }]).catch(
          () => undefined,
        );
        fake?.restore();
        const later = new Date(Date.now() + 60_000).toISOString();
        respondToPatch(() => ({
          status: 412,
          body: {
            error: API_ERRORS.presentation.conflict,
            presentation: { ...serverCopyOf(SEED2), updatedAt: later },
          },
        }));

        renamePresentation(SEED2.id, "영구 삭제를 마친 뒤 고친 제목");
        await flushPendingSync();

        expect(copies().map((doc) => doc.title)).toEqual([
          `영구 삭제를 마친 뒤 고친 제목${COMMON_COPY.copySuffix}`,
        ]);
      });
    });
  });
});
