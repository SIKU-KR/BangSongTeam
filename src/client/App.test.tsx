import {
  screen,
  act,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toast } from "sonner";
import { renderApp } from "./test/nextApp";
import { testRouter } from "./test/next/navigation";
import {
  createNewPresentation,
  flushPendingWrites,
  getPresentationById,
  renamePresentation,
  resetPresentationStore,
} from "./features/presentation/presentationStore";
import { closeOfflineDB, OFFLINE_DB_NAME } from "./lib/storage/db";
import { __resetStorageChannelForTests } from "./lib/storage/storageChannel";
import { __resetStorageSyncForTests } from "./lib/sync/storageSync";
import { authClient } from "./lib/auth/authClient";
import * as capabilities from "./lib/browser/capabilities";
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
import { __resetBootSyncForTests, FRESHNESS_MS } from "./lib/sync/bootSync";
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
  API_ERRORS,
  APP_NAME,
  MEDIA_URL_PREFIX,
  type FolderListResponse,
  type Presentation,
} from "#shared";
import { SHELL_COPY } from "#copy/shell";
import { LEGAL_COPY } from "#copy/auth";
import { COMMON_COPY, ERROR_COPY } from "#copy/common";
import { PRESENTATION_COPY } from "#copy/presentation";
import { SHARE_LINK_COPY } from "#copy/shareLink";
import { SHARING_COPY } from "#copy/sharing";
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
    __resetStorageSyncForTests();
    __resetStorageChannelForTests();
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

  it("미로그인으로 연 공유 링크가 만료됐으면 로그인하기가 랜딩이 아니라 로그인 화면으로 이어진다", async () => {
    signOutForTests();
    const api = installFakeApi({
      "GET /api/share/*": () => ({
        status: 404,
        body: { error: API_ERRORS.share.linkUnavailable },
      }),
    });

    try {
      renderAt("/s/expired");

      fireEvent.click(
        await screen.findByRole("button", { name: SHARE_LINK_COPY.signIn }),
      );

      expect(
        await screen.findByTestId("login-description"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("landing-route")).not.toBeInTheDocument();
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

  describe("다른 탭이 저장한 변경", () => {
    const [SEED] = SEED_PRESENTATIONS;
    let api: FakeApi | null = null;

    function announceFromOtherTab(ids: string[]): void {
      tabs.otherTab("chiton:storage").post({
        v: 1,
        userId: SEED_USER_ID,
        kind: "presentations",
        ids,
      });
    }

    beforeEach(() => {
      resetSyncModules();
    });

    afterEach(() => {
      backgroundHydration.held = null;
      api?.restore();
      api = null;
      resetSyncModules();
      vi.restoreAllMocks();
    });

    it("저장본을 싣는 동안 다른 탭이 저장한 변경도 싣는다", async () => {
      const backgrounds = deferred<void>();
      backgroundHydration.held = backgrounds.promise;
      api = installFakeApi(bootRoutes());
      renderAt("/presentations");
      await waitFor(() => expect(getPresentationById(SEED.id)).toBeDefined());

      await seedPresentationsIntoStorage([
        {
          ...SEED,
          title: "싣는 동안 다른 탭이 바꾼 제목",
          updatedAt: "2026-10-26T00:00:00.000Z",
        },
      ]);
      announceFromOtherTab([SEED.id]);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        backgrounds.resolve();
      });

      expect(
        await screen.findByText("싣는 동안 다른 탭이 바꾼 제목"),
      ).toBeInTheDocument();
    });

    it("다른 탭이 이름을 바꾼 프레젠테이션을 드라이브에 바로 보여 준다", async () => {
      api = installFakeApi(bootRoutes());
      renderAt("/presentations");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));

      await seedPresentationsIntoStorage([
        {
          ...SEED,
          title: "다른 탭에서 바꾼 제목",
          updatedAt: "2026-10-26T00:00:00.000Z",
        },
      ]);
      announceFromOtherTab([SEED.id]);

      expect(
        await screen.findByText("다른 탭에서 바꾼 제목"),
      ).toBeInTheDocument();
    });

    it("송출 주소로 부팅한 탭은 송출 동안 받은 변경을 송출을 마친 뒤에 싣는다", async () => {
      await saveCachedSession(sessionUser());
      api = installFakeApi(bootRoutes());
      renderAt(`/present/${SEED.id}/fullscreen`);
      await screen.findByTestId("fullscreen-present-route");

      await seedPresentationsIntoStorage([
        {
          ...SEED,
          title: "송출 중에 다른 탭이 바꾼 제목",
          updatedAt: "2026-10-26T00:00:00.000Z",
        },
      ]);
      announceFromOtherTab([SEED.id]);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(getPresentationById(SEED.id)?.title).toBe(SEED.title);

      fireEvent.click(screen.getByTestId("exit-present-btn"));

      await waitFor(() =>
        expect(getPresentationById(SEED.id)?.title).toBe(
          "송출 중에 다른 탭이 바꾼 제목",
        ),
      );
    });

    it("송출 직전에 고친 세트는 송출 화면으로 가기 전에 올려, 송출 중에 다른 탭이 고친 판을 송출을 마친 뒤에 덮지 않는다", async () => {
      vi.spyOn(
        capabilities,
        "getMissingPresentationCapabilities",
      ).mockReturnValue([]);
      api = installFakeApi(bootRoutes());
      renderAt(`/editor/${SEED.id}`);
      await screen.findByTestId("editor-stage-canvas");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));
      const patches = () =>
        (api?.calls ?? []).filter(
          ({ method, path }) =>
            method === "PATCH" && path === `/api/presentations/${SEED.id}`,
        );

      act(() => {
        renamePresentation(SEED.id, "송출 직전에 고친 제목");
      });
      fireEvent.click(screen.getByTestId("header-present-btn"));
      await screen.findByTestId("fullscreen-present-route");

      await waitFor(() => expect(patches()).toHaveLength(1));
      expect(patches()[0].body).toMatchObject({
        title: "송출 직전에 고친 제목",
      });

      await act(async () => {
        await flushPendingWrites();
      });
      await seedPresentationsIntoStorage([
        {
          ...SEED,
          title: "송출 중에 다른 탭이 고친 제목",
          updatedAt: "2026-10-26T00:00:00.000Z",
        },
      ]);
      announceFromOtherTab([SEED.id]);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      fireEvent.click(screen.getByTestId("exit-present-btn"));

      await waitFor(() =>
        expect(getPresentationById(SEED.id)?.title).toBe(
          "송출 중에 다른 탭이 고친 제목",
        ),
      );
      await act(async () => {
        await flushPendingSync();
      });
      expect(patches()).toHaveLength(1);
    });
  });

  describe("주소를 옮길 때 오래된 내 데이터 다시 받기", () => {
    const OWN_DATA_PULLS = [
      "GET /api/folders",
      "GET /api/presentations",
      "GET /api/decks",
    ];
    let api: FakeApi | null = null;

    function navigateTo(path: string): void {
      act(() => {
        testRouter.push(path);
      });
    }

    function ownDataPulls(): string[] {
      return apiRequests(api as FakeApi).filter((request) =>
        OWN_DATA_PULLS.includes(request),
      );
    }

    function presentationPulls(): number {
      return ownDataPulls().filter(
        (request) => request === "GET /api/presentations",
      ).length;
    }

    async function settle(): Promise<void> {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    function pretendDataIsStale(): void {
      vi.useFakeTimers({
        toFake: ["Date"],
        now: Date.now() + FRESHNESS_MS + 1_000,
      });
    }

    beforeEach(() => {
      resetSyncModules();
    });

    afterEach(() => {
      vi.useRealTimers();
      api?.restore();
      api = null;
      resetSyncModules();
    });

    it("받은 지 1분이 지난 뒤 편집기로 옮기면 내 데이터를 한 번 다시 받는다", async () => {
      api = installFakeApi(bootRoutes());
      renderAt("/presentations");
      await screen.findAllByTestId("presentation-row");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));
      navigateTo(`/editor/${DOC_ID}`);
      await screen.findByTestId("editor-stage-canvas");
      navigateTo("/presentations");
      await screen.findAllByTestId("presentation-row");
      await settle();
      expect(presentationPulls()).toBe(1);

      pretendDataIsStale();
      navigateTo(`/editor/${DOC_ID}`);
      await screen.findByTestId("editor-stage-canvas");
      await waitFor(() => expect(presentationPulls()).toBe(2));
      navigateTo("/presentations");
      await screen.findAllByTestId("presentation-row");
      await settle();

      expect(ownDataPulls()).toEqual([...OWN_DATA_PULLS, ...OWN_DATA_PULLS]);
    });

    it("송출 주소로 옮길 때는 받은 지 1분이 지났어도 다시 받지 않는다", async () => {
      api = installFakeApi(bootRoutes());
      renderAt(`/editor/${DOC_ID}`);
      await screen.findByTestId("editor-stage-canvas");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));

      pretendDataIsStale();
      navigateTo(`/present/${DOC_ID}/fullscreen`);
      await screen.findByTestId("fullscreen-present-route");
      await settle();

      expect(presentationPulls()).toBe(1);
    });

    it("로그인하지 않은 손님은 주소를 옮겨도 아무것도 받지 않는다", async () => {
      signOutForTests();
      api = installFakeApi(bootRoutes());
      renderAt("/");
      await screen.findByTestId("landing-route");

      pretendDataIsStale();
      navigateTo("/terms");
      await screen.findByRole("heading", { name: LEGAL_COPY.terms });
      await settle();

      expect(ownDataPulls()).toEqual([]);
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

  describe("알림 창", () => {
    let api: FakeApi | null = null;
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const execCommand = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );

    function navigateTo(path: string): void {
      act(() => {
        testRouter.push(path);
      });
    }

    async function nextTask(): Promise<void> {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    beforeEach(() => {
      resetSyncModules();
    });

    afterEach(() => {
      act(() => {
        toast.dismiss();
      });
      api?.restore();
      api = null;
      vi.restoreAllMocks();
      resetSyncModules();
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
      if (execCommand)
        Object.defineProperty(document, "execCommand", execCommand);
      else Reflect.deleteProperty(document, "execCommand");
    });

    it("편집기에서 공유 링크를 복사하지 못하면 편집기 화면에 알린다", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: vi.fn(async () => Promise.reject(new Error("거부"))),
        },
        configurable: true,
      });
      Object.defineProperty(document, "execCommand", {
        value: vi.fn(() => false),
        configurable: true,
      });
      api = installFakeApi(
        bootRoutes({
          "GET /api/presentations/*/share": () => ({
            body: { access: "view", token: "share-token" },
          }),
        }),
      );
      renderAt(`/editor/${DOC_ID}`);
      await screen.findByTestId("editor-stage-canvas");

      fireEvent.click(screen.getByTestId("header-share-btn"));
      fireEvent.click(await screen.findByTestId("share-copy-btn"));

      expect(
        await screen.findByText(SHARING_COPY.link.copyFailed),
      ).toBeInTheDocument();
    });

    it("편집기에서 고친 세트가 다른 기기와 엇갈리면 이 기기의 편집을 사본으로 남겼다고 편집기 화면에 알린다", async () => {
      const later = new Date(Date.now() + HOUR).toISOString();
      let conflicted = false;
      api = installFakeApi(
        bootRoutes({
          "PATCH /api/presentations/*": ({ url, body }) => {
            if (!conflicted && url.pathname.endsWith(DOC_ID)) {
              conflicted = true;
              return {
                status: 412,
                body: {
                  error: API_ERRORS.presentation.conflict,
                  presentation: {
                    ...SEED_PRESENTATIONS[0],
                    title: "다른 기기에서 고친 제목",
                    updatedAt: later,
                  },
                },
              };
            }
            return {
              body: {
                ok: true,
                updatedAt: (body as { updatedAt: string }).updatedAt,
              },
            };
          },
        }),
      );
      renderAt(`/editor/${DOC_ID}`);
      await screen.findByTestId("editor-stage-canvas");
      await waitFor(() => expect(getSyncSnapshot().status).toBe("synced"));

      act(() => {
        renamePresentation(DOC_ID, "이 기기에서 고친 제목");
      });
      await act(async () => {
        await flushPendingSync();
      });

      expect(
        await screen.findByText(
          PRESENTATION_COPY.conflictSavedAsCopy(
            `이 기기에서 고친 제목${COMMON_COPY.copySuffix}`,
          ),
        ),
      ).toBeInTheDocument();
      expect(getPresentationById(DOC_ID)?.title).toBe(
        "다른 기기에서 고친 제목",
      );
    });

    it("로그인하지 않은 화면에서도 알림을 띄운다", async () => {
      signOutForTests();
      renderAt("/");
      await screen.findByTestId("landing-route");

      act(() => {
        toast("손님 화면의 알림");
      });

      expect(await screen.findByText("손님 화면의 알림")).toBeInTheDocument();
    });

    it("드라이브의 실행 취소 알림은 드라이브를 떠나면 닫혀, 다른 화면에서도 드라이브로 돌아와서도 다시 뜨지 않는다", async () => {
      api = installFakeApi(bootRoutes());
      renderAt("/presentations");
      await screen.findAllByTestId("presentation-row");

      fireEvent.click(screen.getAllByRole("option")[0]);
      act(() => {
        fireEvent.keyDown(document.activeElement ?? window, {
          key: "Delete",
        });
      });
      expect(await screen.findByTestId("drive-toast")).toBeInTheDocument();

      navigateTo(`/editor/${DOC_ID}`);
      await screen.findByTestId("editor-stage-canvas");
      await waitFor(() =>
        expect(screen.queryByTestId("drive-toast")).not.toBeInTheDocument(),
      );

      navigateTo("/presentations");
      await screen.findAllByTestId("presentation-row");
      await nextTask();

      expect(screen.queryByTestId("drive-toast")).not.toBeInTheDocument();
    });

    it("송출 화면에는 알림을 띄우지 않고, 송출 전에 떠 있던 알림은 송출을 마쳐도 다시 뜨지 않는다", async () => {
      vi.spyOn(
        capabilities,
        "getMissingPresentationCapabilities",
      ).mockReturnValue([]);
      api = installFakeApi(bootRoutes());
      renderAt(`/editor/${DOC_ID}`);
      await screen.findByTestId("editor-stage-canvas");

      act(() => {
        toast("송출 전의 알림");
      });
      expect(await screen.findByText("송출 전의 알림")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("header-present-btn"));
      await screen.findByTestId("fullscreen-present-route");
      await nextTask();
      expect(screen.queryByText("송출 전의 알림")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("exit-present-btn"));
      await screen.findByTestId("editor-stage-canvas");
      await nextTask();

      expect(screen.queryByText("송출 전의 알림")).not.toBeInTheDocument();
    });
  });
});
