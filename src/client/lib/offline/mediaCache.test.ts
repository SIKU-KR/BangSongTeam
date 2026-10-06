import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MEDIA_CACHE_NAME, mediaCacheNameFor } from "#shared";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import {
  cacheMediaFirst,
  cacheMediaUrls,
  ensureMediaSpace,
  findCachedMediaUrls,
  getMediaCacheFailure,
  getMediaProgress,
  scheduleMediaCaching,
  shouldWaitForMediaCache,
  isCacheStorageAvailable,
  MEDIA_STALL_TIMEOUT_MS,
  __resetMediaCachingForTests,
  __waitForMediaCachingForTests,
} from "./mediaCache";

const VIDEO = "/api/media/loops/warm_light_flow.mp4";
const POSTER = "/api/media/posters/warm_light_flow.webp";
const OTHER = "/api/media/loops/ocean_wave.mp4";
const LARGE = "/api/media/loops/mountain_dawn.mp4";

function okResponse(size = 16): Response {
  return new Response(new ArrayBuffer(size), {
    status: 200,
    headers: { "content-type": "video/mp4", "content-length": String(size) },
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

function controlByServiceWorker(): void {
  Object.defineProperty(navigator, "serviceWorker", {
    value: { controller: {} },
    configurable: true,
  });
}

function mockServiceWorkerFetch() {
  return mockFetch(async (url) => {
    const response = okResponse();
    const copy = response.clone();
    const cache = await caches.open(mediaCacheNameFor(url));
    setTimeout(() => void cache.put(url, copy), 0);
    return response;
  });
}

function mockEstimate(quota: number, usage: number): void {
  Object.defineProperty(navigator, "storage", {
    value: { estimate: vi.fn(async () => ({ quota, usage })) },
    configurable: true,
  });
}

function quotaError(): DOMException {
  return new DOMException("quota", "QuotaExceededError");
}

async function isCached(url: string): Promise<boolean> {
  const cache = await caches.open(mediaCacheNameFor(url));
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
  vi.useRealTimers();
  // @ts-expect-error 테스트에서 주입한 서비스 워커를 되돌린다
  delete navigator.serviceWorker;
  // @ts-expect-error 테스트에서 주입한 저장소 관리자를 되돌린다
  delete navigator.storage;
});

describe("cacheMediaUrls", () => {
  it("요청한 URL을 모두 받아 캐시에 넣는다", async () => {
    mockFetch();

    const result = await cacheMediaUrls([VIDEO, POSTER]);

    expect(result).toEqual({ cachedUrls: [VIDEO, POSTER] });
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

    expect(result).toEqual({ cachedUrls: [POSTER] });
    expect(await isCached(VIDEO)).toBe(false);
  });

  it("부분 응답(206)은 캐시에 넣지 않는다", async () => {
    mockFetch(async () => new Response(new ArrayBuffer(4), { status: 206 }));

    const result = await cacheMediaUrls([VIDEO]);

    expect(result.cachedUrls).toEqual([]);
    expect(await isCached(VIDEO)).toBe(false);
  });

  it("네트워크 오류나 용량 초과는 실패로 삼키고 던지지 않는다", async () => {
    mockFetch(async (url) => {
      if (url === VIDEO) throw new TypeError("Failed to fetch");
      return okResponse();
    });
    const cache = await caches.open(MEDIA_CACHE_NAME);
    vi.spyOn(cache, "put").mockRejectedValue(quotaError());

    const result = await cacheMediaUrls([VIDEO, OTHER]);

    expect(result).toEqual({ cachedUrls: [] });
    expect(getMediaCacheFailure(VIDEO)).toBe("network");
    expect(getMediaCacheFailure(OTHER)).toBe("quota");
  });
});

describe("cacheMediaUrls 진행률과 캐시 분리", () => {
  it("받은 바이트 수를 응답 길이와 함께 알린다", async () => {
    mockFetch(async () => okResponse(64));

    await cacheMediaUrls([VIDEO]);

    expect(getMediaProgress(VIDEO)).toEqual({ received: 64, total: 64 });
  });

  it("포스터는 영상 캐시가 아닌 포스터 캐시에 담는다", async () => {
    mockFetch();

    await cacheMediaUrls([POSTER]);

    const videos = await caches.open(MEDIA_CACHE_NAME);
    expect(await videos.match(POSTER)).toBeUndefined();
    expect(await isCached(POSTER)).toBe(true);
  });
});

describe("cacheMediaUrls (서비스 워커 제어 중)", () => {
  it("SW가 캐시에 담으므로 페이지는 cache.put을 하지 않는다", async () => {
    controlByServiceWorker();
    mockServiceWorkerFetch();
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const put = vi.spyOn(cache, "put");

    const result = await cacheMediaUrls([VIDEO]);

    expect(result).toEqual({ cachedUrls: [VIDEO] });
    expect(put).toHaveBeenCalledTimes(1);
    expect(await isCached(VIDEO)).toBe(true);
  });

  it("본문이 다 오기 전에 끝났고 SW가 담지 않으면 네트워크 실패로 돌려준다", async () => {
    vi.useFakeTimers();
    controlByServiceWorker();
    mockFetch(
      async () =>
        new Response(new ArrayBuffer(8), {
          status: 200,
          headers: { "content-length": "16" },
        }),
    );

    const pendingResult = cacheMediaUrls([VIDEO]);
    await vi.runAllTimersAsync();

    expect(await pendingResult).toEqual({ cachedUrls: [] });
    expect(getMediaCacheFailure(VIDEO)).toBe("network");
  });

  it("본문을 다 받았는데 SW가 담지 않으면 용량을 알 수 없어도 저장 공간 부족으로 남긴다", async () => {
    vi.useFakeTimers();
    controlByServiceWorker();
    mockFetch();

    const pendingResult = cacheMediaUrls([VIDEO]);
    await vi.runAllTimersAsync();

    expect(await pendingResult).toEqual({ cachedUrls: [] });
    expect(getMediaCacheFailure(VIDEO)).toBe("quota");
  });

  it("본문을 다 받았는데 SW가 담지 않아도 알려 준 남은 용량이 파일보다 크면 네트워크 실패로 남긴다", async () => {
    vi.useFakeTimers();
    controlByServiceWorker();
    mockEstimate(1024 * 1024 * 1024, 0);
    mockFetch();

    const pendingResult = cacheMediaUrls([VIDEO]);
    await vi.runAllTimersAsync();

    expect(await pendingResult).toEqual({ cachedUrls: [] });
    expect(getMediaCacheFailure(VIDEO)).toBe("network");
  });

  it("본문을 다 받았는데 SW가 담지 않고 알려 준 남은 용량도 파일보다 작으면 저장 공간 부족으로 남긴다", async () => {
    vi.useFakeTimers();
    controlByServiceWorker();
    mockEstimate(100, 92);
    mockFetch();

    const pendingResult = cacheMediaUrls([VIDEO]);
    await vi.runAllTimersAsync();

    expect(await pendingResult).toEqual({ cachedUrls: [] });
    expect(getMediaCacheFailure(VIDEO)).toBe("quota");
  });
});

describe("cacheMediaUrls 멈춘 다운로드", () => {
  function mockFetchWithInit(
    impl: (url: string, init: RequestInit | undefined) => Promise<Response>,
  ) {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) =>
        impl(String(input), init),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function stalledResponse(): Response {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(8));
        },
      }),
      { status: 200, headers: { "content-length": "16" } },
    );
  }

  it("본문이 멈추면 제한 시간 뒤 실패로 끝나고, 다음 호출은 새로 받는다", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetchWithInit(async () => stalledResponse());

    const first = cacheMediaFirst(VIDEO);
    await vi.advanceTimersByTimeAsync(MEDIA_STALL_TIMEOUT_MS);

    expect(await first).toBe(false);
    expect(getMediaProgress(VIDEO)).toEqual({ received: 8, total: 16 });

    void cacheMediaFirst(VIDEO);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MEDIA_STALL_TIMEOUT_MS);
  });

  it("응답 헤더가 오지 않으면 요청을 끊고 실패로 끝낸다", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    mockFetchWithInit(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () => reject(signal?.reason));
        }),
    );

    const result = cacheMediaFirst(VIDEO);
    await vi.advanceTimersByTimeAsync(MEDIA_STALL_TIMEOUT_MS);

    expect(await result).toBe(false);
    expect(signal?.aborted).toBe(true);
  });

  it("Cache Storage가 응답하지 않으면 제한 시간 뒤 실패로 끝나고, 다음 호출은 새로 시도한다", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetchWithInit(async () => okResponse());
    vi.spyOn(caches, "open").mockReturnValueOnce(new Promise<Cache>(() => {}));

    const first = cacheMediaFirst(VIDEO);
    await vi.advanceTimersByTimeAsync(MEDIA_STALL_TIMEOUT_MS);

    expect(await first).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const second = cacheMediaFirst(VIDEO);
    await vi.advanceTimersByTimeAsync(0);
    expect(await second).toBe(true);
  });

  it("느려도 바이트가 계속 오면 끊지 않는다", async () => {
    vi.useFakeTimers();
    const step = MEDIA_STALL_TIMEOUT_MS / 2;
    let chunks = 0;
    mockFetchWithInit(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              await new Promise((resolve) => setTimeout(resolve, step));
              chunks += 1;
              controller.enqueue(new Uint8Array(4));
              if (chunks === 4) controller.close();
            },
          }),
          { status: 200 },
        ),
    );

    const result = cacheMediaFirst(VIDEO);
    await vi.advanceTimersByTimeAsync(MEDIA_STALL_TIMEOUT_MS * 3);

    expect(await result).toBe(true);
    expect(getMediaProgress(VIDEO)?.received).toBe(16);
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

describe("cacheMediaFirst", () => {
  it("큐가 같은 URL을 받는 중이면 그 다운로드를 기다리고 다시 받지 않는다", async () => {
    let release: () => void = () => undefined;
    const fetchMock = mockFetch(async (url) => {
      if (url === VIDEO) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return okResponse();
    });

    scheduleMediaCaching([VIDEO, POSTER]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const cached = cacheMediaFirst(VIDEO);
    release();

    expect(await cached).toBe(true);
    await __waitForMediaCachingForTests();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      VIDEO,
      POSTER,
    ]);
  });

  it("큐가 다른 파일을 받는 중이어도 기다리지 않고 곧바로 받는다", async () => {
    let release: () => void = () => undefined;
    const fetchMock = mockFetch(async (url) => {
      if (url === VIDEO) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return okResponse();
    });

    scheduleMediaCaching([VIDEO, OTHER]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(await cacheMediaFirst(OTHER)).toBe(true);
    release();
    await __waitForMediaCachingForTests();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("실패하면 false로 끝난다", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));

    expect(await cacheMediaFirst(VIDEO)).toBe(false);
    expect(getMediaCacheFailure(VIDEO)).toBe("network");
  });

  it("저장 공간이 모자라면 까닭을 quota로 남기고, 다시 담기면 지운다", async () => {
    mockFetch();
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const put = vi.spyOn(cache, "put").mockRejectedValueOnce(quotaError());

    expect(await cacheMediaFirst(VIDEO)).toBe(false);
    expect(getMediaCacheFailure(VIDEO)).toBe("quota");

    put.mockRestore();
    expect(await cacheMediaFirst(VIDEO)).toBe(true);
    expect(getMediaCacheFailure(VIDEO)).toBeUndefined();
  });
});

describe("findCachedMediaUrls", () => {
  it("이미 캐시에 담긴 URL만 돌려준다", async () => {
    mockFetch();
    await cacheMediaUrls([VIDEO]);
    __resetMediaCachingForTests();

    expect(await findCachedMediaUrls([VIDEO, OTHER, POSTER])).toEqual([VIDEO]);
  });

  it("Cache Storage가 열리지 않으면 던지지 않고 담기지 않은 것으로 본다", async () => {
    vi.spyOn(caches, "open").mockRejectedValue(
      new DOMException("broken", "UnknownError"),
    );

    expect(await findCachedMediaUrls([VIDEO, POSTER])).toEqual([]);
  });
});

describe("ensureMediaSpace", () => {
  const MIB = 1024 * 1024;

  async function seedVideo(url: string, claimedBytes: number): Promise<void> {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    await cache.put(
      url,
      new Response("media", {
        status: 200,
        headers: { "content-length": String(claimedBytes) },
      }),
    );
  }

  it("자리가 있으면 아무것도 지우지 않는다", async () => {
    mockFetch(async () => okResponse(100));
    await cacheMediaUrls([OTHER]);
    mockEstimate(1000, 100);

    expect(await ensureMediaSpace(500, [VIDEO])).toBe(true);
    expect(await isCached(OTHER)).toBe(true);
  });

  it("모자라면 지금 세트 밖의 영상부터 지우고 세트 영상은 남긴다", async () => {
    mockFetch(async () => okResponse(400));
    await cacheMediaUrls([OTHER, VIDEO]);
    mockEstimate(1000, 800);

    expect(await ensureMediaSpace(500, [VIDEO])).toBe(true);
    expect(await isCached(OTHER)).toBe(false);
    expect(await isCached(VIDEO)).toBe(true);
  });

  it("세트 밖 영상을 모두 지워도 모자라면 false다", async () => {
    mockFetch(async () => okResponse(100));
    await cacheMediaUrls([VIDEO]);
    mockEstimate(1000, 900);

    expect(await ensureMediaSpace(5000, [VIDEO])).toBe(false);
    expect(await isCached(VIDEO)).toBe(true);
  });

  it("지우다가 Cache Storage가 실패해도 던지지 않고 자리가 없다고 본다", async () => {
    mockEstimate(1000, 900);
    vi.spyOn(caches, "open").mockRejectedValue(
      new DOMException("broken", "UnknownError"),
    );

    expect(await ensureMediaSpace(500, [VIDEO])).toBe(false);
  });

  it("브라우저가 용량을 알려 주지 않아도 지울 것이 없으면 실제 받기에 맡기고 통과시킨다", async () => {
    expect(await ensureMediaSpace(5000, [])).toBe(true);
  });

  it("브라우저가 용량을 알려 주지 않으면 예산을 넘는 만큼 세트 밖 영상을 미리 지운다", async () => {
    await seedVideo(OTHER, 300 * MIB);
    await seedVideo(VIDEO, 300 * MIB);

    expect(await ensureMediaSpace(300 * MIB, [VIDEO])).toBe(true);
    expect(await isCached(OTHER)).toBe(false);
    expect(await isCached(VIDEO)).toBe(true);
  });

  it("브라우저가 용량을 알려 주지 않아도 예산 안이면 지우지 않는다", async () => {
    await seedVideo(OTHER, 10 * MIB);

    expect(await ensureMediaSpace(10 * MIB, [VIDEO])).toBe(true);
    expect(await isCached(OTHER)).toBe(true);
  });

  it("이미 저장 공간 부족을 겪었으면 알려 준 용량을 믿지 않고 세트 밖 영상을 지운다", async () => {
    mockFetch();
    const cache = await caches.open(MEDIA_CACHE_NAME);
    vi.spyOn(cache, "put").mockRejectedValueOnce(quotaError());
    await cacheMediaFirst(LARGE);
    expect(getMediaCacheFailure(LARGE)).toBe("quota");
    await seedVideo(OTHER, 300 * MIB);
    await seedVideo(VIDEO, 300 * MIB);
    mockEstimate(10_000 * MIB, 0);

    expect(await ensureMediaSpace(300 * MIB, [VIDEO, LARGE])).toBe(true);
    expect(await isCached(OTHER)).toBe(false);
    expect(await isCached(VIDEO)).toBe(true);
  });

  it("다시 큐에 넣어 실패 까닭이 지워져도 세트 영상이 겪은 부족은 공간 확보에 남는다", async () => {
    mockFetch();
    const cache = await caches.open(MEDIA_CACHE_NAME);
    vi.spyOn(cache, "put").mockRejectedValueOnce(quotaError());
    await cacheMediaFirst(LARGE);
    let release: () => void = () => undefined;
    const fetchMock = mockFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(null, { status: 404 }));
        }),
    );

    scheduleMediaCaching([LARGE]);
    expect(getMediaCacheFailure(LARGE)).toBeUndefined();
    await seedVideo(OTHER, 300 * MIB);
    await seedVideo(VIDEO, 300 * MIB);
    mockEstimate(10_000 * MIB, 0);

    expect(await ensureMediaSpace(300 * MIB, [VIDEO, LARGE])).toBe(true);
    expect(await isCached(OTHER)).toBe(false);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    release();
    await __waitForMediaCachingForTests();
  });

  it("부족을 겪어 의심할 때도 알려 준 용량이 예산보다 작으면 그만큼 세트 밖 영상을 지운다", async () => {
    mockFetch();
    const cache = await caches.open(MEDIA_CACHE_NAME);
    vi.spyOn(cache, "put").mockRejectedValueOnce(quotaError());
    await cacheMediaFirst(LARGE);
    expect(getMediaCacheFailure(LARGE)).toBe("quota");
    await seedVideo(OTHER, 100 * MIB);
    mockEstimate(250 * MIB, 0);

    expect(await ensureMediaSpace(300 * MIB, [LARGE])).toBe(true);
    expect(await isCached(OTHER)).toBe(false);
  });

  it("부족을 겪어 의심할 때 세트 밖 영상을 모두 지워도 알려 준 용량이 모자라면 false다", async () => {
    mockFetch();
    const cache = await caches.open(MEDIA_CACHE_NAME);
    vi.spyOn(cache, "put").mockRejectedValueOnce(quotaError());
    await cacheMediaFirst(LARGE);
    await seedVideo(OTHER, 10 * MIB);
    mockEstimate(250 * MIB, 0);

    expect(await ensureMediaSpace(300 * MIB, [LARGE])).toBe(false);
    expect(await isCached(OTHER)).toBe(false);
  });

  it("세트 밖 영상이 겪은 저장 공간 부족으로는 알려 준 용량을 의심하지 않는다", async () => {
    mockFetch();
    const cache = await caches.open(MEDIA_CACHE_NAME);
    vi.spyOn(cache, "put").mockRejectedValueOnce(quotaError());
    await cacheMediaFirst(LARGE);
    expect(getMediaCacheFailure(LARGE)).toBe("quota");
    await seedVideo(OTHER, 300 * MIB);
    await seedVideo(VIDEO, 300 * MIB);
    mockEstimate(10_000 * MIB, 0);

    expect(await ensureMediaSpace(300 * MIB, [VIDEO])).toBe(true);
    expect(await isCached(OTHER)).toBe(true);
  });
});

describe("shouldWaitForMediaCache", () => {
  it("SW가 페이지를 제어하지 않으면 기다리지 않는다", () => {
    expect(shouldWaitForMediaCache(VIDEO)).toBe(false);
  });

  it("SW가 제어하면 캐시에 담기기 전까지만 기다린다", async () => {
    controlByServiceWorker();
    mockServiceWorkerFetch();

    expect(shouldWaitForMediaCache(VIDEO)).toBe(true);
    expect(await cacheMediaFirst(VIDEO)).toBe(true);
    expect(shouldWaitForMediaCache(VIDEO)).toBe(false);
  });

  it("오프라인이면 기다리지 않는다", () => {
    controlByServiceWorker();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    expect(shouldWaitForMediaCache(VIDEO)).toBe(false);
  });
});

describe("isCacheStorageAvailable", () => {
  it("대역이 깔린 테스트 환경에서는 사용 가능하다", () => {
    expect(isCacheStorageAvailable()).toBe(true);
  });
});
