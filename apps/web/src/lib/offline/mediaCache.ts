import { MEDIA_CACHE_NAME } from "@repo/shared";
import { requestPersistentStorage } from "./storagePersistence";

/** 미디어 캐시 결과 */
export interface MediaCacheResult {
  cachedUrls: string[];
  failedUrls: string[];
}

/** 브라우저의 Cache Storage 지원 여부 확인 */
export function isCacheStorageAvailable(): boolean {
  try {
    return typeof caches !== "undefined" && caches !== null;
  } catch {
    return false;
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** URL 목록을 순차적으로 받아 캐시에 저장 */
export async function cacheMediaUrls(
  urls: readonly string[],
): Promise<MediaCacheResult> {
  const cachedUrls: string[] = [];
  const failedUrls: string[] = [];

  if (!isCacheStorageAvailable()) {
    return { cachedUrls, failedUrls: [...urls] };
  }

  const cache = await caches.open(MEDIA_CACHE_NAME);

  for (const url of urls) {
    if (await cache.match(url)) {
      cachedUrls.push(url);
      continue;
    }

    try {
      const response = await fetch(url);
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }
      await cache.put(url, response);
      cachedUrls.push(url);
    } catch {
      failedUrls.push(url);
    }
  }

  return { cachedUrls, failedUrls };
}

const pending = new Set<string>();
let draining: Promise<void> | null = null;
let persistenceRequested = false;

async function drainQueue(): Promise<void> {
  if (!persistenceRequested) {
    persistenceRequested = true;
    await requestPersistentStorage();
  }

  while (pending.size > 0 && !isOffline()) {
    const [url] = pending;
    pending.delete(url);
    try {
      await cacheMediaUrls([url]);
    } catch {
    }
  }
}

function startDrain(): void {
  if (draining) return;
  draining = drainQueue()
    .catch(() => undefined)
    .finally(() => {
      draining = null;
      if (pending.size > 0 && !isOffline()) startDrain();
    });
}

/** 미디어 URL을 백그라운드 캐시 큐에 추가 */
export function scheduleMediaCaching(urls: readonly string[]): void {
  if (urls.length === 0 || isOffline() || !isCacheStorageAvailable()) return;
  for (const url of urls) pending.add(url);
  startDrain();
}

/** 테스트 전용: 캐시 큐 대기 */
export async function __waitForMediaCachingForTests(): Promise<void> {
  while (draining) await draining;
}

/** 테스트 전용: 미디어 캐시 상태 초기화 */
export function __resetMediaCachingForTests(): void {
  pending.clear();
  draining = null;
  persistenceRequested = false;
}
