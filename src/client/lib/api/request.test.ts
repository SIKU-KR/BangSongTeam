import { describe, it, expect, vi } from "vitest";
import {
  callApi,
  isRetryableApiError,
  OfflineError,
  parseRetryAfter,
  ServerRejectedError,
  SessionExpiredError,
} from "./request";

describe("parseRetryAfter", () => {
  it("초 단위 정수를 밀리초로 바꾼다", () => {
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("60")).toBe(60_000);
  });

  it("공백이 포함된 초 단위도 처리한다", () => {
    expect(parseRetryAfter("  5  ")).toBe(5000);
  });

  it("빈 값이나 null은 null을 돌려준다", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
  });

  it("유효하지 않은 문자열은 null을 돌려준다", () => {
    expect(parseRetryAfter("invalid")).toBeNull();
  });

  it("HTTP 날짜 포맷을 밀리초 지연으로 바꾼다", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed).not.toBeNull();
    expect(parsed).toBeGreaterThanOrEqual(9000);
    expect(parsed).toBeLessThanOrEqual(11_000);
  });
});

describe("isRetryableApiError", () => {
  it("오프라인 오류는 재시도 가능하다", () => {
    expect(isRetryableApiError(new OfflineError())).toBe(true);
  });

  it("5xx 서버 오류는 재시도 가능하다", () => {
    expect(isRetryableApiError(new ServerRejectedError(500))).toBe(true);
    expect(isRetryableApiError(new ServerRejectedError(502))).toBe(true);
    expect(isRetryableApiError(new ServerRejectedError(503))).toBe(true);
    expect(isRetryableApiError(new ServerRejectedError(504))).toBe(true);
  });

  it("408 및 429는 재시도 가능하다", () => {
    expect(isRetryableApiError(new ServerRejectedError(408))).toBe(true);
    expect(isRetryableApiError(new ServerRejectedError(429))).toBe(true);
  });

  it("401(세션 만료)은 재시도하지 않는다", () => {
    expect(isRetryableApiError(new SessionExpiredError())).toBe(false);
  });

  it("그 외 4xx는 영구 실패로 재시도하지 않는다", () => {
    expect(isRetryableApiError(new ServerRejectedError(400))).toBe(false);
    expect(isRetryableApiError(new ServerRejectedError(403))).toBe(false);
    expect(isRetryableApiError(new ServerRejectedError(404))).toBe(false);
    expect(isRetryableApiError(new ServerRejectedError(409))).toBe(false);
    expect(isRetryableApiError(new ServerRejectedError(422))).toBe(false);
  });

  it("일반 Error는 재시도 대상이 아니다", () => {
    expect(isRetryableApiError(new Error("unknown"))).toBe(false);
  });
});

describe("callApi with Retry-After", () => {
  it("서버가 Retry-After를 주면 ServerRejectedError에 담는다", async () => {
    const headers = new Headers({ "Retry-After": "5" });
    const mockRequest = vi.fn(async () => ({
      status: 503,
      ok: false,
      headers,
      json: async () => ({ error: "잠시 후 다시 시도해 주세요" }),
    }));

    await expect(callApi(mockRequest)).rejects.toMatchObject({
      status: 503,
      retryAfterMs: 5000,
    });
  });
});
