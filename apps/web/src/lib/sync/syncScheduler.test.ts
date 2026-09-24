import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Presentation } from "@repo/shared";
import {
  scheduleDocumentPush,
  flushPendingSync,
  setSyncEnabled,
  __resetSyncSchedulerForTests,
  __setPusherForTests,
} from "./syncScheduler";
import { getSyncStatus, __resetSyncStatusForTests } from "./syncStatus";
import { OfflineError } from "./presentationSync";
import {
  scheduleFolderPush,
  setFolderSyncEnabled,
  __resetFolderSyncForTests,
  __setFolderPusherForTests,
} from "./folderSync";

const USER = "00000000-0000-4000-8000-000000000001";

function doc(id: string, title = "세트"): Presentation {
  return {
    id,
    userId: USER,
    title,
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

describe("서버 push 스케줄러", () => {
  let push: ReturnType<typeof vi.fn<(doc: Presentation) => Promise<boolean>>>;

  beforeEach(() => {
    __resetSyncSchedulerForTests();
    __resetSyncStatusForTests();
    push = vi.fn(async () => true);
    __setPusherForTests(push);
    setSyncEnabled(true);
  });

  afterEach(() => {
    __resetSyncSchedulerForTests();
  });

  it("동기화가 꺼져 있으면 아무것도 보내지 않는다", async () => {
    setSyncEnabled(false);

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(push).not.toHaveBeenCalled();
  });

  it("예약한 문서를 flush 시 올린다", async () => {
    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(1);
    expect(getSyncStatus()).toBe("synced");
  });

  it("같은 문서를 연달아 고치면 한 번만 올린다 (디바운스)", async () => {
    scheduleDocumentPush(doc("a", "1"));
    scheduleDocumentPush(doc("a", "2"));
    scheduleDocumentPush(doc("a", "3"));
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(1);
    // 마지막 값이 올라가야 한다
    expect(push.mock.calls[0][0].title).toBe("3");
  });

  it("비활성 문서 변경도 큐에 남는다", async () => {
    // 기존 IndexedDB 스케줄러는 activeId만 넣는다. 그 제약을 물려받으면
    // 비활성 문서 변경이 영영 안 올라간다.
    scheduleDocumentPush(doc("a"));
    scheduleDocumentPush(doc("b"));
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(2);
    const ids = push.mock.calls.map((c) => c[0].id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("id가 없는 자리표시자 문서는 올리지 않는다", async () => {
    scheduleDocumentPush(doc(""));
    await flushPendingSync();

    expect(push).not.toHaveBeenCalled();
  });

  it("오프라인이면 상태만 offline로 두고 큐에 되돌린다", async () => {
    push.mockRejectedValue(new OfflineError());

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(getSyncStatus()).toBe("offline");

    // 다시 온라인이 되면 그대로 올라가야 한다
    push.mockResolvedValue(true);
    await flushPendingSync();
    expect(getSyncStatus()).toBe("synced");
  });

  it("서버가 거절하면 error로 표시한다", async () => {
    push.mockRejectedValue(new Error("403"));

    scheduleDocumentPush(doc("a"));
    await flushPendingSync();

    expect(getSyncStatus()).toBe("error");
  });

  it("빈 큐를 flush해도 상태를 건드리지 않는다", async () => {
    await flushPendingSync();
    expect(getSyncStatus()).toBe("idle");
  });

  it("새 폴더를 세트보다 먼저 올린다 (폴더 큐를 먼저 비운다)", async () => {
    __resetFolderSyncForTests();
    const order: string[] = [];
    __setFolderPusherForTests(async (folder) => {
      order.push(`folder:${folder.id}`);
      return folder;
    });
    push.mockImplementation(async (document) => {
      order.push(`doc:${document.id}`);
      return true;
    });
    setFolderSyncEnabled(true);

    scheduleFolderPush({
      id: "f0000000-0000-4000-8000-000000000001",
      userId: USER,
      parentId: null,
      name: "새 폴더",
      trashedAt: null,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    scheduleDocumentPush({
      ...doc("a"),
      folderId: "f0000000-0000-4000-8000-000000000001",
    });
    await flushPendingSync();

    expect(order).toEqual([
      "folder:f0000000-0000-4000-8000-000000000001",
      "doc:a",
    ]);
    __resetFolderSyncForTests();
  });
});
