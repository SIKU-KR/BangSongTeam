import { describe, it, expect } from "vitest";
import { isTransientStorageError } from "./storageErrors";

describe("isTransientStorageError", () => {
  it("D1의 SQLITE_BUSY 및 잠금 오류를 일시 장애로 판별한다", () => {
    expect(
      isTransientStorageError(new Error("SQLITE_BUSY: database is locked")),
    ).toBe(true);
    expect(
      isTransientStorageError(new Error("database table is locked")),
    ).toBe(true);
  });

  it("D1의 제약 위반이나 문법 오류는 영구 실패로 판별한다", () => {
    expect(
      isTransientStorageError(
        new Error("D1_ERROR: UNIQUE constraint failed: presentations.id"),
      ),
    ).toBe(false);
    expect(
      isTransientStorageError(
        new Error("D1_ERROR: FOREIGN KEY constraint failed"),
      ),
    ).toBe(false);
    expect(
      isTransientStorageError(
        new Error("D1_ERROR: near \"WHERE\": syntax error"),
      ),
    ).toBe(false);
  });

  it("타임아웃 및 네트워크 오류를 일시 장애로 판별한다", () => {
    expect(
      isTransientStorageError(new Error("connection reset by peer")),
    ).toBe(true);
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
      cause: new Error("SQLITE_BUSY"),
    });
    expect(isTransientStorageError(wrapped)).toBe(true);
  });

  it("TypeError, ReferenceError 등 코드 결함은 일시 장애로 보지 않는다", () => {
    expect(
      isTransientStorageError(new TypeError("Cannot read properties of undefined")),
    ).toBe(false);
    expect(
      isTransientStorageError(new ReferenceError("foo is not defined")),
    ).toBe(false);
    expect(isTransientStorageError(new SyntaxError("Unexpected token"))).toBe(
      false,
    );
  });
});
