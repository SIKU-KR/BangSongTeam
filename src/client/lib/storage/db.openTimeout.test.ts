import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  BLOCKED_OPEN_TIMEOUT_MS,
  closeOfflineDB,
  getOfflineDB,
  OPEN_TIMEOUT_MS,
} from "./db";
import { clearPersistenceError } from "./persistenceStatus";
import {
  hydrateSession,
  __resetSessionForTests,
  __setSessionFetcherForTests,
} from "../auth/sessionStore";

vi.mock("idb", () => ({
  openDB: vi.fn(() => new Promise<never>(() => undefined)),
}));

vi.mock("../auth/authClient", () => ({ authClient: {} }));

describe("IndexedDB 열기가 끝나지 않을 때", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    closeOfflineDB();
    __resetSessionForTests();
  });

  afterEach(() => {
    closeOfflineDB();
    __resetSessionForTests();
    clearPersistenceError("session");
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("송출 화면 밖에서는 기한이 지나면 저장소를 쓸 수 없다고 알리고, 세션 복원은 멈추지 않는다", async () => {
    __setSessionFetcherForTests(async () => null);
    const rejected = expect(getOfflineDB()).rejects.toMatchObject({
      name: "PersistenceUnavailableError",
      reason: "unavailable",
    });
    const hydrated = hydrateSession();

    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS);

    await rejected;
    await expect(hydrated).resolves.toMatchObject({
      status: "unauthenticated",
    });
  });

  it("송출 화면에서는 기한이 지나도 기다린다", async () => {
    window.history.replaceState({}, "", "/present/x/fullscreen");
    let settled = false;
    void getOfflineDB().then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(
      OPEN_TIMEOUT_MS + BLOCKED_OPEN_TIMEOUT_MS,
    );

    expect(settled).toBe(false);
  });
});
