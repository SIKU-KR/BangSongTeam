import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MEDIA_CACHE_NAME } from "#shared";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import {
  cacheMediaUrls,
  scheduleMediaCaching,
  isCacheStorageAvailable,
  __resetMediaCachingForTests,
  __waitForMediaCachingForTests,
} from "./mediaCache";

const VIDEO = "/api/media/loops/warm_light_flow.mp4";
const POSTER = "/api/media/posters/warm_light_flow.webp";
const OTHER = "/api/media/loops/ocean_wave.mp4";

function okResponse(size = 16): Response {
  return new Response(new ArrayBuffer(size), {
    status: 200,
    headers: { "content-type": "video/mp4" },
  });
}

function mockFetch(
  impl: (url: string) => Promise<Response> = async () => okResponse(),
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    impl(String(input)),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function isCached(url: string): Promise<boolean> {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  return (await cache.match(url)) !== undefined;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetFakeCacheStorage();
  __resetMediaCachingForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("cacheMediaUrls", () => {
  it("요청한 URL을 모두 받아 캐시에 넣는다", async () => {
    mockFetch();

    const result = await cacheMediaUrls([VIDEO, POSTER]);

    expect(result).toEqual({ cachedUrls: [VIDEO, POSTER], failedUrls: [] });
    expect(await isCached(VIDEO)).toBe(true);
    expect(await isCached(POSTER)).toBe(true);
  });

  it("Range 헤더 없이 전체 응답을 받는다", async () => {
    const fetchMock = mockFetch();

    await cacheMediaUrls([VIDEO]);

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as
      RequestInit | undefined;
    expect(init?.headers).toBeUndefined();
    expect(init?.mode).toBeUndefined();
  });

  it("이미 캐시에 있으면 다시 받지 않는다", async () => {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    await cache.put(VIDEO, okResponse());
    const fetchMock = mockFetch();

    const result = await cacheMediaUrls([VIDEO]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.cachedUrls).toEqual([VIDEO]);
  });

  it("한 항목이 실패해도 나머지를 계속 받는다", async () => {
    mockFetch(async (url) =>
      url === VIDEO ? new Response(null, { status: 404 }) : okResponse(),
    );

    const result = await cacheMediaUrls([VIDEO, POSTER]);

    expect(result).toEqual({ cachedUrls: [POSTER], failedUrls: [VIDEO] });
    expect(await isCached(VIDEO)).toBe(false);
  });

  it("부분 응답(206)은 캐시에 넣지 않는다", async () => {
    mockFetch(async () => new Response(new ArrayBuffer(4), { status: 206 }));

    const result = await cacheMediaUrls([VIDEO]);

    expect(result.failedUrls).toEqual([VIDEO]);
    expect(await isCached(VIDEO)).toBe(false);
  });

  it("네트워크 오류나 용량 초과는 실패로 삼키고 던지지 않는다", async () => {
    mockFetch(async (url) => {
      if (url === VIDEO) throw new TypeError("Failed to fetch");
      return okResponse();
    });
    const cache = await caches.open(MEDIA_CACHE_NAME);
    vi.spyOn(cache, "put").mockRejectedValue(
      new DOMException("quota", "QuotaExceededError"),
    );

    const result = await cacheMediaUrls([VIDEO, POSTER]);

    expect(result).toEqual({ cachedUrls: [], failedUrls: [VIDEO, POSTER] });
  });
});

describe("scheduleMediaCaching", () => {
  it("큐에 넣은 URL을 백그라운드로 받아 캐시에 넣는다", async () => {
    mockFetch();

    scheduleMediaCaching([VIDEO, POSTER]);
    await __waitForMediaCachingForTests();

    expect(await isCached(VIDEO)).toBe(true);
    expect(await isCached(POSTER)).toBe(true);
  });

  it("한 번에 하나씩 순차로 받는다", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockFetch(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return okResponse();
    });

    scheduleMediaCaching([VIDEO, POSTER, OTHER]);
    await __waitForMediaCachingForTests();

    expect(maxInFlight).toBe(1);
  });

  it("받는 도중 같은 URL을 다시 넣어도 한 번만 받는다", async () => {
    const fetchMock = mockFetch();

    scheduleMediaCaching([VIDEO, POSTER]);
    scheduleMediaCaching([VIDEO, POSTER]);
    await __waitForMediaCachingForTests();
    scheduleMediaCaching([VIDEO, POSTER]);
    await __waitForMediaCachingForTests();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("받는 도중 새로 넣은 URL도 이어서 받는다", async () => {
    mockFetch();

    scheduleMediaCaching([VIDEO]);
    scheduleMediaCaching([OTHER]);
    await __waitForMediaCachingForTests();

    expect(await isCached(VIDEO)).toBe(true);
    expect(await isCached(OTHER)).toBe(true);
  });

  it("우선 항목은 아직 받지 않은 항목보다 먼저 받는다", async () => {
    const fetchMock = mockFetch();

    scheduleMediaCaching([VIDEO, POSTER]);
    scheduleMediaCaching([OTHER, POSTER], { priority: true });
    await __waitForMediaCachingForTests();

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      OTHER,
      POSTER,
      VIDEO,
    ]);
  });

  it("실패한 URL은 다음 호출에서 다시 시도한다", async () => {
    let attempts = 0;
    const fetchMock = mockFetch(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return okResponse();
    });

    scheduleMediaCaching([VIDEO]);
    await __waitForMediaCachingForTests();
    expect(await isCached(VIDEO)).toBe(false);

    scheduleMediaCaching([VIDEO]);
    await __waitForMediaCachingForTests();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await isCached(VIDEO)).toBe(true);
  });

  it("오프라인이면 아무것도 받지 않는다", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = mockFetch();

    scheduleMediaCaching([VIDEO]);
    await __waitForMediaCachingForTests();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("처음 시작할 때 한 번만 영구 저장소를 요청한다", async () => {
    mockFetch();
    const persist = vi.fn(async () => true);
    const original = Object.getOwnPropertyDescriptor(navigator, "storage");
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => false, persist },
      configurable: true,
    });

    try {
      scheduleMediaCaching([VIDEO]);
      await __waitForMediaCachingForTests();
      scheduleMediaCaching([OTHER]);
      await __waitForMediaCachingForTests();
    } finally {
      if (original) {
        Object.defineProperty(navigator, "storage", original);
      } else {
        // @ts-expect-error 테스트에서 주입한 속성을 되돌린다
        delete navigator.storage;
      }
    }

    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe("isCacheStorageAvailable", () => {
  it("대역이 깔린 테스트 환경에서는 사용 가능하다", () => {
    expect(isCacheStorageAvailable()).toBe(true);
  });
});
