/** DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, ABORTED(트랜잭션 경합), UNAVAILABLE */
const TRANSIENT_GRPC_CODES = new Set([4, 8, 10, 14]);
const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Firestore·GCS의 일시 장애(경합, 타임아웃, 네트워크 실패, 과부하)와 코드 결함(500)을
 * 구분한다.
 *
 * Firestore 오류의 `code`는 gRPC 상태 번호, GCS 오류의 `code`는 HTTP 상태다.
 */
export function isTransientStorageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as {
    name?: string;
    message?: string;
    cause?: unknown;
    status?: number;
    code?: unknown;
  };

  if (
    err.name === "TypeError" ||
    err.name === "ReferenceError" ||
    err.name === "SyntaxError" ||
    err.name === "RangeError"
  ) {
    return false;
  }

  if (err.status === 503 || err.status === 429) {
    return true;
  }

  if (typeof err.code === "number") {
    if (TRANSIENT_GRPC_CODES.has(err.code)) return true;
    if (TRANSIENT_HTTP_STATUSES.has(err.code)) return true;
  }

  const message = (err.message ?? "").toLowerCase();
  const name = (err.name ?? "").toLowerCase();

  const transientIndicators = [
    "timeout",
    "timed out",
    "temporarily unavailable",
    "service unavailable",
    "rate limit",
    "connection error",
    "connection reset",
    "network error",
    "overloaded",
  ];

  if (
    transientIndicators.some(
      (indicator) => message.includes(indicator) || name.includes(indicator),
    )
  ) {
    return true;
  }

  if (err.cause && isTransientStorageError(err.cause)) {
    return true;
  }

  return false;
}
