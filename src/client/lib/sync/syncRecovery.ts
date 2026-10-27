import {
  isServerReachable,
  markServerUnreachable,
  subscribeServerReachability,
} from "../api/connectivity";
import { probeServerHealth } from "../api/healthApi";
import { OfflineError } from "../api/request";
import { resumeMediaCaching } from "../offline/mediaCache";
import { BackoffTracker, MAX_BACKOFF_MS, type SyncRetryMode } from "./backoff";
import { retryBackgroundCatalogIfNeeded } from "./backgroundSync";
import { refreshOwnDataIfStale, retryBootSyncIfNeeded } from "./bootSync";
import { retryDeckSyncNow } from "./deckSync";
import { retryFolderSyncNow } from "./folderSync";
import { retryPendingSyncNow } from "./syncScheduler";
import { resumeOtherTabsSongDeletes } from "../../features/editor/songLibraryStore";

interface SyncRecoveryOptions {
  /** true인 동안에는 요청을 보내지 않는다 (송출 화면) */
  isPaused: () => boolean;
}

/**
 * 보이는 탭이 신호 없이도 내 데이터를 다시 받는 간격. 포커스를 잃지 않고 한 화면을 띄워 둔 예배실
 * PC는 창으로 돌아오는 신호가 오지 않는다.
 */
export const FRESHNESS_TICK_MS = 5 * 60_000;

const NEVER_PAUSED = (): boolean => false;
const STABLE_REACHABLE_MS = MAX_BACKOFF_MS;
const MODE_RANK: Record<SyncRetryMode, number> = {
  wake: 0,
  reconnect: 1,
  manual: 2,
};

let isPaused: () => boolean = NEVER_PAUSED;
let started = false;
let stop: (() => void) | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let freshnessTimer: ReturnType<typeof setTimeout> | null = null;
let freshnessDeferred = false;
let probeInFlight: Promise<void> | null = null;
let resumeInFlight: Promise<void> | null = null;
let runningMode: SyncRetryMode = "wake";
let queuedMode: SyncRetryMode | null = null;
let deferredMode: SyncRetryMode | null = null;
let modeOnReachable: SyncRetryMode | null = null;
let outageEnded = false;
let reachableSince = 0;
const probeBackoff = new BackoffTracker();
const resumeListeners = new Set<(mode: SyncRetryMode) => void>();

function stronger(
  current: SyncRetryMode | null,
  next: SyncRetryMode,
): SyncRetryMode {
  return current && MODE_RANK[current] >= MODE_RANK[next] ? current : next;
}

function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function clearProbeTimer(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
}

function clearFreshnessTimer(): void {
  if (freshnessTimer) clearTimeout(freshnessTimer);
  freshnessTimer = null;
}

function scheduleFreshnessTick(): void {
  if (!started || freshnessTimer) return;
  freshnessTimer = setTimeout(runFreshnessTick, FRESHNESS_TICK_MS);
}

function runFreshnessTick(): void {
  freshnessTimer = null;
  if (!started) return;
  if (isPaused()) {
    freshnessDeferred = true;
    return;
  }
  if (document.visibilityState === "visible" && isServerReachable()) {
    void refreshOwnDataIfStale("wake");
  }
  scheduleFreshnessTick();
}

function deferUntilUnpaused(mode: SyncRetryMode): void {
  deferredMode = stronger(deferredMode, mode);
}

function scheduleProbe(): void {
  if (!started || probeTimer || isServerReachable() || isBrowserOffline()) {
    return;
  }
  if (isPaused()) {
    deferUntilUnpaused("wake");
    return;
  }
  probeTimer = setTimeout(() => {
    probeTimer = null;
    void runProbe();
  }, probeBackoff.getDelay(new OfflineError()));
}

function runProbe(): Promise<void> {
  clearProbeTimer();
  if (!started || isServerReachable()) return Promise.resolve();
  if (isPaused()) {
    deferUntilUnpaused("wake");
    return Promise.resolve();
  }
  probeInFlight ??= (async (): Promise<void> => {
    try {
      await probeServerHealth();
    } finally {
      probeInFlight = null;
    }
    if (!isServerReachable()) scheduleProbe();
  })();
  return probeInFlight;
}

async function runResume(mode: SyncRetryMode): Promise<void> {
  clearProbeTimer();
  if (mode !== "wake") probeBackoff.reset();
  const afterOutage = outageEnded;
  outageEnded = false;
  resumeMediaCaching(mode, { afterOutage });
  retryBackgroundCatalogIfNeeded(mode);
  for (const listener of resumeListeners) listener(mode);
  const repulled = await retryBootSyncIfNeeded(mode).catch(() => false);
  if (isPaused()) {
    deferUntilUnpaused(mode);
    return;
  }
  void retryFolderSyncNow(mode).catch(() => undefined);
  retryPendingSyncNow(mode);
  resumeOtherTabsSongDeletes();
  void retryDeckSyncNow(mode).catch(() => undefined);
  if (repulled) return;
  if (mode === "manual" || document.visibilityState === "visible") {
    void refreshOwnDataIfStale(mode);
  }
}

function resume(mode: SyncRetryMode): Promise<void> {
  if (!started) return Promise.resolve();
  if (isPaused()) {
    deferUntilUnpaused(mode);
    return Promise.resolve();
  }
  if (resumeInFlight) {
    if (MODE_RANK[mode] > MODE_RANK[runningMode] || outageEnded) {
      queuedMode = stronger(queuedMode, mode);
    }
    return resumeInFlight;
  }
  resumeInFlight = (async (): Promise<void> => {
    let next: SyncRetryMode | null = mode;
    while (next) {
      queuedMode = null;
      if (isPaused()) {
        deferUntilUnpaused(next);
        return;
      }
      runningMode = next;
      await runResume(next);
      next = queuedMode;
    }
  })().finally(() => {
    resumeInFlight = null;
  });
  return resumeInFlight;
}

function wake(mode: SyncRetryMode): void {
  if (!started) return;
  if (isPaused()) {
    deferUntilUnpaused(mode);
    return;
  }
  if (isServerReachable()) {
    void resume(mode);
    return;
  }
  if (mode !== "wake") {
    modeOnReachable = stronger(modeOnReachable, mode);
    probeBackoff.reset();
  }
  void runProbe();
}

function handleReachabilityChange(): void {
  if (isServerReachable()) {
    reachableSince = Date.now();
    outageEnded = true;
    const mode = modeOnReachable ?? "wake";
    modeOnReachable = null;
    queueMicrotask(() => void resume(mode));
    return;
  }
  if (Date.now() - reachableSince >= STABLE_REACHABLE_MS) probeBackoff.reset();
  clearProbeTimer();
  scheduleProbe();
}

function handleOnline(): void {
  wake("reconnect");
}

function handleFocus(): void {
  wake("wake");
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") wake("wake");
}

/**
 * 연결 회복을 감지해 동기화 큐와 배경 다운로드를 곧바로 다시 돌린다. 앱 최상단에서 한 번
 * 켜고, 돌려준 함수로 끈다. 여러 번 켜도 한 벌만 동작한다 (StrictMode).
 *
 * `online` 이벤트만 기다리면 캡티브 포털·멈춘 Wi‑Fi처럼 브라우저가 연결됐다고 믿는 동안
 * 큐가 백오프 끝(최대 1분)까지 멈춰 있고, 부팅 때 받지 못한 단계는 다시 받지 않는다.
 * 그래서 실제 요청이 닿지 못하면(`connectivity`) 가벼운 상태 확인(`GET /api/health`)을
 * 백오프 간격으로 보내고, 닿으면 부팅 재시도 → 폴더·프레젠테이션·곡 큐 → 배경 다운로드와
 * 받지 못한 배경 목록(`retryBackgroundCatalogIfNeeded`)을 곧바로 다시 돌린다. `online`,
 * 탭 복귀(`visibilitychange` → visible), 포커스도 같은 경로를 탄다. 닿는 중이면 확인 없이
 * 대기 중인 쓰기를 곧바로 보낸다 (TanStack Query의
 * `refetchOnReconnect`·`refetchOnWindowFocus`와 같은 원칙). 곡 큐에는 같은 브라우저의 다른
 * 탭이 보내지 못하고 남긴 곡 삭제도 넣는다(`resumeOtherTabsSongDeletes`).
 *
 * 큐를 돌린 뒤에는 내 데이터를 다시 받는다(`refreshOwnDataIfStale`). 부팅 때만 받으면 며칠 열어 둔
 * 탭이 다른 기기에서 고친 판을 모른 채 띄우고 송출한다. 받지 못했던 부팅 단계를 방금 다시 받았으면
 * 받지 않는다. 가려진 탭은 '다시 시도'가 아니면 받지 않는다. 연결이 돌아오면 가려진 탭까지 모든 탭이
 * 한꺼번에 목록 전체를 받는데, 보이는 탭이 받아 쓴 저장본이 저장본 알림으로 가려진 탭에도 오고, 그
 * 탭은 다시 보일 때 받는다. 신호가 오지 않는 탭(한 화면을 띄워 둔 예배실 PC)도 보이고 서버에 닿는
 * 동안에는 `FRESHNESS_TICK_MS`마다 다시 받는다. 받는 간격은 다시 받기가 정한다.
 *
 * 포커스·탭 복귀·상태 확인 성공은 자주 오므로 큐의 백오프 횟수와 서버가 준 대기를 비우지
 * 않는다(`SyncRetryMode`의 `wake`). 다만 닿지 못하다 다시 닿았으면 배경 다운로드에는
 * 그 사실(`afterOutage`)을 함께 넘겨, 끊긴 동안 재시도를 다 쓴 영상을 다시 받게 한다. 상태 확인의 백오프도 회복 때 비우지 않고, 닿는 상태가
 * `STABLE_REACHABLE_MS` 이상 이어진 뒤 다시 끊겼을 때만 비운다. 포커스·탭 복귀는 닿지 못하는
 * 중이면 상태를 곧바로 한 번 확인하되 그 간격도 처음으로 되돌리지 않는다. `online`과 '다시
 * 시도'만 되돌린다. 상태 확인은 닿는데 무거운 요청만 시간을 넘기는 느린 연결이나 저장소 장애에서,
 * 회복하거나 창을 오갈 때마다 처음 간격으로 돌아가 같은 요청을 쉬지 않고 다시 보내지 않게 하려는
 * 것이다.
 *
 * `isPaused`가 true인 동안(송출 화면)에는 상태 확인도 큐 재시도도 다시 받기도 보내지 않고, 들어온
 * 신호만 기억했다가 송출을 마친 뒤(`resumeDeferredSyncRecovery`) 한 번 돌린다. 송출
 * 화면은 같은 SPA 안에서 이동해 들어가므로 매번 다시 묻는다. 다시 받기 타이머도 송출 중에 돌아오면
 * 다시 걸지 않고, 송출을 마치면 다시 센다. 부팅 단계를 다시 받는 동안 송출을 시작했으면 그 회복의
 * 큐 재시도·다시 받기와 그사이 들어온 신호도 송출을 마친 뒤로 미룬다. 신호를 받는 곳(로그아웃
 * 마치기 등)은 송출 중인지 보지 않고 요청을 보낸다.
 */
export function startSyncRecovery(options: SyncRecoveryOptions): () => void {
  if (started || typeof window === "undefined") return () => undefined;
  started = true;
  isPaused = options.isPaused;
  const unsubscribe = subscribeServerReachability(handleReachabilityChange);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", markServerUnreachable);
  window.addEventListener("focus", handleFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  scheduleProbe();
  scheduleFreshnessTick();

  const cleanup = (): void => {
    if (stop !== cleanup) return;
    stop = null;
    unsubscribe();
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", markServerUnreachable);
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    clearProbeTimer();
    clearFreshnessTimer();
    resetRecoveryState();
  };
  stop = cleanup;
  return cleanup;
}

function resetRecoveryState(): void {
  probeBackoff.reset();
  queuedMode = null;
  deferredMode = null;
  modeOnReachable = null;
  outageEnded = false;
  reachableSince = 0;
  freshnessDeferred = false;
  isPaused = NEVER_PAUSED;
  started = false;
}

/**
 * 사용자가 '다시 시도'를 눌렀을 때. 닿지 못하는 중이면 백오프를 기다리지 않고 곧바로
 * 상태를 확인하고, 닿으면(지금이든 확인 뒤든) 백오프를 비우고 대기 중인 쓰기와 영구 실패로
 * 남긴 항목, 받다 포기한 부팅 단계를 다시 보낸다.
 */
export function retrySyncNow(): void {
  wake("manual");
}

/**
 * 송출 화면을 떠났을 때 부른다. 송출 중에 미뤄 둔 회복 신호가 있으면 지금 한 번 돌리고, 송출 중에
 * 멈춘 다시 받기 타이머를 다시 건다. 송출 중에 타이머로 다시 묻지 않으려고, 라우트 변화를 아는
 * 쪽(`App`)이 알려 준다.
 */
export function resumeDeferredSyncRecovery(): void {
  if (!started || isPaused()) return;
  if (freshnessDeferred) {
    freshnessDeferred = false;
    scheduleFreshnessTick();
  }
  if (!deferredMode) return;
  const mode = deferredMode;
  deferredMode = null;
  wake(mode);
}

/**
 * 연결 회복 경로를 탈 때마다 알린다. 열려 있는 화면이 자기 일(배경 URL 다시 넣기,
 * 공유받은 프레젠테이션 새로고침)을 같은 신호에 붙일 때 쓴다. 송출 중에는 알리지 않는다.
 * `wake`는 포커스마다 오므로, 비싼 일은 `mode`를 보고 줄인다.
 */
export function subscribeSyncRecovery(
  listener: (mode: SyncRetryMode) => void,
): () => void {
  resumeListeners.add(listener);
  return () => {
    resumeListeners.delete(listener);
  };
}

export function __setProbeRandomForTests(fn: () => number): void {
  probeBackoff.__setRandomForTests(fn);
}

export async function __waitForSyncRecoveryForTests(): Promise<void> {
  while (probeInFlight || resumeInFlight) {
    await Promise.all([probeInFlight, resumeInFlight]);
  }
}

export function __resetSyncRecoveryForTests(): void {
  stop?.();
  clearProbeTimer();
  clearFreshnessTimer();
  resetRecoveryState();
  probeBackoff.__setRandomForTests(Math.random);
  probeInFlight = null;
  resumeInFlight = null;
  resumeListeners.clear();
}
