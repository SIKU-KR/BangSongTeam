import { describe, it, expect } from "vitest";
import { isTransientStorageError } from "./storageErrors";

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
