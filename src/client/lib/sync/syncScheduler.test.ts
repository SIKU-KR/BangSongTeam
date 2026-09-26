import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Presentation } from "#shared";
import {
  scheduleDocumentPush,
  flushPendingSync,
  setSyncEnabled,
  SYNC_DEBOUNCE_MS,
  SYNC_MAX_WAIT_MS,
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

const USER = "00000000x000000000001";

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
    expect(push.mock.calls[0][0].title).toBe("3");
  });

  it("비활성 문서 변경도 큐에 남는다", async () => {
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
      id: "f00000000000000000001",
      userId: USER,
      parentId: null,
      name: "새 폴더",
      trashedAt: null,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    scheduleDocumentPush({
      ...doc("a"),
      folderId: "f00000000000000000001",
    });
    await flushPendingSync();

    expect(order).toEqual(["folder:f00000000000000000001", "doc:a"]);
    __resetFolderSyncForTests();
  });

  describe("타이머", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("입력이 멈추면 디바운스 뒤에 올린다", async () => {
      scheduleDocumentPush(doc("a"));

      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS - 1);
      expect(push).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(push).toHaveBeenCalledTimes(1);
    });

    it("쉬지 않고 30초 입력해도 최대 대기 시간마다 올린다", async () => {
      for (let elapsed = 0; elapsed < 30_000; elapsed += 500) {
        scheduleDocumentPush(doc("a", String(elapsed)));
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(push.mock.calls.length).toBeGreaterThanOrEqual(
        Math.floor(30_000 / SYNC_MAX_WAIT_MS),
      );
      expect(push.mock.calls[0][0].title).toBe(String(SYNC_MAX_WAIT_MS - 500));
    });

    it("올린 뒤 다시 고치면 최대 대기 시간을 새로 센다", async () => {
      scheduleDocumentPush(doc("a"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
      expect(push).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(SYNC_MAX_WAIT_MS);
      scheduleDocumentPush(doc("a", "2"));
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS - 1);
      expect(push).toHaveBeenCalledTimes(1);
    });
  });

  it("서로 다른 문서는 동시에 올린다", async () => {
    let active = 0;
    let peak = 0;
    push.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return true;
    });

    for (const id of ["a", "b", "c", "d", "e"]) scheduleDocumentPush(doc(id));
    await flushPendingSync();

    expect(push).toHaveBeenCalledTimes(5);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("오프라인으로 되돌릴 때 그 사이 새로 예약한 판을 덮어쓰지 않는다", async () => {
    let release: () => void = () => {};
    push.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          release = () => reject(new OfflineError());
        }),
    );

    scheduleDocumentPush(doc("a", "옛 판"));
    const flushing = flushPendingSync();
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    scheduleDocumentPush(doc("a", "새 판"));
    release();
    await flushing;

    await flushPendingSync();
    expect(push.mock.calls.at(-1)?.[0].title).toBe("새 판");
  });
});
