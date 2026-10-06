import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
  type Folder,
} from "#shared";
import {
  scheduleFolderPush,
  flushFolderSync,
  setFolderSyncEnabled,
  setServerFolderListener,
  __setFolderPusherForTests,
  __setFolderBackoffRandomForTests,
  __resetFolderSyncForTests,
} from "./folderSync";
import {
  OfflineError,
  ServerRejectedError,
  TimeoutError,
} from "../api/request";
import { installFakeApi } from "../../test/fakeApi";
import { getSyncSnapshot, resetSyncStatus } from "./syncStatus";
import {
  scheduleDeckPush,
  flushDeckSync,
  setDeckSyncEnabled,
  __setDeckTransportForTests,
  __resetDeckSyncForTests,
} from "./deckSync";

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

function libraryDeck(): Deck {
  return DeckSchema.parse({
    id: "c0000000000000000000a",
    userId: USER,
    scope: "library",
    title: "은혜로다",
    lyricsRaw: "가사",
    slides: [],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

describe("폴더 push 큐", () => {
  let push: ReturnType<typeof vi.fn<(folder: Folder) => Promise<Folder>>>;

  beforeEach(() => {
    __resetFolderSyncForTests();
    resetSyncStatus();
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
    push.mockRejectedValue(new ServerRejectedError(503, "Service Unavailable"));

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

  it("오프라인(OfflineError)은 10회를 초과해도 재시도를 포기하지 않고 큐에 유지된다", async () => {
    push.mockRejectedValue(new OfflineError());
    __setFolderBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleFolderPush(folder(PARENT, null));
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(push.mock.calls.length).toBeGreaterThanOrEqual(15);
    expect(getSyncSnapshot().status).toBe("offline");

    push.mockImplementation(async (f) => f);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  describe("다른 큐와 함께", () => {
    beforeEach(() => {
      __resetDeckSyncForTests();
      __setDeckTransportForTests({ push: async (deck) => deck });
      setDeckSyncEnabled(true);
    });

    afterEach(() => {
      __resetDeckSyncForTests();
    });

    it("폴더가 영구 실패한 뒤 곡 동기화가 성공해도 동기화 실패로 남는다", async () => {
      push.mockRejectedValue(new ServerRejectedError(400, "잘못된 폴더"));
      scheduleFolderPush(folder(PARENT, null));
      await flushFolderSync();

      scheduleDeckPush(libraryDeck());
      await flushDeckSync();

      expect(getSyncSnapshot().status).toBe("error");
      expect(getSyncSnapshot().lastFailure).toMatchObject({
        id: PARENT,
        kind: "folder",
      });
    });

    it("폴더가 오프라인으로 밀린 뒤 곡 동기화가 성공해도 offline으로 남는다", async () => {
      push.mockRejectedValue(new OfflineError());
      scheduleFolderPush(folder(PARENT, null));
      await flushFolderSync();

      scheduleDeckPush(libraryDeck());
      await flushDeckSync();

      expect(getSyncSnapshot().status).toBe("offline");
    });
  });
});
