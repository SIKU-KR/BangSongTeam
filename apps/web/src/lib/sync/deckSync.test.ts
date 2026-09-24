import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "@repo/shared";
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
import { OfflineError } from "./presentationSync";
import { getSyncStatus, __resetSyncStatusForTests } from "./syncStatus";

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
    expect(getSyncStatus()).toBe("synced");
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
    expect(getSyncStatus()).toBe("offline");

    await flushDeckSync();
    expect(push).toHaveBeenCalledTimes(2);
    expect(getSyncStatus()).toBe("synced");
  });

  it("marks the status as error on a rejected push without retrying", async () => {
    push.mockRejectedValueOnce(new Error("400"));
    scheduleDeckPush(deck());
    await flushDeckSync();
    expect(getSyncStatus()).toBe("error");
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
