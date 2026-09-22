import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MEDIA_CACHE_NAME } from "@repo/shared";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import {
  cacheMediaUrls,
  getCachedUrls,
  evictMediaUrls,
  isCacheStorageAvailable,
  type MediaCacheItem,
} from "./mediaCache";

const VIDEO = "/api/media/loops/warm_light_flow.mp4";
const POSTER = "/api/media/posters/warm_light_flow.webp";

function bodyOf(size: number): ArrayBuffer {
  return new ArrayBuffer(size);
}

function okResponse(size: number): Response {
  return new Response(bodyOf(size), {
    status: 200,
    headers: { "content-type": "video/mp4" },
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetFakeCacheStorage();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("cacheMediaUrls", () => {
  it("요청한 URL을 모두 받아 캐시에 넣는다", async () => {
    globalThis.fetch = vi.fn(async () => okResponse(1024)) as typeof fetch;

    const result = await cacheMediaUrls([VIDEO, POSTER]);

    expect(result.isComplete).toBe(true);
    expect(result.cachedUrls).toEqual([VIDEO, POSTER]);
    expect(result.totalBytes).toBe(2048);

    const cache = await caches.open(MEDIA_CACHE_NAME);
    expect(await cache.match(VIDEO)).toBeDefined();
    expect(await cache.match(POSTER)).toBeDefined();
  });

  it("Range 헤더 없이 전체 응답을 받는다", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => okResponse(16));
    globalThis.fetch = fetchMock;

    await cacheMediaUrls([VIDEO]);

    const init = fetchMock.mock.calls[0][1];
    // 부분 응답을 캐시에 넣으면 RangeRequestsPlugin이 영상을 중간에 끊는다.
    expect(init?.headers).toBeUndefined();
    // 동일 출처이므로 mode를 지정하지 않는다.
    expect(init?.mode).toBeUndefined();
  });

  it("이미 캐시에 있으면 다시 받지 않는다", async () => {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    await cache.put(
      VIDEO,
      new Response(bodyOf(64), {
        status: 200,
        headers: { "content-length": "64" },
      }),
    );
    const fetchMock = vi.fn(async () => okResponse(1024));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await cacheMediaUrls([VIDEO]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isComplete).toBe(true);
    expect(result.totalBytes).toBe(64);
  });

  it("한 항목이 실패해도 나머지를 계속 받는다", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === VIDEO) return new Response(null, { status: 404 });
      return okResponse(512);
    }) as unknown as typeof fetch;

    const result = await cacheMediaUrls([VIDEO, POSTER]);

    expect(result.isComplete).toBe(false);
    expect(result.items[0]).toMatchObject({
      status: "failed",
      reason: "network",
    });
    expect(result.items[1].status).toBe("done");
    expect(result.cachedUrls).toEqual([POSTER]);
  });

  it("용량 초과를 네트워크 실패와 구분한다", async () => {
    globalThis.fetch = vi.fn(async () => okResponse(1024)) as typeof fetch;
    const cache = await caches.open(MEDIA_CACHE_NAME);
    vi.spyOn(cache, "put").mockRejectedValue(
      new DOMException("quota", "QuotaExceededError"),
    );

    const result = await cacheMediaUrls([VIDEO]);

    expect(result.items[0]).toMatchObject({
      status: "failed",
      reason: "quota",
    });
  });

  it("진행 상황을 단계별로 보고한다", async () => {
    globalThis.fetch = vi.fn(async () => okResponse(10)) as typeof fetch;
    const snapshots: MediaCacheItem[][] = [];

    await cacheMediaUrls([VIDEO], {
      onProgress: (items) => snapshots.push(items),
    });

    const statuses = snapshots.map((items) => items[0].status);
    expect(statuses).toContain("pending");
    expect(statuses).toContain("downloading");
    expect(statuses[statuses.length - 1]).toBe("done");
  });

  it("중단 신호를 받으면 남은 항목을 받지 않는다", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      return okResponse(10);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await cacheMediaUrls([VIDEO, POSTER], { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("받을 것이 없으면 완료로 보지 않는다", async () => {
    const result = await cacheMediaUrls([]);

    expect(result.isComplete).toBe(false);
    expect(result.totalBytes).toBe(0);
  });
});

describe("getCachedUrls / evictMediaUrls", () => {
  it("캐시에 있는 URL만 골라낸다", async () => {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    await cache.put(VIDEO, new Response(bodyOf(8), { status: 200 }));

    const cached = await getCachedUrls([VIDEO, POSTER]);

    expect(cached.has(VIDEO)).toBe(true);
    expect(cached.has(POSTER)).toBe(false);
  });

  it("캐시된 항목을 지운다", async () => {
    globalThis.fetch = vi.fn(async () => okResponse(8)) as typeof fetch;
    await cacheMediaUrls([VIDEO]);

    await evictMediaUrls([VIDEO]);

    expect((await getCachedUrls([VIDEO])).size).toBe(0);
  });
});

describe("isCacheStorageAvailable", () => {
  it("대역이 깔린 테스트 환경에서는 사용 가능하다", () => {
    expect(isCacheStorageAvailable()).toBe(true);
  });
});
