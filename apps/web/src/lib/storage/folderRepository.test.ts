import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Folder } from "@repo/shared";
import { getOfflineDB, closeOfflineDB, OFFLINE_DB_NAME } from "./db";
import {
  saveFolder,
  saveFolders,
  loadAllFolders,
  deleteFolders,
  clearAllFolders,
} from "./folderRepository";

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId: "00000000-0000-4000-8000-000000000001",
    parentId: null,
    name: "2026 주일",
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
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

describe("folderRepository", () => {
  beforeEach(resetDatabase);
  afterEach(closeOfflineDB);

  it("저장한 폴더를 그대로 다시 읽는다", async () => {
    const parent = makeFolder({ name: "부모" });
    const child = makeFolder({ name: "자식", parentId: parent.id });
    await saveFolder(parent);
    await saveFolders([child]);

    const { valid, corrupted } = await loadAllFolders();
    expect(corrupted).toHaveLength(0);
    expect(valid).toHaveLength(2);
    expect(valid).toEqual(expect.arrayContaining([parent, child]));
  });

  it("같은 id로 다시 저장하면 덮어쓴다", async () => {
    const folder = makeFolder();
    await saveFolder(folder);
    await saveFolder({ ...folder, name: "이름 바꿈" });

    const { valid } = await loadAllFolders();
    expect(valid).toEqual([{ ...folder, name: "이름 바꿈" }]);
  });

  it("스키마를 어긴 레코드는 격리하고 나머지는 살린다", async () => {
    const good = makeFolder();
    await saveFolder(good);
    const db = await getOfflineDB();
    await db.put("folders", { id: "broken", name: "" } as unknown as Folder);

    const { valid, corrupted } = await loadAllFolders();
    expect(valid).toEqual([good]);
    expect(corrupted.map((record) => record.id)).toEqual(["broken"]);
  });

  it("여러 건을 지우고 전체를 비운다", async () => {
    const a = makeFolder();
    const b = makeFolder();
    const c = makeFolder();
    await saveFolders([a, b, c]);

    await deleteFolders([a.id, b.id]);
    expect((await loadAllFolders()).valid).toEqual([c]);

    await clearAllFolders();
    expect((await loadAllFolders()).valid).toEqual([]);
  });
});
