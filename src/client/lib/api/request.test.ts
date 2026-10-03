import { describe, it, expect } from "vitest";
import {
  callApi,
  describeApiError,
  OfflineError,
  TimeoutError,
  SessionExpiredError,
  ServerRejectedError,
} from "./request";
import { ERROR_COPY } from "#copy/common";

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

    it("요청 중단(AbortError)은 TimeoutError(OfflineError 상속)를 던진다", async () => {
      const request = async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      };

      const err = await callApi(request).catch((e) => e);
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err).toBeInstanceOf(OfflineError);
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
