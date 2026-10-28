import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  type Deck,
  type Folder,
} from "#shared";
import {
  scheduleFolderPush,
  cancelFolderPush,
  ensureFolderPushed,
  flushFolderSync,
  hasPendingFolderPush,
  isFolderPushPending,
  pushFolderNow,
  retryFolderSyncNow,
  setFailedFolderResolver,
  setFolderGoneListener,
  setFolderPushSettledListener,
  setFolderSyncEnabled,
  setServerFolderListener,
  __setFolderPusherForTests,
  __setFolderBackoffRandomForTests,
  __resetFolderSyncForTests,
} from "./folderSync";
import {
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
  TimeoutError,
} from "../api/request";
import { installFakeApi } from "../../test/fakeApi";
import { isProjecting } from "../../features/presentation/fullscreen";
import { getSyncSnapshot, resetSyncStatus } from "./syncStatus";
import {
  scheduleDeckPush,
  flushDeckSync,
  setDeckSyncEnabled,
  __setDeckTransportForTests,
  __resetDeckSyncForTests,
} from "./deckSync";
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  SLOW_RETRY_MS,
} from "./backoff";

const USER = "000000000000000000001";
const PARENT = "a00000000000000000001";
const CHILD = "b00000000000000000002";
const GRANDCHILD = "c00000000000000000003";
const OTHER_ROOT = "d00000000000000000004";

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

  describe("다른 곳에서 영구 삭제한 폴더(410)", () => {
    const gone = vi.fn<(ids: readonly string[]) => void>();
    const deleted = new ServerRejectedError(410, API_ERRORS.folder.deleted);

    beforeEach(() => {
      gone.mockReset();
      setFolderGoneListener(gone);
    });

    afterEach(() => {
      setFolderGoneListener(null);
    });

    it("큐가 올린 폴더가 410이면 지웠다고 알리고, 실패로 남기거나 다시 올리지 않는다", async () => {
      push.mockImplementation(async (f) => {
        if (f.id === CHILD) throw deleted;
        return f;
      });

      scheduleFolderPush(folder(PARENT, null));
      scheduleFolderPush(folder(CHILD, PARENT));
      await flushFolderSync();

      expect(gone).toHaveBeenCalledExactlyOnceWith([CHILD]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
      expect(hasPendingFolderPush()).toBe(false);

      await retryFolderSyncNow("manual");
      expect(push).toHaveBeenCalledTimes(2);
    });

    it("바로 올린 폴더가 410이면 지웠다고 알리고 null을 돌려준다", async () => {
      push.mockRejectedValueOnce(deleted);

      await expect(pushFolderNow(folder(PARENT, null))).resolves.toBeNull();

      expect(gone).toHaveBeenCalledExactlyOnceWith([PARENT]);
      expect(getSyncSnapshot().lastFailure).toBeNull();
    });
  });

  it("서버가 거절하며 준 문장을 실패 이유로 남긴다", async () => {
    __setFolderPusherForTests(null);
    const fake = installFakeApi({
      "PUT /api/folders/*": () => ({
        status: 403,
        body: { error: API_ERRORS.folder.notAccessible },
      }),
    });

    scheduleFolderPush(folder(PARENT, null, "남의 폴더"));
    await flushFolderSync();
    fake.restore();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: PARENT,
      title: "남의 폴더",
      kind: "folder",
      status: 403,
      reason: API_ERRORS.folder.notAccessible,
    });
  });

  it("서버 응답을 읽지 못한 실패는 개발자용 오류 문구라 실패 이유로 남기지 않는다", async () => {
    __setFolderPusherForTests(null);
    const fake = installFakeApi({
      "PUT /api/folders/*": () => ({
        status: 200,
        body: { folder: { id: PARENT } },
      }),
    });

    scheduleFolderPush(folder(PARENT, null));
    await flushFolderSync();
    fake.restore();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: PARENT,
      kind: "folder",
    });
    expect(getSyncSnapshot().lastFailure?.reason).toBeUndefined();
  });

  it("동시에 여러 폴더가 실패해도 각 폴더의 백오프 attempt는 독립적으로 계산된다", async () => {
    push.mockRejectedValue(new ServerRejectedError(503, "Service Unavailable"));

    __setFolderBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleFolderPush(folder(PARENT, null, "첫 폴더"));
    scheduleFolderPush(folder(OTHER_ROOT, null, "둘째 폴더"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(2);

    push.mockImplementation(async (f) => f);
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(4);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  describe("부모가 아직 서버에 없는 폴더", () => {
    const listener = vi.fn<(saved: Folder) => void>();

    beforeEach(() => {
      listener.mockReset();
      setServerFolderListener(listener);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("부모 push가 일시 실패하면 같은 차례의 자식·손자는 올리지 않고 함께 다시 시도한다", async () => {
      push.mockImplementationOnce(async () => {
        throw new ServerRejectedError(503, API_ERRORS.serverBusy);
      });

      scheduleFolderPush(folder(GRANDCHILD, CHILD));
      scheduleFolderPush(folder(CHILD, PARENT));
      scheduleFolderPush(folder(PARENT, null));
      await flushFolderSync();

      expect(push.mock.calls.map(([f]) => f.id)).toEqual([PARENT]);
      expect(listener).not.toHaveBeenCalled();
      expect(getSyncSnapshot().status).toBe("offline");
      expect(hasPendingFolderPush()).toBe(true);

      await flushFolderSync();

      expect(push.mock.calls.map(([f]) => f.id)).toEqual([
        PARENT,
        PARENT,
        CHILD,
        GRANDCHILD,
      ]);
      expect(push.mock.calls[2][0].parentId).toBe(PARENT);
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("부모 PUT이 나가는 동안 만든 자식은 부모가 실패하면 다음 차례에도 기다린다", async () => {
      __setFolderBackoffRandomForTests(() => 1);
      vi.useFakeTimers();
      let failParent: (err: unknown) => void = () => undefined;
      push.mockImplementationOnce(
        () =>
          new Promise<Folder>((_, reject) => {
            failParent = reject;
          }),
      );

      scheduleFolderPush(folder(PARENT, null));
      await vi.advanceTimersByTimeAsync(2000);
      expect(push).toHaveBeenCalledTimes(1);

      scheduleFolderPush(folder(CHILD, PARENT));
      await vi.advanceTimersByTimeAsync(2000);
      failParent(new ServerRejectedError(503, API_ERRORS.serverBusy));
      await vi.advanceTimersByTimeAsync(0);

      expect(push.mock.calls.map(([f]) => f.id)).toEqual([PARENT]);
      expect(getSyncSnapshot().status).toBe("offline");

      await vi.advanceTimersByTimeAsync(2000);

      expect(push.mock.calls.map(([f]) => f.id)).toEqual([
        PARENT,
        PARENT,
        CHILD,
      ]);
      expect(push.mock.calls[2][0].parentId).toBe(PARENT);
      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: CHILD, parentId: PARENT }),
      );
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("부팅이 바로 올리던 부모가 일시 장애로 실패하면, 그 뒤에 줄 선 자식은 부모가 다시 오른 뒤에 올린다", async () => {
      let failParent: (err: unknown) => void = () => undefined;
      push.mockImplementationOnce(
        () =>
          new Promise<Folder>((_, reject) => {
            failParent = reject;
          }),
      );
      const booting = pushFolderNow(folder(PARENT, null)).catch(() => {
        scheduleFolderPush(folder(PARENT, null));
      });
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      scheduleFolderPush(folder(CHILD, PARENT));
      const queued = flushFolderSync();
      failParent(new ServerRejectedError(503, API_ERRORS.serverBusy));
      await Promise.all([booting, queued]);

      expect(push.mock.calls.map(([f]) => f.id)).toEqual([PARENT]);
      expect(listener).not.toHaveBeenCalled();

      await flushFolderSync();

      expect(push.mock.calls.map(([f]) => f.id)).toEqual([
        PARENT,
        PARENT,
        CHILD,
      ]);
      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: CHILD, parentId: PARENT }),
      );
    });

    it("부모가 영구 실패하면 자식은 기다리지 않고 올린다", async () => {
      push.mockImplementation(async (f) => {
        if (f.id === PARENT) throw new ServerRejectedError(400, "거절");
        return { ...f, parentId: null };
      });

      scheduleFolderPush(folder(PARENT, null));
      scheduleFolderPush(folder(CHILD, PARENT));
      await flushFolderSync();

      expect(push.mock.calls.map(([f]) => f.id)).toEqual([PARENT, CHILD]);
      expect(hasPendingFolderPush()).toBe(false);
    });
  });

  describe("올리는 중인 폴더 (isFolderPushPending)", () => {
    function holdPushOnce(): () => void {
      let release: () => void = () => undefined;
      push.mockImplementationOnce(
        (f) =>
          new Promise<Folder>((resolve) => {
            release = () => resolve(f);
          }),
      );
      return () => release();
    }

    it("기다리는 중, 묶음으로 보내는 중, 바로 올리는 중에 참이고 끝나면 거짓이다", async () => {
      expect(isFolderPushPending(PARENT)).toBe(false);
      expect(isFolderPushPending(null)).toBe(false);

      scheduleFolderPush(folder(PARENT, null));
      expect(isFolderPushPending(PARENT)).toBe(true);

      const releaseBatch = holdPushOnce();
      const flushing = flushFolderSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
      expect(isFolderPushPending(PARENT)).toBe(true);
      releaseBatch();
      await flushing;
      expect(isFolderPushPending(PARENT)).toBe(false);

      const releaseNow = holdPushOnce();
      const pushing = pushFolderNow(folder(CHILD, PARENT));
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2));
      expect(isFolderPushPending(CHILD)).toBe(true);
      expect(hasPendingFolderPush()).toBe(true);
      releaseNow();
      await pushing;
      expect(isFolderPushPending(CHILD)).toBe(false);
      expect(hasPendingFolderPush()).toBe(false);
    });

    it("flushFolderSync는 이미 나간 바로 올리기(pushFolderNow)가 끝날 때까지 기다린다", async () => {
      const releaseNow = holdPushOnce();
      const pushing = pushFolderNow(folder(PARENT, null));
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      let flushed = false;
      const flushing = flushFolderSync().then(() => {
        flushed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(flushed).toBe(false);

      releaseNow();
      await Promise.all([pushing, flushing]);
      expect(flushed).toBe(true);
    });

    it("바로 올리기가 일시 장애로 실패하면 그 오류를 부른 쪽에 던지고, 큐가 그 폴더를 다시 올린다", async () => {
      push.mockRejectedValueOnce(new ServerRejectedError(503, "과부하"));

      await expect(pushFolderNow(folder(PARENT, null))).rejects.toBeInstanceOf(
        ServerRejectedError,
      );
      expect(isFolderPushPending(PARENT)).toBe(true);

      scheduleFolderPush(folder(CHILD, null));
      await flushFolderSync();
      expect(push.mock.calls.map(([f]) => f.id)).toEqual([
        PARENT,
        PARENT,
        CHILD,
      ]);
      expect(hasPendingFolderPush()).toBe(false);
    });

    it("바로 올리기가 영구 실패(400)하면 큐에 다시 넣지 않는다", async () => {
      push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));

      await expect(pushFolderNow(folder(PARENT, null))).rejects.toBeInstanceOf(
        ServerRejectedError,
      );

      expect(isFolderPushPending(PARENT)).toBe(false);
      await flushFolderSync();
      expect(push).toHaveBeenCalledTimes(1);
    });

    it("바로 올리기가 일시 장애로 끝나 알릴 때는 그 폴더를 아직 끝나지 않은 폴더로 센다", async () => {
      push.mockRejectedValueOnce(new ServerRejectedError(503, "과부하"));
      const pendingWhenSettled: boolean[] = [];
      setFolderPushSettledListener(() => {
        pendingWhenSettled.push(isFolderPushPending(PARENT));
      });

      await pushFolderNow(folder(PARENT, null)).catch(() => undefined);

      expect(pendingWhenSettled).toEqual([true]);
    });
  });

  describe("세트가 기다리는 폴더 (ensureFolderPushed)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("기다리는 폴더가 없으면 요청 없이 곧바로 참이다", async () => {
      await expect(ensureFolderPushed(null)).resolves.toBe(true);
      await expect(ensureFolderPushed(PARENT)).resolves.toBe(true);

      expect(push).not.toHaveBeenCalled();
    });

    it("기다리는 폴더는 지금 올리고, 올라가면 참이다", async () => {
      scheduleFolderPush(folder(PARENT, null));

      await expect(ensureFolderPushed(PARENT)).resolves.toBe(true);

      expect(push).toHaveBeenCalledTimes(1);
      expect(isFolderPushPending(PARENT)).toBe(false);
    });

    it("폴더나 기다리는 조상이 서버 거절로 다시 시도를 기다리면 요청 없이 거짓이다", async () => {
      __setFolderBackoffRandomForTests(() => 1);
      vi.useFakeTimers();
      push.mockRejectedValueOnce(
        new ServerRejectedError(503, API_ERRORS.serverBusy, 30_000),
      );
      scheduleFolderPush(folder(PARENT, null));
      await vi.advanceTimersByTimeAsync(2000);
      expect(push).toHaveBeenCalledTimes(1);
      scheduleFolderPush(folder(CHILD, PARENT));

      await expect(ensureFolderPushed(PARENT)).resolves.toBe(false);
      await expect(ensureFolderPushed(CHILD)).resolves.toBe(false);

      expect(push).toHaveBeenCalledTimes(1);
    });

    it("부모가 오르기를 기다리느라 미뤄진 폴더는 거짓이다", async () => {
      push.mockImplementationOnce(async () => {
        throw new ServerRejectedError(503, API_ERRORS.serverBusy);
      });
      scheduleFolderPush(folder(PARENT, null));
      scheduleFolderPush(folder(CHILD, PARENT));

      await expect(ensureFolderPushed(CHILD)).resolves.toBe(false);

      expect(push.mock.calls.map(([f]) => f.id)).toEqual([PARENT]);
    });
  });

  describe("폴더 큐가 일을 마칠 때마다 알리기 (setFolderPushSettledListener)", () => {
    const settled = vi.fn<() => void>();

    beforeEach(() => {
      settled.mockReset();
      setFolderPushSettledListener(settled);
    });

    it("묶음과 바로 올리기가 끝나면 등록에서 뺀 뒤에 알린다", async () => {
      let pendingWhenSettled: boolean | null = null;
      settled.mockImplementation(() => {
        pendingWhenSettled = isFolderPushPending(PARENT);
      });

      scheduleFolderPush(folder(PARENT, null));
      await flushFolderSync();
      expect(settled).toHaveBeenCalledTimes(1);
      expect(pendingWhenSettled).toBe(false);

      await pushFolderNow(folder(PARENT, null));
      expect(settled).toHaveBeenCalledTimes(2);
      expect(pendingWhenSettled).toBe(false);
    });

    it("기다리던 폴더를 취소하거나 큐를 끄면 알린다", () => {
      scheduleFolderPush(folder(PARENT, null));
      cancelFolderPush(PARENT);
      expect(settled).toHaveBeenCalledTimes(1);

      setFolderSyncEnabled(false);
      expect(settled).toHaveBeenCalledTimes(2);
    });

    it("테스트 초기화는 알릴 곳을 지운다", async () => {
      __resetFolderSyncForTests();
      __setFolderPusherForTests(push);
      setFolderSyncEnabled(true);

      scheduleFolderPush(folder(PARENT, null));
      await flushFolderSync();

      expect(settled).not.toHaveBeenCalled();
    });
  });

  describe("영구 실패한 폴더", () => {
    it("영구 실패한 요청을 보내는 동안 고친 폴더는 버리지 않고 다음에 올린다", async () => {
      push.mockImplementationOnce(async () => {
        scheduleFolderPush(folder(PARENT, null, "고친 이름"));
        throw new ServerRejectedError(400, "거절");
      });

      scheduleFolderPush(folder(PARENT, null, "처음 이름"));
      await flushFolderSync();

      expect(hasPendingFolderPush()).toBe(true);
      expect(getSyncSnapshot().status).toBe("error");

      await flushFolderSync();

      expect(push.mock.calls.map(([f]) => f.name)).toEqual([
        "처음 이름",
        "고친 이름",
      ]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });

      await retryFolderSyncNow("manual");
      expect(push).toHaveBeenCalledTimes(2);
    });

    it("다시 시도는 실패로 남긴 사본이 아니라 지금 폴더를 올리고, 없어진 폴더는 버린다", async () => {
      push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      scheduleFolderPush(folder(PARENT, null, "실패한 사본"));
      scheduleFolderPush(folder(OTHER_ROOT, null, "지운 폴더"));
      await flushFolderSync();
      expect(getSyncSnapshot().status).toBe("error");

      setFailedFolderResolver((id) =>
        id === PARENT ? folder(PARENT, null, "지금 폴더") : undefined,
      );
      await retryFolderSyncNow("manual");

      expect(push.mock.calls.slice(2).map(([f]) => f.name)).toEqual([
        "지금 폴더",
      ]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });
  });

  it.each(["reconnect", "manual"] as const)(
    "%s 재시도는 백오프를 비워 한도 가까이 실패한 폴더가 한 번 더 실패해도 영구 실패로 넘기지 않는다",
    async (mode) => {
      push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
      __setFolderBackoffRandomForTests(() => 1);
      vi.useFakeTimers();

      scheduleFolderPush(folder(PARENT, null));
      while (push.mock.calls.length < 10) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await retryFolderSyncNow(mode);

      expect(push).toHaveBeenCalledTimes(11);
      expect(getSyncSnapshot().status).toBe("offline");

      vi.useRealTimers();
    },
  );

  describe("서버가 기다리라고 한 폴더", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function recordSends(rejectParent: () => Error | null): string[] {
      const start = Date.now();
      const sent: string[] = [];
      push.mockImplementation(async (f: Folder) => {
        sent.push(`${f.id}@${Date.now() - start}`);
        const err = f.id === PARENT ? rejectParent() : null;
        if (err) throw err;
        return f;
      });
      return sent;
    }

    it("다른 폴더를 고쳐도 Retry-After를 지키고, 그 안에 만든 폴더는 그 폴더가 오른 뒤에 올린다", async () => {
      vi.useFakeTimers();
      let rejected = false;
      const sent = recordSends(() => {
        if (rejected) return null;
        rejected = true;
        return new ServerRejectedError(503, undefined, 30_000);
      });
      scheduleFolderPush(folder(PARENT, null));
      await vi.advanceTimersByTimeAsync(2000);

      scheduleFolderPush(folder(OTHER_ROOT, null));
      scheduleFolderPush(folder(CHILD, PARENT));
      await vi.advanceTimersByTimeAsync(2000);

      expect(sent).toEqual([`${PARENT}@2000`, `${OTHER_ROOT}@4000`]);
      expect(getSyncSnapshot().status).toBe("offline");

      await vi.advanceTimersByTimeAsync(28_000 - 1);
      expect(sent).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);

      expect(sent).toEqual([
        `${PARENT}@2000`,
        `${OTHER_ROOT}@4000`,
        `${PARENT}@32000`,
        `${CHILD}@32000`,
      ]);
      expect(hasPendingFolderPush()).toBe(false);
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("재시도 한도를 넘겨 천천히 다시 보내는 폴더도 다른 폴더를 고쳐 보내는 사이에는 다시 보내지 않는다", async () => {
      vi.useFakeTimers();
      __setFolderBackoffRandomForTests(() => 1);
      const sent = recordSends(
        () => new ServerRejectedError(503, "지속 과부하"),
      );
      scheduleFolderPush(folder(PARENT, null));
      await vi.advanceTimersByTimeAsync(2000);
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }
      const slowRetries = sent.length;
      expect(slowRetries).toBe(MAX_RETRY_ATTEMPTS + 1);

      scheduleFolderPush(folder(OTHER_ROOT, null, "1"));
      await vi.advanceTimersByTimeAsync(2000);
      scheduleFolderPush(folder(OTHER_ROOT, null, "2"));
      await vi.advanceTimersByTimeAsync(2000);

      expect(
        sent.slice(slowRetries).map((entry) => entry.split("@")[0]),
      ).toEqual([OTHER_ROOT, OTHER_ROOT]);

      await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS);
      expect(
        sent.slice(slowRetries).map((entry) => entry.split("@")[0]),
      ).toEqual([OTHER_ROOT, OTHER_ROOT, PARENT]);
    });
  });

  it("재시도 한도를 넘긴 일시 장애(503)는 동기화 실패로 보이되 버리지 않고 SLOW_RETRY_MS 뒤에 다시 보낸다", async () => {
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
    expect(hasPendingFolderPush()).toBe(true);
    await expect(ensureFolderPushed(PARENT)).resolves.toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    await retryFolderSyncNow("wake");
    expect(push).toHaveBeenCalledTimes(11);

    push.mockImplementation(async (f) => f);
    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS);

    expect(push).toHaveBeenCalledTimes(12);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });

    vi.useRealTimers();
  });

  it("재시도 한도를 넘겨 천천히 다시 보내던 폴더는 다시 시도하면 곧바로 보내고 실패 표시를 지운다", async () => {
    push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
    __setFolderBackoffRandomForTests(() => 0);
    vi.useFakeTimers();
    scheduleFolderPush(folder(PARENT, null));
    for (let i = 0; i <= MAX_RETRY_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
    expect(getSyncSnapshot().status).toBe("error");

    let release: () => void = () => undefined;
    push.mockImplementation(
      (f) =>
        new Promise<Folder>((resolve) => {
          release = () => resolve(f);
        }),
    );
    const retrying = retryFolderSyncNow("manual");
    await vi.advanceTimersByTimeAsync(0);

    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);
    expect(getSyncSnapshot()).toMatchObject({
      status: "syncing",
      lastFailure: null,
    });

    release();
    await retrying;
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("재시도 한도를 넘긴 서버 오류(500)는 천천히 다시 보내지 않고 영구 실패로 남겨, 그 안의 폴더를 막지 않는다", async () => {
    push.mockImplementation(async (f) => {
      if (f.id === PARENT) throw new ServerRejectedError(500, "서버 오류");
      return f;
    });
    __setFolderBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleFolderPush(folder(PARENT, null));
    scheduleFolderPush(folder(CHILD, PARENT));
    await vi.advanceTimersByTimeAsync(2000);
    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(push.mock.calls.map(([f]) => f.id)).toEqual([
      ...Array<string>(MAX_RETRY_ATTEMPTS + 1).fill(PARENT),
      CHILD,
    ]);
    expect(hasPendingFolderPush()).toBe(false);
    expect(getSyncSnapshot()).toMatchObject({
      status: "error",
      lastFailure: { id: PARENT, kind: "folder", status: 500 },
    });
    await expect(ensureFolderPushed(PARENT)).resolves.toBe(true);

    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS * 2);
    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);

    vi.useRealTimers();
  });

  describe("송출 화면", () => {
    const startPath = window.location.pathname;
    const PROJECTION_PATH = "/present/a00000000000000000001/fullscreen";

    afterEach(() => {
      vi.useRealTimers();
      window.history.pushState({}, "", startPath);
    });

    it("재시도 한도를 넘겨 천천히 다시 보내던 폴더도 송출하는 동안은 보내지 않고, 송출을 마치면 보낸다", async () => {
      push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
      __setFolderBackoffRandomForTests(() => 1);
      vi.useFakeTimers();
      scheduleFolderPush(folder(PARENT, null));
      await vi.advanceTimersByTimeAsync(2000);
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

      window.history.pushState({}, "", PROJECTION_PATH);
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS * 6);
      await flushFolderSync();
      await retryFolderSyncNow("manual");

      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
      expect(hasPendingFolderPush()).toBe(true);

      push.mockImplementation(async (f) => f);
      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("송출 전에 보내기 시작한 묶음도 송출하는 동안은 남은 폴더를 보내지 않고, 송출을 마치면 보낸다", async () => {
      vi.useFakeTimers();
      let release: () => void = () => undefined;
      const sent: { id: string; projecting: boolean }[] = [];
      push.mockImplementation((f: Folder) => {
        sent.push({ id: f.id, projecting: isProjecting() });
        if (f.id !== PARENT) return Promise.resolve(f);
        return new Promise<Folder>((resolve) => {
          release = () => resolve(f);
        });
      });
      scheduleFolderPush(folder(PARENT, null));
      scheduleFolderPush(folder(OTHER_ROOT, null));
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent).toEqual([{ id: PARENT, projecting: false }]);

      window.history.pushState({}, "", PROJECTION_PATH);
      release();
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

      expect(sent).toHaveLength(1);
      expect(hasPendingFolderPush()).toBe(true);

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(sent).toEqual([
        { id: PARENT, projecting: false },
        { id: OTHER_ROOT, projecting: false },
      ]);
      expect(hasPendingFolderPush()).toBe(false);
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("송출 중에 고친 폴더는 디바운스·flush로도 보내지 않고, 송출을 마치면 보낸다", async () => {
      vi.useFakeTimers();
      window.history.pushState({}, "", PROJECTION_PATH);

      scheduleFolderPush(folder(PARENT, null));
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 3);
      await flushFolderSync();

      expect(push).not.toHaveBeenCalled();

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(push).toHaveBeenCalledTimes(1);
      expect(hasPendingFolderPush()).toBe(false);
    });
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

  describe("세션 만료(401)", () => {
    beforeEach(() => {
      __setFolderBackoffRandomForTests(() => 1);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("401을 받은 폴더는 버리지 않고 큐에 남겨 백오프 타이머로 다시 올린다", async () => {
      push
        .mockRejectedValueOnce(new SessionExpiredError())
        .mockImplementation(async (f) => f);

      scheduleFolderPush(folder(PARENT, null, "새 폴더"));
      await vi.advanceTimersByTimeAsync(2000);
      expect(push).toHaveBeenCalledTimes(1);
      expect(getSyncSnapshot().status).toBe("error");
      expect(hasPendingFolderPush()).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);

      expect(push).toHaveBeenCalledTimes(2);
      expect(push.mock.calls[1][0].name).toBe("새 폴더");
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("포커스(wake)는 401로 기다리는 폴더를 앞당기지 않고 타이머를 기다린다", async () => {
      push
        .mockRejectedValueOnce(new SessionExpiredError())
        .mockImplementation(async (f) => f);

      scheduleFolderPush(folder(PARENT, null));
      await vi.advanceTimersByTimeAsync(2000);
      await retryFolderSyncNow("wake");
      await vi.advanceTimersByTimeAsync(1999);

      expect(push).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(push).toHaveBeenCalledTimes(2);
    });

    it("401이 재시도 한도까지 이어지면 실패로 남기고 더 올리지 않는다", async () => {
      push.mockRejectedValue(new SessionExpiredError());

      scheduleFolderPush(folder(PARENT, null, "만료된 폴더"));
      await vi.advanceTimersByTimeAsync(2000);
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }

      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
      expect(getSyncSnapshot()).toMatchObject({
        status: "error",
        lastFailure: { id: PARENT, title: "만료된 폴더", kind: "folder" },
      });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

      push.mockImplementation(async (f) => f);
      await retryFolderSyncNow("manual");

      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });
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

  describe("큐를 끈 뒤", () => {
    function holdPushOnce(): {
      resolve: (saved: Folder) => void;
      reject: (err: unknown) => void;
    } {
      const settle: {
        resolve: (saved: Folder) => void;
        reject: (err: unknown) => void;
      } = { resolve: () => undefined, reject: () => undefined };
      push.mockImplementationOnce(
        () =>
          new Promise<Folder>((resolve, reject) => {
            settle.resolve = resolve;
            settle.reject = reject;
          }),
      );
      return settle;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("묶음의 첫 폴더를 보내는 동안 끄면 그 뒤의 폴더는 보내지 않는다", async () => {
      const first = holdPushOnce();
      scheduleFolderPush(folder(PARENT, null));
      scheduleFolderPush(folder(CHILD, PARENT));
      scheduleFolderPush(folder(GRANDCHILD, CHILD));
      const flushing = flushFolderSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      setFolderSyncEnabled(false);
      first.resolve(folder(PARENT, null));
      await flushing;

      expect(push).toHaveBeenCalledTimes(1);
    });

    it("끈 뒤에 오프라인으로 끝난 폴더는 백오프 타이머가 지나도 다시 보내지 않는다", async () => {
      vi.useFakeTimers();
      const first = holdPushOnce();
      scheduleFolderPush(folder(PARENT, null));
      const flushing = flushFolderSync();
      await vi.advanceTimersByTimeAsync(0);
      expect(push).toHaveBeenCalledTimes(1);

      setFolderSyncEnabled(false);
      first.reject(new OfflineError());
      await flushing;
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

      expect(push).toHaveBeenCalledTimes(1);
    });

    it("끈 뒤에 일시 장애로 끝난 바로 올리기는 큐에 다시 넣지 않는다", async () => {
      const first = holdPushOnce();
      const booting = pushFolderNow(folder(PARENT, null));
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      setFolderSyncEnabled(false);
      first.reject(new ServerRejectedError(503, "과부하"));
      await expect(booting).rejects.toBeInstanceOf(ServerRejectedError);

      expect(hasPendingFolderPush()).toBe(false);
    });

    it("끈 뒤에는 flush하거나 다시 시도해도 보내지 않는다", async () => {
      const first = holdPushOnce();
      scheduleFolderPush(folder(PARENT, null));
      const flushing = flushFolderSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      setFolderSyncEnabled(false);
      first.reject(new OfflineError());
      await flushing;
      await flushFolderSync();
      await retryFolderSyncNow("manual");

      expect(push).toHaveBeenCalledTimes(1);
    });
  });
});
