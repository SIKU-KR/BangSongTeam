import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Folder } from "@repo/shared";
import {
  scheduleFolderPush,
  flushFolderSync,
  setFolderSyncEnabled,
  setServerFolderListener,
  __setFolderPusherForTests,
  __resetFolderSyncForTests,
} from "./folderSync";
import { OfflineError } from "./presentationSync";
import { getSyncStatus, __resetSyncStatusForTests } from "./syncStatus";

const USER = "00000000-0000-4000-8000-000000000001";
const PARENT = "a0000000-0000-4000-8000-000000000001";
const CHILD = "b0000000-0000-4000-8000-000000000002";
const GRANDCHILD = "c0000000-0000-4000-8000-000000000003";

function folder(id: string, parentId: string | null, name = "폴더"): Folder {
  return {
    id,
    userId: USER,
    parentId,
    name,
    trashedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };
}

describe("폴더 push 큐", () => {
  let push: ReturnType<typeof vi.fn<(folder: Folder) => Promise<Folder>>>;

  beforeEach(() => {
    __resetFolderSyncForTests();
    __resetSyncStatusForTests();
    push = vi.fn(async (f: Folder) => f);
    __setFolderPusherForTests(push);
    setFolderSyncEnabled(true);
  });

  afterEach(() => {
    __resetFolderSyncForTests();
  });

  it("꺼져 있으면 아무것도 올리지 않는다", async () => {
    setFolderSyncEnabled(false);
    scheduleFolderPush(folder(PARENT, null));
    await flushFolderSync();
    expect(push).not.toHaveBeenCalled();
  });

  it("같은 폴더를 연달아 고치면 마지막 것만 올린다", async () => {
    scheduleFolderPush(folder(PARENT, null, "1"));
    scheduleFolderPush(folder(PARENT, null, "2"));
    await flushFolderSync();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].name).toBe("2");
    expect(getSyncStatus()).toBe("synced");
  });

  it("부모를 자식보다 먼저 올린다 (예약 순서와 무관)", async () => {
    scheduleFolderPush(folder(GRANDCHILD, CHILD));
    scheduleFolderPush(folder(CHILD, PARENT));
    scheduleFolderPush(folder(PARENT, null));
    await flushFolderSync();
    expect(push.mock.calls.map(([f]) => f.id)).toEqual([
      PARENT,
      CHILD,
      GRANDCHILD,
    ]);
  });

  it("서버 확정본을 리스너에 넘긴다", async () => {
    const listener = vi.fn();
    setServerFolderListener(listener);
    push.mockImplementation(async (f) => ({ ...f, parentId: null }));

    scheduleFolderPush(folder(CHILD, PARENT));
    await flushFolderSync();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHILD, parentId: null }),
    );
  });

  it("오프라인이면 다시 큐에 넣고, 온라인이 되면 올린다", async () => {
    push.mockRejectedValueOnce(new OfflineError());
    scheduleFolderPush(folder(PARENT, null));
    await flushFolderSync();
    expect(getSyncStatus()).toBe("offline");

    await flushFolderSync();
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncStatus()).toBe("synced");
  });

  it("오프라인 재큐잉이 그사이 예약된 더 새로운 변경을 덮지 않는다", async () => {
    push.mockImplementationOnce(async () => {
      scheduleFolderPush(folder(PARENT, null, "새 이름"));
      throw new OfflineError();
    });
    scheduleFolderPush(folder(PARENT, null, "옛 이름"));
    await flushFolderSync();
    await flushFolderSync();
    expect(push.mock.calls.at(-1)?.[0].name).toBe("새 이름");
  });
});
