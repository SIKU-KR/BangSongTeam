import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage";
import { saveCachedSession, loadCachedSession } from "./sessionCache";
import {
  hydrateSession,
  revalidateSession,
  getSessionState,
  getCurrentUserId,
  __setSessionFetcherForTests,
  __resetSessionForTests,
  type SessionFetcher,
} from "./sessionStore";

const HOUR = 60 * 60 * 1000;
const USER_ID = "8f14e45fc1a2b3c4d5e6f";

function makeUser(overrides = {}) {
  return {
    userId: USER_ID,
    name: "봉사자",
    image: null,
    expiresAt: Date.now() + HOUR,
    ...overrides,
  };
}

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/** 서버에 닿지 못한 상황 (오프라인) */
const offlineFetcher: SessionFetcher = async () => {
  throw new Error("network down");
};

describe("세션 스토어", () => {
  beforeEach(async () => {
    await resetDatabase();
    __resetSessionForTests();
  });

  afterEach(() => {
    __resetSessionForTests();
    closeOfflineDB();
  });

  describe("부팅 하이드레이션", () => {
    it("캐시가 없고 서버에 세션이 없으면 미인증이다", async () => {
      __setSessionFetcherForTests(async () => null);

      await hydrateSession();

      expect(getSessionState().status).toBe("unauthenticated");
      expect(getCurrentUserId()).toBeNull();
    });

    it("캐시가 없어도 서버에 세션이 있으면 인증되고 캐시에 기록한다", async () => {
      __setSessionFetcherForTests(async () => makeUser());

      await hydrateSession();

      expect(getSessionState().status).toBe("authenticated");
      expect(getCurrentUserId()).toBe(USER_ID);
      expect((await loadCachedSession())?.userId).toBe(USER_ID);
    });

    it("캐시가 있으면 서버 응답을 기다리지 않고 즉시 통과시킨다", async () => {
      await saveCachedSession(makeUser());

      let resolveServer: (value: null) => void = () => {};
      const pending = new Promise<null>((resolve) => {
        resolveServer = resolve;
      });
      __setSessionFetcherForTests(() => pending);

      // 서버 응답이 아직 안 왔는데도 인증 상태여야 한다.
      await hydrateSession();
      expect(getSessionState().status).toBe("authenticated");

      resolveServer(null);
    });

    it("오프라인이고 캐시가 있으면 인증 상태를 유지한다", async () => {
      // 예배 당일 네트워크가 끊겼을 때 송출이 되어야 한다.
      await saveCachedSession(makeUser());
      __setSessionFetcherForTests(offlineFetcher);

      await hydrateSession();

      expect(getSessionState().status).toBe("authenticated");
      expect(getCurrentUserId()).toBe(USER_ID);
    });

    it("오프라인이고 캐시도 없으면 미인증이다", async () => {
      __setSessionFetcherForTests(offlineFetcher);

      await hydrateSession();

      expect(getSessionState().status).toBe("unauthenticated");
    });

    it("만료된 캐시는 통과시키지 않는다", async () => {
      await saveCachedSession(makeUser({ expiresAt: Date.now() - 1000 }));
      __setSessionFetcherForTests(async () => null);

      await hydrateSession();

      expect(getSessionState().status).toBe("unauthenticated");
    });
  });

  describe("백그라운드 재검증", () => {
    it("서버가 세션 없음을 답하면 로그아웃시키고 캐시를 비운다", async () => {
      await saveCachedSession(makeUser());
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();
      expect(getSessionState().status).toBe("authenticated");

      __setSessionFetcherForTests(async () => null);
      await revalidateSession();

      expect(getSessionState().status).toBe("unauthenticated");
      expect(await loadCachedSession()).toBeNull();
    });

    it("네트워크 실패는 상태를 건드리지 않는다", async () => {
      // 이것이 오프라인 송출을 지탱하는 규칙이다.
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();

      __setSessionFetcherForTests(offlineFetcher);
      await revalidateSession();

      expect(getSessionState().status).toBe("authenticated");
      expect(await loadCachedSession()).not.toBeNull();
    });

    it("사용자가 바뀌면 캐시를 새 사용자로 갱신한다", async () => {
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();

      const other = "bbbbbbbbc1a2b3c4d5e6f";
      __setSessionFetcherForTests(async () =>
        makeUser({ userId: other, name: "다른 봉사자" }),
      );
      await revalidateSession();

      expect(getCurrentUserId()).toBe(other);
      expect((await loadCachedSession())?.name).toBe("다른 봉사자");
    });

    it("하이드레이션이 백그라운드 재검증을 실제로 돌린다", async () => {
      await saveCachedSession(makeUser());
      const fetcher = vi.fn(async () => makeUser());
      __setSessionFetcherForTests(fetcher);

      await hydrateSession();
      // 백그라운드 호출이 큐에서 빠져나갈 틈을 준다
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetcher).toHaveBeenCalled();
    });
  });
});
