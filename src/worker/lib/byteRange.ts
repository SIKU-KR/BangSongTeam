export type ByteRangeRequest =
  { start: number; end?: number } | { suffix: number };

export type ResolvedByteRange = { start: number; end: number };

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/i;

function toSafeInteger(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * `Range` 헤더에서 단일 바이트 범위 하나만 읽는다.
 *
 * multipart/byteranges 응답을 만들지 않으므로 여러 범위, 다른 단위, 구문 오류는
 * 모두 `null`로 돌려 헤더를 무시하고 전체(200)를 내보내게 한다. RFC 9110 §14.2가
 * 서버에 허용하는 처리다.
 */
export function parseRangeHeader(header: string): ByteRangeRequest | null {
  const match = SINGLE_BYTE_RANGE.exec(header.trim());
  if (!match) return null;

  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return null;

  if (first === "") {
    const suffix = toSafeInteger(last);
    return suffix === null ? null : { suffix };
  }

  const start = toSafeInteger(first);
  if (start === null) return null;
  if (last === "") return { start };

  const end = toSafeInteger(last);
  return end === null ? null : { start, end };
}

/**
 * 요청 범위를 객체 크기에 맞춰 실제로 보낼 바이트 구간으로 바꾼다.
 *
 * `null`이면 만족할 수 없는 범위이므로 라우트가 전체 크기만 담은 `Content-Range`와
 * 함께 416을 돌려줘야 한다(RFC 9110 §14.4). 결과는 항상 `end >= start`라 음수
 * content-length가 나오지 않고, R2에는 이미 검증한 범위만 넘어가 InvalidRange 예외가
 * 500으로 번지지 않는다.
 */
export function resolveByteRange(
  request: ByteRangeRequest,
  size: number,
): ResolvedByteRange | null {
  if (size <= 0) return null;

  if ("suffix" in request) {
    if (request.suffix === 0) return null;
    return { start: Math.max(0, size - request.suffix), end: size - 1 };
  }

  const { start, end } = request;
  if (start >= size) return null;
  if (end !== undefined && end < start) return null;

  return { start, end: Math.min(end ?? size - 1, size - 1) };
}
