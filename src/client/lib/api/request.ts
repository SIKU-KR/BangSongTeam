import { ERROR_COPY } from "#copy/common";

/** 서버가 세션을 거절했다 (만료·로그아웃) */
export class SessionExpiredError extends Error {
  constructor() {
    super(ERROR_COPY.sessionExpiredShort);
    this.name = "SessionExpiredError";
  }
}

/** 네트워크에 닿지 못했다 — 실패가 아니라 오프라인이다 */
export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super(ERROR_COPY.serverUnreachable);
    this.name = "OfflineError";
    this.cause = cause;
  }
}

/** 요청이 데드라인 안에 끝나지 않았다 — 실패가 아니라 오프라인(재시도 대상)이다 */
export class TimeoutError extends OfflineError {
  constructor(cause?: unknown) {
    super(cause);
    this.name = "TimeoutError";
  }
}

/**
 * 서버가 요청을 거절했다 (4xx·5xx). 상태 코드로 사유를 가를 수 있게 남긴다.
 * 메시지는 서버가 준 한국어 오류 문장이 있으면 그것을 쓴다.
 */
export class ServerRejectedError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(status: number, message?: string, retryAfterMs?: number) {
    super(message ?? ERROR_COPY.serverRejected(status));
    this.name = "ServerRejectedError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Retry-After 헤더 값을 밀리초로 환산한다 (RFC 9110 §10.2.3).
 * 초 단위 숫자나 HTTP 날짜 포맷을 지원한다.
 */
export function parseRetryAfter(
  header: string | null | undefined,
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

/**
 * 일시 장애(네트워크 실패, 타임아웃, 408·429·5xx)와 영구 실패(그 외 4xx)를 가른다.
 * 401(세션 만료)은 재시도하지 않는다.
 */
export function isRetryableApiError(err: unknown): boolean {
  if (err instanceof OfflineError) return true;
  if (err instanceof ServerRejectedError) {
    const s = err.status;
    if (s === 408 || s === 429) return true;
    if (s >= 500 && s <= 599) return true;
    return false;
  }
  return false;
}

function isTimeoutError(err: unknown): boolean {
  if (err && typeof err === "object" && "name" in err) {
    const error = err as { name?: unknown; cause?: unknown };
    if (error.name === "TimeoutError") return true;
    if (
      error.cause &&
      typeof error.cause === "object" &&
      "name" in error.cause &&
      (error.cause as { name: unknown }).name === "TimeoutError"
    ) {
      return true;
    }
  }
  return false;
}

function isCallerAbort(err: unknown): boolean {
  if (err && typeof err === "object" && "name" in err) {
    return (err as { name: unknown }).name === "AbortError";
  }
  return false;
}

interface RpcResponse {
  status: number;
  ok: boolean;
  headers?: Headers;
  json: () => Promise<unknown>;
}

/**
 * 요청 1건을 보내고 실패를 세 갈래로 나눈다. 서버 통신의 오류 구분은 모두
 * 여기서 정한다.
 *
 * '서버가 거절함'과 '서버에 닿지 못함'을 가르는 이유: 401은 로그아웃시켜야
 * 하지만 오프라인은 캐시된 세션을 유지해야 한다. 둘을 묶으면 예배 당일
 * 네트워크가 끊기는 순간 로그인 화면으로 튕긴다.
 *
 * 동기화 상태 표시(`syncStatus`)는 건드리지 않는다. 검색 한 번 실패했다고
 * '저장 안 됨' 배지가 뜨면 안 되므로, 동기화 큐(세트·폴더·곡·부팅 동기화)가
 * 던져진 오류를 보고 자기 도메인 상태를 따로 남긴다. 그래서 의존 방향은
 * sync → api 한쪽뿐이다.
 *
 * - 네트워크에 닿지 못함(타임아웃 포함) → `OfflineError` (또는 `TimeoutError`)
 * - 호출자 취소(`AbortError`) → 그대로 던짐 (오프라인으로 오인하지 않음)
 * - 401 → `SessionExpiredError`
 * - 그 외 4xx·5xx → `ServerRejectedError(status, 서버가 준 한국어 문장, retryAfterMs)`
 */
export async function callApi<T>(
  request: () => Promise<RpcResponse>,
): Promise<T> {
  let response: RpcResponse;
  try {
    response = await request();
  } catch (err) {
    if (isTimeoutError(err)) throw new TimeoutError(err);
    if (isCallerAbort(err)) throw err;
    throw new OfflineError(err);
  }

  if (response.status === 401) throw new SessionExpiredError();
  if (!response.ok) {
    let message: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === "string") message = body.error;
    } catch (error) {
      if (isTimeoutError(error)) throw new TimeoutError(error);
      if (isCallerAbort(error)) throw error;
      void error;
    }
    const retryAfter = response.headers?.get("retry-after");
    const retryAfterMs = parseRetryAfter(retryAfter) ?? undefined;
    throw new ServerRejectedError(response.status, message, retryAfterMs);
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    if (isTimeoutError(err)) throw new TimeoutError(err);
    if (isCallerAbort(err)) throw err;
    throw new OfflineError(err);
  }
}

export function describeApiError(err: unknown): string {
  if (err instanceof OfflineError) return ERROR_COPY.offline;
  if (err instanceof SessionExpiredError) return ERROR_COPY.sessionExpired;
  if (err instanceof ServerRejectedError) return err.message;
  return ERROR_COPY.requestFailed;
}
