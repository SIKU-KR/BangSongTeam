import { MEDIA_CACHE_NAME } from "#shared";
import { requestPersistentStorage } from "./storagePersistence";

export interface MediaCacheResult {
  cachedUrls: string[];
  failedUrls: string[];
}

const SW_CACHE_POLL_MS = 100;
const SW_CACHE_POLL_LIMIT = 50;

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

function isServiceWorkerControlled(): boolean {
  return (
    typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller
  );
}

async function drainBody(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  let done = false;
  while (!done) ({ done } = await reader.read());
}

async function waitForCacheEntry(cache: Cache, url: string): Promise<boolean> {
  for (let attempt = 0; attempt < SW_CACHE_POLL_LIMIT; attempt += 1) {
    if (await cache.match(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, SW_CACHE_POLL_MS));
  }
  return false;
}

/** 이 세션에서 캐시에 들어 있는 것을 확인한 URL */
const knownCached = new Set<string>();

/**
 * 미디어 URL을 전체 응답(200)으로 받아 `worship-media` 캐시에 담는다.
 *
 * 서비스 워커가 페이지를 제어하면 `fetch()`가 SW의 `CacheFirst` 미디어 라우트를
 * 지나며 SW가 캐시에 담으므로, 여기서는 본문을 다 읽고 SW의 쓰기가 끝나기를 기다리기만
 * 한다. 페이지가 `cache.put`을 한 번 더 하면 최대 30MB 파일마다 디스크 쓰기가 두 번이다.
 * SW가 없을 때(개발 서버, 설치 직후 첫 방문)만 직접 `put`한다.
 */
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
      knownCached.add(url);
      cachedUrls.push(url);
      continue;
    }

    try {
      const response = await fetch(url);
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (isServiceWorkerControlled()) {
        await drainBody(response);
        if (!(await waitForCacheEntry(cache, url))) {
          throw new Error("service worker did not cache");
        }
      } else {
        await cache.put(url, response);
      }
      knownCached.add(url);
      cachedUrls.push(url);
    } catch {
      failedUrls.push(url);
    }
  }

  return { cachedUrls, failedUrls };
}

const pending = new Set<string>();
const inFlight = new Map<string, Promise<boolean>>();
let draining: Promise<void> | null = null;
let persistenceRequested = false;

function cacheOnce(url: string): Promise<boolean> {
  const running = inFlight.get(url);
  if (running) return running;
  const task = cacheMediaUrls([url])
    .then(
      (result) => result.cachedUrls.includes(url),
      () => false,
    )
    .finally(() => inFlight.delete(url));
  inFlight.set(url, task);
  return task;
}

async function drainQueue(): Promise<void> {
  if (!persistenceRequested) {
    persistenceRequested = true;
    await requestPersistentStorage();
  }

  while (pending.size > 0 && !isOffline()) {
    const [url] = pending;
    pending.delete(url);
    await cacheOnce(url);
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

function canCacheInBackground(): boolean {
  return !isOffline() && isCacheStorageAvailable();
}

/**
 * URL을 백그라운드 캐시 큐에 넣는다. 한 번에 하나씩 받아 재생과 대역폭을 덜 다툰다.
 *
 * `priority`면 아직 받지 않은 항목보다 앞에 세운다. 송출 중 지금·다음 곡 배경을
 * 세트의 나머지보다 먼저 받을 때 쓴다. 이미 받고 있는 항목은 끊지 않는다.
 */
export function scheduleMediaCaching(
  urls: readonly string[],
  options: { priority?: boolean } = {},
): void {
  if (urls.length === 0 || !canCacheInBackground()) return;
  if (options.priority) {
    const rest = [...pending].filter((url) => !urls.includes(url));
    pending.clear();
    for (const url of [...urls, ...rest]) pending.add(url);
  } else {
    for (const url of urls) pending.add(url);
  }
  startDrain();
}

/**
 * 큐 순서를 기다리지 않고 `url`을 곧바로 캐시에 담는다. 담기면 true, 실패하면 false다.
 *
 * 큐가 다른 파일을 받는 중이어도 함께 받는다. 같은 URL을 이미 받는 중이면 그 다운로드를
 * 기다린다 — 같은 URL을 동시에 두 번 받지 않는다.
 */
export function cacheMediaFirst(url: string): Promise<boolean> {
  if (knownCached.has(url)) return Promise.resolve(true);
  if (!canCacheInBackground()) return Promise.resolve(false);
  pending.delete(url);
  return cacheOnce(url);
}

/**
 * 영상을 재생하기 전에 캐시가 끝나기를 기다려야 하는지.
 *
 * SW가 페이지를 제어할 때만 true다. 그때는 캐시본을 SW가 Range로 잘라 `<video>`에
 * 주므로, 캐시를 먼저 채우면 재생과 캐시가 같은 파일을 두 번 받지 않는다. SW가 없으면
 * 캐시본으로 재생할 수 없으니 기다려 봐야 늦게 뜰 뿐이다.
 */
export function shouldWaitForMediaCache(url: string): boolean {
  return (
    !knownCached.has(url) &&
    isServiceWorkerControlled() &&
    canCacheInBackground()
  );
}

export async function __waitForMediaCachingForTests(): Promise<void> {
  while (draining || inFlight.size > 0) {
    await Promise.all([draining, ...inFlight.values()]);
  }
}

export function __resetMediaCachingForTests(): void {
  pending.clear();
  inFlight.clear();
  knownCached.clear();
  draining = null;
  persistenceRequested = false;
}
