import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck, Folder, Presentation } from "#shared";
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
import { getSyncSnapshot, resetSyncStatus } from "./syncStatus";
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS } from "./backoff";
import { ServerRejectedError, TimeoutError } from "../api/request";

const recoveryDeps = vi.hoisted(() => ({
  retryBootSyncIfNeeded: vi.fn(async () => false),
  resumeMediaCaching: vi.fn(),
}));

vi.mock("./bootSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bootSync")>()),
  retryBootSyncIfNeeded: recoveryDeps.retryBootSyncIfNeeded,
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

    expect(
      server.calls.filter((call) => call.path === "/api/health"),
    ).toHaveLength(0);
    expect(recoveryDeps.retryBootSyncIfNeeded).not.toHaveBeenCalled();
    expect(recoveryDeps.resumeMediaCaching).not.toHaveBeenCalled();
  });

  it("송출로 들어가기 전에 잡힌 상태 확인은 송출 중에 타이머 없이 미뤘다가 송출을 마치면 보낸다", async () => {
    server.blocked = true;
    markServerUnreachable();
    start();
    paused = true;

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
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
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pushFolder).toHaveBeenCalledTimes(1);
    expect(pushDeck).toHaveBeenCalledTimes(1);
    expect(pushDoc).toHaveBeenCalledTimes(1);
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
});
