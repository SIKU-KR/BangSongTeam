import { ServerRejectedError, SessionExpiredError } from "../api/request";

/** 백오프 시작 지연 시간 (2초) */
export const BASE_BACKOFF_MS = 2000;
/** 백오프 최대 상한 (60초) */
export const MAX_BACKOFF_MS = 60_000;
/**
 * 서버 재시도 한도. 5xx·429와 401(세션 거절)을 10회까지 백오프로 다시 보낸다. 오프라인은 세지
 * 않는다.
 *
 * 한도를 넘긴 일시 거절(408·429·502·503·504, `isTransientServerError`)은 동기화 실패로 보이되
 * 버리지 않고 `SLOW_RETRY_MS`마다 다시 보낸다. 500 같은 그 밖의 5xx와 401은 영구 실패로 남긴다.
 * 다시 보내도 같은 답일 거절을 큐에 남기면 휴지통 비우기를 막고 그 폴더 아래 항목도 올리지 못한다.
 * 401을 받은 항목은 버리지 않고 세션을 확인하며 다시 보내는데, 세션이 살아 있다는데 401이
 * 이어지면(엔드포인트·프록시 문제) 한도 없이 다시 보내고 그때마다 세션을 묻게 된다. 영구 실패로
 * 남긴 항목은 '다시 시도'가 다시 넣는다.
 */
export const MAX_RETRY_ATTEMPTS = 10;

/**
 * 서버 재시도 한도를 넘긴 일시 거절(408·429·502·503·504)을 다시 보내는 간격 (5분).
 *
 * 저장소 장애가 몇 분 이어지면 한도는 곧 찬다. 그때 영구 실패로 남기면 서버가 회복해도 포커스·연결
 * 회복은 그 항목을 다시 보내지 않아, '다시 시도'나 새 편집, 새로고침 전까지 다른 기기(송출 PC)가
 * 옛 판을 받는다. 그렇다고 백오프 상한(1분)으로 계속 보내면 장애 중인 서버를 계속 누른다.
 */
export const SLOW_RETRY_MS = 5 * 60_000;

/**
 * 연결 회복 경로가 큐를 얼마나 세게 다시 돌리는지.
 *
 * - `wake`: 포커스·탭 복귀·상태 확인 성공. 네트워크 실패로 기다리던 항목만 앞당기고
 *   백오프 횟수와 서버가 준 대기(5xx·429 `Retry-After`)는 그대로 둔다. 자주 오는
 *   신호마다 횟수를 비우면 서버 재시도 한도가 끝나지 않고, 느린 연결에서 같은 요청을
 *   쉬지 않고 다시 보낸다.
 * - `reconnect`: 브라우저 `online` 이벤트. 백오프를 비우고 대기 중인 항목을 모두 보낸다.
 * - `manual`: 사용자가 '다시 시도'를 눌렀다. `reconnect`에 더해 영구 실패로 남긴 항목과
 *   받다 포기한 부팅 단계도 다시 보낸다.
 */
export type SyncRetryMode = "wake" | "reconnect" | "manual";

/**
 * 지수 백오프와 풀 지터(Full Jitter)를 계산한다 (AWS Architecture Blog 권고).
 * 지연 상한 `min(maxMs, baseMs * 2 ** attempt)` 내에서 0부터 균등한 난수를 취한다.
 */
export function calculateBackoffWithJitter(
  attempt: number,
  baseMs = BASE_BACKOFF_MS,
  maxMs = MAX_BACKOFF_MS,
  random = Math.random(),
): number {
  const temp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random * temp);
}

/**
 * 오류 정보와 시도 횟수를 바탕으로 다음 재시도까지 대기할 밀리초를 구한다.
 *
 * 서버가 `Retry-After`를 줬으면 그 값을 바닥으로 삼고, 지수 백오프가 더 길면 그만큼 기다린다.
 * 둘 다 `[BASE_BACKOFF_MS, MAX_BACKOFF_MS]` 안으로 맞춘다. 장애 중에 늘 같은 짧은 값(이전 서버의
 * 2초)을 그대로 따르면, 실패한 클라이언트가 모두 같은 박자로 다시 보내고 재시도 한도를 20초 안에
 * 다 쓴다.
 */
export function getRetryDelay(
  err: unknown,
  attempt: number,
  random = Math.random(),
): number {
  const backoff = calculateBackoffWithJitter(
    attempt,
    BASE_BACKOFF_MS,
    MAX_BACKOFF_MS,
    random,
  );
  if (
    err instanceof ServerRejectedError &&
    typeof err.retryAfterMs === "number" &&
    err.retryAfterMs >= 0
  ) {
    return Math.min(
      MAX_BACKOFF_MS,
      Math.max(BASE_BACKOFF_MS, err.retryAfterMs, backoff),
    );
  }
  return backoff;
}

/**
 * 항목별 재시도 시도 횟수와 백오프 지연을 추적하는 유틸리티.
 * 항목 키를 지정하지 않으면 단일 항목(기본 키)으로 동작한다.
 */
export class BackoffTracker {
  private attempts = new Map<string, number>();
  private serverAttempts = new Map<string, number>();
  private randomGenerator: () => number = Math.random;

  getDelay(keyOrErr: string | unknown, maybeErr?: unknown): number {
    let key: string;
    let err: unknown;

    if (typeof keyOrErr === "string") {
      key = keyOrErr;
      err = maybeErr;
    } else {
      key = "";
      err = keyOrErr;
    }

    const attempt = this.attempts.get(key) ?? 0;
    const delay = getRetryDelay(err, attempt, this.randomGenerator());
    this.attempts.set(key, attempt + 1);
    if (
      err instanceof ServerRejectedError ||
      err instanceof SessionExpiredError
    ) {
      const serverAttempt = this.serverAttempts.get(key) ?? 0;
      this.serverAttempts.set(key, serverAttempt + 1);
    }
    return delay;
  }

  getAttempt(key = ""): number {
    return this.attempts.get(key) ?? 0;
  }

  getServerAttempt(key = ""): number {
    return this.serverAttempts.get(key) ?? 0;
  }

  /**
   * 서버가 거절하지 않은 실패를 서버 재시도 횟수에 한 번 더 센다. 부팅이 목록을 받다 시간을 넘긴
   * 것처럼, 오프라인으로 보면 한도 없이 같은 무거운 요청을 다시 보내게 되는 실패에 쓴다.
   */
  countServerAttempt(key = ""): void {
    this.serverAttempts.set(key, this.getServerAttempt(key) + 1);
  }

  get currentAttempt(): number {
    return this.getAttempt("");
  }

  reset(key?: string): void {
    if (key !== undefined) {
      this.attempts.delete(key);
      this.serverAttempts.delete(key);
    } else {
      this.attempts.clear();
      this.serverAttempts.clear();
    }
  }

  __setRandomForTests(fn: () => number): void {
    this.randomGenerator = fn;
  }
}
