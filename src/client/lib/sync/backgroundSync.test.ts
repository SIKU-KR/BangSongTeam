import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installFakeApi,
  type FakeApi,
  type FakeRoute,
} from "../../test/fakeApi";
import { makeBackground } from "../../test/backgroundFixture";
import {
  __resetConnectivityForTests,
  markServerReachable,
  markServerUnreachable,
} from "../api/connectivity";
import { loadAllBackgrounds, replaceAllBackgrounds } from "../storage";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage/db";
import {
  getBackgroundCatalogStatus,
  getBackgrounds,
  hydrateBackgroundCatalog,
  resetBackgroundCatalogForTests,
} from "../../features/backgrounds/backgroundCatalog";
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS, MAX_RETRY_ATTEMPTS } from "./backoff";
import {
  __resetBackgroundSyncForTests,
  __waitForBackgroundCatalogForTests,
  refreshBackgroundCatalog,
  retryBackgroundCatalogIfNeeded,
} from "./backgroundSync";

const FIRST = makeBackground(1, { title: "가을 들판" });
const SECOND = makeBackground(2, { title: "나무 그늘" });
const THIRD = makeBackground(3, { title: "다리 위 노을" });

function listed(...backgrounds: unknown[]): { body: unknown } {
  return { body: { backgrounds } };
}

const unavailable = (): { status: number; body: unknown } => ({
  status: 503,
  body: { error: "잠시 쓸 수 없어요" },
});

const unreachable = (): never => {
  throw new TypeError("Failed to fetch");
};

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

describe("배경 목록 동기화", () => {
  let api: FakeApi | null = null;
  let replies: FakeRoute[];
  let fallback: FakeRoute;

  function serveCatalog(): void {
    api = installFakeApi({
      "GET /api/backgrounds": (request) =>
        (replies.shift() ?? fallback)(request),
    });
  }

  function catalogCalls(): number {
    return (
      api?.calls.filter((call) => call.path === "/api/backgrounds").length ?? 0
    );
  }

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    await __waitForBackgroundCatalogForTests();
  }

  beforeEach(async () => {
    await resetDatabase();
    resetBackgroundCatalogForTests();
    __resetBackgroundSyncForTests();
    __resetConnectivityForTests();
    replies = [];
    fallback = () => listed(FIRST);
  });

  afterEach(() => {
    __resetBackgroundSyncForTests();
    api?.restore();
    api = null;
    vi.useRealTimers();
    resetBackgroundCatalogForTests();
    closeOfflineDB();
  });

  describe("서버가 잠시 거절했을 때", () => {
    const startPath = window.location.pathname;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    });

    afterEach(() => {
      window.history.pushState({}, "", startPath);
    });

    it("사용자 신호가 없어도 백오프 뒤 스스로 다시 받는다", async () => {
      replies = [unavailable];
      serveCatalog();

      await refreshBackgroundCatalog();
      expect(getBackgroundCatalogStatus()).toBe("error");

      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
      await settle();

      expect(catalogCalls()).toBe(2);
      expect(getBackgroundCatalogStatus()).toBe("synced");
      expect(getBackgrounds()).toEqual([FIRST]);
    });

    it("송출 화면에 있는 동안에는 요청 없이 기다렸다가 송출을 마치면 받는다", async () => {
      replies = [unavailable];
      serveCatalog();
      await refreshBackgroundCatalog();

      window.history.pushState({}, "", "/present/abc/fullscreen");
      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 3);
      expect(catalogCalls()).toBe(1);
      expect(getBackgroundCatalogStatus()).toBe("error");

      window.history.pushState({}, "", "/presentations");
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
      await settle();

      expect(catalogCalls()).toBe(2);
      expect(getBackgroundCatalogStatus()).toBe("synced");
    });

    it("잇달아 거절하면 정해진 횟수에서 멈추고, online에는 곧바로 다시 받는다", async () => {
      fallback = unavailable;
      serveCatalog();
      await refreshBackgroundCatalog();

      await vi.advanceTimersByTimeAsync(
        MAX_BACKOFF_MS * MAX_RETRY_ATTEMPTS * 2,
      );
      await settle();
      expect(catalogCalls()).toBe(MAX_RETRY_ATTEMPTS);

      retryBackgroundCatalogIfNeeded("wake");
      await settle();
      expect(catalogCalls()).toBe(MAX_RETRY_ATTEMPTS);

      fallback = () => listed(FIRST);
      retryBackgroundCatalogIfNeeded("reconnect");
      await settle();

      expect(catalogCalls()).toBe(MAX_RETRY_ATTEMPTS + 1);
      expect(getBackgroundCatalogStatus()).toBe("synced");
    });

    it("다시 시도는 스스로 다시 받기를 멈춘 목록도 백오프를 비워, 또 거절되면 다시 스스로 받는다", async () => {
      fallback = unavailable;
      serveCatalog();
      await refreshBackgroundCatalog();
      await vi.advanceTimersByTimeAsync(
        MAX_BACKOFF_MS * MAX_RETRY_ATTEMPTS * 2,
      );
      await settle();
      expect(catalogCalls()).toBe(MAX_RETRY_ATTEMPTS);

      retryBackgroundCatalogIfNeeded("manual");
      await settle();
      expect(catalogCalls()).toBe(MAX_RETRY_ATTEMPTS + 1);
      expect(getBackgroundCatalogStatus()).toBe("error");

      fallback = () => listed(FIRST);
      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
      await settle();

      expect(catalogCalls()).toBe(MAX_RETRY_ATTEMPTS + 2);
      expect(getBackgroundCatalogStatus()).toBe("synced");
    });

    it("그사이 다른 화면이 새로 받으면 기다리던 재시도는 버린다", async () => {
      replies = [unavailable];
      serveCatalog();
      await refreshBackgroundCatalog();

      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS / 2);
      await refreshBackgroundCatalog();
      expect(getBackgroundCatalogStatus()).toBe("synced");

      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
      await settle();

      expect(catalogCalls()).toBe(2);
    });

    it("서버에 닿지 못하는 동안에는 타이머로 보내지 않고 연결 회복에 맡긴다", async () => {
      replies = [unavailable];
      serveCatalog();
      await refreshBackgroundCatalog();
      markServerUnreachable();

      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
      await settle();
      expect(catalogCalls()).toBe(1);

      markServerReachable();
      retryBackgroundCatalogIfNeeded("wake");
      await settle();

      expect(catalogCalls()).toBe(2);
      expect(getBackgroundCatalogStatus()).toBe("synced");
    });

    it("닿지 못해 받지 못한 목록은 타이머로 다시 보내지 않는다", async () => {
      replies = [unreachable];
      serveCatalog();
      await refreshBackgroundCatalog();
      expect(getBackgroundCatalogStatus()).toBe("offline");
      markServerReachable();

      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
      await settle();

      expect(catalogCalls()).toBe(1);
    });
  });

  describe("닿지 못해 받지 못했을 때", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    });

    it("회복 신호가 백오프보다 먼저 오면 백오프가 끝날 때 한 번만 받는다", async () => {
      replies = [unreachable];
      serveCatalog();
      await refreshBackgroundCatalog();
      markServerReachable();

      retryBackgroundCatalogIfNeeded("wake");
      retryBackgroundCatalogIfNeeded("wake");
      await settle();
      expect(catalogCalls()).toBe(1);

      await vi.advanceTimersByTimeAsync(BASE_BACKOFF_MS);
      await settle();

      expect(catalogCalls()).toBe(2);
      expect(getBackgroundCatalogStatus()).toBe("synced");
    });

    it("다른 화면이 받는 동안 온 회복 신호로는 따로 다시 받지 않는다", async () => {
      let release: () => void = () => undefined;
      replies = [
        unreachable,
        () =>
          new Promise((resolve) => {
            release = () => resolve(listed(FIRST));
          }),
      ];
      serveCatalog();
      await refreshBackgroundCatalog();
      markServerReachable();

      const opening = refreshBackgroundCatalog();
      await vi.waitFor(() => expect(catalogCalls()).toBe(2));
      retryBackgroundCatalogIfNeeded("wake");
      release();
      await opening;

      await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
      await settle();

      expect(catalogCalls()).toBe(2);
      expect(getBackgroundCatalogStatus()).toBe("synced");
    });
  });

  describe("형식이 어긋난 배경", () => {
    async function seedLocalCatalog(): Promise<void> {
      await replaceAllBackgrounds([FIRST, SECOND]);
      await hydrateBackgroundCatalog();
    }

    it("배경이 있는데 하나도 읽지 못하면 가진 목록과 저장된 사본을 그대로 두고 받지 못한 것으로 남긴다", async () => {
      await seedLocalCatalog();
      fallback = () =>
        listed(
          { ...FIRST, license: undefined },
          { ...SECOND, durationSec: "20" },
        );
      serveCatalog();

      await refreshBackgroundCatalog();

      expect(getBackgroundCatalogStatus()).toBe("error");
      expect(getBackgrounds()).toEqual([FIRST, SECOND]);
      expect(await loadAllBackgrounds()).toHaveLength(2);
    });

    it("읽지 못한 배경은 가진 사본을 남기고 나머지는 서버 목록으로 맞춘다", async () => {
      await seedLocalCatalog();
      const renamed = { ...FIRST, title: "가을 들판 (새 영상)" };
      fallback = () =>
        listed(renamed, { ...SECOND, keywords: ["나무", 2024] }, THIRD);
      serveCatalog();

      await refreshBackgroundCatalog();

      expect(getBackgroundCatalogStatus()).toBe("synced");
      expect(getBackgrounds()).toEqual([renamed, SECOND, THIRD]);
      const stored = await loadAllBackgrounds();
      expect(stored.map((background) => background.title).sort()).toEqual(
        [renamed.title, SECOND.title, THIRD.title].sort(),
      );
    });

    it("서버에서 지운 배경은 가진 사본이 있어도 남기지 않는다", async () => {
      await seedLocalCatalog();
      fallback = () => listed(FIRST);
      serveCatalog();

      await refreshBackgroundCatalog();

      expect(getBackgrounds()).toEqual([FIRST]);
      expect(await loadAllBackgrounds()).toEqual([FIRST]);
    });
  });
});
