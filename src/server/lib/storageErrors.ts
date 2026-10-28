/** DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, ABORTED(트랜잭션 경합), UNAVAILABLE */
const TRANSIENT_GRPC_CODES = new Set([4, 8, 10, 14]);
const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);

const INVALID_ARGUMENT = 3;
const STORAGE_LIMIT_MESSAGE =
  /bytes|index entries|too big|more than \d+ entities|maximum \d+ writes/i;

/**
 * Firestore가 저장 한도(필드·문서 1 MiB, 문서당 색인 항목 4만 개, 요청·트랜잭션 크기, 한 번에
 * 쓰는 문서 수)를 넘었다며 거절한 오류인지. `cause`에 감싸인 오류도 본다.
 *
 * 같은 내용을 다시 보내도 같은 결과라 재시도할 일이 아니다. 라우트는 이 오류를 일시 장애(503)나
 * 서버 오류(500)가 아니라 413과 무엇을 줄일지 담은 문장으로 답한다. Firestore가 문구를 바꾸면
 * 지금처럼 500으로 돌아갈 뿐 더 위험해지지 않는다.
 * https://firebase.google.com/docs/firestore/quotas#limits
 */
export function isStorageLimitError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const err = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      err.code === INVALID_ARGUMENT &&
      typeof err.message === "string" &&
      STORAGE_LIMIT_MESSAGE.test(err.message)
    ) {
      return true;
    }
    current = err.cause;
  }
  return false;
}

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
