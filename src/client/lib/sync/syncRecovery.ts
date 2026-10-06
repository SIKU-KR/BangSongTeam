import {
  isServerReachable,
  markServerUnreachable,
  subscribeServerReachability,
} from "../api/connectivity";
import { probeServerHealth } from "../api/healthApi";
import { OfflineError } from "../api/request";
import { resumeMediaCaching } from "../offline/mediaCache";
import { BackoffTracker, BASE_BACKOFF_MS } from "./backoff";
import { retryBootSyncIfNeeded } from "./bootSync";
import { flushDeckSync } from "./deckSync";
import { flushFolderSync } from "./folderSync";
import { retryPendingSyncNow } from "./syncScheduler";

interface SyncRecoveryOptions {
  /** true인 동안에는 요청을 보내지 않는다 (송출 화면) */
  isPaused: () => boolean;
}

const NEVER_PAUSED = (): boolean => false;

let isPaused: () => boolean = NEVER_PAUSED;
let started = false;
let stop: (() => void) | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let deferTimer: ReturnType<typeof setTimeout> | null = null;
let probeInFlight: Promise<void> | null = null;
let resumeInFlight: Promise<void> | null = null;
const probeBackoff = new BackoffTracker();
const resumeListeners = new Set<() => void>();

function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function clearProbeTimer(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
}

function clearDeferTimer(): void {
  if (deferTimer) clearTimeout(deferTimer);
  deferTimer = null;
}

function deferUntilUnpaused(): void {
  if (deferTimer) return;
  deferTimer = setTimeout(() => {
    deferTimer = null;
    wake();
  }, BASE_BACKOFF_MS);
}

function scheduleProbe(): void {
  if (!started || probeTimer || isServerReachable() || isBrowserOffline()) {
    return;
  }
  if (isPaused()) {
    deferUntilUnpaused();
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
    deferUntilUnpaused();
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

async function runResume(): Promise<void> {
  probeBackoff.reset();
  clearProbeTimer();
  resumeMediaCaching();
  for (const listener of resumeListeners) listener();
  await retryBootSyncIfNeeded().catch(() => false);
  void flushFolderSync().catch(() => undefined);
  retryPendingSyncNow();
  void flushDeckSync().catch(() => undefined);
}

function resume(): Promise<void> {
  if (!started) return Promise.resolve();
  if (isPaused()) {
    deferUntilUnpaused();
    return Promise.resolve();
  }
  resumeInFlight ??= runResume().finally(() => {
    resumeInFlight = null;
  });
  return resumeInFlight;
}

function wake(): void {
  if (!started) return;
  if (isPaused()) {
    deferUntilUnpaused();
    return;
  }
  if (isServerReachable()) {
    void resume();
    return;
  }
  probeBackoff.reset();
  void runProbe();
}

function handleReachabilityChange(): void {
  if (isServerReachable()) {
    queueMicrotask(() => void resume());
    return;
  }
  clearProbeTimer();
  scheduleProbe();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") wake();
}

/**
 * 연결 회복을 감지해 동기화 큐와 배경 다운로드를 곧바로 다시 돌린다. 앱 최상단에서 한 번
 * 켜고, 돌려준 함수로 끈다. 여러 번 켜도 한 벌만 동작한다 (StrictMode).
 *
 * `online` 이벤트만 기다리면 캡티브 포털·멈춘 Wi‑Fi처럼 브라우저가 연결됐다고 믿는 동안
 * 큐가 백오프 끝(최대 1분)까지 멈춰 있고, 부팅 때 받지 못한 단계는 다시 받지 않는다.
 * 그래서 실제 요청이 닿지 못하면(`connectivity`) 가벼운 상태 확인(`GET /api/health`)을
 * 백오프 간격으로 보내고, 닿으면 부팅 재시도 → 폴더·프레젠테이션·곡 큐 → 배경 다운로드를
 * 곧바로 다시 돌린다. `online`, 탭 복귀(`visibilitychange` → visible), 포커스도 같은
 * 경로를 탄다. 닿는 중이면 확인 없이 대기 중인 쓰기를 곧바로 보낸다 (TanStack Query의
 * `refetchOnReconnect`·`refetchOnWindowFocus`와 같은 원칙).
 *
 * `isPaused`가 true인 동안(송출 화면)에는 상태 확인도 큐 재시도도 보내지 않고 송출을
 * 마친 뒤로 미룬다. 송출 화면은 같은 SPA 안에서 이동해 들어가므로 매번 다시 묻는다.
 */
export function startSyncRecovery(options: SyncRecoveryOptions): () => void {
  if (started || typeof window === "undefined") return () => undefined;
  started = true;
  isPaused = options.isPaused;
  const unsubscribe = subscribeServerReachability(handleReachabilityChange);
  window.addEventListener("online", wake);
  window.addEventListener("offline", markServerUnreachable);
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  scheduleProbe();

  const cleanup = (): void => {
    if (stop !== cleanup) return;
    stop = null;
    unsubscribe();
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", markServerUnreachable);
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    clearProbeTimer();
    clearDeferTimer();
    probeBackoff.reset();
    isPaused = NEVER_PAUSED;
    started = false;
  };
  stop = cleanup;
  return cleanup;
}

/**
 * 사용자가 '다시 시도'를 눌렀을 때. 닿지 못하는 중이면 백오프를 기다리지 않고 곧바로
 * 상태를 확인하고, 닿는 중이면 대기 중인 쓰기를 곧바로 보낸다.
 */
export function retrySyncNow(): void {
  wake();
}

/**
 * 연결 회복 경로를 탈 때마다 알린다. 열려 있는 화면이 자기 일(배경 URL 다시 넣기,
 * 공유받은 프레젠테이션 새로고침)을 같은 신호에 붙일 때 쓴다. 송출 중에는 알리지 않는다.
 */
export function subscribeSyncRecovery(listener: () => void): () => void {
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
  clearDeferTimer();
  probeBackoff.reset();
  probeBackoff.__setRandomForTests(Math.random);
  probeInFlight = null;
  resumeInFlight = null;
  resumeListeners.clear();
  isPaused = NEVER_PAUSED;
  started = false;
}
