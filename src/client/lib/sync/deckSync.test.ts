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
  __resetDeckSyncForTests,
} from "./deckSync";
import { OfflineError, TimeoutError } from "../api/request";
import { installFakeApi } from "../../test/fakeApi";
import { getSyncSnapshot, __resetSyncStatusForTests } from "./syncStatus";

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
    __resetSyncStatusForTests();
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
});
