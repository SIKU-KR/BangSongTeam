import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Folder } from "@repo/shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_USER_ID } from "../presentation";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../../lib/storage";
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
  removeFoldersLocally,
  renameFolder,
  resetFolderStore,
  restoreFolder,
  trashFolder,
} from "./folderStore";

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
    // 앞 테스트의 저장이 다음 테스트의 새 DB에 떨어지지 않게 끝까지 기다린다
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
      expect(a.name).toBe("새 폴더");
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

  describe("renameFolder", () => {
    it("빈 이름·같은 위치 중복은 거절한다", () => {
      const a = createFolder(null, "A");
      createFolder(null, "B");

      expect(renameFolder(a.id, "   ")).toEqual({
        ok: false,
        error: "이름을 입력하세요",
      });
      expect(renameFolder(a.id, "b")).toEqual({
        ok: false,
        error: "같은 위치에 같은 이름의 폴더가 있습니다",
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
        error: "폴더를 자기 안으로 옮길 수 없습니다",
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
  });
});
