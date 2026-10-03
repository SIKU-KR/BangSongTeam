import { ServerRejectedError } from "../api/request";

/** 백오프 시작 지연 시간 (2초) */
export const BASE_BACKOFF_MS = 2000;
/** 백오프 최대 상한 (60초) */
export const MAX_BACKOFF_MS = 60_000;

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
 * 서버가 `Retry-After` 헤더를 준 경우 백오프 계산 대신 그 값을 따른다.
 */
export function getRetryDelay(
  err: unknown,
  attempt: number,
  random = Math.random(),
): number {
  if (
    err instanceof ServerRejectedError &&
    typeof err.retryAfterMs === "number" &&
    err.retryAfterMs >= 0
  ) {
    return err.retryAfterMs;
  }
  return calculateBackoffWithJitter(
    attempt,
    BASE_BACKOFF_MS,
    MAX_BACKOFF_MS,
    random,
  );
}

/**
 * 큐별 재시도 시도 횟수와 백오프 지연을 추적하는 유틸리티.
 * 성공 시 `reset()`을 호출해 시도 횟수를 0으로 되돌린다.
 */
export class BackoffTracker {
  private attempt = 0;
  private randomGenerator: () => number = Math.random;

  getDelay(err: unknown): number {
    const delay = getRetryDelay(err, this.attempt, this.randomGenerator());
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }

  get currentAttempt(): number {
    return this.attempt;
  }

  __setRandomForTests(fn: () => number): void {
    this.randomGenerator = fn;
  }
}
