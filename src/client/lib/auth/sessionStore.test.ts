import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage/db";
import { authClient } from "./authClient";
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

vi.mock("./authClient", () => ({
  authClient: { getSession: vi.fn() },
}));

const getSession = vi.mocked(authClient.getSession);

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

const offlineFetcher: SessionFetcher = async () => {
  throw new Error("network down");
};

type GetSessionResult = Awaited<ReturnType<typeof authClient.getSession>>;

function serverAnswers(result: unknown): void {
  getSession.mockResolvedValue(result as GetSessionResult);
  __setSessionFetcherForTests(null);
}

function serverError(status: number): unknown {
  return { data: null, error: { status, statusText: "" } };
}

async function saveExpiredSession(): Promise<void> {
  await saveCachedSession(makeUser({ expiresAt: Date.now() - 1000 }));
}

describe("세션 스토어", () => {
  beforeEach(async () => {
    await resetDatabase();
    __resetSessionForTests();
  });

  afterEach(() => {
    __resetSessionForTests();
    closeOfflineDB();
    getSession.mockReset();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
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

      await hydrateSession();
      expect(getSessionState().status).toBe("authenticated");

      resolveServer(null);
    });

    it("오프라인이고 캐시가 있으면 인증 상태를 유지한다", async () => {
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

    it("만료된 캐시는 서버가 세션 없음을 답하면 로그아웃하고 캐시를 비운다", async () => {
      await saveExpiredSession();
      __setSessionFetcherForTests(async () => null);

      await hydrateSession();

      expect(getSessionState().status).toBe("unauthenticated");
      expect(await loadCachedSession()).toBeNull();
    });

    it("만료된 캐시라도 서버에 닿지 못하면 캐시된 사용자로 들어가고 캐시를 지킨다", async () => {
      await saveExpiredSession();
      __setSessionFetcherForTests(offlineFetcher);

      await hydrateSession();

      expect(getSessionState().status).toBe("authenticated");
      expect(getCurrentUserId()).toBe(USER_ID);
      expect((await loadCachedSession())?.userId).toBe(USER_ID);
    });

    it("만료된 캐시는 서버가 세션을 돌려주면 만료 시각을 갱신한다", async () => {
      await saveExpiredSession();
      const renewed = Date.now() + 7 * 24 * HOUR;
      __setSessionFetcherForTests(async () => makeUser({ expiresAt: renewed }));

      await hydrateSession();

      expect(getSessionState().status).toBe("authenticated");
      expect((await loadCachedSession())?.expiresAt).toBe(renewed);
    });

    it("송출 화면에서 부팅하면 유효한 캐시로 들어가고 서버에 묻지 않는다", async () => {
      window.history.replaceState({}, "", "/present/abc/fullscreen");
      await saveCachedSession(makeUser());
      const fetcher = vi.fn(async () => null);
      __setSessionFetcherForTests(fetcher);

      await hydrateSession();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getSessionState().status).toBe("authenticated");
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("송출 화면에서 부팅하면 만료된 캐시로도 들어가고 서버에 묻지 않는다", async () => {
      window.history.replaceState({}, "", "/present/abc/fullscreen");
      await saveExpiredSession();
      const fetcher = vi.fn(async () => null);
      __setSessionFetcherForTests(fetcher);

      await hydrateSession();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getSessionState().status).toBe("authenticated");
      expect(getCurrentUserId()).toBe(USER_ID);
      expect(fetcher).not.toHaveBeenCalled();
      expect((await loadCachedSession())?.userId).toBe(USER_ID);
    });
  });

  describe("서버 응답 해석", () => {
    it.each([
      ["500", serverError(500)],
      ["429", serverError(429)],
      ["403", serverError(403)],
      ["상태 코드 없는 오류", { data: null, error: { statusText: "" } }],
      ["캡티브 포털 HTML", { data: "<html>login</html>", error: null }],
      ["모양이 다른 본문", { data: { user: {} }, error: null }],
    ])("%s 응답은 만료된 캐시로 로그인 상태를 지킨다", async (_, result) => {
      await saveExpiredSession();
      serverAnswers(result);

      await hydrateSession();

      expect(getSessionState().status).toBe("authenticated");
      expect((await loadCachedSession())?.userId).toBe(USER_ID);
    });

    it.each([
      ["500", serverError(500)],
      ["캡티브 포털 HTML", { data: "<html>login</html>", error: null }],
    ])("재검증 중 %s 응답은 로그아웃시키지 않는다", async (_, result) => {
      await saveCachedSession(makeUser());
      serverAnswers(result);

      await hydrateSession();
      await revalidateSession();

      expect(getSessionState().status).toBe("authenticated");
      expect(await loadCachedSession()).not.toBeNull();
    });

    it.each([
      ["401", serverError(401)],
      ["data: null", { data: null, error: null }],
    ])("%s 응답은 로그아웃하고 캐시를 비운다", async (_, result) => {
      await saveExpiredSession();
      serverAnswers(result);

      await hydrateSession();

      expect(getSessionState().status).toBe("unauthenticated");
      expect(await loadCachedSession()).toBeNull();
    });

    it("세션 본문을 사용자로 바꾸고 요청에 시간 제한을 건다", async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * HOUR);
      serverAnswers({
        data: {
          user: { id: USER_ID, name: null, image: null },
          session: { expiresAt: expiresAt.toISOString() },
        },
        error: null,
      });

      await hydrateSession();

      expect(getSessionState().user).toMatchObject({
        userId: USER_ID,
        expiresAt: expiresAt.getTime(),
      });
      expect(getSession).toHaveBeenCalledWith({
        fetchOptions: { signal: expect.any(AbortSignal) },
      });
    });

    it.each([
      ["만료된 캐시", true, "authenticated", 5000],
      ["캐시 없음", false, "unauthenticated", 15000],
    ] as const)(
      "%s에서 응답 없는 요청은 시간 제한이 지나면 부팅을 마친다",
      async (_, hasCache, status, timeoutMs) => {
        if (hasCache) await saveExpiredSession();
        const deadline = new AbortController();
        const timeout = vi
          .spyOn(AbortSignal, "timeout")
          .mockReturnValue(deadline.signal);
        getSession.mockImplementation(
          () =>
            new Promise((_, reject) => {
              deadline.signal.addEventListener("abort", () =>
                reject(deadline.signal.reason),
              );
            }),
        );
        __setSessionFetcherForTests(null);

        const hydrating = hydrateSession();
        await vi.waitFor(() => expect(getSession).toHaveBeenCalled());
        deadline.abort(new DOMException("timeout", "TimeoutError"));
        await hydrating;

        expect(timeout).toHaveBeenCalledWith(timeoutMs);
        expect(getSessionState().status).toBe(status);
      },
    );
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
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetcher).toHaveBeenCalled();
    });
  });
});
