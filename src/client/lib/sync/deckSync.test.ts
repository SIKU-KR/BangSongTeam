import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "#shared";
import {
  scheduleDeckPush,
  scheduleDeckDelete,
  pushDeckNow,
  flushDeckSync,
  setDeckSyncEnabled,
  setServerDeckListener,
  __setDeckTransportForTests,
  __setDeckBackoffRandomForTests,
  __resetDeckSyncForTests,
} from "./deckSync";
import {
  OfflineError,
  ServerRejectedError,
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

const USER = "00000000x000000000001";
const A = "c0000000000000000000a";

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
  let remove: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;

  beforeEach(() => {
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
    scheduleDeckDelete(A);
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

    scheduleDeckDelete(A);
    await flushDeckSync();

    expect(remove).toHaveBeenCalledWith(A);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("pushDeckNow는 오프라인으로 밀린 곡이 남아 있으면 synced로 바꾸지 않는다", async () => {
    push.mockRejectedValueOnce(new OfflineError());
    scheduleDeckPush({ ...deck(), id: "c0000000000000000000b" });
    await flushDeckSync();
    expect(getSyncSnapshot().status).toBe("offline");

    await pushDeckNow(deck("공개"));

    expect(getSyncSnapshot().status).toBe("offline");
  });
});
