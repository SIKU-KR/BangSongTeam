import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SIGN_UP_IN_PROGRESS } from "#shared";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage/db";
import { authClient } from "./authClient";
import {
  saveCachedSession,
  loadCachedSession,
  type SessionUser,
} from "./sessionCache";
import {
  hydrateSession,
  revalidateSession,
  getSessionState,
  getCurrentUserId,
  listenToOtherTabs,
  requestSessionCheck,
  resumeDeferredSessionWork,
  setAccountHooks,
  signInWithEmail,
  signInWithProvider,
  signOut,
  signUpWithEmail,
  __setPageReloadForTests,
  __setSessionFetcherForTests,
  __resetSessionForTests,
  type SessionFetcher,
} from "./sessionStore";
import { installFakeBroadcastChannel } from "../../test/fakeBroadcastChannel";

vi.mock("./authClient", () => ({
  authClient: {
    getSession: vi.fn(),
    signIn: { social: vi.fn(), email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  },
}));

type CacheWrite = "save" | "clear";

const cacheWriteGates = vi.hoisted(
  () => new Map<CacheWrite, { reach: () => void; release: Promise<void> }>(),
);

vi.mock("./sessionCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sessionCache")>();
  const passGate = async (write: CacheWrite): Promise<void> => {
    const gate = cacheWriteGates.get(write);
    if (!gate) return;
    cacheWriteGates.delete(write);
    gate.reach();
    await gate.release;
  };
  return {
    ...actual,
    saveCachedSession: async (
      ...args: Parameters<typeof actual.saveCachedSession>
    ): Promise<void> => {
      await passGate("save");
      await actual.saveCachedSession(...args);
    },
    clearCachedSession: async (): Promise<void> => {
      await passGate("clear");
      await actual.clearCachedSession();
    },
  };
});

const getSession = vi.mocked(authClient.getSession);
const signInSocial = vi.mocked(authClient.signIn.social);
const signInEmail = vi.mocked(authClient.signIn.email);
const signUpEmail = vi.mocked(authClient.signUp.email);
const authSignOut = vi.mocked(authClient.signOut);

const HOUR = 60 * 60 * 1000;
const USER_ID = "8f14e45fc1a2b3c4d5e6f";
const OTHER_USER_ID = "bbbbbbbbc1a2b3c4d5e6f";
const SESSION_END_KEY = "chiton:session-end";
const SESSION_CHANNEL = "chiton:session";

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

function holdFetcher(): {
  fetcher: ReturnType<typeof vi.fn<SessionFetcher>>;
  answer: (user: SessionUser | null) => void;
} {
  const waiting: Array<(user: SessionUser | null) => void> = [];
  const fetcher = vi.fn<SessionFetcher>(
    () =>
      new Promise<SessionUser | null>((resolve) => {
        waiting.push(resolve);
      }),
  );
  __setSessionFetcherForTests(fetcher);
  return {
    fetcher,
    answer: (user) => {
      for (const resolve of waiting.splice(0)) resolve(user);
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function holdNextCacheWrite(write: CacheWrite): {
  reached: Promise<void>;
  release: () => void;
} {
  const reached = deferred<void>();
  const released = deferred<void>();
  cacheWriteGates.set(write, {
    reach: () => reached.resolve(),
    release: released.promise,
  });
  return { reached: reached.promise, release: () => released.resolve() };
}

function holdFlushBeforeSignOut(): () => void {
  const flushed = deferred<void>();
  setAccountHooks({
    flushBeforeSignOut: () => flushed.promise,
    stopAccountSync: vi.fn(async () => undefined),
  });
  return () => flushed.resolve();
}

async function signInAsCachedUser(): Promise<void> {
  await saveCachedSession(makeUser());
  __setSessionFetcherForTests(async () => makeUser());
  await hydrateSession();
  await revalidateSession();
}

type SignOutResult = Awaited<ReturnType<typeof authClient.signOut>>;

describe("세션 스토어", () => {
  let reload: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    await resetDatabase();
    __resetSessionForTests();
    reload = vi.fn<() => void>();
    __setPageReloadForTests(reload);
    window.sessionStorage.clear();
    authSignOut.mockResolvedValue({
      data: { success: true },
      error: null,
    } as SignOutResult);
  });

  afterEach(() => {
    cacheWriteGates.clear();
    __resetSessionForTests();
    closeOfflineDB();
    getSession.mockReset();
    authSignOut.mockReset();
    signInEmail.mockReset();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    window.sessionStorage.clear();
  });

  describe("부팅 하이드레이션", () => {
    it("캐시가 없고 서버에 세션이 없으면 미인증이다", async () => {
      __setSessionFetcherForTests(async () => null);

      await hydrateSession();

      expect(getSessionState()).toEqual({
        status: "unauthenticated",
        user: null,
      });
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

    it("만료된 캐시는 서버가 세션 없음을 답하면 캐시를 비우고 만료 사유와 함께 로그아웃한다", async () => {
      await saveExpiredSession();
      __setSessionFetcherForTests(async () => null);

      await hydrateSession();

      expect(getSessionState()).toEqual({
        status: "unauthenticated",
        user: null,
        reason: "expired",
      });
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

    describe("계정이 끝나 새로고침한 부팅", () => {
      it("유효한 캐시가 있어도 서버에 먼저 묻고 서버가 답한 사용자로 들어간다", async () => {
        window.sessionStorage.setItem(SESSION_END_KEY, "switched");
        await saveCachedSession(makeUser());
        __setSessionFetcherForTests(async () =>
          makeUser({ userId: OTHER_USER_ID, name: "다른 봉사자" }),
        );

        await hydrateSession();

        expect(getCurrentUserId()).toBe(OTHER_USER_ID);
        expect((await loadCachedSession())?.userId).toBe(OTHER_USER_ID);
        expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBeNull();
      });

      it("서버에 닿지 못하면 캐시된 사용자로 들어간다", async () => {
        window.sessionStorage.setItem(SESSION_END_KEY, "switched");
        await saveCachedSession(makeUser());
        __setSessionFetcherForTests(offlineFetcher);

        await hydrateSession();

        expect(getSessionState().status).toBe("authenticated");
        expect(getCurrentUserId()).toBe(USER_ID);
      });

      it("세션이 만료돼 끝났고 서버에 세션이 없으면 만료 사유와 함께 로그아웃한다", async () => {
        window.sessionStorage.setItem(SESSION_END_KEY, "expired");
        __setSessionFetcherForTests(async () => null);

        await hydrateSession();

        expect(getSessionState()).toEqual({
          status: "unauthenticated",
          user: null,
          reason: "expired",
        });
      });

      it("로그아웃해 끝났으면 서버에 세션이 없어도 만료됐다고 하지 않는다", async () => {
        window.sessionStorage.setItem(SESSION_END_KEY, "signedOut");
        await saveCachedSession(makeUser());
        __setSessionFetcherForTests(async () => null);

        await hydrateSession();

        expect(getSessionState()).toEqual({
          status: "unauthenticated",
          user: null,
        });
        expect(await loadCachedSession()).toBeNull();
      });

      it("송출 화면에서는 캐시로 들어가고 서버에 묻지 않는다", async () => {
        window.history.replaceState({}, "", "/present/abc/fullscreen");
        window.sessionStorage.setItem(SESSION_END_KEY, "switched");
        await saveCachedSession(makeUser());
        const fetcher = vi.fn(async () => null);
        __setSessionFetcherForTests(fetcher);

        await hydrateSession();

        expect(getCurrentUserId()).toBe(USER_ID);
        expect(fetcher).not.toHaveBeenCalled();
      });

      it("하이드레이션을 겹쳐 불러도 서버에 한 번만 묻고 같은 사용자로 끝난다", async () => {
        window.sessionStorage.setItem(SESSION_END_KEY, "switched");
        await saveCachedSession(makeUser());
        const fetcher = vi.fn(async () =>
          makeUser({ userId: OTHER_USER_ID, name: "다른 봉사자" }),
        );
        __setSessionFetcherForTests(fetcher);

        const [first, second] = await Promise.all([
          hydrateSession(),
          hydrateSession(),
        ]);

        expect(first.user?.userId).toBe(OTHER_USER_ID);
        expect(second.user?.userId).toBe(OTHER_USER_ID);
        expect(fetcher).toHaveBeenCalledTimes(1);
      });
    });

    it("부팅 확인이 늦게 끝나도 그사이 이메일로 로그인한 세션을 덮지 않는다", async () => {
      const boot = holdFetcher();
      const hydrating = hydrateSession();
      await vi.waitFor(() => expect(boot.fetcher).toHaveBeenCalled());

      signInEmail.mockResolvedValueOnce({ data: {}, error: null } as never);
      __setSessionFetcherForTests(async () => makeUser());
      await signInWithEmail("team@example.com", "password-1234");
      boot.answer(null);
      await hydrating;

      expect(getCurrentUserId()).toBe(USER_ID);
      expect((await loadCachedSession())?.userId).toBe(USER_ID);
    });

    it.each([
      {
        step: "받은 세션을 캐시에 쓰는",
        write: "save",
        seed: async () => undefined,
        answer: makeUser({ userId: OTHER_USER_ID }),
      },
      {
        step: "만료된 캐시를 지우는",
        write: "clear",
        seed: saveExpiredSession,
        answer: null,
      },
    ] as const)(
      "부팅이 $step 사이 이메일로 로그인하면 늦게 끝난 부팅이 그 세션을 덮지 않는다",
      async ({ write, seed, answer }) => {
        await seed();
        const held = holdNextCacheWrite(write);
        __setSessionFetcherForTests(async () => answer);
        const hydrating = hydrateSession();
        await held.reached;

        signInEmail.mockResolvedValueOnce({ data: {}, error: null } as never);
        __setSessionFetcherForTests(async () => makeUser());
        await signInWithEmail("team@example.com", "password-1234");
        held.release();
        await hydrating;

        expect(getSessionState().status).toBe("authenticated");
        expect(getCurrentUserId()).toBe(USER_ID);
      },
    );
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
    it("서버가 세션 없음을 답하면 캐시를 비우고 만료 사유를 남긴 뒤 새로고침한다", async () => {
      await signInAsCachedUser();
      expect(getSessionState().status).toBe("authenticated");

      __setSessionFetcherForTests(async () => null);
      await revalidateSession();

      expect(await loadCachedSession()).toBeNull();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("expired");
      expect(getSessionState()).toEqual({ status: "loading", user: null });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("네트워크 실패는 상태를 건드리지 않는다", async () => {
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();

      __setSessionFetcherForTests(offlineFetcher);
      await revalidateSession();

      expect(getSessionState().status).toBe("authenticated");
      expect(await loadCachedSession()).not.toBeNull();
    });

    it("다른 사용자로 바뀌면 새 사용자를 저장하고 새로고침한다", async () => {
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();

      __setSessionFetcherForTests(async () =>
        makeUser({ userId: OTHER_USER_ID, name: "다른 봉사자" }),
      );
      await revalidateSession();

      expect((await loadCachedSession())?.name).toBe("다른 봉사자");
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("switched");
      expect(getSessionState()).toEqual({ status: "loading", user: null });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("같은 사용자면 만료 시각만 갱신하고 새로고침하지 않는다", async () => {
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();

      const renewed = Date.now() + 7 * 24 * HOUR;
      __setSessionFetcherForTests(async () => makeUser({ expiresAt: renewed }));
      await revalidateSession();

      expect(getSessionState().user?.expiresAt).toBe(renewed);
      expect((await loadCachedSession())?.expiresAt).toBe(renewed);
      expect(reload).not.toHaveBeenCalled();
    });

    it("겹쳐 불러도 서버에 한 번만 묻는다", async () => {
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();

      const check = holdFetcher();
      const first = revalidateSession();
      const second = revalidateSession();
      check.answer(makeUser());
      await Promise.all([first, second]);

      expect(check.fetcher).toHaveBeenCalledTimes(1);
    });

    it("로그아웃 전에 시작한 재검증이 늦게 끝나도 캐시와 상태를 쓰지 않는다", async () => {
      await signInAsCachedUser();

      const check = holdFetcher();
      const checking = revalidateSession();
      await vi.waitFor(() => expect(check.fetcher).toHaveBeenCalled());
      await signOut();
      check.answer(makeUser({ name: "늦은 응답" }));
      await checking;

      expect(await loadCachedSession()).toBeNull();
      expect(getSessionState()).toEqual({ status: "loading", user: null });
      expect(reload).toHaveBeenCalledTimes(1);
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

  describe("계정이 끝날 때", () => {
    it("로그아웃은 서버에 알리기 전에 대기 중인 변경을 보내고, 새로고침하기 전에 동기화를 끈다", async () => {
      await signInAsCachedUser();
      const order: string[] = [];
      setAccountHooks({
        flushBeforeSignOut: async () => {
          await Promise.resolve();
          order.push("flushed");
        },
        stopAccountSync: async () => {
          order.push("stop");
          await Promise.resolve();
          order.push("stopped");
        },
      });
      authSignOut.mockImplementation(async () => {
        order.push("signOut");
        return { data: { success: true }, error: null } as SignOutResult;
      });
      reload.mockImplementation(() => {
        order.push("reload");
      });

      await signOut();

      expect(order).toEqual([
        "flushed",
        "signOut",
        "stop",
        "stopped",
        "reload",
      ]);
      expect(await loadCachedSession()).toBeNull();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("signedOut");
      expect(getSessionState()).toEqual({ status: "loading", user: null });
    });

    it("로그아웃을 겹쳐 눌러도 서버에 한 번만 알리고 한 번만 새로고침한다", async () => {
      await signInAsCachedUser();

      await Promise.all([signOut(), signOut()]);

      expect(authSignOut).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it.each([
      { answer: "세션 없음", user: null },
      { answer: "다른 사용자", user: makeUser({ userId: OTHER_USER_ID }) },
    ])(
      "로그아웃이 변경을 보내는 동안 끝난 재검증($answer)은 로그아웃을 끊지 않는다",
      async ({ user }) => {
        await signInAsCachedUser();
        const finishFlush = holdFlushBeforeSignOut();
        const check = holdFetcher();
        const checking = revalidateSession();
        await vi.waitFor(() => expect(check.fetcher).toHaveBeenCalled());

        const signingOut = signOut();
        check.answer(user);
        await checking;

        expect(reload).not.toHaveBeenCalled();

        finishFlush();
        await signingOut;

        expect(authSignOut).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe(
          "signedOut",
        );
      },
    );

    it.each([
      { step: "세션 없음을 받아 캐시를 지우는", write: "clear", user: null },
      {
        step: "다른 사용자를 받아 캐시에 쓰는",
        write: "save",
        user: makeUser({ userId: OTHER_USER_ID }),
      },
    ] as const)(
      "재검증이 $step 사이 로그아웃을 시작해도 재검증이 로그아웃을 끊지 않는다",
      async ({ write, user }) => {
        await signInAsCachedUser();
        const finishFlush = holdFlushBeforeSignOut();
        const held = holdNextCacheWrite(write);
        __setSessionFetcherForTests(async () => user);
        const checking = revalidateSession();
        await held.reached;

        const signingOut = signOut();
        held.release();
        await checking;

        expect(reload).not.toHaveBeenCalled();

        finishFlush();
        await signingOut;

        expect(authSignOut).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe(
          "signedOut",
        );
      },
    );

    it("서버에 로그아웃을 알리지 못해도 이 탭은 로그아웃하고 새로고침한다", async () => {
      await signInAsCachedUser();
      authSignOut.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await signOut();

      expect(await loadCachedSession()).toBeNull();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("동기화를 끄는 사이 주소가 송출 화면으로 바뀌어도 새로고침한다", async () => {
      await signInAsCachedUser();
      const stopped = deferred<void>();
      setAccountHooks({
        flushBeforeSignOut: vi.fn(async () => undefined),
        stopAccountSync: () => stopped.promise,
      });
      __setSessionFetcherForTests(async () => null);

      const checking = revalidateSession();
      await vi.waitFor(() =>
        expect(getSessionState()).toEqual({ status: "loading", user: null }),
      );
      window.history.replaceState({}, "", "/present/abc/fullscreen");
      stopped.resolve();
      await checking;

      expect(reload).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("expired");
    });

    it("송출 중에 계정이 끝나면 동기화만 끄고, 새로고침은 송출을 마친 뒤에 한 번 한다", async () => {
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();
      const stopAccountSync = vi.fn(async () => undefined);
      setAccountHooks({
        flushBeforeSignOut: vi.fn(async () => undefined),
        stopAccountSync,
      });

      const check = holdFetcher();
      const checking = revalidateSession();
      await vi.waitFor(() => expect(check.fetcher).toHaveBeenCalled());
      window.history.replaceState({}, "", "/present/abc/fullscreen");
      check.answer(null);
      await checking;

      expect(stopAccountSync).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
      expect(getSessionState().status).toBe("authenticated");
      expect(getCurrentUserId()).toBe(USER_ID);

      await signOut();
      resumeDeferredSessionWork();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(authSignOut).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();

      window.history.replaceState({}, "", "/presentations");
      resumeDeferredSessionWork();
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

      expect(getSessionState()).toEqual({ status: "loading", user: null });
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("expired");

      resumeDeferredSessionWork();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("송출 중에 계정이 끝난 뒤의 재검증은 캐시에 쓰지 않고 동기화를 다시 끄지 않는다", async () => {
      __setSessionFetcherForTests(async () => makeUser());
      await hydrateSession();
      const stopAccountSync = vi.fn(async () => undefined);
      setAccountHooks({
        flushBeforeSignOut: vi.fn(async () => undefined),
        stopAccountSync,
      });
      window.history.replaceState({}, "", "/present/abc/fullscreen");

      __setSessionFetcherForTests(async () => null);
      await revalidateSession();
      __setSessionFetcherForTests(async () =>
        makeUser({ userId: OTHER_USER_ID }),
      );
      await revalidateSession();

      expect(await loadCachedSession()).toBeNull();
      expect(stopAccountSync).toHaveBeenCalledTimes(1);
      expect(getCurrentUserId()).toBe(USER_ID);
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe("401·403 뒤의 세션 확인 (requestSessionCheck)", () => {
    it("로그인한 탭에서만 확인하고, 겹쳐 불러도 서버에 한 번만 묻는다", async () => {
      const loading = holdFetcher();
      requestSessionCheck();
      expect(loading.fetcher).not.toHaveBeenCalled();

      __setSessionFetcherForTests(async () => null);
      await hydrateSession();
      const signedOut = holdFetcher();
      requestSessionCheck();
      expect(signedOut.fetcher).not.toHaveBeenCalled();

      await signInAsCachedUser();
      const check = holdFetcher();
      requestSessionCheck();
      requestSessionCheck();
      check.answer(makeUser());
      await revalidateSession();

      expect(check.fetcher).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
    });

    it("확인한 서버가 세션 없음을 답하면 만료로 계정을 끝낸다", async () => {
      await signInAsCachedUser();
      __setSessionFetcherForTests(async () => null);

      requestSessionCheck();

      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("expired");
      expect(await loadCachedSession()).toBeNull();
    });

    it("로그아웃이 변경을 보내는 동안에는 확인하지 않는다", async () => {
      await signInAsCachedUser();
      const finishFlush = holdFlushBeforeSignOut();
      const fetcher = vi.fn<SessionFetcher>(async () => null);
      __setSessionFetcherForTests(fetcher);

      const signingOut = signOut();
      requestSessionCheck();
      finishFlush();
      await signingOut;

      expect(fetcher).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("signedOut");
    });

    it("계정이 끝난 뒤에는 확인하지 않는다", async () => {
      await signInAsCachedUser();
      window.history.replaceState({}, "", "/present/x/fullscreen");
      __setSessionFetcherForTests(async () => null);
      await revalidateSession();
      const fetcher = vi.fn<SessionFetcher>(async () => makeUser());
      __setSessionFetcherForTests(fetcher);

      requestSessionCheck();
      window.history.replaceState({}, "", "/presentations");
      resumeDeferredSessionWork();
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

      expect(fetcher).not.toHaveBeenCalled();
    });

    it("송출 중에는 묻지 않고, 송출을 마치면 한 번 확인한다", async () => {
      await signInAsCachedUser();
      const fetcher = vi.fn<SessionFetcher>(async () => makeUser());
      __setSessionFetcherForTests(fetcher);
      window.history.replaceState({}, "", "/present/x/fullscreen");

      requestSessionCheck();
      requestSessionCheck();
      resumeDeferredSessionWork();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetcher).not.toHaveBeenCalled();

      window.history.replaceState({}, "", "/presentations");
      resumeDeferredSessionWork();
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      resumeDeferredSessionWork();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe("다른 탭의 로그인 변화 (listenToOtherTabs)", () => {
    let tabs: ReturnType<typeof installFakeBroadcastChannel>;
    let stopListening: () => void;

    function nextTask(): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    beforeEach(() => {
      tabs = installFakeBroadcastChannel();
      stopListening = listenToOtherTabs();
    });

    afterEach(() => {
      stopListening();
      vi.unstubAllGlobals();
    });

    it("다른 탭이 로그아웃했다고 알리면 캐시를 비우고 새로고침한다", async () => {
      await signInAsCachedUser();
      const other = tabs.otherTab(SESSION_CHANNEL);

      other.post({ userId: null });

      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(await loadCachedSession()).toBeNull();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("otherTab");
      expect(getSessionState()).toEqual({ status: "loading", user: null });
    });

    it("다른 탭이 다른 계정으로 로그인했다고 알리면 캐시를 그대로 두고 새로고침한다", async () => {
      await signInAsCachedUser();
      const other = tabs.otherTab(SESSION_CHANNEL);

      other.post({ userId: OTHER_USER_ID });

      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect((await loadCachedSession())?.userId).toBe(USER_ID);
    });

    it("같은 계정이라는 알림과 모양이 다른 메시지는 무시한다", async () => {
      await signInAsCachedUser();
      const other = tabs.otherTab(SESSION_CHANNEL);

      other.post({ userId: USER_ID });
      other.post({ userId: 42 });
      other.post("로그아웃");
      await nextTask();

      expect(reload).not.toHaveBeenCalled();
      expect(getCurrentUserId()).toBe(USER_ID);
    });

    it("로그인하지 않은 탭은 어떤 알림에도 그대로 있다", async () => {
      __setSessionFetcherForTests(async () => null);
      await hydrateSession();
      const other = tabs.otherTab(SESSION_CHANNEL);

      other.post({ userId: OTHER_USER_ID });
      other.post({ userId: null });
      await nextTask();

      expect(reload).not.toHaveBeenCalled();
      expect(getSessionState().status).toBe("unauthenticated");
    });

    it("부팅 중인 탭은 알림을 받으면 새로고침한다", async () => {
      const boot = holdFetcher();
      const hydrating = hydrateSession();
      await vi.waitFor(() => expect(boot.fetcher).toHaveBeenCalled());
      const other = tabs.otherTab(SESSION_CHANNEL);

      other.post({ userId: OTHER_USER_ID });
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      boot.answer(makeUser());
      await hydrating;

      expect(getSessionState()).toEqual({ status: "loading", user: null });
    });

    it("송출 중이면 동기화만 끄고, 새로고침은 송출을 마친 뒤에 한다", async () => {
      await signInAsCachedUser();
      const stopAccountSync = vi.fn(async () => undefined);
      setAccountHooks({
        flushBeforeSignOut: vi.fn(async () => undefined),
        stopAccountSync,
      });
      window.history.replaceState({}, "", "/present/abc/fullscreen");
      const other = tabs.otherTab(SESSION_CHANNEL);

      other.post({ userId: OTHER_USER_ID });
      await vi.waitFor(() => expect(stopAccountSync).toHaveBeenCalledTimes(1));
      other.post({ userId: null });
      await nextTask();

      expect(reload).not.toHaveBeenCalled();
      expect(getCurrentUserId()).toBe(USER_ID);
      expect(stopAccountSync).toHaveBeenCalledTimes(1);

      window.history.replaceState({}, "", "/presentations");
      resumeDeferredSessionWork();

      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("otherTab");
    });

    it("로그아웃·이메일 로그인·세션 확인 결과를 알리고, 부팅은 알리지 않는다", async () => {
      const other = tabs.otherTab(SESSION_CHANNEL);
      await signInAsCachedUser();
      await nextTask();
      expect(other.received).toEqual([]);

      await signOut();
      await nextTask();
      expect(other.received).toEqual([{ userId: null }]);

      __resetSessionForTests();
      __setPageReloadForTests(reload);
      stopListening = listenToOtherTabs();
      __setSessionFetcherForTests(async () => null);
      await hydrateSession();
      signInEmail.mockResolvedValueOnce({ data: {}, error: null } as never);
      __setSessionFetcherForTests(async () => makeUser());
      await signInWithEmail("team@example.com", "password-1234");
      await nextTask();
      expect(other.received).toEqual([{ userId: null }, { userId: USER_ID }]);

      __setSessionFetcherForTests(async () =>
        makeUser({ userId: OTHER_USER_ID }),
      );
      await revalidateSession();
      await nextTask();
      expect(other.received).toEqual([
        { userId: null },
        { userId: USER_ID },
        { userId: OTHER_USER_ID },
      ]);
    });

    it("세션 확인이 세션 없음을 찾으면 다른 탭에 로그아웃을 알린다", async () => {
      const other = tabs.otherTab(SESSION_CHANNEL);
      await signInAsCachedUser();

      __setSessionFetcherForTests(async () => null);
      await revalidateSession();
      await nextTask();

      expect(other.received).toEqual([{ userId: null }]);
    });

    it("로그아웃이 변경을 보내는 동안 다른 탭이 바뀌면 서버에 알리지 않고 한 번 새로고침한다", async () => {
      await signInAsCachedUser();
      const finishFlush = holdFlushBeforeSignOut();
      const other = tabs.otherTab(SESSION_CHANNEL);

      const signingOut = signOut();
      other.post({ userId: OTHER_USER_ID });
      await nextTask();
      expect(reload).not.toHaveBeenCalled();

      finishFlush();
      await signingOut;

      expect(authSignOut).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("otherTab");
    });

    it("로그아웃 요청 중에 다른 탭이 로그인하면 그 탭이 남긴 세션 캐시를 지우지 않는다", async () => {
      await signInAsCachedUser();
      const sent = deferred<SignOutResult>();
      authSignOut.mockReturnValueOnce(sent.promise);
      const other = tabs.otherTab(SESSION_CHANNEL);

      const signingOut = signOut();
      await vi.waitFor(() => expect(authSignOut).toHaveBeenCalledTimes(1));
      await saveCachedSession(makeUser({ userId: OTHER_USER_ID }));
      other.post({ userId: OTHER_USER_ID });
      await nextTask();
      sent.resolve({ data: { success: true }, error: null } as SignOutResult);
      await signingOut;

      expect((await loadCachedSession())?.userId).toBe(OTHER_USER_ID);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe("signInWithEmail", () => {
    it("로그인하면 서버 세션으로 들어가고 캐시에 기록한다", async () => {
      __setSessionFetcherForTests(async () => null);
      await hydrateSession();

      signInEmail.mockResolvedValueOnce({ data: {}, error: null } as never);
      __setSessionFetcherForTests(async () => makeUser());
      await signInWithEmail("team@example.com", "password-1234");

      expect(getCurrentUserId()).toBe(USER_ID);
      expect((await loadCachedSession())?.userId).toBe(USER_ID);
      expect(reload).not.toHaveBeenCalled();
    });

    it("로그인을 겹쳐 하면 나중에 시작한 로그인의 세션으로 들어간다", async () => {
      __setSessionFetcherForTests(async () => null);
      await hydrateSession();
      signInEmail.mockResolvedValue({ data: {}, error: null } as never);

      const held = holdNextCacheWrite("save");
      __setSessionFetcherForTests(async () =>
        makeUser({ userId: OTHER_USER_ID }),
      );
      const first = signInWithEmail("other@example.com", "password-1234");
      await held.reached;
      __setSessionFetcherForTests(async () => makeUser());
      await signInWithEmail("team@example.com", "password-1234");
      held.release();
      await first;

      expect(getSessionState().status).toBe("authenticated");
      expect(getCurrentUserId()).toBe(USER_ID);
    });
  });

  describe("signInWithProvider", () => {
    it("서버가 로그인 시작을 거절하면 던져 화면이 안내하게 한다", async () => {
      signInSocial.mockResolvedValueOnce({
        data: null,
        error: {
          status: 404,
          statusText: "Not Found",
          message: "Provider not found",
        },
      } as never);

      await expect(signInWithProvider("kakao")).rejects.toThrow();
    });
  });

  describe("signUpWithEmail", () => {
    const input = {
      name: "찬양팀",
      email: "team@example.com",
      password: "password-1234",
    };

    function rejectSignUp(code: string, status = 422): void {
      signUpEmail.mockResolvedValueOnce({
        data: null,
        error: { status, statusText: "", code },
      } as never);
    }

    it("이미 가입한 이메일이라는 답이면 로그인하라고 안내한다", async () => {
      rejectSignUp("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");

      await expect(signUpWithEmail(input)).rejects.toMatchObject({
        reason: "alreadyExists",
      });
    });

    it("서버가 사용자를 만들지 못한 422는 이미 가입했다고 하지 않고 다시 시도하게 한다", async () => {
      rejectSignUp("FAILED_TO_CREATE_USER");

      await expect(signUpWithEmail(input)).rejects.toMatchObject({
        reason: "unknown",
      });
    });

    it("같은 이메일의 가입이 아직 끝나지 않았다는 409도 이미 가입했다고 하지 않고 다시 시도하게 한다", async () => {
      rejectSignUp(SIGN_UP_IN_PROGRESS, 409);

      await expect(signUpWithEmail(input)).rejects.toMatchObject({
        reason: "unknown",
      });
    });
  });
});
