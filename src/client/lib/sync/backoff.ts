import { ServerRejectedError } from "../api/request";

/** 백오프 시작 지연 시간 (2초) */
export const BASE_BACKOFF_MS = 2000;
/** 백오프 최대 상한 (60초) */
export const MAX_BACKOFF_MS = 60_000;
/** 서버 재시도 한도 (5xx·429 등 서버 오류 10회 초과 시 영구 실패 처리; 오프라인은 제외) */
export const MAX_RETRY_ATTEMPTS = 10;

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
 * 서버가 `Retry-After` 헤더를 준 경우 `[BASE_BACKOFF_MS, MAX_BACKOFF_MS]` 범위로 보정해 따른다.
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
    return Math.min(
      MAX_BACKOFF_MS,
      Math.max(BASE_BACKOFF_MS, err.retryAfterMs),
    );
  }
  return calculateBackoffWithJitter(
    attempt,
    BASE_BACKOFF_MS,
    MAX_BACKOFF_MS,
    random,
  );
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
    if (err instanceof ServerRejectedError) {
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
