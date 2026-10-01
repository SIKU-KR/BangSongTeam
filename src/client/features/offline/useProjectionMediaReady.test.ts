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
import { __resetMediaCachingForTests } from "../../lib/offline/mediaCache";
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
    expect(fetchMock).toHaveBeenCalledWith(SECOND.mediaUrl);
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
});
