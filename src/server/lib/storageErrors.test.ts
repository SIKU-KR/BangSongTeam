import { describe, it, expect } from "vitest";
import { isStorageLimitError, isTransientStorageError } from "./storageErrors";

describe("isTransientStorageError", () => {
  it("Firestore의 경합·과부하·연결 오류 코드를 일시 장애로 판별한다", () => {
    for (const code of [4, 8, 10, 14]) {
      expect(
        isTransientStorageError(Object.assign(new Error("x"), { code })),
      ).toBe(true);
    }
  });

  it("Firestore의 잘못된 요청·권한·없음 오류는 영구 실패로 판별한다", () => {
    for (const code of [3, 5, 7, 9]) {
      expect(
        isTransientStorageError(Object.assign(new Error("x"), { code })),
      ).toBe(false);
    }
  });

  it("GCS의 429·5xx 상태 코드를 일시 장애로 판별하고 404는 아니다", () => {
    expect(isTransientStorageError({ code: 503 })).toBe(true);
    expect(isTransientStorageError({ code: 429 })).toBe(true);
    expect(isTransientStorageError({ code: 404 })).toBe(false);
  });

  it("타임아웃 및 네트워크 오류를 일시 장애로 판별한다", () => {
    expect(isTransientStorageError(new Error("connection reset by peer"))).toBe(
      true,
    );
    expect(isTransientStorageError(new Error("fetch timed out"))).toBe(true);
    expect(
      isTransientStorageError(new Error("upstream service unavailable")),
    ).toBe(true);
  });

  it("503 및 429 status를 일시 장애로 판별한다", () => {
    expect(isTransientStorageError({ status: 503 })).toBe(true);
    expect(isTransientStorageError({ status: 429 })).toBe(true);
  });

  it("원인(cause)에 일시 장애가 중첩된 경우도 감지한다", () => {
    const wrapped = new Error("DB operation failed", {
      cause: Object.assign(new Error("14 UNAVAILABLE"), { code: 14 }),
    });
    expect(isTransientStorageError(wrapped)).toBe(true);
  });

  it("TypeError, ReferenceError 등 코드 결함은 일시 장애로 보지 않는다", () => {
    expect(
      isTransientStorageError(
        new TypeError("Cannot read properties of undefined"),
      ),
    ).toBe(false);
    expect(
      isTransientStorageError(new ReferenceError("foo is not defined")),
    ).toBe(false);
    expect(isTransientStorageError(new SyntaxError("Unexpected token"))).toBe(
      false,
    );
  });
});

describe("isStorageLimitError", () => {
  const invalidArgument = (message: string) =>
    Object.assign(new Error(`3 INVALID_ARGUMENT: ${message}`), { code: 3 });

  it("문서·필드 크기, 색인 항목 수, 트랜잭션 크기·쓰기 수 한도 초과를 판별한다", () => {
    for (const message of [
      "The value of property 'lyricsRaw' is longer than 1048487 bytes.",
      "Document 'decks/abc' cannot be written because its size (1,234,567 bytes) exceeds the maximum allowed size of 1,048,576 bytes.",
      "too many index entries for entity",
      "Transaction too big. Decrease transaction size.",
      "cannot write more than 500 entities in a single call",
      "maximum 500 writes allowed per request",
    ]) {
      expect(isStorageLimitError(invalidArgument(message))).toBe(true);
    }
  });

  it("원인(cause)에 한도 초과가 감싸여 있어도 판별한다", () => {
    const wrapped = new Error("transaction failed", {
      cause: invalidArgument("maximum entity size is 1048576 bytes"),
    });
    expect(isStorageLimitError(wrapped)).toBe(true);
  });

  it("한도와 상관없는 잘못된 요청, 다른 코드, 일반 오류는 아니다", () => {
    expect(
      isStorageLimitError(invalidArgument("Document path must not be empty")),
    ).toBe(false);
    expect(
      isStorageLimitError(
        Object.assign(new Error("10 ABORTED: too big contention"), {
          code: 10,
        }),
      ),
    ).toBe(false);
    expect(isStorageLimitError(new Error("value longer than 10 bytes"))).toBe(
      false,
    );
    expect(isStorageLimitError(null)).toBe(false);
    expect(isStorageLimitError("3 INVALID_ARGUMENT: bytes")).toBe(false);
  });

  it("원인이 자기 자신을 가리켜도 끝난다", () => {
    const loop: Error & { cause?: unknown } = new Error("loop");
    loop.cause = loop;
    expect(isStorageLimitError(loop)).toBe(false);
  });
});
