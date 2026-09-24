import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Folder } from "@repo/shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  SEED_PRESENTATIONS,
  SEED_USER_ID,
  __loadDocumentsForTests,
  getPresentationById,
  listPresentations,
  resetPresentationStore,
} from "../presentation";
import {
  __loadFoldersForTests,
  getFolders,
  resetFolderStore,
} from "./folderStore";
import {
  deleteItemsForever,
  DriveActionError,
  moveItems,
  undoMove,
} from "./driveActions";

const sync = vi.hoisted(() => ({
  flushPendingSync: vi.fn(async () => {}),
  deleteFolderRemote: vi.fn<
    (id: string) => Promise<{
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

const { OfflineError } = await import("../../lib/sync/presentationSync");

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
    vi.clearAllMocks();
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
      expect(outcome.errors).toEqual(["폴더를 자기 안으로 옮길 수 없습니다"]);
    });
  });

  describe("deleteItemsForever", () => {
    it("폴더를 서버에서 지운 뒤 하위 폴더·세트를 로컬에서도 지운다", async () => {
      sync.deleteFolderRemote.mockResolvedValueOnce({
        ok: true,
        deletedFolderIds: [ROOT, CHILD],
        deletedPresentationIds: [SEED_PRESENTATIONS[0].id],
      });

      await deleteItemsForever([{ kind: "folder", id: ROOT }]);

      expect(sync.flushPendingSync).toHaveBeenCalled();
      expect(sync.deleteFolderRemote).toHaveBeenCalledWith(ROOT);
      expect(getFolders().map((f) => f.id)).toEqual([OTHER]);
      expect(listPresentations().map((p) => p.id)).toEqual([
        SEED_PRESENTATIONS[1].id,
        SEED_PRESENTATIONS[2].id,
      ]);
    });

    it("서버가 폴더 소속으로 몰랐던 로컬 세트도 서버에서 지운다", async () => {
      await deleteItemsForever([{ kind: "folder", id: ROOT }]);

      expect(sync.deletePresentationRemote).toHaveBeenCalledWith(
        SEED_PRESENTATIONS[0].id,
      );
      expect(getPresentationById(SEED_PRESENTATIONS[0].id)).toBeUndefined();
    });

    it("오프라인이면 아무것도 지우지 않고 이유를 알린다", async () => {
      sync.deletePresentationRemote.mockRejectedValueOnce(new OfflineError());
      const target = SEED_PRESENTATIONS[2].id;

      const error = await deleteItemsForever([
        { kind: "file", id: target },
      ]).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(DriveActionError);
      expect((error as Error).message).toMatch(/오프라인/);
      expect(getPresentationById(target)).toBeDefined();
    });
  });
});
