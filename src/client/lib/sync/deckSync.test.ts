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
  unmarkDeckDeleted,
  isDeckDeletedError,
  hasPendingDeckSync,
  resumeOtherTabsDeckDeletes,
  resumePendingDeckDeletes,
  setFailedDeckResolver,
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
import { isProjecting } from "../../features/presentation/fullscreen";
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
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  SLOW_RETRY_MS,
} from "./backoff";

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
    push = vi.fn(async (d: Deck) => ({ ...d, forkedFromAuthorName: "원작자" }));
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
    expect(received[0].forkedFromAuthorName).toBe("원작자");
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
    expect(saved.forkedFromAuthorName).toBe("원작자");
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

    push.mockImplementation(async (d: Deck) => ({
      ...d,
      forkedFromAuthorName: "원작자",
    }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(push).toHaveBeenCalledTimes(4);
    expect(getSyncSnapshot().status).toBe("synced");

    vi.useRealTimers();
  });

  describe("서버가 기다리라고 한 곡", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function recordSends(rejectA: () => Error | null): string[] {
      const start = Date.now();
      const sent: string[] = [];
      push.mockImplementation(async (d: Deck) => {
        sent.push(`${d.id === A ? "A" : "B"}@${Date.now() - start}`);
        const err = d.id === A ? rejectA() : null;
        if (err) throw err;
        return d;
      });
      return sent;
    }

    it("다른 곡을 고쳐도 Retry-After를 지키고 고친 곡만 보낸 뒤, 기다린 곡은 대기가 끝나면 보낸다", async () => {
      vi.useFakeTimers();
      let rejected = false;
      const sent = recordSends(() => {
        if (rejected) return null;
        rejected = true;
        return new ServerRejectedError(503, undefined, 30_000);
      });
      scheduleDeckPush(deck());
      await vi.advanceTimersByTimeAsync(2000);

      scheduleDeckPush({ ...deck("곡 2"), id: B });
      await vi.advanceTimersByTimeAsync(2000);

      expect(sent).toEqual(["A@2000", "B@4000"]);
      expect(getSyncSnapshot().status).toBe("offline");

      await vi.advanceTimersByTimeAsync(28_000 - 1);
      expect(sent).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);

      expect(sent).toEqual(["A@2000", "B@4000", "A@32000"]);
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("재시도 한도를 넘겨 천천히 다시 보내는 곡도 다른 곡을 고쳐 보내는 사이에는 다시 보내지 않는다", async () => {
      vi.useFakeTimers();
      __setDeckBackoffRandomForTests(() => 1);
      const sent = recordSends(
        () => new ServerRejectedError(503, "지속 과부하"),
      );
      scheduleDeckPush(deck());
      await vi.advanceTimersByTimeAsync(2000);
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }
      const slowRetries = sent.length;
      expect(slowRetries).toBe(MAX_RETRY_ATTEMPTS + 1);

      scheduleDeckPush({ ...deck("곡 2"), id: B });
      await vi.advanceTimersByTimeAsync(2000);
      scheduleDeckPush({ ...deck("곡 2 다시"), id: B });
      await vi.advanceTimersByTimeAsync(2000);

      expect(sent.slice(slowRetries).map((entry) => entry[0])).toEqual([
        "B",
        "B",
      ]);

      await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS);
      expect(sent.slice(slowRetries).map((entry) => entry[0])).toEqual([
        "B",
        "B",
        "A",
      ]);
    });

    it("기다리는 곡이 있어도 오프라인으로 밀린 다른 곡은 그 대기를 기다리지 않고 백오프대로 다시 보낸다", async () => {
      vi.useFakeTimers();
      __setDeckBackoffRandomForTests(() => 1);
      const start = Date.now();
      const sent: string[] = [];
      let offlineOnce = true;
      push.mockImplementation(async (d: Deck) => {
        sent.push(`${d.id === A ? "A" : "B"}@${Date.now() - start}`);
        if (d.id === A) throw new ServerRejectedError(503, undefined, 60_000);
        if (offlineOnce) {
          offlineOnce = false;
          throw new OfflineError();
        }
        return d;
      });
      scheduleDeckPush(deck());
      await vi.advanceTimersByTimeAsync(2000);
      scheduleDeckPush({ ...deck("곡 2"), id: B });
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(sent).toEqual(["A@2000", "B@4000", "B@6000"]);
    });
  });

  it("재시도 한도를 넘긴 일시 장애(503)는 동기화 실패로 보이되 버리지 않고 SLOW_RETRY_MS 뒤에 다시 보낸다", async () => {
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
    expect(hasPendingDeckSync()).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    await retryDeckSyncNow("wake");
    expect(push).toHaveBeenCalledTimes(11);

    push.mockImplementation(async (d: Deck) => d);
    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS);

    expect(push).toHaveBeenCalledTimes(12);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });

    vi.useRealTimers();
  });

  it("재시도 한도를 넘겨 천천히 다시 보내던 곡은 다시 시도하면 곧바로 보내고 실패 표시를 지운다", async () => {
    push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
    __setDeckBackoffRandomForTests(() => 0);
    vi.useFakeTimers();
    scheduleDeckPush(deck());
    for (let i = 0; i <= MAX_RETRY_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
    expect(getSyncSnapshot().status).toBe("error");

    let release: () => void = () => undefined;
    push.mockImplementation(
      (d: Deck) =>
        new Promise<Deck>((resolve) => {
          release = () => resolve(d);
        }),
    );
    const retrying = retryDeckSyncNow("manual");
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

  it("재시도 한도를 넘긴 서버 오류(500)는 천천히 다시 보내지 않고 영구 실패로 남긴다", async () => {
    push.mockRejectedValue(new ServerRejectedError(500, "서버 오류"));
    __setDeckBackoffRandomForTests(() => 1);
    vi.useFakeTimers();

    scheduleDeckPush(deck());
    await vi.advanceTimersByTimeAsync(2000);
    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
    expect(hasPendingDeckSync()).toBe(false);
    expect(getSyncSnapshot()).toMatchObject({
      status: "error",
      lastFailure: { id: A, kind: "deck", status: 500 },
    });

    await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS * 2);
    expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

    vi.useRealTimers();
  });

  describe("송출 화면", () => {
    const startPath = window.location.pathname;
    const PROJECTION_PATH = "/present/a00000000000000000001/fullscreen";

    afterEach(() => {
      vi.useRealTimers();
      window.history.pushState({}, "", startPath);
    });

    it("재시도 한도를 넘겨 천천히 다시 보내던 곡도 송출하는 동안은 보내지 않고, 송출을 마치면 보낸다", async () => {
      push.mockRejectedValue(new ServerRejectedError(503, "지속 과부하"));
      __setDeckBackoffRandomForTests(() => 1);
      vi.useFakeTimers();
      scheduleDeckPush(deck());
      await vi.advanceTimersByTimeAsync(2000);
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

      window.history.pushState({}, "", PROJECTION_PATH);
      await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS * 6);
      await flushDeckSync();
      await retryDeckSyncNow("manual");

      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
      expect(hasPendingDeckSync()).toBe(true);

      push.mockImplementation(async (d: Deck) => d);
      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(push).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("서버가 기다리게 한 곡이 있을 때 포커스로 큐를 돌려도 송출하는 동안은 다른 곡을 보내지 않고, 송출을 마치면 보낸다", async () => {
      vi.useFakeTimers();
      push.mockImplementation(async (d: Deck) => {
        if (d.id === A) throw new ServerRejectedError(503, undefined, 30_000);
        return d;
      });
      scheduleDeckPush(deck());
      await vi.advanceTimersByTimeAsync(2000);
      expect(push).toHaveBeenCalledTimes(1);

      scheduleDeckPush({ ...deck("곡 2"), id: B });
      window.history.pushState({}, "", PROJECTION_PATH);
      await retryDeckSyncNow("wake");
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

      expect(push).toHaveBeenCalledTimes(1);

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(push.mock.calls.map(([sent]) => sent.id)).toContain(B);
    });

    it("송출 전에 보내기 시작한 묶음도 송출하는 동안은 남은 곡 변경을 보내지 않고, 송출을 마치면 보낸다", async () => {
      const C = "c0000000000000000000c";
      vi.useFakeTimers();
      let release: () => void = () => undefined;
      const sent: { id: string; projecting: boolean }[] = [];
      push.mockImplementation((d: Deck) => {
        sent.push({ id: d.id, projecting: isProjecting() });
        if (d.id !== A) return Promise.resolve(d);
        return new Promise<Deck>((resolve) => {
          release = () => resolve(d);
        });
      });
      scheduleDeckPush(deck());
      scheduleDeckPush({ ...deck("곡 2"), id: B });
      scheduleDeckDelete(C, USER);
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent).toEqual([{ id: A, projecting: false }]);

      window.history.pushState({}, "", PROJECTION_PATH);
      release();
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

      expect(sent).toHaveLength(1);
      expect(remove).not.toHaveBeenCalled();
      expect(hasPendingDeckSync()).toBe(true);

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(sent).toEqual([
        { id: A, projecting: false },
        { id: B, projecting: false },
      ]);
      expect(remove).toHaveBeenCalledExactlyOnceWith(C);
      expect(hasPendingDeckSync()).toBe(false);
      expect(getSyncSnapshot().status).toBe("synced");
    });

    it("송출 중에 고치거나 지운 곡은 디바운스·flush로도 보내지 않고, 송출을 마치면 보낸다", async () => {
      vi.useFakeTimers();
      window.history.pushState({}, "", PROJECTION_PATH);

      scheduleDeckPush(deck());
      scheduleDeckDelete(B, USER);
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 3);
      await flushDeckSync();

      expect(push).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);

      expect(push).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledExactlyOnceWith(B);
      expect(hasPendingDeckSync()).toBe(false);
    });
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

    push.mockImplementation(async (d: Deck) => ({
      ...d,
      forkedFromAuthorName: "원작자",
    }));
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
      pending.resolve({ ...deck(), forkedFromAuthorName: "원작자" });
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

    it("unmarkDeckDeleted는 다른 곳에서 지운 곡으로만 기억한 곡의 기억만 지운다", async () => {
      expect(unmarkDeckDeleted(A)).toBe(true);

      markDeckDeleted(A);
      expect(unmarkDeckDeleted(A)).toBe(true);
      expect(wasDeckDeleted(A)).toBe(false);

      markDeckDeleted(B);
      scheduleDeckDelete(B, USER);
      markDeckDeleted(B);
      expect(unmarkDeckDeleted(B)).toBe(false);
      await flushDeckSync();
      expect(unmarkDeckDeleted(B)).toBe(false);
      expect(wasDeckDeleted(B)).toBe(true);

      push.mockRejectedValueOnce(new ServerRejectedError(410));
      scheduleDeckPush(deck());
      await flushDeckSync();
      markDeckDeleted(A);
      expect(unmarkDeckDeleted(A)).toBe(false);
      expect(wasDeckDeleted(A)).toBe(true);
    });

    it("410만 지운 곡 오류로 본다", () => {
      expect(isDeckDeletedError(new ServerRejectedError(410))).toBe(true);
      expect(isDeckDeletedError(new ServerRejectedError(404))).toBe(false);
      expect(isDeckDeletedError(new OfflineError())).toBe(false);
    });
  });

  describe("영구 실패한 곡 변경", () => {
    it("영구 실패한 곡을 올리는 동안 지운 곡은 다음 차례에 서버에서도 지운다", async () => {
      push.mockImplementationOnce(async () => {
        scheduleDeckDelete(A, USER);
        throw new ServerRejectedError(400, "거절");
      });

      scheduleDeckPush(deck());
      await flushDeckSync();
      await flushDeckSync();

      expect(remove).toHaveBeenCalledExactlyOnceWith(A);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("영구 실패한 요청을 보내는 동안 고친 곡은 버리지 않고 다음 차례에 올린다", async () => {
      push.mockImplementationOnce(async () => {
        scheduleDeckPush(deck("고친 곡"));
        throw new ServerRejectedError(400, "거절");
      });

      scheduleDeckPush(deck("처음 곡"));
      await flushDeckSync();

      expect(hasPendingDeckSync()).toBe(true);
      expect(getSyncSnapshot().status).toBe("error");

      await flushDeckSync();

      expect(push.mock.calls.map(([sent]) => sent.title)).toEqual([
        "처음 곡",
        "고친 곡",
      ]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });

      await retryDeckSyncNow("manual");
      expect(push).toHaveBeenCalledTimes(2);
    });

    it("영구 실패한 삭제를 보내는 동안 다시 넣은 곡은 버리지 않고 올린다", async () => {
      remove.mockImplementationOnce(async () => {
        cancelDeckDelete(A, USER);
        scheduleDeckPush(deck("다시 넣은 곡"));
        throw new ServerRejectedError(400, "거절");
      });

      scheduleDeckDelete(A, USER);
      await flushDeckSync();
      await flushDeckSync();

      expect(push.mock.calls.map(([sent]) => sent.title)).toEqual([
        "다시 넣은 곡",
      ]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });

      await retryDeckSyncNow("manual");
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it("다시 시도는 실패로 남긴 사본이 아니라 지금 보관함의 곡을 올리고, 없어진 곡은 버린다", async () => {
      push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      push.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      scheduleDeckPush(deck("실패한 사본"));
      scheduleDeckPush({ ...deck("없어진 곡"), id: B });
      await flushDeckSync();
      expect(getSyncSnapshot().status).toBe("error");

      setFailedDeckResolver((id) =>
        id === A ? deck("지금 보관함의 곡") : undefined,
      );
      await retryDeckSyncNow("manual");

      expect(push.mock.calls.slice(2).map(([sent]) => sent.title)).toEqual([
        "지금 보관함의 곡",
      ]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("영구 실패한 삭제는 다시 시도에 지금 곡을 찾지 않고 삭제로 다시 보낸다", async () => {
      const resolve = vi.fn<(id: string) => Deck | undefined>(() => undefined);
      setFailedDeckResolver(resolve);
      remove.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      scheduleDeckDelete(A, USER);
      await flushDeckSync();

      await retryDeckSyncNow("manual");

      expect(remove).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenLastCalledWith(A);
      expect(push).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
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

    it("재시도 한도까지 일시 장애(503)가 이어져도 기록을 남기고 실패를 보이며, 천천히 다시 보내 지우면 기록을 지운다", async () => {
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
        expect(listPendingDeckDeletes(USER)).toEqual([A]);
        expect(getSyncSnapshot()).toMatchObject({
          status: "error",
          lastFailure: { id: A, kind: "deck", status: 503 },
        });

        remove.mockResolvedValue(true);
        await vi.advanceTimersByTimeAsync(SLOW_RETRY_MS);

        expect(remove).toHaveBeenCalledTimes(12);
        expect(listPendingDeckDeletes(USER)).toEqual([]);
        expect(getSyncSnapshot()).toMatchObject({
          status: "synced",
          lastFailure: null,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("영구 실패한 DELETE를 '다시 시도'로 다시 보내면 기록을 다시 남겨, 오프라인으로 밀려도 남긴다", async () => {
      remove.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
      scheduleDeckDelete(A, USER);
      await flushDeckSync();
      expect(listPendingDeckDeletes(USER)).toEqual([]);

      remove.mockRejectedValueOnce(new OfflineError());
      await retryDeckSyncNow("manual");

      expect(remove).toHaveBeenCalledTimes(2);
      expect(listPendingDeckDeletes(USER)).toEqual([A]);
      expect(getSyncSnapshot().status).toBe("offline");
    });

    it.each([
      {
        reason: "서버가 지우면(200)",
        answer: (): Promise<boolean> => Promise.resolve(true),
      },
      {
        reason: "다시 거절하면(400)",
        answer: (): Promise<boolean> =>
          Promise.reject(new ServerRejectedError(400, "거절")),
      },
    ])(
      "영구 실패한 DELETE를 '다시 시도'로 다시 보내 $reason 기록을 지운다",
      async ({ answer }) => {
        remove.mockRejectedValueOnce(new ServerRejectedError(400, "거절"));
        scheduleDeckDelete(A, USER);
        await flushDeckSync();

        remove.mockImplementationOnce(answer);
        await retryDeckSyncNow("manual");

        expect(remove).toHaveBeenCalledTimes(2);
        expect(listPendingDeckDeletes(USER)).toEqual([]);
      },
    );

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

    it("resumeOtherTabsDeckDeletes는 다른 탭이 남긴 기록만 한 번 보내고, 이 페이지가 지운 곡은 다시 넣지 않는다", async () => {
      remove.mockImplementation(async (id) => id !== B);
      scheduleDeckDelete(B, USER);
      await flushDeckSync();
      rememberDeckDelete(USER, A);
      markDeckDeleted(A);

      resumeOtherTabsDeckDeletes(USER);
      await flushDeckSync();
      resumeOtherTabsDeckDeletes(USER);
      await flushDeckSync();

      expect(remove.mock.calls.map(([id]) => id)).toEqual([B, A]);
      expect(listPendingDeckDeletes(USER)).toEqual([B]);
    });

    it("resumeOtherTabsDeckDeletes는 큐가 꺼져 있으면 아무것도 하지 않는다", async () => {
      rememberDeckDelete(USER, A);
      setDeckSyncEnabled(false);

      resumeOtherTabsDeckDeletes(USER);
      setDeckSyncEnabled(true);
      await flushDeckSync();

      expect(remove).not.toHaveBeenCalled();
      expect(wasDeckDeleted(A)).toBe(false);
    });
  });

  describe("세션 만료(401)", () => {
    beforeEach(() => {
      __setDeckBackoffRandomForTests(() => 1);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("401을 받은 DELETE는 버리지 않고 큐에 남겨 백오프 타이머로 다시 보낸다", async () => {
      remove
        .mockRejectedValueOnce(new SessionExpiredError())
        .mockResolvedValue(true);

      scheduleDeckDelete(A, USER);
      await vi.advanceTimersByTimeAsync(2000);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(getSyncSnapshot().status).toBe("error");
      expect(hasPendingDeckSync()).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);

      expect(remove).toHaveBeenCalledTimes(2);
      expect(listPendingDeckDeletes(USER)).toEqual([]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("포커스(wake)는 401로 기다리는 DELETE를 앞당기지 않는다", async () => {
      remove
        .mockRejectedValueOnce(new SessionExpiredError())
        .mockResolvedValue(true);

      scheduleDeckDelete(A, USER);
      await vi.advanceTimersByTimeAsync(2000);
      await retryDeckSyncNow("wake");
      await vi.advanceTimersByTimeAsync(1999);

      expect(remove).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(remove).toHaveBeenCalledTimes(2);
    });

    it("401이 재시도 한도까지 이어지면 실패로 남기되 삭제 기록은 지키고, '다시 시도'가 다시 보낸다", async () => {
      remove.mockRejectedValue(new SessionExpiredError());

      scheduleDeckDelete(A, USER);
      await vi.advanceTimersByTimeAsync(2000);
      for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(60_000);
      }

      expect(remove).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
      expect(getSyncSnapshot()).toMatchObject({
        status: "error",
        lastFailure: { id: A, kind: "deck" },
      });
      expect(listPendingDeckDeletes(USER)).toEqual([A]);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(remove).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

      remove.mockResolvedValue(true);
      await retryDeckSyncNow("manual");

      expect(remove).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 2);
      expect(listPendingDeckDeletes(USER)).toEqual([]);
      expect(getSyncSnapshot()).toMatchObject({
        status: "synced",
        lastFailure: null,
      });
    });

    it("401을 받은 곡 push도 큐에 남겨 다시 올린다", async () => {
      push.mockRejectedValueOnce(new SessionExpiredError());

      scheduleDeckPush(deck("고친 곡"));
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(push).toHaveBeenCalledTimes(2);
      expect(push.mock.calls[1][0].title).toBe("고친 곡");
      expect(getSyncSnapshot().status).toBe("synced");
    });
  });

  describe("큐를 끈 뒤", () => {
    const C = "c0000000000000000000c";

    function deckOf(id: string): Deck {
      return { ...deck(), id };
    }

    function holdPushOnce(): {
      resolve: (saved: Deck) => void;
      reject: (err: unknown) => void;
    } {
      const settle: {
        resolve: (saved: Deck) => void;
        reject: (err: unknown) => void;
      } = { resolve: () => undefined, reject: () => undefined };
      push.mockImplementationOnce(
        () =>
          new Promise<Deck>((resolve, reject) => {
            settle.resolve = resolve;
            settle.reject = reject;
          }),
      );
      return settle;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("묶음의 첫 곡을 보내는 동안 끄면 그 뒤의 곡과 삭제는 보내지 않는다", async () => {
      const first = holdPushOnce();
      scheduleDeckPush(deckOf(A));
      scheduleDeckPush(deckOf(B));
      scheduleDeckDelete(C, USER);
      const flushing = flushDeckSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      setDeckSyncEnabled(false);
      first.resolve(deckOf(A));
      await flushing;

      expect(push).toHaveBeenCalledTimes(1);
      expect(remove).not.toHaveBeenCalled();
    });

    it("끈 뒤에 오프라인으로 끝난 곡은 백오프 타이머가 지나도 다시 보내지 않는다", async () => {
      vi.useFakeTimers();
      const first = holdPushOnce();
      scheduleDeckPush(deck());
      const flushing = flushDeckSync();
      await vi.advanceTimersByTimeAsync(0);
      expect(push).toHaveBeenCalledTimes(1);

      setDeckSyncEnabled(false);
      first.reject(new OfflineError());
      await flushing;
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

      expect(push).toHaveBeenCalledTimes(1);
    });

    it("끈 뒤에는 flush하거나 다시 시도해도 보내지 않는다", async () => {
      const first = holdPushOnce();
      scheduleDeckPush(deck());
      const flushing = flushDeckSync();
      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

      setDeckSyncEnabled(false);
      first.reject(new OfflineError());
      await flushing;
      await flushDeckSync();
      await retryDeckSyncNow("manual");

      expect(push).toHaveBeenCalledTimes(1);
    });
  });
});
