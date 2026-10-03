import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Folder } from "#shared";
import {
  scheduleFolderPush,
  flushFolderSync,
  setFolderSyncEnabled,
  setServerFolderListener,
  __setFolderPusherForTests,
  __resetFolderSyncForTests,
} from "./folderSync";
import { OfflineError, TimeoutError } from "../api/request";
import { installFakeApi } from "../../test/fakeApi";
import { getSyncSnapshot, __resetSyncStatusForTests } from "./syncStatus";

const USER = "000000000000000000001";
const PARENT = "a00000000000000000001";
const CHILD = "b00000000000000000002";
const GRANDCHILD = "c00000000000000000003";

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
    expect(getSyncSnapshot().status).toBe("synced");
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
    expect(getSyncSnapshot().status).toBe("offline");

    await flushFolderSync();
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("멈춘 요청으로 인해 타임아웃(TimeoutError)이 발생해도 syncing에 머물지 않고 offline으로 바뀐 뒤 재시도된다", async () => {
    push.mockRejectedValueOnce(new TimeoutError());
    scheduleFolderPush(folder(PARENT, null));
    await flushFolderSync();
    expect(getSyncSnapshot().status).toBe("offline");

    await flushFolderSync();
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("서버가 응답하지 않고 멈춘 경우 데드라인 뒤 offline 상태로 전환되고 재연결 시 정상 동기화된다", async () => {
    vi.useFakeTimers();
    __setFolderPusherForTests(null);

    const waiter: { resolve?: () => void } = {};
    let shouldResolve = false;
    const fake = installFakeApi({
      "PUT /api/folders/*": () =>
        new Promise((resolve) => {
          if (shouldResolve) {
            resolve({
              status: 200,
              body: { folder: folder(PARENT, null) },
            });
            return;
          }
          waiter.resolve = () => {
            shouldResolve = true;
            resolve({
              status: 200,
              body: { folder: folder(PARENT, null) },
            });
          };
        }),
    });

    scheduleFolderPush(folder(PARENT, null));
    const flushPromise = flushFolderSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(getSyncSnapshot().status).toBe("syncing");

    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromise;

    expect(getSyncSnapshot().status).toBe("offline");

    shouldResolve = true;
    waiter.resolve?.();
    const nextFlush = flushFolderSync();
    await vi.advanceTimersByTimeAsync(0);
    await nextFlush;

    expect(getSyncSnapshot().status).toBe("synced");

    fake.restore();
    vi.useRealTimers();
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
