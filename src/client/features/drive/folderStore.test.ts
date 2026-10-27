import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Folder } from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  closeOfflineDB,
  getOfflineDB,
  OFFLINE_DB_NAME,
} from "../../lib/storage/db";
import { deleteFolders, loadAllFolders, saveFolders } from "../../lib/storage";
import { __resetStorageChannelForTests } from "../../lib/storage/storageChannel";
import { installFakeBroadcastChannel } from "../../test/fakeBroadcastChannel";
import {
  __resetFolderSyncForTests,
  __setFolderPusherForTests,
  flushFolderSync,
  setFolderSyncEnabled,
} from "../../lib/sync/folderSync";
import {
  __loadFoldersForTests,
  applyServerFolder,
  applyServerFolders,
  createFolder,
  flushFolderWrites,
  getFolder,
  getFolders,
  hydrateFoldersFromStorage,
  moveFolder,
  reloadFoldersFromStorage,
  removeFoldersLocally,
  renameFolder,
  resetFolderStore,
  restoreFolder,
  suggestFolderName,
  trashFolder,
} from "./folderStore";
import { FOLDER_COPY } from "#copy/folders";
import { SEED_USER_ID } from "../../test/presentationFixture";

vi.mock("../../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage")>();
  return {
    ...actual,
    loadAllFolders: vi.fn(actual.loadAllFolders),
    saveFolders: vi.fn(actual.saveFolders),
    deleteFolders: vi.fn(actual.deleteFolders),
  };
});

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function folder(id: string, overrides: Partial<Folder> = {}): Folder {
  return {
    id,
    userId: SEED_USER_ID,
    parentId: null,
    name: id,
    trashedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("folderStore", () => {
  beforeEach(async () => {
    await resetDatabase();
    signInAsTestUser();
    resetFolderStore();
    __resetFolderSyncForTests();
  });

  afterEach(async () => {
    await flushFolderWrites();
    __resetFolderSyncForTests();
    closeOfflineDB();
  });

  describe("createFolder", () => {
    it("세션 사용자의 폴더를 만들고 같은 위치의 이름이 겹치면 번호를 붙인다", () => {
      const a = createFolder(null);
      const b = createFolder(null);
      const c = createFolder(null, "  청년부 ");

      expect(a.userId).toBe(SEED_USER_ID);
      expect(a.name).toBe(FOLDER_COPY.newFolder);
      expect(b.name).toBe("새 폴더 (2)");
      expect(c.name).toBe("청년부");
    });

    it("다른 위치나 휴지통의 같은 이름은 겹침으로 보지 않는다", () => {
      const parent = createFolder(null, "부모");
      createFolder(null, "주일");
      expect(createFolder(parent.id, "주일").name).toBe("주일");

      const trashed = createFolder(null, "기도회");
      trashFolder(trashed.id);
      expect(createFolder(null, "기도회").name).toBe("기도회");
    });

    it("휴지통에 있는 부모 아래에는 만들지 않고 루트에 만든다", () => {
      const parent = createFolder(null, "부모");
      trashFolder(parent.id);
      expect(createFolder(parent.id, "자식").parentId).toBeNull();
    });
  });

  describe("suggestFolderName", () => {
    it("같은 위치에서 겹치지 않는 기본 이름을 고르고 다른 위치는 따로 센다", () => {
      const parent = createFolder(null, "부모");
      expect(suggestFolderName(null)).toBe(FOLDER_COPY.newFolder);

      createFolder(null);
      createFolder(null);
      expect(suggestFolderName(null)).toBe("새 폴더 (3)");
      expect(suggestFolderName(parent.id)).toBe(FOLDER_COPY.newFolder);
    });
  });

  describe("renameFolder", () => {
    it("빈 이름·같은 위치 중복은 거절한다", () => {
      const a = createFolder(null, "A");
      createFolder(null, "B");

      expect(renameFolder(a.id, "   ")).toEqual({
        ok: false,
        error: FOLDER_COPY.nameRequired,
      });
      expect(renameFolder(a.id, "b")).toEqual({
        ok: false,
        error: FOLDER_COPY.nameTaken,
      });
      const result = renameFolder(a.id, " 새 이름 ");
      expect(result.ok && result.folder.name).toBe("새 이름");
      expect(getFolder(a.id)?.name).toBe("새 이름");
    });

    it("자기 이름으로 바꾸는 것은 중복이 아니다 (대소문자만 바꾸기)", () => {
      const a = createFolder(null, "youth");
      const result = renameFolder(a.id, "Youth");
      expect(result.ok).toBe(true);
      expect(getFolder(a.id)?.name).toBe("Youth");
    });
  });

  describe("moveFolder", () => {
    it("다른 폴더로 옮기고, 같은 이름이 있으면 번호를 붙인다", () => {
      const target = createFolder(null, "보관");
      createFolder(target.id, "주일");
      const moving = createFolder(null, "주일");

      const result = moveFolder(moving.id, target.id);
      expect(result.ok).toBe(true);
      expect(getFolder(moving.id)).toMatchObject({
        parentId: target.id,
        name: "주일 (2)",
      });
    });

    it("자기 자신이나 하위 폴더로는 옮기지 못한다", () => {
      const a = createFolder(null, "a");
      const b = createFolder(a.id, "b");

      expect(moveFolder(a.id, a.id).ok).toBe(false);
      expect(moveFolder(a.id, b.id)).toEqual({
        ok: false,
        error: FOLDER_COPY.cannotMoveIntoSelf,
      });
      expect(getFolder(a.id)?.parentId).toBeNull();
    });

    it("휴지통에 있는 폴더로는 옮기지 못한다", () => {
      const a = createFolder(null, "a");
      const trash = createFolder(null, "t");
      trashFolder(trash.id);
      expect(moveFolder(a.id, trash.id).ok).toBe(false);
    });
  });

  describe("휴지통", () => {
    it("복원하면 원래 자리로, 부모가 휴지통에 있으면 루트로 돌아간다", () => {
      const parent = createFolder(null, "부모");
      const child = createFolder(parent.id, "자식");

      trashFolder(child.id);
      restoreFolder(child.id);
      expect(getFolder(child.id)).toMatchObject({
        parentId: parent.id,
        trashedAt: null,
      });

      trashFolder(child.id);
      trashFolder(parent.id);
      restoreFolder(child.id);
      expect(getFolder(child.id)?.parentId).toBeNull();
    });

    it("복원한 곳에 같은 이름이 생겼으면 번호를 붙인다", () => {
      const old = createFolder(null, "주일");
      trashFolder(old.id);
      createFolder(null, "주일");
      restoreFolder(old.id);
      expect(getFolder(old.id)?.name).toBe("주일 (2)");
    });
  });

  describe("수정 시각", () => {
    const NOW = "2026-09-25T00:00:00.000Z";
    const SEEN = "2026-09-25T00:02:00.000Z";
    const AFTER_SEEN = "2026-09-25T00:02:00.001Z";

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(NOW));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("시계가 본 판보다 늦어도 이름 바꾸기·이동·휴지통·복원은 본 판보다 1ms 뒤로 찍는다", () => {
      __loadFoldersForTests([
        folder("renamed", { updatedAt: SEEN }),
        folder("moved", { updatedAt: SEEN }),
        folder("target"),
        folder("trashed", { updatedAt: SEEN }),
        folder("restored", { trashedAt: SEEN, updatedAt: SEEN }),
      ]);

      renameFolder("renamed", "새 이름");
      moveFolder("moved", "target");
      trashFolder("trashed");
      restoreFolder("restored");

      expect(getFolder("renamed")?.updatedAt).toBe(AFTER_SEEN);
      expect(getFolder("moved")?.updatedAt).toBe(AFTER_SEEN);
      expect(getFolder("trashed")).toMatchObject({
        trashedAt: NOW,
        updatedAt: AFTER_SEEN,
      });
      expect(getFolder("restored")).toMatchObject({
        trashedAt: null,
        updatedAt: AFTER_SEEN,
      });
    });

    it("본 판이 지금보다 앞서지 않으면 지금으로 찍는다", () => {
      __loadFoldersForTests([folder("x")]);

      renameFolder("x", "새 이름");

      expect(getFolder("x")?.updatedAt).toBe(NOW);
    });
  });

  describe("영속성·동기화", () => {
    it("저장소에 쓰고, 다시 부팅하면 세션 사용자의 폴더만 싣는다", async () => {
      const mine = createFolder(null, "내 폴더");
      await flushFolderWrites();

      resetFolderStore();
      await hydrateFoldersFromStorage();
      expect(getFolders()).toEqual([mine]);

      signInAsTestUser("999999999999999999999");
      await hydrateFoldersFromStorage();
      expect(getFolders()).toEqual([]);
    });

    it("변경을 서버 push 큐에 넣는다", async () => {
      const pushed: Folder[] = [];
      __setFolderPusherForTests(async (f) => {
        pushed.push(f);
        return f;
      });
      setFolderSyncEnabled(true);

      const a = createFolder(null, "a");
      renameFolder(a.id, "b");
      await flushFolderSync();

      expect(pushed.map((f) => f.name)).toEqual(["b"]);
    });

    it("서버 확정본(부모 보정)을 반영하되, 더 새로운 로컬 변경은 덮지 않는다", () => {
      __loadFoldersForTests([
        folder("x", { parentId: "y", updatedAt: "2026-09-21T00:00:00.000Z" }),
        folder("y"),
      ]);

      applyServerFolder(
        folder("x", { parentId: null, updatedAt: "2026-09-21T00:00:00.000Z" }),
      );
      expect(getFolder("x")?.parentId).toBeNull();

      __loadFoldersForTests([
        folder("x", { name: "새 이름", updatedAt: "2026-09-22T00:00:00.000Z" }),
      ]);
      applyServerFolder(
        folder("x", { name: "옛 이름", updatedAt: "2026-09-21T00:00:00.000Z" }),
      );
      expect(getFolder("x")?.name).toBe("새 이름");
    });

    it("필드가 같고 시각만 다른 서버 확정본(서버가 줄인 시각)은 그 시각을 따르고 저장한다", async () => {
      const id = "a0000000000000000000d";
      __loadFoldersForTests([
        folder(id, {
          name: "주일",
          createdAt: "2026-09-25T00:20:00.000Z",
          updatedAt: "2026-09-25T00:20:00.000Z",
        }),
      ]);
      const clamped = folder(id, {
        name: "주일",
        createdAt: "2026-09-25T00:05:00.000Z",
        updatedAt: "2026-09-25T00:05:00.000Z",
      });

      applyServerFolder(clamped);
      await flushFolderWrites();

      expect(getFolder(id)).toEqual(clamped);
      resetFolderStore();
      await hydrateFoldersFromStorage();
      expect(getFolder(id)).toEqual(clamped);
    });

    it("기기 시계보다 한참 앞선 로컬 폴더는 필드가 달라도 서버 확정본을 따른다", () => {
      __loadFoldersForTests([
        folder("x", { name: "미래", updatedAt: "9999-12-31T00:00:00.000Z" }),
      ]);
      const server = folder("x", {
        name: "서버",
        updatedAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });

      applyServerFolder(server);

      expect(getFolder("x")).toEqual(server);
    });

    it("병합 결과로 교체하고 영구 삭제된 폴더는 저장본에서도 지운다", async () => {
      createFolder(null, "gone");
      await flushFolderWrites();
      const goneId = getFolders()[0].id;

      const kept = "a0000000000000000000c";
      await applyServerFolders([folder(kept)], [goneId]);
      expect(getFolders().map((f) => f.id)).toEqual([kept]);

      resetFolderStore();
      await hydrateFoldersFromStorage();
      expect(getFolders().map((f) => f.id)).toEqual([kept]);
    });

    it("removeFoldersLocally는 메모리와 저장본에서 지운다", async () => {
      const a = createFolder(null, "a");
      await flushFolderWrites();
      await removeFoldersLocally([a.id]);

      expect(getFolders()).toEqual([]);
      resetFolderStore();
      await hydrateFoldersFromStorage();
      expect(getFolders()).toEqual([]);
    });

    it("병합에서 영구 삭제된 폴더의 대기 중인 push를 버린다", async () => {
      const pushed: Folder[] = [];
      __setFolderPusherForTests(async (f) => {
        pushed.push(f);
        return f;
      });
      setFolderSyncEnabled(true);
      const kept = createFolder(null, "남길 폴더");
      const gone = createFolder(null, "지울 폴더");

      await applyServerFolders([kept], [gone.id]);
      await flushFolderSync();

      expect(pushed.map((f) => f.id)).toEqual([kept.id]);
    });

    it("폴더 저장본을 읽지 못했으면 applyServerFolders가 저장소에 쓰지 않는다", async () => {
      const unreadable = createFolder(null, "읽지 못한 폴더");
      await flushFolderWrites();
      vi.mocked(loadAllFolders).mockRejectedValueOnce(new Error("읽기 실패"));
      await hydrateFoldersFromStorage();
      vi.mocked(saveFolders).mockClear();
      vi.mocked(deleteFolders).mockClear();

      const kept = "a0000000000000000000c";
      await applyServerFolders([folder(kept)], [unreadable.id]);
      await flushFolderWrites();

      expect(getFolders().map((f) => f.id)).toEqual([kept]);
      expect(saveFolders).not.toHaveBeenCalled();
      expect(deleteFolders).not.toHaveBeenCalled();
      const { valid } = await loadAllFolders();
      expect(valid.map((f) => f.id)).toEqual([unreadable.id]);
    });

    it("폴더 저장본을 다시 읽으면 병합 결과를 다시 저장한다", async () => {
      vi.mocked(loadAllFolders).mockRejectedValueOnce(new Error("읽기 실패"));
      await hydrateFoldersFromStorage();
      await hydrateFoldersFromStorage();

      const kept = "a0000000000000000000c";
      await applyServerFolders([folder(kept)]);

      resetFolderStore();
      await hydrateFoldersFromStorage();
      expect(getFolders().map((f) => f.id)).toEqual([kept]);
    });

    it("병합 결과 중 바뀐 폴더와 지운 폴더만 저장소에 쓴다", async () => {
      const same = folder("a00000000000000000001");
      const changed = folder("a00000000000000000002");
      const removed = folder("a00000000000000000003");
      __loadFoldersForTests([same, changed, removed]);
      vi.mocked(saveFolders).mockClear();
      vi.mocked(deleteFolders).mockClear();

      const newer = folder(changed.id, {
        name: "서버에서 바꾼 이름",
        updatedAt: "2026-09-25T00:00:00.000Z",
      });
      const added = folder("a00000000000000000004");
      await applyServerFolders([{ ...same }, newer, added], [removed.id]);

      expect(saveFolders).toHaveBeenCalledExactlyOnceWith([newer, added]);
      expect(deleteFolders).toHaveBeenCalledExactlyOnceWith([removed.id]);
    });

    it("병합 결과가 지금 폴더와 같으면 저장소에 쓰지 않는다", async () => {
      const same = folder("a00000000000000000001");
      __loadFoldersForTests([same]);
      vi.mocked(saveFolders).mockClear();
      vi.mocked(deleteFolders).mockClear();

      await applyServerFolders([{ ...same }]);

      expect(saveFolders).not.toHaveBeenCalled();
      expect(deleteFolders).not.toHaveBeenCalled();
    });
  });

  describe("다른 탭이 쓴 저장본 다시 읽기", () => {
    async function writeFromOtherTab(record: unknown): Promise<void> {
      const db = await getOfflineDB();
      await db.put("folders", record as Folder);
    }

    async function deleteFromOtherTab(id: string): Promise<void> {
      const db = await getOfflineDB();
      await db.delete("folders", id);
    }

    it("다른 탭이 고친 폴더와 만든 폴더를 따르고, 지운 폴더는 빼고 대기 중인 push를 버린다", async () => {
      const pushed: Folder[] = [];
      __setFolderPusherForTests(async (f) => {
        pushed.push(f);
        return f;
      });
      setFolderSyncEnabled(true);
      const renamed = createFolder(null, "이름을 바꿀 폴더");
      const removed = createFolder(null, "지울 폴더");
      await flushFolderWrites();
      const otherName = {
        ...renamed,
        name: "다른 탭에서 바꾼 이름",
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      };
      const created = folder("a0000000000000000000e", {
        name: "다른 탭에서 만든 폴더",
      });
      await writeFromOtherTab(otherName);
      await writeFromOtherTab(created);
      await deleteFromOtherTab(removed.id);

      await reloadFoldersFromStorage([renamed.id, created.id, removed.id]);
      await flushFolderSync();

      expect(getFolder(renamed.id)).toEqual(otherName);
      expect(getFolder(created.id)).toEqual(created);
      expect(getFolder(removed.id)).toBeUndefined();
      expect(pushed.map((f) => f.id)).not.toContain(removed.id);
    });

    it("이 탭이 아직 저장하지 않은 폴더는 다른 탭의 저장본으로 바꾸지 않는다", async () => {
      const mine = createFolder(null, "이 탭의 폴더");
      await flushFolderWrites();
      await writeFromOtherTab({ ...mine, name: "다른 탭에서 바꾼 이름" });

      renameFolder(mine.id, "이 탭에서 바꾼 이름");
      await reloadFoldersFromStorage([mine.id]);

      expect(getFolder(mine.id)?.name).toBe("이 탭에서 바꾼 이름");
    });

    it("읽는 동안 이 탭에서 고친 폴더는 읽은 저장본으로 바꾸지 않는다", async () => {
      const mine = createFolder(null, "이 탭의 폴더");
      await flushFolderWrites();
      await writeFromOtherTab({ ...mine, name: "다른 탭에서 바꾼 이름" });

      const reloading = reloadFoldersFromStorage([mine.id]);
      renameFolder(mine.id, "읽는 동안 바꾼 이름");
      await reloading;

      expect(getFolder(mine.id)?.name).toBe("읽는 동안 바꾼 이름");
    });

    it("읽지 못한 저장본과 다른 계정의 폴더는 그대로 둔다", async () => {
      const mine = createFolder(null, "이 탭의 폴더");
      await flushFolderWrites();
      await writeFromOtherTab({ id: mine.id, name: "" });
      const foreign = folder("a0000000000000000000f", {
        userId: "999999999999999999999",
      });
      await writeFromOtherTab(foreign);

      await reloadFoldersFromStorage([mine.id, foreign.id]);

      expect(getFolder(mine.id)).toEqual(mine);
      expect(getFolder(foreign.id)).toBeUndefined();
    });

    it("다시 읽기는 저장소에 쓰지 않는다", async () => {
      const mine = createFolder(null, "이 탭의 폴더");
      await flushFolderWrites();
      await writeFromOtherTab({ ...mine, name: "다른 탭에서 바꾼 이름" });
      vi.mocked(saveFolders).mockClear();
      vi.mocked(deleteFolders).mockClear();

      await reloadFoldersFromStorage([mine.id]);
      await flushFolderWrites();

      expect(saveFolders).not.toHaveBeenCalled();
      expect(deleteFolders).not.toHaveBeenCalled();
      const { valid } = await loadAllFolders();
      expect(valid.find((f) => f.id === mine.id)?.name).toBe(
        "다른 탭에서 바꾼 이름",
      );
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

    it("폴더를 저장소에 쓰거나 지운 뒤에 그 id를 알린다", async () => {
      const other = tabs.otherTab("chiton:storage");

      const created = createFolder(null, "새 폴더");
      await flushFolderWrites();
      await removeFoldersLocally([created.id]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const change = {
        v: 1,
        userId: SEED_USER_ID,
        kind: "folders",
        ids: [created.id],
      };
      expect(other.received).toEqual([change, change]);
      other.close();
    });
  });
});
