import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { API_ERRORS, type Folder, type Presentation } from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  getPresentationById,
  listPresentations,
  movePresentation,
} from "../presentation";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
} from "../presentation/presentationStore";
import {
  __loadFoldersForTests,
  getFolders,
  moveFolder,
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
  __setFolderPusherForTests,
  setFolderSyncEnabled,
} from "../../lib/sync/folderSync";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
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
  });
});
