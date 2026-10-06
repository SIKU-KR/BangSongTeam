import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  callApi,
  describeApiError,
  isRetryableApiError,
  OfflineError,
  parseRetryAfter,
  requestIdOfError,
  ServerRejectedError,
  SessionExpiredError,
  TimeoutError,
} from "./request";
import { ERROR_COPY } from "#copy/common";
import {
  __resetConnectivityForTests,
  isServerReachable,
  markServerReachable,
  markServerUnreachable,
} from "./connectivity";
import { rememberRequestMeta } from "./traceContext";

describe("request", () => {
  describe("callApi", () => {
    it("성공적인 응답의 JSON을 정상 반환한다", async () => {
      const response = {
        status: 200,
        ok: true,
        json: async () => ({ hello: "world" }),
      };

      const result = await callApi<{ hello: string }>(async () => response);
      expect(result).toEqual({ hello: "world" });
    });

    it("401 응답은 SessionExpiredError를 던진다", async () => {
      const response = {
        status: 401,
        ok: false,
        json: async () => ({ error: "Unauthorized" }),
      };

      await expect(callApi(async () => response)).rejects.toBeInstanceOf(
        SessionExpiredError,
      );
    });

    it("4xx·5xx 오류 응답은 서버 에러 메시지와 함께 ServerRejectedError를 던진다", async () => {
      const response = {
        status: 400,
        ok: false,
        json: async () => ({ error: "잘못된 요청입니다" }),
      };

      const err = await callApi(async () => response).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServerRejectedError);
      if (err instanceof ServerRejectedError) {
        expect(err.status).toBe(400);
        expect(err.message).toBe("잘못된 요청입니다");
      }
    });

    it("네트워크 연결 실패(TypeError)는 OfflineError를 던진다", async () => {
      const request = async () => {
        throw new TypeError("Failed to fetch");
      };

      const err = await callApi(request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OfflineError);
      expect(err).not.toBeInstanceOf(TimeoutError);
      if (err instanceof OfflineError) {
        expect(err.message).toBe(ERROR_COPY.serverUnreachable);
      }
    });

    it("요청 중 타임아웃(TimeoutError)은 TimeoutError(OfflineError 상속)를 던진다", async () => {
      const request = async () => {
        throw new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
      };

      const err = await callApi(request).catch((e) => e);
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err).toBeInstanceOf(OfflineError);
    });

    it("호출자가 직접 중단한 AbortError는 OfflineError나 TimeoutError로 바꾸지 않고 그대로 던진다", async () => {
      const abortError = new DOMException(
        "This operation was aborted",
        "AbortError",
      );
      const request = async () => {
        throw abortError;
      };

      const err = await callApi(request).catch((e: unknown) => e);
      expect(err).toBe(abortError);
      expect(err).not.toBeInstanceOf(OfflineError);
    });

    it("성공 응답 후 본문 읽기 중 호출자가 중단하면 AbortError를 그대로 던진다", async () => {
      const abortError = new DOMException(
        "This operation was aborted",
        "AbortError",
      );
      const response = {
        status: 200,
        ok: true,
        json: async () => {
          throw abortError;
        },
      };

      const err = await callApi(async () => response).catch((e: unknown) => e);
      expect(err).toBe(abortError);
      expect(err).not.toBeInstanceOf(OfflineError);
    });

    it("성공 응답 후 본문 읽기(response.json()) 중 타임아웃이 발생해도 TimeoutError를 던진다", async () => {
      const response = {
        status: 200,
        ok: true,
        json: async () => {
          throw new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          );
        },
      };

      const err = await callApi(async () => response).catch((e) => e);
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err).toBeInstanceOf(OfflineError);
    });

    it("성공 응답 후 본문 읽기 중 연결이 끊기면 OfflineError를 던진다", async () => {
      const response = {
        status: 200,
        ok: true,
        json: async () => {
          throw new TypeError("network error");
        },
      };

      const err = await callApi(async () => response).catch((e) => e);
      expect(err).toBeInstanceOf(OfflineError);
    });

    it("에러 응답(500) 본문 읽기 중 타임아웃이 발생하면 TimeoutError를 던진다", async () => {
      const response = {
        status: 500,
        ok: false,
        json: async () => {
          throw new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          );
        },
      };

      const err = await callApi(async () => response).catch((e) => e);
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err).toBeInstanceOf(OfflineError);
    });
  });

  describe("callApi 연결 상태", () => {
    beforeEach(() => {
      __resetConnectivityForTests();
    });

    it.each([200, 401, 500])(
      "%i 응답을 받으면 서버에 닿은 것으로 남긴다",
      async (status) => {
        markServerUnreachable();
        const response = {
          status,
          ok: status < 400,
          json: async () => ({}),
        };

        await callApi(async () => response).catch(() => undefined);

        expect(isServerReachable()).toBe(true);
      },
    );

    it("네트워크 실패는 서버에 닿지 못한 것으로 남긴다", async () => {
      markServerReachable();

      await callApi(async () => {
        throw new TypeError("Failed to fetch");
      }).catch(() => undefined);

      expect(isServerReachable()).toBe(false);
    });

    it("타임아웃은 서버에 닿지 못한 것으로 남긴다", async () => {
      markServerReachable();

      await callApi(async () => {
        throw new DOMException("timeout", "TimeoutError");
      }).catch(() => undefined);

      expect(isServerReachable()).toBe(false);
    });

    it.each([
      [200, new TypeError("network error")],
      [200, new DOMException("timeout", "TimeoutError")],
      [500, new DOMException("timeout", "TimeoutError")],
    ])(
      "%i 응답의 본문을 받다 끊기면 서버에 닿지 못한 것으로 남긴다",
      async (status, error) => {
        markServerUnreachable();
        const response = {
          status,
          ok: status < 400,
          json: async (): Promise<never> => {
            throw error;
          },
        };

        await expect(callApi(async () => response)).rejects.toBeInstanceOf(
          OfflineError,
        );

        expect(isServerReachable()).toBe(false);
      },
    );

    it("호출자 취소는 연결 상태를 바꾸지 않는다", async () => {
      const abort = async (): Promise<never> => {
        throw new DOMException("aborted", "AbortError");
      };

      markServerReachable();
      await callApi(abort).catch(() => undefined);
      expect(isServerReachable()).toBe(true);

      markServerUnreachable();
      await callApi(abort).catch(() => undefined);
      expect(isServerReachable()).toBe(false);
    });
  });

  describe("describeApiError", () => {
    it("OfflineError와 TimeoutError 모두 오프라인 안내 문구를 반환한다", () => {
      expect(describeApiError(new OfflineError())).toBe(ERROR_COPY.offline);
      expect(describeApiError(new TimeoutError())).toBe(ERROR_COPY.offline);
    });

    it("SessionExpiredError는 세션 만료 문구를 반환한다", () => {
      expect(describeApiError(new SessionExpiredError())).toBe(
        ERROR_COPY.sessionExpired,
      );
    });

    it("ServerRejectedError는 에러 메시지를 반환한다", () => {
      expect(
        describeApiError(new ServerRejectedError(500, "서버 내부 오류")),
      ).toBe("서버 내부 오류");
    });

    it("기타 에러는 일반 실패 문구를 반환한다", () => {
      expect(describeApiError(new Error("알 수 없는 에러"))).toBe(
        ERROR_COPY.requestFailed,
      );
    });
  });
});

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
  it("오프라인·타임아웃 오류는 재시도 가능하다", () => {
    expect(isRetryableApiError(new OfflineError())).toBe(true);
    expect(isRetryableApiError(new TimeoutError())).toBe(true);
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

describe("callApi 상관 ID", () => {
  const meta = {
    requestId: "4bf92f3577b34da6a3ce929d0e0e4736",
    route: "/api/presentations/:id",
  };

  it("서버가 거절하면 응답의 상관 ID와 경로 패턴을 오류에 싣는다", async () => {
    const response = {
      status: 500,
      ok: false,
      json: async () => ({ error: "x" }),
    };
    rememberRequestMeta(response, meta);

    const err = await callApi(async () => response).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServerRejectedError);
    expect(err).toMatchObject(meta);
    expect(requestIdOfError(err)).toBe(meta.requestId);
  });

  it("타임아웃·네트워크 실패도 던진 오류의 상관 ID를 싣는다", async () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    const network = new TypeError("Failed to fetch");
    rememberRequestMeta(timeout, meta);
    rememberRequestMeta(network, meta);

    const timedOut = await callApi(async () => {
      throw timeout;
    }).catch((e: unknown) => e);
    const unreachable = await callApi(async () => {
      throw network;
    }).catch((e: unknown) => e);

    expect(timedOut).toBeInstanceOf(TimeoutError);
    expect(timedOut).toMatchObject(meta);
    expect(unreachable).toBeInstanceOf(OfflineError);
    expect(unreachable).toMatchObject(meta);
  });

  it("본문을 받다 끊기면 응답의 상관 ID를 싣는다", async () => {
    const response = {
      status: 200,
      ok: true,
      json: async () => {
        throw new TypeError("network error");
      },
    };
    rememberRequestMeta(response, meta);

    await expect(callApi(async () => response)).rejects.toMatchObject(meta);
  });

  it("상관 ID를 모르는 응답이나 다른 오류에는 싣지 않는다", async () => {
    const err = await callApi(async () => ({
      status: 503,
      ok: false,
      json: async () => ({}),
    })).catch((e: unknown) => e);

    expect(requestIdOfError(err)).toBeUndefined();
    expect(requestIdOfError(new Error("x"))).toBeUndefined();
  });
});
