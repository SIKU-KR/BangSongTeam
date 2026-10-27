import {
  applyServerBackgroundCatalog,
  getBackgroundCatalogStatus,
  markBackgroundCatalogStatus,
} from "../../features/backgrounds/backgroundCatalog";
import { fetchBackgroundList } from "../api/backgroundApi";
import { OfflineError } from "../api/request";
import { MAX_BACKOFF_MS, type SyncRetryMode } from "./backoff";

let inFlight: Promise<void> | null = null;
let lastAttemptAt = 0;

/**
 * 서버 배경 목록을 받아 로컬 카탈로그를 맞춘다.
 *
 * 부팅 동기화·배경 갤러리·배경 선택 창이 부른다. 송출 화면은 부르지 않는다.
 * 실패해도 로컬 사본으로 계속 쓰므로 예외를 던지지 않는다. 동시에 여러 곳에서
 * 불러도 요청은 한 번만 나간다.
 */
export function refreshBackgroundCatalog(): Promise<void> {
  if (inFlight) return inFlight;
  lastAttemptAt = Date.now();
  inFlight = (async () => {
    try {
      const { backgrounds } = await fetchBackgroundList();
      await applyServerBackgroundCatalog(backgrounds);
    } catch (err) {
      markBackgroundCatalogStatus(
        err instanceof OfflineError ? "offline" : "error",
      );
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
 * 다시 받을 주체가 없어, 비었거나 낡은 카탈로그로는 곡의 배경 id를 찾지 못한다. 그러면 송출
 * 준비가 그 배경을 빼고 '준비됨'이 되고 오프라인용으로 받아 두지도 않는다.
 *
 * 닿지 못해 받지 못한 목록(`offline`)은 어느 신호에든 다시 받는다. 회복 신호는 서버에 다시
 * 닿은 뒤에만 온다. 서버가 거절한 목록(`error`)은 포커스·탭 복귀(`wake`)에는 마지막으로 받으려
 * 한 지 `MAX_BACKOFF_MS`가 지난 뒤에만 다시 받는다. 포커스마다 받으면 장애 중인 서버를 더
 * 누르고, 받지 않으면 부팅 때 한 번 일시 장애(503)를 만난 기기가 새로고침할 때까지 낡은 목록을
 * 쓴다. `online`과 '다시 시도'는 곧바로 다시 받는다.
 */
export function retryBackgroundCatalogIfNeeded(mode: SyncRetryMode): void {
  const status = getBackgroundCatalogStatus();
  const due =
    status === "offline" ||
    (status === "error" &&
      (mode !== "wake" || Date.now() - lastAttemptAt >= MAX_BACKOFF_MS));
  if (due) void refreshBackgroundCatalog();
}

export async function __waitForBackgroundCatalogForTests(): Promise<void> {
  await inFlight;
}
