import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { MEDIA_CACHE_NAME } from "#shared";
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../backgrounds/backgroundCatalog";
import {
  TEST_SERVICE_BACKGROUNDS,
  withBackgrounds,
} from "../../test/backgroundFixture";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import {
  __resetMediaCachingForTests,
  __setMediaRetryRandomForTests,
  cacheMediaFirst,
  MEDIA_STALL_TIMEOUT_MS,
} from "../../lib/offline/mediaCache";
import {
  AUTO_CACHE_DELAY_MS,
  useBackgroundAutoCache,
} from "./useBackgroundAutoCache";
import {
  PASSIVE_RECHECK_MS,
  useProjectionMediaReady,
} from "./useProjectionMediaReady";
import { SEED_PRESENTATIONS } from "../../test/presentationFixture";

const [FIRST, SECOND] = TEST_SERVICE_BACKGROUNDS;
const PRESENTATION = withBackgrounds(SEED_PRESENTATIONS[0], [
  FIRST.id,
  SECOND.id,
]);

async function store(url: string): Promise<void> {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  await cache.put(url, new Response("media"));
}

function mockFetch(status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(status === 200 ? "media" : null, {
        status,
        headers: { "content-length": "5" },
      }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function mockEstimate(quota: number, usage: number): void {
  Object.defineProperty(navigator, "storage", {
    value: { estimate: vi.fn(async () => ({ quota, usage })) },
    configurable: true,
  });
}

async function rejectPutWithQuota() {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  return vi
    .spyOn(cache, "put")
    .mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
}

const originalFetch = globalThis.fetch;

describe("useProjectionMediaReady", () => {
  beforeEach(() => {
    resetFakeCacheStorage();
    __resetMediaCachingForTests();
    setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetBackgroundCatalogForTests();
    // @ts-expect-error 테스트에서 주입한 저장소 관리자를 되돌린다
    delete navigator.storage;
  });

  it("배경이 없는 세트는 곧바로 준비된다", () => {
    const { result } = renderHook(() =>
      useProjectionMediaReady(SEED_PRESENTATIONS[0]),
    );
    expect(result.current.status).toBe("ready");
    expect(result.current.totalCount).toBe(0);
  });

  it("빠진 영상만 받고 개수와 용량을 알린 뒤 준비된다", async () => {
    await store(FIRST.mediaUrl);
    const fetchMock = mockFetch();

    const { result } = renderHook(() => useProjectionMediaReady(PRESENTATION));

    expect(result.current.status).toBe("checking");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      SECOND.mediaUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current).toMatchObject({
      readyCount: 2,
      totalCount: 2,
      failure: null,
    });
    expect(result.current.receivedBytes).toBe(result.current.totalBytes);
  });

  it("저장 공간을 만들 수 없으면 quota로 실패한다", async () => {
    mockEstimate(100, 99);
    const fetchMock = mockFetch();

    const { result } = renderHook(() => useProjectionMediaReady(PRESENTATION));

    await waitFor(() => expect(result.current.failure).toBe("quota"));
    expect(result.current.status).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("오프라인이면 받지 않고 offline으로 실패한다", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = mockFetch();

    const { result } = renderHook(() => useProjectionMediaReady(PRESENTATION));

    await waitFor(() => expect(result.current.failure).toBe("offline"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("받다가 실패하면 network로 알리고, 다시 시도하면 이어서 받는다", async () => {
    mockFetch(500);
    const { result } = renderHook(() => useProjectionMediaReady(PRESENTATION));
    await waitFor(() => expect(result.current.failure).toBe("network"));

    mockFetch();
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("받다가 저장 공간이 모자라면 network가 아니라 quota로 실패한다", async () => {
    mockFetch();
    await rejectPutWithQuota();

    const { result } = renderHook(() => useProjectionMediaReady(PRESENTATION));

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.failure).toBe("quota");
  });

  it("Cache Storage가 실패해도 확인 중에 멈추지 않고 실패로 끝난다", async () => {
    vi.spyOn(caches, "open").mockRejectedValue(
      new DOMException("broken", "UnknownError"),
    );
    mockFetch();

    const { result } = renderHook(() => useProjectionMediaReady(PRESENTATION));

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.failure).toBe("network");
  });

  it("passive면 Cache Storage가 실패해도 다시 확인한다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const open = vi
      .spyOn(caches, "open")
      .mockRejectedValue(new DOMException("broken", "UnknownError"));

    const { result } = renderHook(() =>
      useProjectionMediaReady(PRESENTATION, { passive: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("downloading"));

    open.mockRestore();
    await store(FIRST.mediaUrl);
    await store(SECOND.mediaUrl);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PASSIVE_RECHECK_MS);
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("passive면 직접 받지 않고 다른 곳에서 저장되면 따라잡는다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = mockFetch();

    const { result } = renderHook(() =>
      useProjectionMediaReady(PRESENTATION, { passive: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("downloading"));
    expect(result.current.readyCount).toBe(0);

    await store(FIRST.mediaUrl);
    await store(SECOND.mediaUrl);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PASSIVE_RECHECK_MS);
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passive면 자동 캐시가 저장 공간 부족으로 실패한 것을 알리고, 저장되면 풀린다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch();
    const put = await rejectPutWithQuota();

    const { result } = renderHook(() =>
      useProjectionMediaReady(PRESENTATION, { passive: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("downloading"));

    await act(async () => {
      expect(await cacheMediaFirst(FIRST.mediaUrl)).toBe(false);
      await vi.advanceTimersByTimeAsync(PASSIVE_RECHECK_MS);
    });
    await waitFor(() => expect(result.current.failure).toBe("quota"));
    expect(result.current.status).toBe("failed");

    put.mockRestore();
    await store(FIRST.mediaUrl);
    await store(SECOND.mediaUrl);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PASSIVE_RECHECK_MS);
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.failure).toBeNull();
  });

  it("passive에서 다시 시도하면 빠진 영상을 다시 받아 저장 공간 부족을 푼다", async () => {
    mockFetch();
    const put = await rejectPutWithQuota();
    expect(await cacheMediaFirst(FIRST.mediaUrl)).toBe(false);

    const { result } = renderHook(() =>
      useProjectionMediaReady(PRESENTATION, { passive: true }),
    );
    await waitFor(() => expect(result.current.failure).toBe("quota"));

    put.mockRestore();
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe("downloading"));
    await waitFor(() => expect(result.current.status).toBe("ready"), {
      timeout: PASSIVE_RECHECK_MS * 2,
    });
    expect(result.current.failure).toBeNull();
  });

  it("passive에서 다시 시도해도 세트 밖 영상을 다 지워 자리가 없으면 다시 받지 않고 저장 공간 부족을 남긴다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = mockFetch();
    const put = await rejectPutWithQuota();
    expect(await cacheMediaFirst(FIRST.mediaUrl)).toBe(false);
    put.mockRestore();
    fetchMock.mockClear();
    mockEstimate(100, 100);

    const { result } = renderHook(() =>
      useProjectionMediaReady(PRESENTATION, { passive: true }),
    );
    await waitFor(() => expect(result.current.failure).toBe("quota"));

    act(() => result.current.retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PASSIVE_RECHECK_MS * 2);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toBe("quota");
  });

  describe("편집기 자동 캐시와 함께", () => {
    function stalledResponse(): Response {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(2));
          },
        }),
        { status: 200, headers: { "content-length": "5" } },
      );
    }

    function mockFetchFor(
      firstVideo: (attempt: number) => Response,
    ): ReturnType<typeof vi.fn> {
      let attempt = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === FIRST.mediaUrl) {
          attempt += 1;
          return firstVideo(attempt);
        }
        return new Response("media", {
          status: 200,
          headers: { "content-length": "5" },
        });
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      return fetchMock;
    }

    function renderEditor() {
      return renderHook(() => {
        useBackgroundAutoCache(PRESENTATION);
        return useProjectionMediaReady(PRESENTATION, { passive: true });
      });
    }

    async function advance(ms: number): Promise<void> {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
      __setMediaRetryRandomForTests(() => 0);
    });

    it("첫 시도가 무진행으로 끊기면 곧 다시 시도한다고 알리고, 다시 받아 담기면 조작 없이 진행 표시가 사라진다", async () => {
      mockFetchFor((attempt) =>
        attempt === 1
          ? stalledResponse()
          : new Response("media", {
              status: 200,
              headers: { "content-length": "5" },
            }),
      );

      const { result } = renderEditor();
      await advance(
        AUTO_CACHE_DELAY_MS + MEDIA_STALL_TIMEOUT_MS + PASSIVE_RECHECK_MS,
      );

      expect(result.current).toMatchObject({
        status: "downloading",
        retrying: true,
        readyCount: 1,
        failure: null,
      });

      await advance(MEDIA_STALL_TIMEOUT_MS + PASSIVE_RECHECK_MS);

      expect(result.current).toMatchObject({
        status: "ready",
        retrying: false,
        readyCount: 2,
      });
    });

    it("다시 받아도 낫지 않는 실패로 멈추면 failed로 알리고, 다시 시도하면 받는다", async () => {
      mockFetchFor((attempt) =>
        attempt === 1
          ? new Response(null, { status: 404 })
          : new Response("media", {
              status: 200,
              headers: { "content-length": "5" },
            }),
      );

      const { result } = renderEditor();
      await advance(AUTO_CACHE_DELAY_MS + PASSIVE_RECHECK_MS);

      expect(result.current).toMatchObject({
        status: "failed",
        failure: "network",
        retrying: false,
      });

      act(() => result.current.retry());
      await advance(PASSIVE_RECHECK_MS);

      expect(result.current.status).toBe("ready");
    });
  });
});
