import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type { Deck, Folder, Presentation } from "#shared";
import { signInAsTestUser, signOutForTests } from "../../test/sessionFixture";
import {
  listPendingDeckDeletes,
  rememberDeckDelete,
} from "./pendingDeckDeletes";
import {
  __resetConnectivityForTests,
  isServerReachable,
  markServerReachable,
  markServerUnreachable,
} from "../api/connectivity";
import {
  __resetSyncRecoveryForTests,
  __setProbeRandomForTests,
  __waitForSyncRecoveryForTests,
  FRESHNESS_TICK_MS,
  resumeDeferredSyncRecovery,
  retrySyncNow,
  startSyncRecovery,
  subscribeSyncRecovery,
} from "./syncRecovery";
import {
  __resetSyncSchedulerForTests,
  __setBackoffRandomForTests,
  __setPusherForTests,
  scheduleDocumentPush,
  setSyncEnabled,
  SYNC_DEBOUNCE_MS,
} from "./syncScheduler";
import {
  __resetFolderSyncForTests,
  __setFolderPusherForTests,
  scheduleFolderPush,
  setFolderSyncEnabled,
} from "./folderSync";
import {
  __resetDeckSyncForTests,
  __setDeckTransportForTests,
  scheduleDeckPush,
  setDeckSyncEnabled,
} from "./deckSync";
import { __resetServerDecksForTests } from "./presentationSync";
import {
  getSyncDomainStatus,
  getSyncSnapshot,
  resetSyncStatus,
  type SyncStatus,
} from "./syncStatus";
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  type SyncRetryMode,
} from "./backoff";
import { ServerRejectedError, TimeoutError } from "../api/request";
import { PULL_API_TIMEOUT_MS } from "../api/fetchWithTimeout";
import {
  __resetBackgroundSyncForTests,
  __waitForBackgroundCatalogForTests,
  refreshBackgroundCatalog,
} from "./backgroundSync";
import {
  getBackgroundCatalogStatus,
  getBackgrounds,
  resetBackgroundCatalogForTests,
} from "../../features/backgrounds/backgroundCatalog";
import { makeBackground } from "../../test/backgroundFixture";
import { isProjecting } from "../../features/presentation/fullscreen";

const recoveryDeps = vi.hoisted(() => ({
  retryBootSyncIfNeeded: vi.fn(async () => false),
  refreshOwnDataIfStale: vi.fn<(mode: SyncRetryMode) => Promise<void>>(
    async () => undefined,
  ),
  resumeMediaCaching: vi.fn(),
}));

vi.mock("./bootSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bootSync")>()),
  retryBootSyncIfNeeded: recoveryDeps.retryBootSyncIfNeeded,
  refreshOwnDataIfStale: recoveryDeps.refreshOwnDataIfStale,
}));

vi.mock("../offline/mediaCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../offline/mediaCache")>()),
  resumeMediaCaching: recoveryDeps.resumeMediaCaching,
}));

const USER = "00000000x000000000001";
const DOC = "00000000d000000000001";

function presentation(): Presentation {
  return {
    id: DOC,
    userId: USER,
    title: "주일 예배",
    serviceDate: "2026-10-04",
    items: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  };
}

interface FakeServer {
  blocked: boolean;
  calls: { method: string; path: string; cache?: RequestCache }[];
}

function installFakeServer(): FakeServer {
  const server: FakeServer = { blocked: false, calls: [] };
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      server.calls.push({ method, path: url.pathname, cache: init?.cache });
      if (server.blocked) throw new TypeError("Failed to fetch");
      const body = url.pathname === "/api/health" ? { status: "ok" } : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  ) as typeof fetch;
  return server;
}

function healthCalls(server: FakeServer): number {
  return server.calls.filter((call) => call.path === "/api/health").length;
}

function setNavigatorOnline(online: boolean): void {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

function setVisibility(state: DocumentVisibilityState): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
}

describe("동기화 회복", () => {
  const originalFetch = globalThis.fetch;
  let server: FakeServer;
  let stop: () => void;
  let paused: boolean;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    __resetConnectivityForTests();
    __resetSyncRecoveryForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetServerDecksForTests();
    resetSyncStatus();
    recoveryDeps.retryBootSyncIfNeeded.mockClear();
    recoveryDeps.refreshOwnDataIfStale.mockReset();
    recoveryDeps.refreshOwnDataIfStale.mockResolvedValue(undefined);
    recoveryDeps.resumeMediaCaching.mockClear();
    server = installFakeServer();
    paused = false;
    __setProbeRandomForTests(() => 0.5);
    __setBackoffRandomForTests(() => 0.99);
    setSyncEnabled(true);
  });

  afterEach(() => {
    stop?.();
    __resetSyncRecoveryForTests();
    __resetSyncSchedulerForTests();
    __resetFolderSyncForTests();
    __resetDeckSyncForTests();
    __resetConnectivityForTests();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function start(): void {
    stop = startSyncRecovery({ isPaused: () => paused });
  }

  it("online 이벤트 없이 요청만 막혔다 풀려도 추가 편집 없이 동기화를 마친다", async () => {
    start();
    server.blocked = true;
    scheduleDocumentPush(presentation());

    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);

    expect(getSyncSnapshot().status).toBe("offline");
    expect(isServerReachable()).toBe(false);
    const blockedCalls = server.calls.length;

    server.blocked = false;
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 0.5);
    await __waitForSyncRecoveryForTests();
    await vi.advanceTimersByTimeAsync(0);

    const afterUnblock = server.calls.slice(blockedCalls);
    expect(afterUnblock[0]).toEqual({
      method: "GET",
      path: "/api/health",
      cache: "no-store",
    });
    expect(afterUnblock[1]).toMatchObject({
      method: "PATCH",
      path: `/api/presentations/${DOC}`,
    });
    expect(getSyncSnapshot().status).toBe("synced");
    expect(getSyncSnapshot().lastSyncedAt).toBe(Date.now());
  });

  it("닿지 못하는 동안 상태 확인 간격을 백오프로 늘리고, 닿으면 멈춘다", async () => {
    __setProbeRandomForTests(() => 1);
    server.blocked = true;
    markServerUnreachable();
    start();

    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
    expect(healthCalls(server)).toBe(1);
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 2 - 1);
    expect(healthCalls(server)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(healthCalls(server)).toBe(2);
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 4);
    expect(healthCalls(server)).toBe(3);

    server.blocked = false;
    await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS * 8);
    expect(healthCalls(server)).toBe(4);
    expect(isServerReachable()).toBe(true);

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 3);
    expect(healthCalls(server)).toBe(4);
  });

  it.each([
    [
      "탭이 다시 보일 때",
      () => document.dispatchEvent(new Event("visibilitychange")),
    ],
    ["창이 포커스를 받을 때", () => window.dispatchEvent(new Event("focus"))],
    ["online 이벤트가 올 때", () => window.dispatchEvent(new Event("online"))],
  ])(
    "닿는 중이면 %s 대기 중인 쓰기를 디바운스 전에 곧바로 보낸다",
    async (_label, fire) => {
      setVisibility("visible");
      const push = vi.fn(async () => true);
      __setPusherForTests(push);
      start();
      scheduleDocumentPush(presentation());

      fire();
      await __waitForSyncRecoveryForTests();
      await vi.advanceTimersByTimeAsync(0);

      expect(push).toHaveBeenCalledTimes(1);
      expect(healthCalls(server)).toBe(0);
    },
  );

  it.each([
    ["focus", "wake"],
    ["online", "reconnect"],
  ] as const)(
    "%s 이벤트의 회복 강도를 배경 다운로드와 구독자에게 넘긴다",
    async (event, mode) => {
      const listener = vi.fn();
      subscribeSyncRecovery(listener);
      start();

      window.dispatchEvent(new Event(event));
      await __waitForSyncRecoveryForTests();

      expect(recoveryDeps.resumeMediaCaching).toHaveBeenCalledWith(mode, {
        afterOutage: false,
      });
      expect(listener).toHaveBeenCalledWith(mode);
    },
  );

  it("상태 확인으로 다시 닿으면 끊긴 동안 재시도를 다 쓴 배경도 다시 받게 하고, 그 뒤 포커스에는 넘기지 않는다", async () => {
    setVisibility("visible");
    server.blocked = true;
    markServerUnreachable();
    start();

    server.blocked = false;
    window.dispatchEvent(new Event("focus"));
    await __waitForSyncRecoveryForTests();
    await vi.advanceTimersByTimeAsync(0);
    await __waitForSyncRecoveryForTests();

    expect(isServerReachable()).toBe(true);
    expect(recoveryDeps.resumeMediaCaching).toHaveBeenCalledTimes(1);
    expect(recoveryDeps.resumeMediaCaching).toHaveBeenLastCalledWith("wake", {
      afterOutage: true,
    });

    window.dispatchEvent(new Event("focus"));
    await __waitForSyncRecoveryForTests();

    expect(recoveryDeps.resumeMediaCaching).toHaveBeenCalledTimes(2);
    expect(recoveryDeps.resumeMediaCaching).toHaveBeenLastCalledWith("wake", {
      afterOutage: false,
    });
  });

  it("탭이 가려질 때는 회복 경로를 타지 않는다", async () => {
    setVisibility("hidden");
    const push = vi.fn(async () => true);
    __setPusherForTests(push);
    start();
    scheduleDocumentPush(presentation());

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["창이 포커스를 받으면", () => window.dispatchEvent(new Event("focus"))],
    [
      "탭이 다시 보이면",
      () => document.dispatchEvent(new Event("visibilitychange")),
    ],
  ])(
    "닿지 못하는 중 %s 백오프를 기다리지 않고 곧바로 상태를 확인한다",
    async (_label, fire) => {
      setVisibility("visible");
      server.blocked = true;
      markServerUnreachable();
      start();

      fire();
      await vi.advanceTimersByTimeAsync(0);

      expect(healthCalls(server)).toBe(1);
    },
  );

  it("송출 중에는 어떤 이벤트와 타이머에도 요청을 보내지 않는다", async () => {
    setVisibility("visible");
    paused = true;
    server.blocked = true;
    markServerUnreachable();
    start();
    scheduleDocumentPush(presentation());

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    retrySyncNow();
    markServerReachable();
    await vi.advanceTimersByTimeAsync(0);
    markServerUnreachable();
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
    markServerReachable();
    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS * 2);

    expect(
      server.calls.filter((call) => call.path === "/api/health"),
    ).toHaveLength(0);
    expect(recoveryDeps.retryBootSyncIfNeeded).not.toHaveBeenCalled();
    expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();
    expect(recoveryDeps.resumeMediaCaching).not.toHaveBeenCalled();
  });

  describe("부팅 재시도를 기다리는 동안 송출을 시작하면", () => {
    const startPath = window.location.pathname;
    const PROJECTION_PATH = "/present/a00000000000000000001/fullscreen";
    const SONG_A = "00000000c00000000000a";
    const SONG_B = "00000000c00000000000b";

    afterEach(() => {
      window.history.pushState({}, "", startPath);
    });

    function holdBootRetry(): () => void {
      let release: () => void = () => undefined;
      recoveryDeps.retryBootSyncIfNeeded.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(false);
          }),
      );
      return () => release();
    }

    it("서버가 기다리게 한 곡이 있어도 곡 큐를 돌리지 않고, 송출을 마친 뒤 돌린다", async () => {
      setVisibility("visible");
      const sent: { id: string; projecting: boolean }[] = [];
      __setDeckTransportForTests({
        push: async (deck: Deck) => {
          sent.push({ id: deck.id, projecting: isProjecting() });
          if (deck.id === SONG_A) {
            throw new ServerRejectedError(503, undefined, 30_000);
          }
          return deck;
        },
      });
      setDeckSyncEnabled(true);
      stop = startSyncRecovery({ isPaused: isProjecting });
      scheduleDeckPush({ id: SONG_A } as Deck);
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent).toEqual([{ id: SONG_A, projecting: false }]);

      const release = holdBootRetry();
      scheduleDeckPush({ id: SONG_B } as Deck);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      window.history.pushState({}, "", PROJECTION_PATH);
      release();
      await __waitForSyncRecoveryForTests();
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);

      expect(sent.filter((entry) => entry.projecting)).toEqual([]);
      expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();

      window.history.pushState({}, "", "/presentations");
      resumeDeferredSyncRecovery();
      await __waitForSyncRecoveryForTests();
      await vi.advanceTimersByTimeAsync(0);

      expect(sent).toContainEqual({ id: SONG_B, projecting: false });
      expect(recoveryDeps.refreshOwnDataIfStale).toHaveBeenCalledWith("wake");
    });

    it("그사이 들어온 더 센 회복 신호도 송출 중에는 돌리지 않고 송출을 마친 뒤 돌린다", async () => {
      const listener = vi.fn();
      subscribeSyncRecovery(listener);
      stop = startSyncRecovery({ isPaused: isProjecting });
      const release = holdBootRetry();

      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      window.dispatchEvent(new Event("online"));
      window.history.pushState({}, "", PROJECTION_PATH);
      release();
      await __waitForSyncRecoveryForTests();
      await vi.advanceTimersByTimeAsync(0);

      expect(listener.mock.calls).toEqual([["wake"]]);
      expect(recoveryDeps.resumeMediaCaching).toHaveBeenCalledTimes(1);
      expect(recoveryDeps.retryBootSyncIfNeeded).toHaveBeenCalledTimes(1);
      expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();

      window.history.pushState({}, "", "/presentations");
      resumeDeferredSyncRecovery();
      await __waitForSyncRecoveryForTests();

      expect(listener.mock.calls).toEqual([["wake"], ["reconnect"]]);
      expect(
        recoveryDeps.refreshOwnDataIfStale,
      ).toHaveBeenCalledExactlyOnceWith("reconnect");
    });
  });

  it("송출로 들어가기 전에 잡힌 상태 확인은 송출 중에 타이머 없이 미뤘다가 송출을 마치면 보낸다", async () => {
    server.blocked = true;
    markServerUnreachable();
    start();
    paused = true;

    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS);
    window.dispatchEvent(new Event("focus"));
    expect(healthCalls(server)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    resumeDeferredSyncRecovery();
    expect(healthCalls(server)).toBe(0);

    paused = false;
    resumeDeferredSyncRecovery();
    await vi.advanceTimersByTimeAsync(0);
    expect(healthCalls(server)).toBe(1);
  });

  it("송출로 들어가기 전에 쌓인 회복 신호는 송출 중에 돌리지 않고 송출을 마치면 돌린다", async () => {
    let releaseBoot: () => void = () => undefined;
    recoveryDeps.retryBootSyncIfNeeded.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseBoot = () => resolve(false);
        }),
    );
    const listener = vi.fn();
    subscribeSyncRecovery(listener);
    start();

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    paused = true;
    releaseBoot();
    await __waitForSyncRecoveryForTests();
    await vi.advanceTimersByTimeAsync(0);

    expect(listener.mock.calls).toEqual([["wake"]]);
    expect(recoveryDeps.resumeMediaCaching).toHaveBeenCalledTimes(1);
    expect(recoveryDeps.retryBootSyncIfNeeded).toHaveBeenCalledTimes(1);

    paused = false;
    resumeDeferredSyncRecovery();
    await __waitForSyncRecoveryForTests();

    expect(listener.mock.calls).toEqual([["wake"], ["reconnect"]]);
    expect(recoveryDeps.retryBootSyncIfNeeded).toHaveBeenCalledTimes(2);
    expect(recoveryDeps.resumeMediaCaching).toHaveBeenLastCalledWith(
      "reconnect",
      { afterOutage: false },
    );
  });

  it("offline 이벤트는 닿지 못함으로 남기고, 브라우저가 오프라인인 동안에는 확인하지 않다가 online이 오면 곧바로 확인한다", async () => {
    start();
    setNavigatorOnline(false);
    server.blocked = true;

    window.dispatchEvent(new Event("offline"));
    expect(isServerReachable()).toBe(false);

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
    expect(healthCalls(server)).toBe(0);

    setNavigatorOnline(true);
    server.blocked = false;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(healthCalls(server)).toBe(1);
    expect(isServerReachable()).toBe(true);
  });

  it("다시 시도는 닿지 못하는 중이면 곧바로 상태를 확인한다", async () => {
    server.blocked = true;
    markServerUnreachable();
    start();

    retrySyncNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(healthCalls(server)).toBe(1);
  });

  it("회복하면 부팅 재시도, 폴더·프레젠테이션·곡 큐, 배경 다운로드를 곧바로 다시 돌리고 구독자에게 알린다", async () => {
    const pushFolder = vi.fn(async (folder: Folder) => folder);
    const pushDeck = vi.fn(async (deck: Deck) => deck);
    const pushDoc = vi.fn(async () => true);
    __setFolderPusherForTests(pushFolder);
    __setDeckTransportForTests({ push: pushDeck });
    __setPusherForTests(pushDoc);
    setFolderSyncEnabled(true);
    setDeckSyncEnabled(true);
    const listener = vi.fn();
    subscribeSyncRecovery(listener);
    start();

    scheduleFolderPush({ id: "00000000f000000000001" } as Folder);
    scheduleDeckPush({ id: "00000000c000000000001" } as Deck);
    scheduleDocumentPush(presentation());

    retrySyncNow();
    await __waitForSyncRecoveryForTests();
    await vi.advanceTimersByTimeAsync(0);

    expect(recoveryDeps.retryBootSyncIfNeeded).toHaveBeenCalledTimes(1);
    expect(recoveryDeps.resumeMediaCaching).toHaveBeenCalledTimes(1);
    expect(recoveryDeps.resumeMediaCaching).toHaveBeenCalledWith("manual", {
      afterOutage: false,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("manual");
    expect(pushFolder).toHaveBeenCalledTimes(1);
    expect(pushDeck).toHaveBeenCalledTimes(1);
    expect(pushDoc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["focus", "wake"],
    ["online", "reconnect"],
  ] as const)(
    "%s 이벤트에는 대기 중인 쓰기를 보낸 뒤 내 데이터를 다시 받는다",
    async (event, mode) => {
      let presentationStatusAtRefresh: SyncStatus | null = null;
      recoveryDeps.refreshOwnDataIfStale.mockImplementation(async () => {
        presentationStatusAtRefresh = getSyncDomainStatus("presentation");
      });
      __setPusherForTests(vi.fn(async () => undefined));
      start();
      scheduleDocumentPush(presentation());

      window.dispatchEvent(new Event(event));
      await __waitForSyncRecoveryForTests();

      expect(
        recoveryDeps.refreshOwnDataIfStale,
      ).toHaveBeenCalledExactlyOnceWith(mode);
      expect(presentationStatusAtRefresh).toBe("syncing");
      expect(
        recoveryDeps.retryBootSyncIfNeeded.mock.invocationCallOrder[0],
      ).toBeLessThan(
        recoveryDeps.refreshOwnDataIfStale.mock.invocationCallOrder[0],
      );
    },
  );

  it("닫힌 탭이 보내지 못하고 남긴 곡 삭제는 열려 있는 탭이 연결을 되찾을 때 보낸다", async () => {
    const LEFT_BEHIND = "00000000c000000000002";
    localStorage.clear();
    signInAsTestUser(USER);
    onTestFinished(() => {
      localStorage.clear();
      signOutForTests();
    });
    const remove = vi.fn(async () => true);
    __setDeckTransportForTests({ remove });
    setDeckSyncEnabled(true);
    rememberDeckDelete(USER, LEFT_BEHIND);
    start();

    window.dispatchEvent(new Event("online"));
    await __waitForSyncRecoveryForTests();
    await vi.advanceTimersByTimeAsync(0);

    expect(remove).toHaveBeenCalledExactlyOnceWith(LEFT_BEHIND);
    expect(listPendingDeckDeletes(USER)).toEqual([]);
  });

  it("받지 못한 부팅 단계를 지금 다시 받았으면 내 데이터를 따로 다시 받지 않는다", async () => {
    recoveryDeps.retryBootSyncIfNeeded.mockResolvedValueOnce(true);
    start();

    retrySyncNow();
    await __waitForSyncRecoveryForTests();

    expect(recoveryDeps.retryBootSyncIfNeeded).toHaveBeenCalledTimes(1);
    expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();
  });

  it("탭이 보이고 서버에 닿으면 5분마다 내 데이터를 다시 받는다", async () => {
    setVisibility("visible");
    start();

    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS - 1);
    expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(recoveryDeps.refreshOwnDataIfStale).toHaveBeenCalledExactlyOnceWith(
      "wake",
    );

    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS);
    expect(recoveryDeps.refreshOwnDataIfStale).toHaveBeenCalledTimes(2);
  });

  it("탭이 가려졌거나 서버에 닿지 못하면 5분 확인에 받지 않는다", async () => {
    setVisibility("hidden");
    start();

    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS);
    expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();

    setVisibility("visible");
    server.blocked = true;
    markServerUnreachable();
    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS);
    expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();
  });

  it("송출 중에는 5분 확인에도 받지 않고 타이머도 남기지 않으며, 송출을 마치면 다시 센다", async () => {
    setVisibility("visible");
    start();
    paused = true;

    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS * 3);
    expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    paused = false;
    resumeDeferredSyncRecovery();
    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS);
    expect(recoveryDeps.refreshOwnDataIfStale).toHaveBeenCalledExactlyOnceWith(
      "wake",
    );
  });

  it("회복을 끄면 5분 확인도 멈춘다", async () => {
    setVisibility("visible");
    start();

    stop();
    await vi.advanceTimersByTimeAsync(FRESHNESS_TICK_MS * 2);

    expect(recoveryDeps.refreshOwnDataIfStale).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("동기화 실패로 남은 프레젠테이션·폴더·곡을 다시 시도하면 다시 올리고 실패를 지운다", async () => {
    const rejected = new ServerRejectedError(400, "거절");
    const pushDoc = vi.fn<(doc: Presentation) => Promise<boolean>>(async () => {
      throw rejected;
    });
    const pushFolder = vi.fn<(folder: Folder) => Promise<Folder>>(async () => {
      throw rejected;
    });
    const pushDeck = vi.fn<(deck: Deck) => Promise<Deck>>(async () => {
      throw rejected;
    });
    __setPusherForTests(pushDoc);
    __setFolderPusherForTests(pushFolder);
    __setDeckTransportForTests({ push: pushDeck });
    setFolderSyncEnabled(true);
    setDeckSyncEnabled(true);
    start();

    scheduleFolderPush({ id: "00000000f000000000001" } as Folder);
    scheduleDeckPush({ id: "00000000c000000000001" } as Deck);
    scheduleDocumentPush(presentation());
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(getSyncSnapshot().status).toBe("error");

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await __waitForSyncRecoveryForTests();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSyncSnapshot().status).toBe("error");

    pushDoc.mockImplementation(async () => true);
    pushFolder.mockImplementation(async (folder: Folder) => folder);
    pushDeck.mockImplementation(async (deck: Deck) => deck);
    retrySyncNow();
    await __waitForSyncRecoveryForTests();
    await vi.advanceTimersByTimeAsync(0);

    expect(pushDoc).toHaveBeenCalledTimes(2);
    expect(pushFolder).toHaveBeenCalledTimes(2);
    expect(pushDeck).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
  });

  it("포커스는 서버가 거절해 기다리는 push를 앞당기지 않고 재시도 횟수도 비우지 않는다", async () => {
    const push = vi.fn(async (): Promise<boolean> => {
      throw new ServerRejectedError(503);
    });
    __setPusherForTests(push);
    setVisibility("visible");
    start();
    scheduleDocumentPush(presentation());
    await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i += 1) {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await __waitForSyncRecoveryForTests();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(push).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 12);
    expect(getSyncSnapshot().status).toBe("error");
  });

  it("상태 확인은 닿는데 push만 시간을 넘기면 다시 보내는 간격이 점점 늘어난다", async () => {
    __setProbeRandomForTests(() => 1);
    const pushedAt: number[] = [];
    __setPusherForTests(async () => {
      pushedAt.push(Date.now());
      markServerUnreachable();
      throw new TimeoutError();
    });
    start();
    scheduleDocumentPush(presentation());

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 5);

    const lastMinute = pushedAt.filter(
      (at) => at > Date.now() - MAX_BACKOFF_MS,
    );
    expect(pushedAt.length).toBeLessThan(15);
    expect(lastMinute.length).toBeLessThanOrEqual(2);
  });

  it("포커스는 상태 확인 간격을 처음으로 되돌리지 않아, 상태 확인만 닿고 push가 시간을 넘기는 동안 다시 보내는 횟수를 늘리지 않는다", async () => {
    __setProbeRandomForTests(() => 1);
    __setBackoffRandomForTests(() => 1);
    setVisibility("visible");
    const pushedAt: number[] = [];
    __setPusherForTests(async () => {
      pushedAt.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      markServerUnreachable();
      throw new TimeoutError();
    });
    start();
    scheduleDocumentPush(presentation());
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    for (let step = 0; step < 120 && isServerReachable(); step += 1) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(isServerReachable()).toBe(false);
    pushedAt.length = 0;

    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pushedAt.length).toBeLessThanOrEqual(2);
  });

  it("구독을 풀거나 회복을 끄면 알리지 않는다", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSyncRecovery(listener);
    start();

    unsubscribe();
    retrySyncNow();
    await __waitForSyncRecoveryForTests();
    expect(listener).not.toHaveBeenCalled();

    subscribeSyncRecovery(listener);
    stop();
    window.dispatchEvent(new Event("focus"));
    retrySyncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("여러 번 켜도 한 벌만 동작한다", async () => {
    const listener = vi.fn();
    subscribeSyncRecovery(listener);
    start();
    const second = startSyncRecovery({ isPaused: () => false });

    window.dispatchEvent(new Event("focus"));
    await __waitForSyncRecoveryForTests();

    expect(listener).toHaveBeenCalledTimes(1);
    second();
  });

  describe("받지 못한 배경 목록", () => {
    type CatalogReply = () => Response | Promise<Response>;
    let catalogReplies: CatalogReply[];
    let catalogFallback: CatalogReply;
    let catalogCalls: number;

    function catalogOk(): Response {
      return new Response(
        JSON.stringify({ backgrounds: [makeBackground(1)] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    function unreachable(): Response {
      throw new TypeError("Failed to fetch");
    }

    function unavailable(): Response {
      return new Response(JSON.stringify({ error: "잠시 쓸 수 없어요" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }

    function timedOut(): Promise<Response> {
      return new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new DOMException("The operation timed out.", "TimeoutError"),
            ),
          PULL_API_TIMEOUT_MS,
        );
      });
    }

    async function settle(): Promise<void> {
      await vi.advanceTimersByTimeAsync(0);
      await __waitForSyncRecoveryForTests();
      await vi.advanceTimersByTimeAsync(0);
      await __waitForBackgroundCatalogForTests();
    }

    beforeEach(() => {
      resetBackgroundCatalogForTests();
      __resetBackgroundSyncForTests();
      catalogReplies = [];
      catalogFallback = catalogOk;
      catalogCalls = 0;
      const serverFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), "http://localhost");
          if (url.pathname !== "/api/backgrounds") {
            return serverFetch(input, init);
          }
          catalogCalls += 1;
          return (catalogReplies.shift() ?? catalogFallback)();
        },
      ) as typeof fetch;
    });

    afterEach(async () => {
      __resetBackgroundSyncForTests();
      await __waitForBackgroundCatalogForTests();
      resetBackgroundCatalogForTests();
    });

    it("부팅 때 닿지 못해 받지 못한 목록을 연결이 돌아오면 다시 받는다", async () => {
      catalogReplies = [unreachable];
      await refreshBackgroundCatalog();
      expect(getBackgroundCatalogStatus()).toBe("offline");

      start();
      markServerUnreachable();
      window.dispatchEvent(new Event("online"));
      await settle();

      await vi.waitFor(() =>
        expect(getBackgroundCatalogStatus()).toBe("synced"),
      );
      expect(catalogCalls).toBe(2);
      expect(getBackgrounds()).toHaveLength(1);
    });

    it("닿지 못했던 목록은 포커스로 회복할 때도 백오프가 지나면 다시 받는다", async () => {
      setVisibility("visible");
      catalogReplies = [unreachable];
      await refreshBackgroundCatalog();

      start();
      window.dispatchEvent(new Event("focus"));
      await settle();
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
      await settle();

      expect(getBackgroundCatalogStatus()).toBe("synced");
      expect(catalogCalls).toBe(2);
    });

    it("상태 확인은 닿는데 목록만 계속 시간을 넘기면 회복할 때마다 다시 받지 않고 정해진 횟수에서 멈추며, online에는 곧바로 다시 받는다", async () => {
      catalogFallback = timedOut;
      start();

      void refreshBackgroundCatalog();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      await settle();

      const resumesAfterOutage =
        recoveryDeps.resumeMediaCaching.mock.calls.filter(
          ([, options]) => options?.afterOutage === true,
        );
      expect(catalogCalls).toBe(MAX_RETRY_ATTEMPTS);
      expect(resumesAfterOutage.length).toBeLessThanOrEqual(MAX_RETRY_ATTEMPTS);
      expect(getBackgroundCatalogStatus()).toBe("offline");

      window.dispatchEvent(new Event("focus"));
      await settle();
      expect(catalogCalls).toBe(MAX_RETRY_ATTEMPTS);

      catalogFallback = catalogOk;
      window.dispatchEvent(new Event("online"));
      await settle();

      expect(catalogCalls).toBe(MAX_RETRY_ATTEMPTS + 1);
      expect(getBackgroundCatalogStatus()).toBe("synced");
    });

    it("서버가 거절한 목록은 포커스로 앞당기지 않고 백오프 뒤 스스로 다시 받으며, online에는 곧바로 다시 받는다", async () => {
      setVisibility("visible");
      catalogReplies = [unavailable, unavailable];
      await refreshBackgroundCatalog();
      expect(getBackgroundCatalogStatus()).toBe("error");
      start();

      for (let i = 0; i < 5; i += 1) {
        window.dispatchEvent(new Event("focus"));
        await settle();
      }
      expect(catalogCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
      await settle();
      expect(catalogCalls).toBe(2);
      expect(getBackgroundCatalogStatus()).toBe("error");

      window.dispatchEvent(new Event("online"));
      await settle();
      expect(getBackgroundCatalogStatus()).toBe("synced");
      expect(catalogCalls).toBe(3);

      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
      expect(catalogCalls).toBe(3);
    });

    it("송출로 들어가기 전에 쌓인 회복 신호로는 송출 중에 목록을 받지 않고, 송출을 마치면 받는다", async () => {
      setVisibility("visible");
      catalogReplies = [unavailable];
      await refreshBackgroundCatalog();
      expect(getBackgroundCatalogStatus()).toBe("error");
      let releaseBoot: () => void = () => undefined;
      recoveryDeps.retryBootSyncIfNeeded.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releaseBoot = () => resolve(false);
          }),
      );
      start();

      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      paused = true;
      releaseBoot();
      await settle();

      expect(catalogCalls).toBe(1);
      expect(getBackgroundCatalogStatus()).toBe("error");

      paused = false;
      resumeDeferredSyncRecovery();
      await settle();

      await vi.waitFor(() =>
        expect(getBackgroundCatalogStatus()).toBe("synced"),
      );
      expect(catalogCalls).toBe(2);
    });

    it("받은 목록은 회복 신호가 와도 다시 받지 않는다", async () => {
      await refreshBackgroundCatalog();
      expect(getBackgroundCatalogStatus()).toBe("synced");
      start();

      window.dispatchEvent(new Event("online"));
      retrySyncNow();
      await settle();

      expect(catalogCalls).toBe(1);
    });
  });
});
