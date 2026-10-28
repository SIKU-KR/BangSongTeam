import {
  screen,
  act,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderApp } from "./test/nextApp";
import {
  createNewPresentation,
  resetPresentationStore,
} from "./features/presentation/presentationStore";
import { closeOfflineDB, OFFLINE_DB_NAME } from "./lib/storage/db";
import { authClient } from "./lib/auth/authClient";
import {
  revalidateSession,
  __setPageReloadForTests,
  __setSessionFetcherForTests,
  __setSessionForTests,
  type SessionFetcher,
} from "./lib/auth/sessionStore";
import {
  loadCachedSession,
  saveCachedSession,
  type SessionUser,
} from "./lib/auth/sessionCache";
import { __resetBootSyncForTests } from "./lib/sync/bootSync";
import { __resetDeckSyncForTests } from "./lib/sync/deckSync";
import { __resetFolderSyncForTests } from "./lib/sync/folderSync";
import {
  __resetSyncSchedulerForTests,
  flushPendingSync,
  scheduleDocumentPush,
} from "./lib/sync/syncScheduler";
import {
  retrySyncNow,
  __waitForSyncRecoveryForTests,
} from "./lib/sync/syncRecovery";
import { getSyncSnapshot, resetSyncStatus } from "./lib/sync/syncStatus";
import { __resetConnectivityForTests } from "./lib/api/connectivity";
import { installFakeApi, type FakeApi, type FakeRoute } from "./test/fakeApi";
import { installFakeBroadcastChannel } from "./test/fakeBroadcastChannel";
import {
  signInAsTestUser,
  signOutForTests,
  seedPresentationsIntoStorage,
} from "./test/sessionFixture";
import {
  APP_NAME,
  MEDIA_URL_PREFIX,
  type FolderListResponse,
  type Presentation,
} from "#shared";
import { SHELL_COPY } from "#copy/shell";
import { ERROR_COPY } from "#copy/common";
import {
  SEED_PRESENTATION_IDS,
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "./test/presentationFixture";

// better-auth 클라이언트는 만들 때 fetch를 잡아 두어 installFakeApi가 바꾼 fetch를 쓰지 않는다.
// better-auth@1.7.12 dist/client/config.mjs (`customFetchImpl: fetch`)
vi.mock("./lib/auth/authClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/auth/authClient")>()),
  authClient: {
    getSession: vi.fn(),
    signIn: { social: vi.fn(), email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(async () => ({ data: { success: true }, error: null })),
  },
}));

const backgroundHydration = vi.hoisted(() => ({
  held: null as Promise<void> | null,
}));

vi.mock("./features/backgrounds/backgroundCatalog", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./features/backgrounds/backgroundCatalog")
    >();
  return {
    ...actual,
    hydrateBackgroundCatalog: (): Promise<void> =>
      backgroundHydration.held ?? actual.hydrateBackgroundCatalog(),
  };
});

const DOC_ID = SEED_PRESENTATION_IDS[0];
const OTHER_USER_ID = "999999999999999999999";
const SESSION_END_KEY = "chiton:session-end";
const SIGN_OUT_PENDING_KEY = "chiton:sign-out-pending";
const HOUR = 60 * 60 * 1000;

const EMPTY_FOLDER_LIST: FolderListResponse = {
  folders: [],
  tombstones: { folderIds: [], presentationIds: [] },
};

const NEW_DOC: Presentation = {
  id: "n00000000000000000001",
  userId: SEED_USER_ID,
  title: "다른 기기에서 만든 세트",
  serviceDate: "2026-10-25",
  items: [],
  folderId: null,
  trashedAt: null,
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
};

function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: SEED_USER_ID,
    name: "테스트 봉사자",
    image: null,
    expiresAt: Date.now() + HOUR,
    ...overrides,
  };
}

function bootRoutes(
  overrides: Record<string, FakeRoute> = {},
): Record<string, FakeRoute> {
  return {
    "GET /api/folders": () => ({ body: EMPTY_FOLDER_LIST }),
    "GET /api/presentations": () => ({
      body: { presentations: SEED_PRESENTATIONS },
    }),
    "GET /api/decks": () => ({ body: { decks: [], deletedIds: [] } }),
    "GET /api/backgrounds": () => ({ body: { backgrounds: [] } }),
    "PATCH /api/presentations/*": () => ({ body: { ok: true } }),
    "PUT /api/folders/*": ({ body }) => ({ body: { folder: body } }),
    ...overrides,
  };
}

function apiRequests(api: FakeApi): string[] {
  return api.calls
    .filter(
      ({ path }) =>
        path.startsWith("/api/") && !path.startsWith(MEDIA_URL_PREFIX),
    )
    .map(({ method, path }) => `${method} ${path}`);
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

function resetSyncModules(): void {
  __resetBootSyncForTests();
  __resetFolderSyncForTests();
  __resetDeckSyncForTests();
  __resetSyncSchedulerForTests();
  resetSyncStatus();
}

function renderAt(path: string) {
  return renderApp(path);
}

describe("App Route Integration", () => {
  let tabs: ReturnType<typeof installFakeBroadcastChannel>;

  beforeEach(async () => {
    tabs = installFakeBroadcastChannel();
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    resetPresentationStore();

    signInAsTestUser();
    await seedPresentationsIntoStorage();
  });

  afterEach(() => {
    signOutForTests();
    closeOfflineDB();
    vi.unstubAllGlobals();
  });

  it("should render the landing placeholder at '/'", async () => {
    renderAt("/");

    expect(await screen.findByTestId("landing-route")).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-row")).not.toBeInTheDocument();
  });

  it("should render the dashboard at '/presentations'", async () => {
    renderAt("/presentations");

    expect(await screen.findByText(APP_NAME)).toBeInTheDocument();
    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("should redirect '/lyrics' to '/presentations'", async () => {
    renderAt("/lyrics");

    expect(await screen.findByText(APP_NAME)).toBeInTheDocument();
    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("should render the background library at '/backgrounds'", async () => {
    renderAt("/backgrounds");

    expect(
      await screen.findByRole("heading", {
        name: SHELL_COPY.backgroundGallery,
      }),
    ).toBeInTheDocument();
  });

  it("should render FullscreenPresentRoute at '/present/:presentationId/fullscreen'", async () => {
    renderAt(`/present/${DOC_ID}/fullscreen`);

    expect(
      await screen.findByTestId("fullscreen-present-route"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("시작됐네 우리 주님의 능력이"),
    ).toBeInTheDocument();
  });

  it("송출 주소에서는 부팅 화면을 검게 그린다", () => {
    renderAt(`/present/${DOC_ID}/fullscreen`);

    expect(screen.getByTestId("app-hydrating")).toHaveClass("bg-black");
    expect(screen.getByTestId("app-hydrating")).not.toHaveClass(
      "bg-background",
    );
  });

  it("다른 주소의 부팅 화면은 테마 배경을 쓴다", () => {
    renderAt("/presentations");

    expect(screen.getByTestId("app-hydrating")).toHaveClass("bg-background");
  });

  it("송출 중 세션이 끊겨도 송출 화면을 그대로 두고, 송출을 마치면 로그인 화면으로 간다", async () => {
    renderAt(`/present/${DOC_ID}/fullscreen`);
    const route = await screen.findByTestId("fullscreen-present-route");

    act(() => {
      __setSessionForTests(null);
    });

    expect(screen.getByTestId("fullscreen-present-route")).toBe(route);
    expect(
      screen.queryByRole("button", { name: /카카오 로그인/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exit-present-btn"));

    expect(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("fullscreen-present-route"),
    ).not.toBeInTheDocument();
  });

  it("should render EditorRoute at '/editor/:presentationId'", async () => {
    renderAt(`/editor/${DOC_ID}`);

    expect(await screen.findByTestId("editor-route")).toBeInTheDocument();
    expect(
      await screen.findByTestId("editor-stage-canvas"),
    ).toBeInTheDocument();
  });

  it("should redirect an unknown presentationId to /presentations", async () => {
    renderAt("/editor/999999999999999999999");

    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("should redirect an unknown path to /presentations", async () => {
    renderAt("/definitely-not-a-route");

    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("should redirect the legacy '/editor' path (no id) to /presentations", async () => {
    renderAt("/editor");

    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("미로그인이면 어떤 경로로 들어와도 로그인 화면만 보인다", async () => {
    signOutForTests();

    renderAt("/presentations");

    expect(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-row")).not.toBeInTheDocument();
  });

  it("미로그인이어도 랜딩 페이지는 열리고, 진입 버튼은 로그인 화면으로 이어진다", async () => {
    signOutForTests();

    renderAt("/");

    expect(await screen.findByTestId("landing-route")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /카카오 로그인/ }),
    ).not.toBeInTheDocument();

    act(() => {
      screen.getByTestId("landing-enter-btn").click();
    });

    expect(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    ).toBeInTheDocument();
  });

  it("미로그인이면 링크로 연 세트가 아닌 송출 경로는 막는다", async () => {
    signOutForTests();

    renderAt(`/present/${DOC_ID}/fullscreen`);

    expect(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("fullscreen-present-route"),
    ).not.toBeInTheDocument();
  });

  it("미로그인이어도 공유 링크는 보기 전용으로 열린다", async () => {
    signOutForTests();
    const api = installFakeApi({
      "GET /api/share/*": () => ({
        body: {
          document: {
            ...SEED_PRESENTATIONS[0],
            userId: "0000000000000000owner",
            access: { ownerName: "인도자" },
          },
        },
      }),
    });

    try {
      renderAt("/s/tok-first");

      expect(await screen.findByTestId("read-only-banner")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /카카오 로그인/ }),
      ).not.toBeInTheDocument();
    } finally {
      api.restore();
    }
  });

  it("미로그인으로 링크에서 띄운 송출을 새로고침하면 링크 화면으로 돌아가 다시 받는다", async () => {
    signOutForTests();
    window.sessionStorage.setItem(
      `chiton:present-return:${DOC_ID}`,
      "/s/tok-first",
    );
    const api = installFakeApi({
      "GET /api/share/*": () => ({
        body: {
          document: {
            ...SEED_PRESENTATIONS[0],
            userId: "0000000000000000owner",
            access: { ownerName: "인도자" },
          },
        },
      }),
    });

    try {
      renderAt(`/present/${DOC_ID}/fullscreen`);

      expect(await screen.findByTestId("read-only-banner")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/s/tok-first");
      expect(
        screen.queryByRole("button", { name: /카카오 로그인/ }),
      ).not.toBeInTheDocument();
    } finally {
      api.restore();
      window.sessionStorage.clear();
    }
  });

  it("다른 계정으로 로그인하면 남의 세트가 보이지 않는다", async () => {
    signInAsTestUser("999999999999999999999");

    renderAt("/presentations");

    expect(await screen.findByText(APP_NAME)).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-row")).not.toBeInTheDocument();
  });

  it("게이트를 통과한 뒤 로그인해도 스토어를 싣는다", async () => {
    signOutForTests();
    renderAt("/presentations");

    await screen.findByRole("button", { name: /카카오 로그인/ });

    await act(async () => {
      signInAsTestUser();
      await Promise.resolve();
    });

    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  describe("송출 주소로 부팅한 탭과 주소로 연 항목", () => {
    let fetcher: ReturnType<typeof vi.fn<SessionFetcher>>;
    let api: FakeApi | null = null;

    beforeEach(() => {
      resetSyncModules();
      fetcher = vi.fn<SessionFetcher>(async () => sessionUser());
      __setSessionFetcherForTests(fetcher);
    });

    afterEach(() => {
      api?.restore();
      api = null;
      resetSyncModules();
    });

    it("송출 주소로 부팅해도 송출을 마치면 서버와 맞추고 이후 변경을 올린다", async () => {
      await saveCachedSession(sessionUser());
      api = installFakeApi(bootRoutes());

      renderAt(`/present/${DOC_ID}/fullscreen`);
      await screen.findByTestId("fullscreen-present-route");

      expect(apiRequests(api)).toEqual([]);
      expect(fetcher).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("exit-present-btn"));
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(apiRequests(api)).toContain("GET /api/folders");

      let created: Presentation | undefined;
      act(() => {
        created = createNewPresentation();
      });
      await act(async () => {
        await flushPendingSync();
      });

      expect(apiRequests(api)).toContain(
        `PATCH /api/presentations/${created?.id}`,
      );
    });

    it("만료된 세션으로 송출 주소를 열면 송출 중에는 묻지 않고, 송출을 마치면 세션을 확인해 새로고침한 뒤 로그인 화면에서 만료를 알린다", async () => {
      const reload = vi.fn<() => void>();
      __setPageReloadForTests(reload);
      await saveCachedSession(sessionUser({ expiresAt: Date.now() - HOUR }));
      fetcher.mockResolvedValue(null);
      const expired: FakeRoute = () => ({
        status: 401,
        body: { error: "세션 만료" },
      });
      api = installFakeApi({
        "GET /api/folders": expired,
        "GET /api/presentations": expired,
        "GET /api/decks": expired,
        "GET /api/backgrounds": expired,
      });

      const view = renderAt(`/present/${DOC_ID}/fullscreen`);
      await screen.findByTestId("fullscreen-present-route");

      expect(fetcher).not.toHaveBeenCalled();
      expect(apiRequests(api)).toEqual([]);

      fireEvent.click(screen.getByTestId("exit-present-btn"));

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("app-hydrating")).toBeInTheDocument();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("expired");

      view.unmount();
      renderAt(window.location.pathname);

      expect(await screen.findByTestId("login-description")).toHaveTextContent(
        ERROR_COPY.sessionExpired,
      );
      expect(
        screen.getByRole("button", { name: /카카오 로그인/ }),
      ).toBeInTheDocument();
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("다른 기기에서 만든 세트 주소로 들어오면 받을 때까지 기다렸다가 연다", async () => {
      const presentations = deferred<{ body: unknown }>();
      api = installFakeApi(
        bootRoutes({ "GET /api/presentations": () => presentations.promise }),
      );

      renderAt(`/editor/${NEW_DOC.id}`);

      expect(await screen.findByTestId("editor-pending")).toBeInTheDocument();
      expect(window.location.pathname).toBe(`/editor/${NEW_DOC.id}`);

      await act(async () => {
        presentations.resolve({
          body: { presentations: [...SEED_PRESENTATIONS, NEW_DOC] },
        });
      });

      expect(await screen.findByTestId("editor-route")).toBeInTheDocument();
      expect(window.location.pathname).toBe(`/editor/${NEW_DOC.id}`);
    });
  });

  describe("계정이 끝난 탭", () => {
    let fetcher: ReturnType<typeof vi.fn<SessionFetcher>>;
    let reload: ReturnType<typeof vi.fn<() => void>>;
    let api: FakeApi | null = null;

    beforeEach(() => {
      resetSyncModules();
      fetcher = vi.fn<SessionFetcher>(async () => sessionUser());
      __setSessionFetcherForTests(fetcher);
      reload = vi.fn<() => void>();
      __setPageReloadForTests(reload);
      vi.mocked(authClient.signOut).mockClear();
    });

    afterEach(() => {
      backgroundHydration.held = null;
      api?.restore();
      api = null;
      resetSyncModules();
      window.sessionStorage.clear();
    });

    it("저장본 싣기가 끝난 직후 화면을 다시 그리기 전에 로그인이 풀려도 부팅 동기화를 시작하지 않고 이후 변경도 보내지 않는다", async () => {
      const backgrounds = deferred<void>();
      backgroundHydration.held = backgrounds.promise;
      api = installFakeApi(bootRoutes());
      renderAt("/presentations");
      await waitFor(async () =>
        expect((await loadCachedSession())?.userId).toBe(SEED_USER_ID),
      );

      await act(async () => {
        backgrounds.resolve();
        queueMicrotask(() => __setSessionForTests(null));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        scheduleDocumentPush(SEED_PRESENTATIONS[0]);
        await flushPendingSync();
      });

      expect(apiRequests(api)).toEqual([]);
    });

    it("계정 카드로 로그아웃하면 세션 캐시를 비우고 로딩 화면으로 덮은 채 한 번 새로고침한다", async () => {
      api = installFakeApi(bootRoutes());
      renderAt("/presentations");
      await screen.findAllByTestId("presentation-row");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));
      expect((await loadCachedSession())?.userId).toBe(SEED_USER_ID);

      fireEvent.click(
        within(screen.getByTestId("account-card")).getByRole("button"),
      );

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(authClient.signOut).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("app-hydrating")).toBeInTheDocument();
      expect(screen.queryByTestId("presentation-row")).not.toBeInTheDocument();
      expect(await loadCachedSession()).toBeNull();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("signedOut");
    });

    it("오프라인으로 밀린 프레젠테이션은 다른 계정으로 바뀐 뒤 다시 시도해도 보내지 않는다", async () => {
      api = installFakeApi(
        bootRoutes({
          "PATCH /api/presentations/*": () => {
            throw new TypeError("Failed to fetch");
          },
        }),
      );
      renderAt("/presentations");
      await screen.findAllByTestId("presentation-row");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));

      let created: Presentation | undefined;
      act(() => {
        created = createNewPresentation();
      });
      await act(async () => {
        await flushPendingSync();
      });
      const patchOfCreated = `PATCH /api/presentations/${created?.id}`;
      expect(apiRequests(api)).toContain(patchOfCreated);

      fetcher.mockResolvedValue(sessionUser({ userId: OTHER_USER_ID }));
      await act(async () => {
        await revalidateSession();
      });

      expect(reload).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("app-hydrating")).toBeInTheDocument();

      const sentBefore = apiRequests(api).length;
      await act(async () => {
        retrySyncNow();
        await __waitForSyncRecoveryForTests();
        await flushPendingSync();
      });

      expect(apiRequests(api).slice(sentBefore)).not.toContain(patchOfCreated);
    });

    it("동기화가 401을 받고 서버가 세션 없음을 답하면 새로고침하고, 다시 열면 로그인 화면이 만료를 알린다", async () => {
      let expired = false;
      api = installFakeApi(
        bootRoutes({
          "PATCH /api/presentations/*": () =>
            expired
              ? { status: 401, body: { error: "세션 만료" } }
              : { body: { ok: true } },
        }),
      );
      const view = renderAt("/presentations");
      await screen.findAllByTestId("presentation-row");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));

      expired = true;
      fetcher.mockResolvedValue(null);
      act(() => {
        createNewPresentation();
      });
      await act(async () => {
        await flushPendingSync();
      });

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("app-hydrating")).toBeInTheDocument();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("expired");
      expect(await loadCachedSession()).toBeNull();

      view.unmount();
      renderAt(window.location.pathname);

      expect(await screen.findByTestId("login-description")).toHaveTextContent(
        ERROR_COPY.sessionExpired,
      );
    });

    it("다른 탭이 로그아웃했다고 알리면 로딩 화면으로 덮고 캐시를 비운 뒤 새로고침한다", async () => {
      api = installFakeApi(bootRoutes());
      renderAt("/presentations");
      await screen.findAllByTestId("presentation-row");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));
      const other = tabs.otherTab("chiton:session");

      other.post({ userId: null });

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("app-hydrating")).toBeInTheDocument();
      expect(screen.queryByTestId("presentation-row")).not.toBeInTheDocument();
      expect(await loadCachedSession()).toBeNull();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("otherTab");
      other.close();
    });

    it("로그아웃을 마치지 못한 채 연 앱은 연결이 돌아오면 로그아웃을 마치고 표시를 지운다", async () => {
      signOutForTests();
      __resetConnectivityForTests();
      api = installFakeApi(bootRoutes());
      window.localStorage.setItem(SIGN_OUT_PENDING_KEY, String(Date.now()));
      vi.mocked(authClient.signOut).mockRejectedValueOnce(
        new TypeError("Failed to fetch"),
      );

      renderAt("/presentations");

      expect(
        await screen.findByRole("button", { name: /카카오 로그인/ }),
      ).toBeInTheDocument();
      await waitFor(() => expect(authClient.signOut).toHaveBeenCalledTimes(1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(window.localStorage.getItem(SIGN_OUT_PENDING_KEY)).not.toBeNull();

      vi.mocked(authClient.signOut).mockClear();
      act(() => {
        window.dispatchEvent(new Event("online"));
      });

      await waitFor(() =>
        expect(window.localStorage.getItem(SIGN_OUT_PENDING_KEY)).toBeNull(),
      );
      expect(authClient.signOut).toHaveBeenCalledTimes(1);
    });

    it("송출 중에 다른 계정으로 바뀌어도 송출 화면을 그대로 두고, 송출을 마치면 부팅 없이 새로고침한다", async () => {
      await saveCachedSession(sessionUser());
      api = installFakeApi(bootRoutes());
      renderAt(`/present/${DOC_ID}/fullscreen`);
      const route = await screen.findByTestId("fullscreen-present-route");

      fetcher.mockResolvedValue(sessionUser({ userId: OTHER_USER_ID }));
      await act(async () => {
        await revalidateSession();
      });

      expect(screen.getByTestId("fullscreen-present-route")).toBe(route);
      expect(reload).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("exit-present-btn"));

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("app-hydrating")).toBeInTheDocument();
      expect(window.sessionStorage.getItem(SESSION_END_KEY)).toBe("switched");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(apiRequests(api)).not.toContain("GET /api/folders");
      expect(apiRequests(api)).not.toContain("GET /api/presentations");
      expect(apiRequests(api)).not.toContain("GET /api/decks");
    });
  });
});
