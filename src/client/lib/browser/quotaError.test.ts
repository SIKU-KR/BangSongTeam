import { describe, it, expect } from "vitest";
import { isQuotaExceededError } from "./quotaError";

describe("isQuotaExceededError", () => {
  it("QuotaExceededError 이름의 DOMException을 알아본다", () => {
    expect(
      isQuotaExceededError(new DOMException("full", "QuotaExceededError")),
    ).toBe(true);
  });

  it("이름이 QuotaExceededError인 일반 Error도 알아본다", () => {
    const err = new Error("full");
    err.name = "QuotaExceededError";

    expect(isQuotaExceededError(err)).toBe(true);
  });

  it("Firefox의 NS_ERROR_DOM_QUOTA_REACHED를 알아본다", () => {
    expect(
      isQuotaExceededError(
        new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED"),
      ),
    ).toBe(true);
  });

  it("옛 코드 22로만 알리는 DOMException을 알아본다", () => {
    const err = new DOMException("full", "UnknownError");
    Object.defineProperty(err, "code", { value: 22 });

    expect(isQuotaExceededError(err)).toBe(true);
  });

  it("네트워크 오류나 다른 DOMException은 한도 초과가 아니다", () => {
    expect(isQuotaExceededError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isQuotaExceededError(new DOMException("x", "UnknownError"))).toBe(
      false,
    );
    expect(isQuotaExceededError("QuotaExceededError")).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
  });
});
