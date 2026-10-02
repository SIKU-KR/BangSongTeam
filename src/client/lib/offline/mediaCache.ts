import { MEDIA_CACHE_NAME, mediaCacheNameFor } from "#shared";
import { requestPersistentStorage } from "./storagePersistence";

interface MediaCacheResult {
  cachedUrls: string[];
}

/** 받는 중인 파일의 진행 상황. `total`은 응답에 길이가 없으면 null이다 */
interface MediaProgress {
  received: number;
  total: number | null;
}

const SW_CACHE_POLL_MS = 100;
const SW_CACHE_POLL_BASE = 50;
const SW_CACHE_POLL_BYTES_PER_EXTRA = 2 * 1024 * 1024;

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

const progress = new Map<string, MediaProgress>();
const progressListeners = new Set<() => void>();
let progressVersion = 0;

function reportProgress(url: string, next: MediaProgress): void {
  progress.set(url, next);
  progressVersion += 1;
  for (const listener of progressListeners) listener();
}

/** `useSyncExternalStore`용 구독. 스냅숏은 `getMediaProgressVersion`이다 */
export function subscribeMediaProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function getMediaProgressVersion(): number {
  return progressVersion;
}

export function getMediaProgress(url: string): MediaProgress | undefined {
  return progress.get(url);
}

function contentLength(response: Response): number | null {
  const length = Number(response.headers.get("content-length"));
  return Number.isFinite(length) && length > 0 ? length : null;
}

function countingBody(
  url: string,
  response: Response,
): ReadableStream<Uint8Array> | null {
  const total = contentLength(response);
  let received = 0;
  reportProgress(url, { received, total });
  return (
    response.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          reportProgress(url, { received, total });
          controller.enqueue(chunk);
        },
      }),
    ) ?? null
  );
}

async function drain(body: ReadableStream<Uint8Array> | null): Promise<void> {
  const reader = body?.getReader();
  if (!reader) return;
  let done = false;
  while (!done) ({ done } = await reader.read());
}

/**
 * SW가 캐시 쓰기를 마칠 때까지 기다린다. SW는 본문을 다 받은 뒤에 쓰기를 끝내므로
 * 큰 파일일수록 오래 걸린다. 파일 크기에 비례해 기다리는 시간을 늘린다.
 */
async function waitForCacheEntry(
  cache: Cache,
  url: string,
  bytes: number | null,
): Promise<boolean> {
  const limit =
    SW_CACHE_POLL_BASE +
    Math.ceil((bytes ?? 0) / SW_CACHE_POLL_BYTES_PER_EXTRA);
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (await cache.match(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, SW_CACHE_POLL_MS));
  }
  return false;
}

/** 이 세션에서 캐시에 들어 있는 것을 확인한 URL */
const knownCached = new Set<string>();

/**
 * 미디어 URL을 전체 응답(200)으로 받아 캐시에 담는다. 포스터와 영상은 캐시가 다르다
 * (`mediaCacheNameFor`). 받는 동안 바이트 수를 `getMediaProgress`로 알린다.
 *
 * 서비스 워커가 페이지를 제어하면 `fetch()`가 SW의 `CacheFirst` 미디어 라우트를
 * 지나며 SW가 캐시에 담으므로, 여기서는 본문을 다 읽고 SW의 쓰기가 끝나기를 기다리기만
 * 한다. 페이지가 `cache.put`을 한 번 더 하면 수백 MB 영상마다 디스크 쓰기가 두 번이다.
 * SW가 없을 때(개발 서버, SW를 지원하지 않는 브라우저)만 직접 `put`한다.
 */
export async function cacheMediaUrls(
  urls: readonly string[],
): Promise<MediaCacheResult> {
  const cachedUrls: string[] = [];

  if (!isCacheStorageAvailable()) {
    return { cachedUrls };
  }

  for (const url of urls) {
    const cache = await caches.open(mediaCacheNameFor(url));
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
      const body = countingBody(url, response);
      if (isServiceWorkerControlled()) {
        await drain(body);
        if (!(await waitForCacheEntry(cache, url, contentLength(response)))) {
          throw new Error("service worker did not cache");
        }
      } else {
        await cache.put(
          url,
          new Response(body, {
            status: response.status,
            headers: response.headers,
          }),
        );
      }
      knownCached.add(url);
      cachedUrls.push(url);
    } catch {
      continue;
    }
  }

  return { cachedUrls };
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

/** 이미 캐시에 담긴 URL만 골라 돌려준다. 이 세션에서 확인한 것은 다시 열어 보지 않는다 */
export async function findCachedMediaUrls(
  urls: readonly string[],
): Promise<string[]> {
  if (!isCacheStorageAvailable()) return [];
  const cached: string[] = [];
  for (const url of urls) {
    if (knownCached.has(url)) {
      cached.push(url);
      continue;
    }
    const cache = await caches.open(mediaCacheNameFor(url));
    if (await cache.match(url)) {
      knownCached.add(url);
      cached.push(url);
    }
  }
  return cached;
}

async function estimateFreeBytes(): Promise<number | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota === undefined || usage === undefined) return null;
    return quota - usage;
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  return url.startsWith("/") ? url : new URL(url).pathname;
}

/**
 * 영상 캐시에 `neededBytes`가 들어갈 자리를 만든다. 자리가 되면 true다.
 *
 * 남은 용량이 모자라면 `keepUrls`(지금 세트가 쓰는 영상) 밖의 영상을 오래 담긴
 * 순서(`cache.keys()` 순서)로 지운다. 배경 교체로 목록에서 사라진 영상도 이렇게
 * 정리된다. 브라우저가 용량을 알려 주지 않으면 지우지 않고 true로 둔다.
 */
export async function ensureMediaSpace(
  neededBytes: number,
  keepUrls: readonly string[],
): Promise<boolean> {
  let free = await estimateFreeBytes();
  if (free === null || free >= neededBytes) return true;
  if (!isCacheStorageAvailable()) return false;

  const keep = new Set(keepUrls.map(pathOf));
  const cache = await caches.open(MEDIA_CACHE_NAME);
  for (const request of await cache.keys()) {
    if (free >= neededBytes) break;
    const path = pathOf(request.url);
    if (keep.has(path)) continue;
    const cached = await cache.match(request);
    await cache.delete(request);
    knownCached.delete(path);
    free += cached ? (contentLength(cached) ?? 0) : 0;
  }
  return free >= neededBytes;
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
  progress.clear();
  progressVersion = 0;
  draining = null;
  persistenceRequested = false;
}
