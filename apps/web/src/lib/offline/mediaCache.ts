import { MEDIA_CACHE_NAME } from "@repo/shared";

/**
 * 배경 영상·포스터를 Cache Storage에 미리 담는 계층 (PRD 6.1, TECH_SPEC 5.4-3).
 *
 * **Service Worker가 활성화되기를 기다리지 않는다.** 첫 방문에서는 SW가 아직
 * activate되지 않아 fetch가 가로채이지 않는다. 그 타이밍에 의존하면 '준비를
 * 눌렀는데 아무것도 안 받아진' 상태로 예배에 들어가게 된다. 그래서 응답을 받아
 * 직접 `cache.put`으로 넣는다. Workbox의 CacheFirst가 같은 `MEDIA_CACHE_NAME`을
 * 읽으므로 송출 때는 그대로 재생된다.
 *
 * **Range 요청을 쓰지 않는다.** RangeRequestsPlugin은 캐시에 있는 *전체* 응답을
 * 잘라 206을 만든다. 부분 응답을 넣어 두면 영상이 중간에 끊긴다.
 */

export type MediaCacheStatus = "pending" | "downloading" | "done" | "failed";

export type MediaCacheFailure = "quota" | "network" | "unsupported";

export interface MediaCacheItem {
  url: string;
  status: MediaCacheStatus;
  /** 받은 바이트 수 (총 캐시 용량 표시용 — PRD 6.3) */
  bytes: number;
  reason?: MediaCacheFailure;
}

export interface MediaCacheResult {
  items: MediaCacheItem[];
  cachedUrls: string[];
  totalBytes: number;
  /** 요청한 URL이 하나도 빠짐없이 캐시에 들어갔는지 */
  isComplete: boolean;
}

export interface CacheMediaOptions {
  onProgress?: (items: MediaCacheItem[]) => void;
  signal?: AbortSignal;
}

/** 이 브라우저에서 Cache Storage를 쓸 수 있는지 */
export function isCacheStorageAvailable(): boolean {
  try {
    return typeof caches !== "undefined" && caches !== null;
  } catch {
    return false;
  }
}

function classifyFailure(err: unknown): MediaCacheFailure {
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    return "quota";
  }
  if (err instanceof Error && err.name === "QuotaExceededError") return "quota";
  return "network";
}

/** 이미 캐시에 들어 있는 URL 집합 */
export async function getCachedUrls(
  urls: readonly string[],
): Promise<Set<string>> {
  const cached = new Set<string>();
  if (!isCacheStorageAvailable()) return cached;

  const cache = await caches.open(MEDIA_CACHE_NAME);
  for (const url of urls) {
    const hit = await cache.match(url);
    if (hit) cached.add(url);
  }
  return cached;
}

/**
 * URL 목록을 순차적으로 받아 캐시에 넣는다.
 *
 * 순차로 도는 이유: 교회 네트워크에서 20MB 영상 다섯 개를 동시에 당기면
 * 전부 느려지고 진행률도 의미가 없어진다. 실패는 그 항목만 표시하고 멈추지
 * 않는다 — 한 곡의 배경이 없다고 나머지 준비까지 버릴 이유가 없다.
 */
export async function cacheMediaUrls(
  urls: readonly string[],
  options: CacheMediaOptions = {},
): Promise<MediaCacheResult> {
  const { onProgress, signal } = options;

  const items: MediaCacheItem[] = urls.map((url) => ({
    url,
    status: "pending",
    bytes: 0,
  }));

  const report = (): void => onProgress?.(items.map((item) => ({ ...item })));

  if (!isCacheStorageAvailable()) {
    for (const item of items) {
      item.status = "failed";
      item.reason = "unsupported";
    }
    report();
    return {
      items,
      cachedUrls: [],
      totalBytes: 0,
      isComplete: urls.length === 0,
    };
  }

  const cache = await caches.open(MEDIA_CACHE_NAME);
  const cachedUrls: string[] = [];
  report();

  for (const item of items) {
    if (signal?.aborted) break;

    // 이미 받아 둔 것은 다시 받지 않는다 (재방문·부분 실패 후 재시도).
    const existing = await cache.match(item.url);
    if (existing) {
      item.status = "done";
      item.bytes = Number(existing.headers.get("content-length") ?? 0);
      cachedUrls.push(item.url);
      report();
      continue;
    }

    item.status = "downloading";
    report();

    try {
      // 동일 출처 프록시이므로 mode를 지정하지 않는다 (TECH_SPEC 5.4-1).
      const response = await fetch(item.url, { signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // 전체 본문을 읽어 바이트 수를 확정하고, 같은 내용으로 캐시에 넣는다.
      const buffer = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      headers.set("content-length", String(buffer.byteLength));

      await cache.put(item.url, new Response(buffer, { status: 200, headers }));

      item.status = "done";
      item.bytes = buffer.byteLength;
      cachedUrls.push(item.url);
    } catch (err) {
      if (signal?.aborted) break;
      item.status = "failed";
      item.reason = classifyFailure(err);
    }
    report();
  }

  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);

  return {
    items,
    cachedUrls,
    totalBytes,
    isComplete:
      items.length > 0 && items.every((item) => item.status === "done"),
  };
}

/** 세트 준비를 다시 하기 위해 캐시된 항목을 지운다 */
export async function evictMediaUrls(urls: readonly string[]): Promise<void> {
  if (!isCacheStorageAvailable()) return;
  const cache = await caches.open(MEDIA_CACHE_NAME);
  for (const url of urls) {
    await cache.delete(url);
  }
}
