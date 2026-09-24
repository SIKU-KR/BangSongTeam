import { MEDIA_CACHE_NAME } from "#shared";
import { requestPersistentStorage } from "./storagePersistence";

export interface MediaCacheResult {
  cachedUrls: string[];
  failedUrls: string[];
}

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
    } catch (error) {
      void error;
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

export function scheduleMediaCaching(urls: readonly string[]): void {
  if (urls.length === 0 || isOffline() || !isCacheStorageAvailable()) return;
  for (const url of urls) pending.add(url);
  startDrain();
}

export async function __waitForMediaCachingForTests(): Promise<void> {
  while (draining) await draining;
}

export function __resetMediaCachingForTests(): void {
  pending.clear();
  draining = null;
  persistenceRequested = false;
}
