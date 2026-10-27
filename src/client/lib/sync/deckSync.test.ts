import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { API_ERRORS, DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "#shared";
import {
  scheduleDeckPush,
  scheduleDeckDelete,
  pushDeckNow,
  flushDeckSync,
  retryDeckSyncNow,
  setDeckSyncEnabled,
  setServerDeckListener,
  setDeckGoneListener,
  cancelDeckPush,
  cancelDeckDelete,
  deletedDeckIds,
  wasDeckDeleted,
  markDeckDeleted,
  isDeckDeletedError,
  resumePendingDeckDeletes,
  __setDeckTransportForTests,
  __setDeckBackoffRandomForTests,
  __resetDeckSyncForTests,
} from "./deckSync";
import {
  OfflineError,
  ServerRejectedError,
  SessionExpiredError,
  TimeoutError,
} from "../api/request";
import { installFakeApi } from "../../test/fakeApi";
import { getSyncSnapshot, resetSyncStatus } from "./syncStatus";
import {
  scheduleDocumentPush,
  flushPendingSync,
  setSyncEnabled,
  __setPusherForTests,
  __resetSyncSchedulerForTests,
} from "./syncScheduler";
import {
  listPendingDeckDeletes,
  rememberDeckDelete,
} from "./pendingDeckDeletes";

const USER = "00000000x000000000001";
const OTHER_USER = "00000000x000000000002";
const A = "c0000000000000000000a";
const B = "c0000000000000000000b";

function deck(title = "은혜로다"): Deck {
  return DeckSchema.parse({
    id: A,
    userId: USER,
    scope: "library",
    title,
    lyricsRaw: "시작됐네",
    slides: [],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

describe("보관함 push 큐", () => {
  let push: ReturnType<typeof vi.fn<(deck: Deck) => Promise<Deck>>>;
  let remove: ReturnType<typeof vi.fn<(id: string) => Promise<boolean | void>>>;

  beforeEach(() => {
    localStorage.clear();
    __resetDeckSyncForTests();
    resetSyncStatus();
    push = vi.fn(async (d: Deck) => ({ ...d, forkCount: 3 }));
    remove = vi.fn(async () => {});
    __setDeckTransportForTests({ push, remove });
    setDeckSyncEnabled(true);
  });

  afterEach(() => {
    __resetDeckSyncForTests();
  });

  it("does nothing while sync is disabled", async () => {
    setDeckSyncEnabled(false);
    scheduleDeckPush(deck());
    await flushDeckSync();
    expect(push).not.toHaveBeenCalled();
  });

  it("debounces repeated edits of the same deck", async () => {
    scheduleDeckPush(deck("1"));
    scheduleDeckPush(deck("2"));
    await flushDeckSync();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].title).toBe("2");
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("hands the server-confirmed deck to the listener", async () => {
    const received: Deck[] = [];
    setServerDeckListener((d) => received.push(d));
    scheduleDeckPush(deck());
    await flushDeckSync();
    expect(received[0].forkCount).toBe(3);
  });

  it("a delete replaces a pending push", async () => {
    scheduleDeckPush(deck());
    scheduleDeckDelete(A, USER);
    await flushDeckSync();
    expect(push).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(A);
  });

  it("requeues when offline and retries on the next flush", async () => {
    push.mockRejectedValueOnce(new OfflineError());
    scheduleDeckPush(deck());
    await flushDeckSync();
    expect(getSyncSnapshot().status).toBe("offline");

    await flushDeckSync();
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("멈춘 요청으로 인해 타임아웃(TimeoutError)이 발생해도 syncing에 머물지 않고 offline으로 바뀐 뒤 재시도된다", async () => {
    push.mockRejectedValueOnce(new TimeoutError());
    scheduleDeckPush(deck());
    await flushDeckSync();
    expect(getSyncSnapshot().status).toBe("offline");

    await flushDeckSync();
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("서버가 응답하지 않고 멈춘 경우 데드라인 뒤 offline 상태로 전환되고 재연결 시 정상 동기화된다", async () => {
    vi.useFakeTimers();
    __setDeckTransportForTests({});

    const waiter: { resolve?: () => void } = {};
    let shouldResolve = false;
    const fake = installFakeApi({
      "PUT /api/decks/*": () =>
        new Promise((resolve) => {
          if (shouldResolve) {
            resolve({
              status: 200,
              body: { deck: deck() },
            });
            return;
          }
          waiter.resolve = () => {
            shouldResolve = true;
            resolve({
              status: 200,
              body: { deck: deck() },
            });
          };
        }),
    });

    scheduleDeckPush(deck());
    const flushPromise = flushDeckSync();
    await vi.advanceTimersByTimeAsync(0);

    expect(getSyncSnapshot().status).toBe("syncing");

    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromise;

    expect(getSyncSnapshot().status).toBe("offline");

    shouldResolve = true;
    waiter.resolve?.();
    const nextFlush = flushDeckSync();
    await vi.advanceTimersByTimeAsync(0);
    await nextFlush;

    expect(getSyncSnapshot().status).toBe("synced");

    fake.restore();
    vi.useRealTimers();
  });

  it("marks the status as error on a rejected push without retrying", async () => {
    push.mockRejectedValueOnce(new Error("400"));
    scheduleDeckPush(deck());
    await flushDeckSync();
    expect(getSyncSnapshot().status).toBe("error");
    await flushDeckSync();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("pushDeckNow pushes immediately, even when auto sync is off, and drops the pending copy", async () => {
    scheduleDeckPush(deck("예약본"));
    setDeckSyncEnabled(false);
    const saved = await pushDeckNow(deck("즉시"));
    expect(saved.forkCount).toBe(3);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].title).toBe("즉시");
  });

  it("pushDeckNow surfaces failures to the caller", async () => {
    push.mockRejectedValueOnce(new OfflineError());
    await expect(pushDeckNow(deck())).rejects.toBeInstanceOf(OfflineError);
  });

  it("503 응답 시 백오프 타이머로 자동 재시도하고 성공 시 synced로 복구된다", async () => {
    push
      .mockRejectedValueOnce(
        new ServerRejectedError(503, "Service Unavailable"),
      )
      .mockResolvedValueOnce(deck());

    __setDeckBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDeckPush(deck());
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot().status).toBe("offline");

    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("영구 실패(400) 시 failure 정보를 남긴다", async () => {
    push.mockRejectedValue(new ServerRejectedError(400, "잘못된 덱"));

    scheduleDeckPush(deck("불량 덱"));
    await flushDeckSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: A,
      title: "불량 덱",
      kind: "deck",
      status: 400,
    });
  });

  it("서버가 거절하며 준 문장을 실패 이유로 남긴다", async () => {
    __setDeckTransportForTests({});
    const fake = installFakeApi({
      "PUT /api/decks/*": () => ({
        status: 413,
        body: { error: API_ERRORS.deck.tooLarge },
      }),
    });

    scheduleDeckPush(deck("긴 곡"));
    await flushDeckSync();
    fake.restore();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: A,
      title: "긴 곡",
      kind: "deck",
      status: 413,
      reason: API_ERRORS.deck.tooLarge,
    });
  });

  it("서버 응답을 읽지 못한 실패는 개발자용 오류 문구라 실패 이유로 남기지 않는다", async () => {
    __setDeckTransportForTests({});
    const fake = installFakeApi({
      "PUT /api/decks/*": () => ({ status: 200, body: { deck: { id: A } } }),
    });

    scheduleDeckPush(deck());
    await flushDeckSync();
    fake.restore();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: A,
      kind: "deck",
    });
    expect(getSyncSnapshot().lastFailure?.reason).toBeUndefined();
  });

  it("동시에 여러 덱이 실패해도 각 덱의 백오프 attempt는 독립적으로 계산된다", async () => {
    push.mockRejectedValue(new ServerRejectedError(503, "Service Unavailable"));

    __setDeckBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDeckPush(deck("곡 1"));
    scheduleDeckPush({ ...deck("곡 2"), id: "c0000000000000000000b" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(2);

    push.mockImplementation(async (d: Deck) => ({ ...d, forkCount: 3 }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(4);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("재시도 한도(MAX_RETRY_ATTEMPTS)를 초과하면 재시도를 중단하고 error 상태가 된다", async () => {
    push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
    __setDeckBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDeckPush(deck());
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(push).toHaveBeenCalledTimes(11);
    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: A,
      kind: "deck",
      status: 503,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(push).toHaveBeenCalledTimes(11);

    vi.useRealTimers();
  });

  it("오프라인(OfflineError)은 10회를 초과해도 재시도를 포기하지 않고 큐에 유지된다", async () => {
    push.mockRejectedValue(new OfflineError());
    __setDeckBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDeckPush(deck());
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(push.mock.calls.length).toBeGreaterThanOrEqual(15);
    expect(getSyncSnapshot().status).toBe("offline");

    push.mockImplementation(async (d: Deck) => ({ ...d, forkCount: 3 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("곡이 영구 실패한 뒤 프레젠테이션 동기화가 성공해도 동기화 실패로 남는다", async () => {
    __resetSyncSchedulerForTests();
    __setPusherForTests(async () => true);
    setSyncEnabled(true);
    push.mockRejectedValue(new ServerRejectedError(400, "잘못된 덱"));

    scheduleDeckPush(deck());
    await flushDeckSync();
    scheduleDocumentPush({
      id: "100000000000000000001",
      userId: USER,
      title: "세트",
      serviceDate: "2026-09-27",
      items: [],
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    });
    await flushPendingSync();

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toMatchObject({
      id: A,
      kind: "deck",
    });
    __resetSyncSchedulerForTests();
  });

  it("올리지 못한 곡을 지우면 실패 표시를 지운다", async () => {
    push.mockRejectedValue(new ServerRejectedError(400, "잘못된 덱"));
    scheduleDeckPush(deck());
    await flushDeckSync();
    expect(getSyncSnapshot().status).toBe("error");

    scheduleDeckDelete(A, USER);
    await flushDeckSync();

    expect(remove).toHaveBeenCalledWith(A);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it.each(["reconnect", "manual"] as const)(
    "%s 재시도는 백오프를 비워 한도 가까이 실패한 곡이 한 번 더 실패해도 영구 실패로 넘기지 않는다",
    async (mode) => {
      push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
      __setDeckBackoffRandomForTests(() => 1);
      vi.useFakeTimers();

      scheduleDeckPush(deck());
      while (push.mock.calls.length < 10) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      await retryDeckSyncNow(mode);

      expect(push).toHaveBeenCalledTimes(11);
      expect(getSyncSnapshot().status).toBe("offline");

      vi.useRealTimers();
    },
  );

  it("포커스(wake)는 서버가 거절해 기다리는 곡만 두고 오프라인으로 밀린 곡은 곧바로 보낸다", async () => {
    const B = "c0000000000000000000b";
    push.mockImplementation(async (d: Deck) => {
      if (d.id === A) throw new ServerRejectedError(503, "과부하");
      throw new OfflineError();
    });
    __setDeckBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDeckPush(deck());
    scheduleDeckPush({ ...deck("다른 곡"), id: B });
    await flushDeckSync();
    expect(push).toHaveBeenCalledTimes(2);

    push.mockImplementation(async (d: Deck) => d);
    await retryDeckSyncNow("wake");

    expect(push).toHaveBeenCalledTimes(3);
    expect(push.mock.calls[2][0].id).toBe(B);
    expect(getSyncSnapshot().status).toBe("offline");

    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(4);
    expect(push.mock.calls[3][0].id).toBe(A);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  it("pushDeckNow는 이미 동기화됨이어도 마지막 동기화 시각을 새로 남긴다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    scheduleDeckPush(deck());
    await flushDeckSync();
    const syncedAt = getSyncSnapshot().lastSyncedAt;
    vi.advanceTimersByTime(60_000);

    await pushDeckNow(deck("공개"));

    expect(getSyncSnapshot().lastSyncedAt).toBe(Date.now());
    expect(getSyncSnapshot().lastSyncedAt).not.toBe(syncedAt);
    vi.useRealTimers();
  });

  it("pushDeckNow는 오프라인으로 밀린 곡이 남아 있으면 synced로 바꾸지 않는다", async () => {
    push.mockRejectedValueOnce(new OfflineError());
    scheduleDeckPush({ ...deck(), id: "c0000000000000000000b" });
    await flushDeckSync();
    expect(getSyncSnapshot().status).toBe("offline");

    await pushDeckNow(deck("공개"));

    expect(getSyncSnapshot().status).toBe("offline");
  });

  describe("지운 곡", () => {
    function deferPushOnce(): {
      resolve: (saved: Deck) => void;
      reject: (err: unknown) => void;
    } {
      let settle: {
        resolve: (saved: Deck) => void;
        reject: (err: unknown) => void;
      } | null = null;
      push.mockImplementationOnce(
        () =>
          new Promise<Deck>((resolve, reject) => {
            settle = { resolve, reject };
          }),
      );
      return {
        resolve: (saved) => settle?.resolve(saved),
        reject: (err) => settle?.reject(err),
      };
    }

    it("410은 이미 지운 곡이라 실패로 남기지 않고 알린 뒤 다시 올리지 않는다", async () => {
      const gone = vi.fn<(id: string) => void>();
      setDeckGoneListener(gone);
      push.mockRejectedValueOnce(new ServerRejectedError(410, "이미 지운 곡"));

      scheduleDeckPush(deck());
      await flushDeckSync();

      expect(gone).toHaveBeenCalledWith(A);
      expect(wasDeckDeleted(A)).toBe(true);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });

      await flushDeckSync();
      await retryDeckSyncNow("manual");
      expect(push).toHaveBeenCalledTimes(1);
    });

    it("410을 받는 동안 고친 같은 곡도 올리지 않는다", async () => {
      const pending = deferPushOnce();
      scheduleDeckPush(deck("처음"));
      const flushing = flushDeckSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      scheduleDeckPush(deck("고친 곡"));
      pending.reject(new ServerRejectedError(410));
      await flushing;
      await flushDeckSync();

      expect(push).toHaveBeenCalledTimes(1);
    });

    it("pushDeckNow는 410이면 던지되 실패로 남기지 않고 알리지 않으며 맡긴 push를 버린다", async () => {
      const gone = vi.fn<(id: string) => void>();
      setDeckGoneListener(gone);
      push.mockRejectedValueOnce(new ServerRejectedError(400, "잘못된 덱"));
      scheduleDeckPush(deck());
      await flushDeckSync();
      expect(getSyncSnapshot().status).toBe("error");

      push.mockRejectedValueOnce(new ServerRejectedError(410));
      const error = await pushDeckNow(deck()).catch((err: unknown) => err);

      expect(isDeckDeletedError(error)).toBe(true);
      expect(gone).not.toHaveBeenCalled();
      expect(wasDeckDeleted(A)).toBe(true);
      expect(getSyncSnapshot().lastFailure).toBeNull();

      await retryDeckSyncNow("manual");
      expect(push).toHaveBeenCalledTimes(2);
    });

    const failedPushCases: {
      reason: string;
      batched: boolean;
      makeError: () => Error;
    }[] = [
      {
        reason: "거절(400)",
        batched: false,
        makeError: () => new ServerRejectedError(400, "거절"),
      },
      {
        reason: "거절(400)",
        batched: true,
        makeError: () => new ServerRejectedError(400, "거절"),
      },
      {
        reason: "오프라인",
        batched: false,
        makeError: () => new OfflineError(),
      },
      {
        reason: "오프라인",
        batched: true,
        makeError: () => new OfflineError(),
      },
    ];

    it.each(failedPushCases)(
      "올리는 중에 지운 곡은 push가 $reason로 실패해도 DELETE를 보내고 push는 다시 보내지 않는다 (DELETE를 다음 묶음에 넣음: $batched)",
      async ({ batched, makeError }) => {
        const pending = deferPushOnce();
        scheduleDeckPush(deck());
        const first = flushDeckSync();
        await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

        scheduleDeckDelete(A, USER);
        const second = batched ? flushDeckSync() : first;
        pending.reject(makeError());
        await second;
        expect(getSyncSnapshot().lastFailure).toBeNull();
        await flushDeckSync();
        await retryDeckSyncNow("manual");

        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledWith(A);
        expect(push).toHaveBeenCalledTimes(1);
        expect(getSyncSnapshot()).toMatchObject({
          status: "synced",
          lastFailure: null,
        });
      },
    );

    it("올리는 중에 지운 곡은 push가 성공해도 결과를 보관함에 넘기지 않는다", async () => {
      const received = vi.fn<(saved: Deck) => void>();
      setServerDeckListener(received);
      const pending = deferPushOnce();
      scheduleDeckPush(deck());
      const flushing = flushDeckSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      scheduleDeckDelete(A, USER);
      pending.resolve({ ...deck(), forkCount: 3 });
      await flushing;
      await flushDeckSync();

      expect(received).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledWith(A);
    });

    it("pushDeckNow 도중에 지운 곡은 성공해도 보관함에 넘기지 않는다", async () => {
      const received = vi.fn<(saved: Deck) => void>();
      setServerDeckListener(received);
      const pending = deferPushOnce();
      const pushing = pushDeckNow(deck());
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      scheduleDeckDelete(A, USER);
      pending.resolve(deck());
      await pushing;
      await flushDeckSync();

      expect(received).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledWith(A);
    });

    it("cancelDeckPush는 대기 중인 push만 버린다", async () => {
      scheduleDeckPush(deck());
      cancelDeckPush(A);
      await flushDeckSync();

      expect(push).not.toHaveBeenCalled();
    });

    it("cancelDeckPush는 서버가 기다리라고 한 DELETE의 대기와 백오프를 건드리지 않는다", async () => {
      vi.useFakeTimers();
      try {
        remove
          .mockRejectedValueOnce(new ServerRejectedError(503, "과부하", 30_000))
          .mockResolvedValue(undefined);
        scheduleDeckDelete(A, USER);
        await vi.advanceTimersByTimeAsync(2000);
        expect(remove).toHaveBeenCalledTimes(1);

        cancelDeckPush(A);
        await retryDeckSyncNow("wake");
        await vi.advanceTimersByTimeAsync(29_000);
        expect(remove).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(remove).toHaveBeenCalledTimes(2);
        expect(getSyncSnapshot().status).toBe("synced");
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancelDeckPush는 영구 실패로 맡긴 DELETE와 그 실패 기록을 남긴다", async () => {
      remove.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      scheduleDeckDelete(A, USER);
      await flushDeckSync();
      expect(getSyncSnapshot().lastFailure).toMatchObject({ id: A });

      cancelDeckPush(A);
      expect(getSyncSnapshot().lastFailure).toMatchObject({ id: A });

      await retryDeckSyncNow("manual");
      expect(remove).toHaveBeenCalledTimes(2);
      expect(getSyncSnapshot().lastFailure).toBeNull();
    });

    it("cancelDeckPush는 영구 실패로 맡긴 push와 그 실패 기록을 지운다", async () => {
      push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      scheduleDeckPush(deck());
      await flushDeckSync();
      expect(getSyncSnapshot().lastFailure).toMatchObject({ id: A });

      cancelDeckPush(A);
      expect(getSyncSnapshot().lastFailure).toBeNull();

      await retryDeckSyncNow("manual");
      expect(push).toHaveBeenCalledTimes(1);
    });

    it("cancelDeckDelete는 대기 중인 DELETE를 버리고 지운 곡 목록에서 뺀다", async () => {
      scheduleDeckDelete(A, USER);
      expect(deletedDeckIds().has(A)).toBe(true);

      cancelDeckDelete(A, USER);
      await flushDeckSync();

      expect(deletedDeckIds().has(A)).toBe(false);
      expect(remove).not.toHaveBeenCalled();
    });

    it("cancelDeckDelete는 영구 실패로 맡긴 DELETE와 그 실패 기록을 지운다", async () => {
      remove.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      scheduleDeckDelete(A, USER);
      await flushDeckSync();
      expect(getSyncSnapshot().lastFailure).toMatchObject({ id: A });

      cancelDeckDelete(A, USER);
      expect(getSyncSnapshot().lastFailure).toBeNull();

      await retryDeckSyncNow("manual");
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it("동기화가 꺼져 있어도 지운 곡을 기억하고, 껐다 켜도 잊지 않는다", () => {
      setDeckSyncEnabled(false);
      scheduleDeckDelete(A, USER);
      expect(wasDeckDeleted(A)).toBe(true);

      setDeckSyncEnabled(true);
      expect(deletedDeckIds().has(A)).toBe(true);
    });

    it("markDeckDeleted는 DELETE를 보내지 않고 지운 곡으로만 기억한다", async () => {
      markDeckDeleted(A);
      await flushDeckSync();

      expect(wasDeckDeleted(A)).toBe(true);
      expect(remove).not.toHaveBeenCalled();
    });

    it("410만 지운 곡 오류로 본다", () => {
      expect(isDeckDeletedError(new ServerRejectedError(410))).toBe(true);
      expect(isDeckDeletedError(new ServerRejectedError(404))).toBe(false);
      expect(isDeckDeletedError(new OfflineError())).toBe(false);
    });
  });

  describe("새로고침 뒤에도 보낼 곡 삭제 기록", () => {
    it("동기화가 꺼져 있어도 지운 곡을 기록하고, 서버가 지우면(200) 기록을 지운다", async () => {
      setDeckSyncEnabled(false);
      scheduleDeckDelete(A, USER);
      expect(listPendingDeckDeletes(USER)).toEqual([A]);

      setDeckSyncEnabled(true);
      remove.mockResolvedValueOnce(true);
      scheduleDeckDelete(A, USER);
      await flushDeckSync();

      expect(remove).toHaveBeenCalledWith(A);
      expect(listPendingDeckDeletes(USER)).toEqual([]);
    });

    it("지운 계정의 기록만 지운다", async () => {
      rememberDeckDelete(OTHER_USER, A);

      scheduleDeckDelete(A, USER);
      await flushDeckSync();

      expect(listPendingDeckDeletes(USER)).toEqual([]);
      expect(listPendingDeckDeletes(OTHER_USER)).toEqual([A]);
    });

    it("이 계정의 곡이 아니라고 하면(404) 실패로 남기지 않되 기록은 남긴다", async () => {
      remove.mockResolvedValueOnce(false);

      scheduleDeckDelete(A, USER);
      await flushDeckSync();

      expect(listPendingDeckDeletes(USER)).toEqual([A]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it.each([
      { reason: "세션 만료(401)", makeError: () => new SessionExpiredError() },
      { reason: "오프라인", makeError: () => new OfflineError() },
      {
        reason: "일시 장애(503)",
        makeError: () => new ServerRejectedError(503, "과부하"),
      },
    ])(
      "$reason로 보내지 못한 DELETE는 기록을 남긴다",
      async ({ makeError }) => {
        remove.mockRejectedValueOnce(makeError());

        scheduleDeckDelete(A, USER);
        await flushDeckSync();

        expect(remove).toHaveBeenCalledTimes(1);
        expect(listPendingDeckDeletes(USER)).toEqual([A]);
      },
    );

    it("서버가 거절해(400) 끝내 지우지 못한 곡은 기록을 지우고 이번 실패는 남긴다", async () => {
      remove.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));

      scheduleDeckDelete(A, USER);
      await flushDeckSync();

      expect(listPendingDeckDeletes(USER)).toEqual([]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "error",
        lastFailure: { id: A, kind: "deck", status: 400 },
      });
      expect(wasDeckDeleted(A)).toBe(true);
    });

    it("재시도 한도까지 일시 장애(503)가 이어지면 기록을 지우고 이번 실패는 남긴다", async () => {
      remove.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
      __setDeckBackoffRandomForTests(() => 1);
      vi.useFakeTimers();
      try {
        scheduleDeckDelete(A, USER);
        await vi.advanceTimersByTimeAsync(2000);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(listPendingDeckDeletes(USER)).toEqual([A]);

        for (let i = 0; i < 10; i++) {
          await vi.advanceTimersByTimeAsync(60_000);
        }

        expect(remove).toHaveBeenCalledTimes(11);
        expect(listPendingDeckDeletes(USER)).toEqual([]);
        expect(getSyncSnapshot()).toMatchObject({
          status: "error",
          lastFailure: { id: A, kind: "deck", status: 503 },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancelDeckDelete는 기록도 지운다", () => {
      scheduleDeckDelete(A, USER);

      cancelDeckDelete(A, USER);

      expect(listPendingDeckDeletes(USER)).toEqual([]);
    });

    it("resumePendingDeckDeletes는 그 계정의 기록을 모두 지운 곡으로 다시 보낸다", async () => {
      rememberDeckDelete(USER, A);
      rememberDeckDelete(USER, B);
      rememberDeckDelete(OTHER_USER, "c0000000000000000000c");

      resumePendingDeckDeletes(USER);
      await flushDeckSync();

      expect(remove.mock.calls.map(([id]) => id).sort()).toEqual([A, B]);
      expect(wasDeckDeleted(A)).toBe(true);
      expect(listPendingDeckDeletes(USER)).toEqual([]);
      expect(listPendingDeckDeletes(OTHER_USER)).toEqual([
        "c0000000000000000000c",
      ]);
    });
  });
});
