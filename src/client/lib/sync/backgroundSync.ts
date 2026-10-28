import {
  applyServerBackgroundCatalog,
  getBackgroundCatalogStatus,
  markBackgroundCatalogStatus,
} from "../../features/backgrounds/backgroundCatalog";
import { isProjectionPath } from "../../features/presentation/fullscreen";
import { fetchBackgroundList } from "../api/backgroundApi";
import { isServerReachable } from "../api/connectivity";
import { isRetryableApiError, OfflineError } from "../api/request";
import {
  BackoffTracker,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  type SyncRetryMode,
} from "./backoff";

type CatalogFailure = "offline" | "server" | "rejected";

let inFlight: Promise<void> | null = null;
let lastFailure: CatalogFailure | null = null;
let retryAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const retryBackoff = new BackoffTracker();

function failureOf(err: unknown): CatalogFailure {
  if (err instanceof OfflineError) return "offline";
  return isRetryableApiError(err) ? "server" : "rejected";
}

function hasGivenUp(): boolean {
  return retryBackoff.getAttempt() >= MAX_RETRY_ATTEMPTS;
}

function isProjecting(): boolean {
  return (
    typeof window !== "undefined" && isProjectionPath(window.location.pathname)
  );
}

function clearRetryTimer(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function armRetry(delay: number): void {
  clearRetryTimer();
  retryTimer = setTimeout(runRetry, delay);
}

function runRetry(): void {
  retryTimer = null;
  if (isProjecting()) {
    armRetry(BASE_BACKOFF_MS);
    return;
  }
  if (isServerReachable()) void refreshBackgroundCatalog();
}

function planRetry(err: unknown): void {
  lastFailure = failureOf(err);
  const backoff = retryBackoff.getDelay(err);
  const delay =
    lastFailure === "rejected"
      ? MAX_BACKOFF_MS
      : Math.max(BASE_BACKOFF_MS, backoff);
  retryAt = Date.now() + delay;
  if (lastFailure === "server" && !hasGivenUp()) armRetry(delay);
}

/**
 * 서버 배경 목록을 받아 로컬 카탈로그를 맞춘다.
 *
 * 부팅 동기화·배경 갤러리·배경 선택 창·링크 화면이 부른다. 송출 화면은 부르지 않는다.
 * 실패해도 로컬 사본으로 계속 쓰므로 예외를 던지지 않는다. 동시에 여러 곳에서
 * 불러도 요청은 한 번만 나간다.
 *
 * 서버가 잠시 거절했으면(5xx·429·408) 사용자 신호를 기다리지 않고 백오프 뒤 스스로 다시
 * 받는다(`Retry-After`를 따른다). 부팅 때 한 번 503을 만난 송출 노트북은 창을 오가지 않으면
 * 다시 받을 계기가 없고, 비었거나 낡은 카탈로그로는 곡의 배경 id를 찾지 못해 송출 준비가
 * 그 배경을 빼고 '준비됨'이 된다. 송출 화면에 있는 동안에는 요청 없이 기다렸다가 송출을
 * 마친 뒤 받는다. 서버에 닿지 못하는 동안에는 보내지 않고 연결 회복
 * (`retryBackgroundCatalogIfNeeded`)에 맡긴다. 새로 받기 시작하면 기다리던 재시도는 버린다.
 */
export function refreshBackgroundCatalog(): Promise<void> {
  if (inFlight) return inFlight;
  clearRetryTimer();
  inFlight = (async () => {
    try {
      const { backgrounds, unreadableIds } = await fetchBackgroundList();
      await applyServerBackgroundCatalog(backgrounds, unreadableIds);
      retryBackoff.reset();
      lastFailure = null;
    } catch (err) {
      markBackgroundCatalogStatus(
        err instanceof OfflineError ? "offline" : "error",
      );
      planRetry(err);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * 받지 못한 배경 목록을 연결 회복 신호(`syncRecovery`)에 다시 받는다.
 *
 * 목록은 부팅·갤러리·배경 선택 창·링크 화면이 열릴 때 한 번씩만 받는다. 그때 받지 못하면
 * 비었거나 낡은 카탈로그로는 곡의 배경 id를 찾지 못해, 송출 준비가 그 배경을 빼고 '준비됨'이
 * 되고 오프라인용으로 받아 두지도 않는다.
 *
 * `online`과 '다시 시도'는 백오프를 비우고 곧바로 다시 받는다. 포커스·탭 복귀·상태 확인
 * 성공(`wake`)은 자주 오므로 마지막 실패 뒤 백오프가 지난 뒤에만 받는다. 닿지 못해 받지 못한
 * 목록은 백오프가 아직이면 끝날 때 받도록 맞춰 둔다. 서버가 잠시 거절한 목록은
 * `refreshBackgroundCatalog`의 타이머를 앞당기지 않는다. 다시 받아도 낫지 않을 거절이나 읽지
 * 못한 응답은 1분(`MAX_BACKOFF_MS`)이 지난 뒤에만 다시 받는다.
 *
 * 잇달아 `MAX_RETRY_ATTEMPTS`번 받지 못하면 `online`·'다시 시도'·성공 전까지 스스로 다시
 * 받지 않는다. 상태 확인(`/api/health`)은 닿는데 목록 요청만 시간을 넘기면 그 실패가 연결이
 * 끊긴 것으로 남고, 다시 닿을 때마다 목록을 받다 같은 실패를 되풀이한다. 그때마다 배경 큐도
 * 끊긴 동안 재시도를 다 쓴 영상을 처음부터 다시 받는다(`resumeMediaCaching`의 `afterOutage`).
 */
export function retryBackgroundCatalogIfNeeded(mode: SyncRetryMode): void {
  const status = getBackgroundCatalogStatus();
  if (status !== "offline" && status !== "error") return;
  if (mode !== "wake") {
    retryBackoff.reset();
    void refreshBackgroundCatalog();
    return;
  }
  if (inFlight || retryTimer || hasGivenUp()) return;
  const wait = retryAt - Date.now();
  if (wait <= 0) void refreshBackgroundCatalog();
  else if (lastFailure === "offline") armRetry(wait);
}

export async function __waitForBackgroundCatalogForTests(): Promise<void> {
  await inFlight;
}

export function __resetBackgroundSyncForTests(): void {
  clearRetryTimer();
  retryBackoff.reset();
  lastFailure = null;
  retryAt = 0;
  inFlight = null;
}
