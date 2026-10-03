/**
 * D1·R2의 일시 장애(잠금, 타임아웃, 네트워크 실패, 과부하)와 코드 결함(500)을 구분한다.
 */
export function isTransientStorageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as {
    name?: string;
    message?: string;
    cause?: unknown;
    status?: number;
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

  const message = (err.message ?? "").toLowerCase();
  const name = (err.name ?? "").toLowerCase();

  if (
    message.includes("constraint failed") ||
    message.includes("syntax error") ||
    message.includes("no such table") ||
    message.includes("no such column")
  ) {
    return false;
  }

  const transientIndicators = [
    "sqlite_busy",
    "sqlite_locked",
    "database is locked",
    "database table is locked",
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
