import { MEDIA_CACHE_NAME } from "@repo/shared";
import { requestPersistentStorage } from "./storagePersistence";

/**
 * 배경 영상·포스터를 Cache Storage에 조용히 담는 계층 (PRD 6.1, TECH_SPEC 5.4-3).
 *
 * 예배 준비 화면(송출 전 미리받기)은 2026-09-24에 제거됐다. 대신 편집기나 송출
 * 화면에 세트가 열려 있고 온라인이면 그 세트의 배경을 뒤에서 하나씩 받아 둔다.
 * 진행률도 경고도 없다. 받을 수 있으면 받고, 못 받으면 다음 기회에 다시 받는다.
 * 캐시에 들어간 파일은 Workbox의 CacheFirst가 같은 `MEDIA_CACHE_NAME`에서 읽어
 * 네트워크 없이 재생한다.
 *
 * **Service Worker가 활성화되기를 기다리지 않는다.** 첫 방문에서는 SW가 아직
 * activate되지 않아 fetch가 가로채이지 않는다. 그래서 응답을 받아 직접
 * `cache.put`으로 넣는다.
 *
 * **Range 요청을 쓰지 않는다.** RangeRequestsPlugin은 캐시에 있는 *전체* 응답을
 * 잘라 206을 만든다. Cache API는 206을 저장하지도 못한다.
 */

export interface MediaCacheResult {
  /** 캐시에 들어 있는 URL (방금 받았거나 이미 있던 것) */
  cachedUrls: string[];
  /** 받지 못한 URL */
  failedUrls: string[];
}

/** 이 브라우저에서 Cache Storage를 쓸 수 있는지 */
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

/**
 * URL 목록을 순차적으로 받아 캐시에 넣는다.
 *
 * 순차로 도는 이유: 교회 네트워크에서 20MB 영상 여러 개를 동시에 당기면
 * 화면에 나오는 영상까지 느려진다. 실패는 그 항목만 건너뛰고 멈추지 않는다.
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
    // 이미 받아 둔 것은 다시 받지 않는다.
    if (await cache.match(url)) {
      cachedUrls.push(url);
      continue;
    }

    try {
      // 동일 출처 프록시이므로 mode를 지정하지 않는다 (TECH_SPEC 5.4-1).
      const response = await fetch(url);
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }
      // 본문을 메모리에 올리지 않고 스트림째 넣는다. 편집·송출 중에 20MB를
      // 통째로 들고 있을 이유가 없다.
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
    // 결과는 쓰지 않는다. 거부돼도 캐시는 담고, 브라우저가 지우면 다음에 다시 담는다.
    await requestPersistentStorage();
  }

  // 한 번에 하나씩 꺼낸다. 받는 도중 새로 들어온 URL도 같은 줄에 선다.
  while (pending.size > 0 && !isOffline()) {
    const [url] = pending;
    pending.delete(url);
    try {
      await cacheMediaUrls([url]);
    } catch {
      // 캐시를 열지 못하는 환경 등. 조용히 넘어가고 다음 기회에 다시 시도한다.
    }
  }
}

function startDrain(): void {
  if (draining) return;
  draining = drainQueue()
    .catch(() => undefined)
    .finally(() => {
      draining = null;
      // 루프가 끝난 직후 끼어든 URL이 있으면 이어서 받는다.
      if (pending.size > 0 && !isOffline()) startDrain();
    });
}

/**
 * URL을 백그라운드 캐시 큐에 넣는다. 결과를 기다리지 않는다.
 *
 * 모듈 단위 싱글턴이라 라우트가 다시 마운트돼도 같은 파일을 겹쳐 받지 않고,
 * 편집기에서 송출로 넘어가도 받던 것을 이어 받는다. 오프라인이거나 Cache
 * Storage가 없으면 아무것도 하지 않는다. 실패한 URL은 다음 호출에서 다시 시도된다.
 */
export function scheduleMediaCaching(urls: readonly string[]): void {
  if (urls.length === 0 || isOffline() || !isCacheStorageAvailable()) return;
  for (const url of urls) pending.add(url);
  startDrain();
}

/** 테스트 전용: 큐가 빌 때까지 기다린다 */
export async function __waitForMediaCachingForTests(): Promise<void> {
  while (draining) await draining;
}

/** 테스트 전용 초기화 */
export function __resetMediaCachingForTests(): void {
  pending.clear();
  draining = null;
  persistenceRequested = false;
}
