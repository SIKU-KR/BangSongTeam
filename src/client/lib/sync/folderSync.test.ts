import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Folder } from "#shared";
import {
  scheduleFolderPush,
  flushFolderSync,
  setFolderSyncEnabled,
  setServerFolderListener,
  __setFolderPusherForTests,
  __setFolderBackoffRandomForTests,
  __resetFolderSyncForTests,
} from "./folderSync";
import { OfflineError, ServerRejectedError } from "../api/request";
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

  it("503 응답 시 백오프 타이머로 자동 재시도하고 성공 시 synced로 복구된다", async () => {
    push
      .mockRejectedValueOnce(
        new ServerRejectedError(503, "Service Unavailable"),
      )
      .mockResolvedValueOnce(folder(PARENT, null));

    __setFolderBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleFolderPush(folder(PARENT, null));
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().status).toBe("offline");

    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("영구 실패(400) 시 재시도하지 않고 error 상태와 실패 정보를 남긴다", async () => {
    push.mockRejectedValue(new ServerRejectedError(400, "잘못된 폴더"));

    scheduleFolderPush(folder(PARENT, null, "불량 폴더"));
    await flushFolderSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: PARENT,
      title: "불량 폴더",
      kind: "folder",
      status: 400,
    });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(push).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("동시에 여러 폴더가 실패해도 각 폴더의 백오프 attempt는 독립적으로 계산된다", async () => {
    push.mockRejectedValue(
      new ServerRejectedError(503, "Service Unavailable"),
    );

    __setFolderBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleFolderPush(folder(PARENT, null, "부모"));
    scheduleFolderPush(folder(CHILD, PARENT, "자식"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(2);

    push.mockImplementation(async (f) => f);
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(4);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("재시도 한도(MAX_RETRY_ATTEMPTS)를 초과하면 재시도를 중단하고 error 상태가 된다", async () => {
    push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
    __setFolderBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleFolderPush(folder(PARENT, null));
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(push).toHaveBeenCalledTimes(11);
    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: PARENT,
      kind: "folder",
      status: 503,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(push).toHaveBeenCalledTimes(11);

    vi.useRealTimers();
  });
});
