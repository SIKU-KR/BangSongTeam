import { MEDIA_CACHE_NAME, mediaCacheNameFor } from "#shared";
import {
  isRetryableApiError,
  OfflineError,
  parseRetryAfter,
  ServerRejectedError,
} from "../api/request";
import {
  createTraceContext,
  toRoutePattern,
  type TraceContext,
} from "../api/traceContext";
import { isServiceWorkerControlled } from "../browser/capabilities";
import { isQuotaExceededError } from "../browser/quotaError";
import {
  recordClientFailure,
  reportApiFailure,
} from "../observability/clientReports";
import { BackoffTracker, type SyncRetryMode } from "../sync/backoff";
import { requestPersistentStorage } from "./storagePersistence";
import { navigatorApi } from "../browser/optionalApis";

/** 받는 중인 파일의 진행 상황. `total`은 응답에 길이가 없으면 null이다 */
interface MediaProgress {
  received: number;
  total: number | null;
}

const SW_CACHE_POLL_MS = 100;
const SW_CACHE_POLL_BASE = 50;
const SW_CACHE_POLL_BYTES_PER_EXTRA = 2 * 1024 * 1024;

/**
 * 새 바이트가 이만큼 오지 않으면 받기를 끊고 실패로 본다. 끊지 않으면 멈춘 다운로드가
 * 영영 끝나지 않아, 다시 시도해도 같은 다운로드(`inFlight`)를 기다리기만 한다.
 */
export const MEDIA_STALL_TIMEOUT_MS = 30_000;

export function isCacheStorageAvailable(): boolean {
  try {
    return typeof caches !== "undefined";
  } catch {
    return false;
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const progress = new Map<string, MediaProgress>();
const progressListeners = new Set<() => void>();
let progressVersion = 0;

function notify(): void {
  progressVersion += 1;
  for (const listener of progressListeners) listener();
}

function reportProgress(url: string, next: MediaProgress): void {
  progress.set(url, next);
  notify();
}

/**
 * `useSyncExternalStore`용 구독. 스냅숏은 `getMediaProgressVersion`이다.
 *
 * 받은 바이트뿐 아니라 담기 성공, 재시도 예약·취소 때도 알린다. 그래야 포스터로 기다리던
 * 미리보기와 편집기 헤더가 백그라운드 재시도의 결과를 곧바로 따라간다.
 */
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

interface StallWatchdog {
  signal: AbortSignal;
  poke: () => void;
  stop: () => void;
  receiving: boolean;
}

function stallWatchdog(): StallWatchdog {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => clearTimeout(timer);
  const poke = (): void => {
    stop();
    timer = setTimeout(() => controller.abort(), MEDIA_STALL_TIMEOUT_MS);
  };
  return { signal: controller.signal, poke, stop, receiving: false };
}

interface CountingBody {
  body: ReadableStream<Uint8Array> | null;
  received: () => number;
}

function countingBody(
  url: string,
  response: Response,
  watchdog: StallWatchdog,
): CountingBody {
  const total = contentLength(response);
  let received = 0;
  reportProgress(url, { received, total });
  const body =
    response.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          watchdog.signal.addEventListener(
            "abort",
            () => controller.error(watchdog.signal.reason),
            { once: true },
          );
        },
        transform(chunk, controller) {
          received += chunk.byteLength;
          watchdog.poke();
          reportProgress(url, { received, total });
          controller.enqueue(chunk);
        },
        flush() {
          watchdog.receiving = false;
          watchdog.poke();
        },
      }),
    ) ?? null;
  if (!body) watchdog.receiving = false;
  return { body, received: () => received };
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
  watchdog: StallWatchdog,
): Promise<boolean> {
  const limit =
    SW_CACHE_POLL_BASE +
    Math.ceil((bytes ?? 0) / SW_CACHE_POLL_BYTES_PER_EXTRA);
  for (let attempt = 0; attempt < limit; attempt += 1) {
    watchdog.poke();
    if (await cache.match(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, SW_CACHE_POLL_MS));
  }
  return false;
}

function aborted(watchdog: StallWatchdog): Promise<never> {
  return new Promise((_, reject) => {
    watchdog.signal.addEventListener(
      "abort",
      () => reject(watchdog.signal.reason),
      { once: true },
    );
  });
}

async function fetchMedia(
  url: string,
  watchdog: StallWatchdog,
  trace: TraceContext,
): Promise<Response> {
  const meta = { requestId: trace.requestId, route: toRoutePattern(url) };
  let response: Response;
  try {
    response = await fetch(url, {
      signal: watchdog.signal,
      headers: { traceparent: trace.traceparent },
    });
  } catch (err) {
    throw new OfflineError(err, meta);
  }
  if (response.status !== 200) {
    throw new ServerRejectedError(
      response.status,
      undefined,
      parseRetryAfter(response.headers.get("retry-after")) ?? undefined,
      meta,
    );
  }
  return response;
}

async function cacheOne(
  url: string,
  watchdog: StallWatchdog,
  trace: TraceContext,
): Promise<void> {
  const cache = await caches.open(mediaCacheNameFor(url));
  if (await cache.match(url)) return;

  watchdog.poke();
  watchdog.receiving = true;
  const response = await fetchMedia(url, watchdog, trace);
  const { body, received } = countingBody(url, response, watchdog);
  if (isServiceWorkerControlled()) {
    await drain(body);
    const bytes = contentLength(response);
    if (!(await waitForCacheEntry(cache, url, bytes, watchdog))) {
      if (bytes !== null && received() >= bytes) {
        const free = await estimateFreeBytes();
        if (free === null || free < bytes) {
          throw new DOMException("media cache quota", "QuotaExceededError");
        }
      }
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
}

/** 이 세션에서 캐시에 들어 있는 것을 확인한 URL */
const knownCached = new Set<string>();

/**
 * 미디어를 캐시에 담지 못한 까닭.
 * - `quota`: 기기 저장 공간이 모자라 담지 못했다. 다시 받아도 공간을 비우기 전에는 낫지 않는다
 * - `network`: 받다가 끊기거나 서버가 실패했다
 */
export type MediaCacheFailure = "quota" | "network";

const failures = new Map<string, MediaCacheFailure>();
const quotaHits = new Set<string>();

function recordFailure(url: string, err: unknown): void {
  const quota = isQuotaExceededError(err);
  failures.set(url, quota ? "quota" : "network");
  if (quota) quotaHits.add(url);
}

function recordCached(url: string): void {
  knownCached.add(url);
  failures.delete(url);
  quotaHits.delete(url);
  notify();
}

/**
 * 이 세션에서 `url`을 마지막으로 담으려다 실패한 까닭. 다시 받기 시작하거나(큐에 다시
 * 넣는 것 포함) 성공하면 지워진다. `network`는 붙잡던 화면이 모두 놓아도 지워진다
 * (`retainMediaUrls`).
 *
 * `cacheMediaFirst`는 담겼는지만 알리는 boolean을 그대로 두고(`useCacheFirstVideo`가
 * 그 계약에 기댄다), 까닭은 여기서 따로 읽는다. 백그라운드 큐가 받다 실패한 것도 남으므로
 * 편집기 헤더가 '저장 공간 부족'을 알릴 수 있다.
 */
export function getMediaCacheFailure(
  url: string,
): MediaCacheFailure | undefined {
  return failures.get(url);
}

function reportMediaFailure(
  url: string,
  err: unknown,
  watchdog: StallWatchdog,
  trace: TraceContext,
): void {
  if (watchdog.signal.aborted && !watchdog.receiving) return;
  const kind = watchdog.signal.aborted
    ? "stalled"
    : err instanceof TypeError
      ? "interrupted"
      : null;
  if (kind) {
    recordClientFailure({
      kind,
      route: toRoutePattern(url),
      requestId: trace.requestId,
    });
    return;
  }
  reportApiFailure(err);
}

async function cacheWithWatchdog(url: string): Promise<void> {
  const watchdog = stallWatchdog();
  const trace = createTraceContext();
  watchdog.poke();
  failures.delete(url);
  try {
    await Promise.race([cacheOne(url, watchdog, trace), aborted(watchdog)]);
    recordCached(url);
  } catch (err) {
    recordFailure(url, err);
    reportMediaFailure(url, err, watchdog, trace);
    throw err;
  } finally {
    watchdog.stop();
  }
}

/**
 * 실패한 URL을 타이머로 다시 받는 최대 횟수. 시도마다 큰 영상을 처음부터 다시 받으므로
 * 끝없이 되풀이하지 않는다. 넘으면 시도 횟수를 비우고, 다음에 큐에 다시 넣거나 연결이
 * 회복될 때(`resumeMediaCaching`) 처음부터 센다.
 */
export const MAX_MEDIA_RETRIES = 5;

const pending = new Set<string>();
const inFlight = new Map<string, Promise<boolean>>();
const backoff = new BackoffTracker();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const waitingOnServer = new Set<string>();
const retained = new Map<string, number>();
let draining: Promise<void> | null = null;
let persistenceRequested = false;

function clearRetry(url: string): boolean {
  const timer = retryTimers.get(url);
  if (timer === undefined) return false;
  clearTimeout(timer);
  retryTimers.delete(url);
  waitingOnServer.delete(url);
  return true;
}

function isPermanentFailure(err: unknown): boolean {
  return (
    isQuotaExceededError(err) ||
    (err instanceof ServerRejectedError && !isRetryableApiError(err))
  );
}

function scheduleRetry(url: string, err: unknown): void {
  clearRetry(url);
  pending.delete(url);
  if (
    !retained.has(url) ||
    isPermanentFailure(err) ||
    backoff.getAttempt(url) >= MAX_MEDIA_RETRIES
  ) {
    backoff.reset(url);
    return;
  }
  const delay = MEDIA_STALL_TIMEOUT_MS + backoff.getDelay(url, err);
  if (err instanceof ServerRejectedError) waitingOnServer.add(url);
  retryTimers.set(
    url,
    setTimeout(() => {
      retryTimers.delete(url);
      waitingOnServer.delete(url);
      if (retained.has(url) && !knownCached.has(url)) {
        pending.add(url);
        startDrain();
      }
      notify();
    }, delay),
  );
}

function cacheOnce(url: string): Promise<boolean> {
  const running = inFlight.get(url);
  if (running) return running;
  clearRetry(url);
  const task = cacheWithWatchdog(url).then(
    () => {
      inFlight.delete(url);
      backoff.reset(url);
      notify();
      return true;
    },
    (err: unknown) => {
      inFlight.delete(url);
      scheduleRetry(url, err);
      notify();
      return false;
    },
  );
  inFlight.set(url, task);
  return task;
}

async function drainQueue(): Promise<void> {
  if (!persistenceRequested) {
    persistenceRequested = true;
    void requestPersistentStorage();
  }
  await Promise.resolve();

  for (const url of pending) {
    if (isOffline()) break;
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
 * 세트의 나머지보다 먼저 받을 때 쓴다. 이미 받고 있는 항목은 끊지 않는다. 같은 틱에
 * 여러 번 부르면 모두 모은 순서대로 받는다.
 *
 * 받고 있는 URL과 재시도를 기다리는 URL은 넣지 않는다. 송출 중 곡이 바뀔 때마다 불려도
 * 백오프 간격이 줄지 않아야, SW가 아직 받고 있을 수 있는 파일을 겹쳐 받지 않는다. 받다가
 * 실패한 URL도 큐에서 빼고 재시도 타이머에 맡긴다.
 *
 * 이 세션에서 담긴 것을 확인한 영상은 다시 넣지 않는다. 영상 캐시는 SW 만료 정책이 없고
 * 이 모듈의 `ensureMediaSpace`만 지우며 그때 확인 기록도 지운다. 포스터는 SW 만료 정책이
 * 페이지 모르게 지울 수 있으니 다시 넣어 캐시를 열어 본다.
 *
 * 확인 기록은 탭마다 따로라서, 다른 탭의 `ensureMediaSpace`가 지운 영상은 이 탭이 모른 채
 * 다시 받지 않는다. 한 기기에서 세트 하나를 여는 쓰임에 맞춘 것이고, 새로 고치면 다시 확인한다.
 */
export function scheduleMediaCaching(
  urls: readonly string[],
  options: { priority?: boolean } = {},
): void {
  if (urls.length === 0 || !canCacheInBackground()) return;
  const fresh = urls.filter(
    (url) =>
      !inFlight.has(url) &&
      !retryTimers.has(url) &&
      !(knownCached.has(url) && mediaCacheNameFor(url) === MEDIA_CACHE_NAME),
  );
  for (const url of fresh) failures.delete(url);
  if (options.priority) {
    const rest = [...pending].filter((url) => !fresh.includes(url));
    pending.clear();
    for (const url of [...fresh, ...rest]) pending.add(url);
  } else {
    for (const url of fresh) pending.add(url);
  }
  startDrain();
}

/**
 * 에디터·송출 화면이 `urls`를 쓰는 동안 붙잡아 둔다. 돌려준 함수로 놓는다(여러 번 불러도
 * 한 번만 놓는다).
 *
 * 붙잡힌 URL만 실패한 뒤 백오프로 다시 받는다. 화면을 떠났거나 배경을 바꿔 아무도 쓰지
 * 않는 영상까지 다시 받으면 대역폭과 저장 공간만 쓴다. 마지막으로 놓이면 기다리던 재시도를
 * 취소하고 시도 횟수와 네트워크 실패 기록을 비운다. 세트를 다시 열 때 지난 실패가 '저장
 * 실패'로 먼저 보이지 않게 하려는 것이다. 저장 공간 부족 기록은 남긴다. 이미 큐에 들어간
 * 항목은 그대로 받는다.
 */
export function retainMediaUrls(urls: readonly string[]): () => void {
  const held = [...new Set(urls)];
  for (const url of held) retained.set(url, (retained.get(url) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    let changed = false;
    for (const url of held) {
      const count = (retained.get(url) ?? 0) - 1;
      if (count > 0) {
        retained.set(url, count);
        continue;
      }
      retained.delete(url);
      backoff.reset(url);
      if (failures.get(url) === "network") failures.delete(url);
      if (clearRetry(url)) changed = true;
    }
    if (changed) notify();
  };
}

/**
 * 재시도를 기다리던 URL을 백오프를 기다리지 않고 곧바로 다시 받는다. 붙잡힌 URL 가운데
 * 받다 실패한 채 재시도 횟수를 다 쓴 것도 함께 넣는다.
 *
 * 연결이 회복됐다는 신호(`syncRecovery`, 송출 화면은 `online` 이벤트)가 배경 큐를 다시
 * 돌리는 입구다. 저장 공간 부족으로 실패한 URL은 공간을 비우기 전에는 낫지 않으므로
 * 넣지 않는다.
 *
 * `wake`(포커스·탭 복귀·상태 확인 성공)는 자주 오므로 네트워크 실패로 기다리던 URL만
 * 앞당긴다. 서버가 거절해(5xx·429) 기다리던 URL과 재시도를 포기한 URL은 그대로 둔다.
 * 시도마다 큰 영상을 처음부터 다시 받으므로, 포커스마다 넣으면 백오프와
 * `MAX_MEDIA_RETRIES`가 소용없어진다.
 *
 * 다만 서버에 닿지 못하다가 다시 닿은 것을 확인했으면(`afterOutage`) `wake`라도 재시도를
 * 포기한 URL을 다시 넣는다. `online` 이벤트 없이 끊긴 동안(캡티브 포털, 멈춘 Wi‑Fi)에도
 * 큐는 계속 받다 한도를 다 쓰므로, 그렇지 않으면 회복한 뒤에도 영영 다시 받지 않는다.
 */
export function resumeMediaCaching(
  mode: SyncRetryMode = "reconnect",
  options: { afterOutage?: boolean } = {},
): void {
  if (!canCacheInBackground()) return;
  const waiting = [...retryTimers.keys()].filter(
    (url) => mode !== "wake" || !waitingOnServer.has(url),
  );
  for (const url of waiting) clearRetry(url);
  const failed =
    mode === "wake" && !options.afterOutage
      ? []
      : [...retained.keys()].filter(
          (url) => getMediaCacheFailure(url) === "network",
        );
  for (const url of [...waiting, ...failed]) {
    if (!knownCached.has(url) && !inFlight.has(url)) pending.add(url);
  }
  startDrain();
  notify();
}

/**
 * - `downloading`: 지금 받고 있다
 * - `queued`: 큐에서 차례를 기다린다
 * - `retrying`: 받다 실패해 백오프 뒤 다시 받기를 기다린다
 */
export type MediaQueueState = "downloading" | "queued" | "retrying";

/** 백그라운드 큐에서 `url`의 상태. 큐에 없으면(담겼거나, 아직 넣지 않았거나, 포기했으면) null이다 */
export function getMediaQueueState(url: string): MediaQueueState | null {
  if (inFlight.has(url)) return "downloading";
  if (pending.has(url)) return "queued";
  if (retryTimers.has(url)) return "retrying";
  return null;
}

/**
 * 큐 순서를 기다리지 않고 `url`을 곧바로 캐시에 담는다. 담기면 true, 실패하면 false다.
 * 백그라운드 큐(`scheduleMediaCaching`)도 같은 방식으로 받는다.
 *
 * 큐가 다른 파일을 받는 중이어도 함께 받는다. 같은 URL을 이미 받는 중이면 그 다운로드를
 * 기다린다 — 같은 URL을 동시에 두 번 받지 않는다.
 *
 * 전체 응답(200)만 담는다. 포스터와 영상은 캐시가 다르다(`mediaCacheNameFor`). 받는 동안
 * 바이트 수를 `getMediaProgress`로 알린다.
 *
 * 서비스 워커가 페이지를 제어하면 `fetch()`가 SW의 `CacheFirst` 미디어 라우트를
 * 지나며 SW가 캐시에 담으므로, 여기서는 본문을 다 읽고 SW의 쓰기가 끝나기를 기다리기만
 * 한다. 페이지가 `cache.put`을 한 번 더 하면 수백 MB 영상마다 디스크 쓰기가 두 번이다.
 * SW가 없을 때(개발 서버, SW를 지원하지 않는 브라우저)만 직접 `put`한다.
 *
 * `MEDIA_STALL_TIMEOUT_MS` 동안 진전이 없으면(새 바이트가 오지 않거나 Cache Storage가
 * 응답하지 않으면) 끊고 실패로 넘긴다.
 * SW를 지날 때는 페이지 요청을 끊어도 SW의 요청은 계속될 수 있어, 다시 시도하면 같은
 * 파일을 한 번 더 받을 수 있다. 캐시에 없는 파일을 성공으로 치지 않는 쪽을 택했다.
 *
 * 실패하면 던지지 않고 false를 돌려주되, 저장 공간 부족(`QuotaExceededError`)인지 다른
 * 실패인지를 `getMediaCacheFailure`로 남긴다. SW가 담을 때는 SW 안에서 난 오류가 페이지에
 * 오지 않는다. 그래서 응답 길이만큼 본문이 다 왔는데도 SW가 끝내 담지 않았으면, Safari처럼
 * `navigator.storage.estimate()`로 남은 용량을 알 수 없거나 알려 준 남은 용량이 파일보다 작을
 * 때만 공간 부족으로 본다. 큰 파일의 쓰기가 기다리는 시간을 넘기거나 쓰는 도중 SW가 멈춘
 * 것까지 공간 부족으로 치면, 다시 받지 않고 '저장 공간 부족'을 잘못 알린다. 그 대신 브라우저가
 * 남은 용량을 부풀려 알려 주면 실제 부족도 `network`로 남아 큐와 `useCacheFirstVideo`의
 * 재시도 한도까지 다시 받는다.
 * 받기 실패(무진행 중단, 닿지 못함, 5xx, 본문을 받다 끊김)는 상관 ID와 함께 실패
 * 보고(`clientReports`)에도 담는다. 본문 스트림의 네트워크 오류는 `fetch()` 밖에서
 * `TypeError`로 나므로 따로 가려 담는다. 저장 공간 부족은 서버와 상관없는 기기 사정이라 담지 않는다.
 *
 * 끊긴 지점부터 `Range`로 이어 받지 않고 처음부터 다시 받는다. 페이지 요청은 SW의
 * `CacheFirst` 라우트를 피할 수 없고 그 라우트는 206을 담지 않는다(`statuses: [200]`).
 * 끊기기 전에 받은 바이트도 남아 있지 않다. SW든 페이지든 본문을 흘려 넣던 캐시 쓰기는
 * 스트림 오류와 함께 버려지므로 이어 붙일 앞부분이 없다. 이어 받으려면 수백 MB를 페이지
 * 메모리에 들고 있거나, 조각을 따로 담아 SW가 다시 합치게 바꿔야 한다. 그래서 큐가 백오프로
 * 다시 받는 쪽을 택했다.
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

/**
 * 이미 캐시에 담긴 URL만 골라 돌려준다. 이 세션에서 확인한 것은 다시 열어 보지 않는다.
 *
 * Cache Storage가 열리지 않으면(디스크 부족, 손상) 그 URL은 담기지 않은 것으로 본다.
 * 던지면 송출 준비 카드가 확인 중에 멈춰 송출을 시작할 수 없다.
 */
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
    try {
      const cache = await caches.open(mediaCacheNameFor(url));
      if (await cache.match(url)) {
        recordCached(url);
        cached.push(url);
      }
    } catch {
      continue;
    }
  }
  return cached;
}

async function estimateFreeBytes(): Promise<number | null> {
  const storage = navigatorApi("storage");
  if (!storage) return null;
  try {
    const { quota, usage } = await storage.estimate();
    if (quota === undefined || usage === undefined) return null;
    return quota - usage;
  } catch {
    return null;
  }
}

const UNKNOWN_QUOTA_MEDIA_BUDGET_BYTES = 512 * 1024 * 1024;

function pathOf(url: string): string {
  return url.startsWith("/") ? url : new URL(url).pathname;
}

/**
 * 영상 캐시에 `neededBytes`가 들어갈 자리를 만든다. 자리가 되면 true다.
 *
 * 남은 용량이 모자라면 `keepUrls`(지금 세트가 쓰는 영상) 밖의 영상을 오래 담긴
 * 순서(`cache.keys()` 순서)로 지운다. 배경 교체로 목록에서 사라진 영상도 이렇게
 * 정리된다. 지우다가 Cache Storage가 실패하면 던지지 않고 자리가 없다고 본다.
 *
 * Safari·iOS처럼 브라우저가 용량을 알려 주지 않거나, 이 세션에서 `keepUrls`의 영상이
 * 이미 저장 공간 부족을 겪어 알려 준 용량을 믿을 수 없으면 미디어에
 * `UNKNOWN_QUOTA_MEDIA_BUDGET_BYTES`만 쓸 수 있다고 보고 세트 밖 영상을 미리 지운다.
 * 용량을 알려 주지 않는 브라우저의 오리진 한도가 수백 MB라 그냥 받으면 받는 도중에 한도에
 * 걸린다. 부족을 겪었는데도 알려 준 용량이 넉넉한 것은 페이지가 직접 `cache.put`하다
 * `QuotaExceededError`를 받을 때(SW 제어 전 첫 방문, 강력 새로고침, 개발 서버)뿐이다. SW가
 * 담을 때는 용량을 알 수 없거나 모자랄 때만 부족으로 치므로(`cacheMediaFirst`), SW 경로에서
 * 의심은 사실상 용량을 알려 주지 않는 브라우저에만 걸리고, 부풀려 알려 준 용량은 `network`
 * 실패와 재시도로 넘어간다.
 * 다른 세트나 세트에서 빠진 영상이 겪은 부족은 따지지 않는다. 따지면 한 번의 부족으로
 * 세션 내내 다른 세트의 오프라인 배경까지 지운다. 의심할 때도 알려 준 용량이 예산보다 작으면 그
 * 용량을 따른다. 부풀려 알려 주는 일은 있어도 실제보다 작게 알려 주지는 않아서, 예산만 보면
 * 지워야 할 영상을 남긴 채 같은 부족을 되풀이한다. 예산은 짐작일 뿐이므로 알려 준 용량이
 * 모자라다고 하지 않는 한 지운 뒤에는 true로 두고 실제 받기에 맡긴다. 그래도 모자라면
 * `getMediaCacheFailure`가 `quota`를 알린다.
 *
 * 부족을 겪은 기록은 `getMediaCacheFailure`의 까닭과 따로 두고, 담기기 전까지 남긴다. 까닭은
 * 다시 받기 시작하면 지워지므로(헤더가 '저장 중'으로 돌아가게), 자동 캐시가 먼저 다시 큐에
 * 넣으면 근거가 사라져 같은 한도에 또 걸린다.
 */
export async function ensureMediaSpace(
  neededBytes: number,
  keepUrls: readonly string[],
): Promise<boolean> {
  const distrust = keepUrls.some((url) => quotaHits.has(url));
  const reported = await estimateFreeBytes();
  const short = reported !== null && reported < neededBytes;
  if (reported !== null && !short && !distrust) return true;
  if (!isCacheStorageAvailable()) return !short;

  const keep = new Set(keepUrls.map(pathOf));
  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const entries = await Promise.all(
      (await cache.keys()).map(async (request) => {
        const cached = await cache.match(request);
        return {
          request,
          path: pathOf(request.url),
          bytes: cached ? (contentLength(cached) ?? 0) : 0,
        };
      }),
    );
    const budget =
      distrust || reported === null
        ? UNKNOWN_QUOTA_MEDIA_BUDGET_BYTES -
          entries.reduce((sum, entry) => sum + entry.bytes, 0)
        : Infinity;
    let freed = 0;
    for (const entry of entries) {
      if (Math.min(reported ?? Infinity, budget) + freed >= neededBytes) break;
      if (keep.has(entry.path)) continue;
      await cache.delete(entry.request);
      knownCached.delete(entry.path);
      freed += entry.bytes;
    }
    return reported === null || reported + freed >= neededBytes;
  } catch {
    return !short;
  }
}

export async function __waitForMediaCachingForTests(): Promise<void> {
  while (draining || inFlight.size > 0) {
    await Promise.all([draining, ...inFlight.values()]);
  }
}

export function __setMediaRetryRandomForTests(fn: () => number): void {
  backoff.__setRandomForTests(fn);
}

export function __resetMediaCachingForTests(): void {
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  waitingOnServer.clear();
  retained.clear();
  backoff.reset();
  backoff.__setRandomForTests(Math.random);
  pending.clear();
  inFlight.clear();
  knownCached.clear();
  failures.clear();
  quotaHits.clear();
  progress.clear();
  progressVersion = 0;
  draining = null;
  persistenceRequested = false;
}
