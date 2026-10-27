import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchWithTimeout,
  combineSignals,
  getDeadlineForRequest,
  DEFAULT_API_TIMEOUT_MS,
  DELETE_API_TIMEOUT_MS,
  KEEPALIVE_BODY_BUDGET,
  PULL_API_TIMEOUT_MS,
  HEALTH_API_TIMEOUT_MS,
} from "./fetchWithTimeout";
import { requestMetaOf } from "./traceContext";

const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-01$/;

describe("fetchWithTimeout", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("getDeadlineForRequest", () => {
    it.each([
      ["/api/presentations", "GET", PULL_API_TIMEOUT_MS],
      ["/api/decks", "GET", PULL_API_TIMEOUT_MS],
      ["/api/folders", "GET", PULL_API_TIMEOUT_MS],
      ["/api/backgrounds", "GET", PULL_API_TIMEOUT_MS],
      ["http://localhost/api/presentations", "GET", PULL_API_TIMEOUT_MS],
      ["/api/presentations", "POST", DEFAULT_API_TIMEOUT_MS],
      ["/api/presentations/123", "GET", DEFAULT_API_TIMEOUT_MS],
      ["/api/presentations/123", "PATCH", DEFAULT_API_TIMEOUT_MS],
      ["/api/decks/123", "PUT", DEFAULT_API_TIMEOUT_MS],
      ["/api/consent", "GET", DEFAULT_API_TIMEOUT_MS],
      ["/api/reports", "POST", DEFAULT_API_TIMEOUT_MS],
      ["/api/health", "GET", HEALTH_API_TIMEOUT_MS],
      ["/api/folders/x", "DELETE", DELETE_API_TIMEOUT_MS],
      ["/api/presentations/x", "DELETE", DELETE_API_TIMEOUT_MS],
      ["http://localhost/api/folders/x", "delete", DELETE_API_TIMEOUT_MS],
      ["/api/decks/x", "DELETE", DEFAULT_API_TIMEOUT_MS],
      ["/api/folders/x", "PUT", DEFAULT_API_TIMEOUT_MS],
      ["/api/folders/x", "GET", DEFAULT_API_TIMEOUT_MS],
    ])("%s (%s) 데드라인은 %dms이다", (url, method, expected) => {
      expect(getDeadlineForRequest(url, method)).toBe(expected);
    });

    it("영구 삭제는 60초까지 기다린다", () => {
      expect(DELETE_API_TIMEOUT_MS).toBe(60_000);
    });
  });

  describe("combineSignals", () => {
    it("시그널이 1개면 그대로 반환한다", () => {
      const c = new AbortController();
      expect(combineSignals(c.signal)).toBe(c.signal);
    });

    it("이미 취소된 시그널이 포함되어 있으면 취소된 시그널을 반환한다", () => {
      const c1 = new AbortController();
      const c2 = new AbortController();
      c2.abort("reason-2");

      const combined = combineSignals(c1.signal, c2.signal);
      expect(combined.aborted).toBe(true);
      expect(combined.reason).toBe("reason-2");
    });

    it("어느 한 시그널이라도 취소되면 합쳐진 시그널이 취소된다", () => {
      const c1 = new AbortController();
      const c2 = new AbortController();

      const combined = combineSignals(c1.signal, c2.signal);
      expect(combined.aborted).toBe(false);

      c1.abort("reason-1");
      expect(combined.aborted).toBe(true);
      expect(combined.reason).toBe("reason-1");
    });
  });

  describe("fetchWithTimeout 호출", () => {
    it("매 요청마다 새로운 AbortSignal.timeout을 만든다 (재사용 금지)", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      globalThis.fetch = vi.fn(async () => new Response("{}"));

      await fetchWithTimeout("/api/presentations/123", { method: "PATCH" });
      await fetchWithTimeout("/api/decks/456", { method: "PUT" });

      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      expect(timeoutSpy).toHaveBeenNthCalledWith(1, DEFAULT_API_TIMEOUT_MS);
      expect(timeoutSpy).toHaveBeenNthCalledWith(2, DEFAULT_API_TIMEOUT_MS);
    });

    it("벌크 Pull 요청에는 PULL_API_TIMEOUT_MS를 적용한다", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      globalThis.fetch = vi.fn(async () => new Response("{}"));

      await fetchWithTimeout("/api/presentations");
      expect(timeoutSpy).toHaveBeenCalledWith(PULL_API_TIMEOUT_MS);
    });

    it("명시적으로 timeoutMs가 주어지면 해당 값을 우선한다", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      globalThis.fetch = vi.fn(async () => new Response("{}"));

      await fetchWithTimeout("/api/presentations", { timeoutMs: 5000 });
      expect(timeoutSpy).toHaveBeenCalledWith(5000);
    });

    it("호출자가 넘긴 signal이 있으면 timeout과 합성한다", async () => {
      const caller = new AbortController();
      let passedSignal: AbortSignal | undefined;

      globalThis.fetch = vi.fn(async (_input, init) => {
        passedSignal = init?.signal ?? undefined;
        return new Response("{}");
      });

      await fetchWithTimeout("/api/test", { signal: caller.signal });
      expect(passedSignal).toBeDefined();
      expect(passedSignal?.aborted).toBe(false);

      caller.abort("caller-cancel");
      expect(passedSignal?.aborted).toBe(true);
      expect(passedSignal?.reason).toBe("caller-cancel");
    });

    it("응답이 오지 않는 요청은 데드라인 만료 시 AbortSignal에 의해 중단된다", async () => {
      vi.useFakeTimers();
      let interceptedSignal: AbortSignal | undefined;

      globalThis.fetch = vi.fn(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            interceptedSignal = init?.signal ?? undefined;
            interceptedSignal?.addEventListener("abort", () => {
              reject(
                interceptedSignal?.reason ??
                  new DOMException("The operation was aborted", "TimeoutError"),
              );
            });
          }),
      );

      const promise = fetchWithTimeout("/api/presentations/123", {
        timeoutMs: 1000,
      });
      const assertion = expect(promise).rejects.toThrow();

      await vi.advanceTimersByTimeAsync(1000);

      await assertion;
      expect(interceptedSignal?.aborted).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("숨겨진 페이지의 쓰기 요청", () => {
    const URL_OF_SET = "/api/presentations/V1StGXR8_Z5jdHi6B-myT";

    function hidePage(state: DocumentVisibilityState = "hidden"): void {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
    }

    function bodyOfBytes(bytes: number): string {
      return "a".repeat(bytes);
    }

    function keepaliveOf(fetch: typeof globalThis.fetch, call: number) {
      return vi.mocked(fetch).mock.calls[call]?.[1]?.keepalive;
    }

    function holdResponses(): {
      settle: Array<{ resolve: () => void; reject: (err: unknown) => void }>;
    } {
      const held: {
        settle: Array<{ resolve: () => void; reject: (err: unknown) => void }>;
      } = { settle: [] };
      globalThis.fetch = vi.fn(
        () =>
          new Promise<Response>((resolve, reject) => {
            held.settle.push({
              resolve: () => resolve(new Response("{}")),
              reject,
            });
          }),
      );
      return held;
    }

    it.each(["PATCH", "PUT", "DELETE"])(
      "%s는 keepalive로 보내 탭을 닫아도 끝까지 간다",
      async (method) => {
        hidePage();
        globalThis.fetch = vi.fn(async () => new Response("{}"));

        await fetchWithTimeout(URL_OF_SET, {
          method,
          body: method === "DELETE" ? undefined : JSON.stringify({ a: 1 }),
        });

        expect(keepaliveOf(globalThis.fetch, 0)).toBe(true);
      },
    );

    it("GET, 보이는 페이지, 문자열이 아닌 본문은 keepalive로 보내지 않는다", async () => {
      globalThis.fetch = vi.fn(async () => new Response("{}"));

      hidePage();
      await fetchWithTimeout("/api/presentations");
      await fetchWithTimeout(URL_OF_SET, {
        method: "PUT",
        body: new FormData(),
      });
      hidePage("visible");
      await fetchWithTimeout(URL_OF_SET, { method: "PATCH", body: "{}" });

      expect(keepaliveOf(globalThis.fetch, 0)).toBeUndefined();
      expect(keepaliveOf(globalThis.fetch, 1)).toBeUndefined();
      expect(keepaliveOf(globalThis.fetch, 2)).toBeUndefined();
    });

    it("본문 크기는 UTF-8 바이트로 세어 한도를 넘으면 keepalive 없이 보낸다", async () => {
      hidePage();
      globalThis.fetch = vi.fn(async () => new Response("{}"));

      await fetchWithTimeout(URL_OF_SET, {
        method: "PATCH",
        body: "가".repeat(KEEPALIVE_BODY_BUDGET / 3),
      });
      await fetchWithTimeout(URL_OF_SET, {
        method: "PATCH",
        body: "가".repeat(KEEPALIVE_BODY_BUDGET / 3 + 1),
      });

      expect(keepaliveOf(globalThis.fetch, 0)).toBe(true);
      expect(keepaliveOf(globalThis.fetch, 1)).toBeUndefined();
    });

    it("응답을 기다리는 keepalive 본문까지 합쳐 한도를 넘는 요청은 keepalive 없이 보낸다", async () => {
      hidePage();
      const held = holdResponses();
      const half = KEEPALIVE_BODY_BUDGET / 2;

      const first = fetchWithTimeout(URL_OF_SET, {
        method: "PATCH",
        body: bodyOfBytes(half),
      });
      const second = fetchWithTimeout(URL_OF_SET, {
        method: "PATCH",
        body: bodyOfBytes(half),
      });
      const third = fetchWithTimeout(URL_OF_SET, {
        method: "PATCH",
        body: bodyOfBytes(1),
      });

      expect(keepaliveOf(globalThis.fetch, 0)).toBe(true);
      expect(keepaliveOf(globalThis.fetch, 1)).toBe(true);
      expect(keepaliveOf(globalThis.fetch, 2)).toBeUndefined();

      for (const { resolve } of held.settle) resolve();
      await Promise.all([first, second, third]);
    });

    it("응답을 받거나 실패하면 그 본문만큼 한도를 돌려준다", async () => {
      hidePage();
      const held = holdResponses();
      const most = KEEPALIVE_BODY_BUDGET - 10;

      const answered = fetchWithTimeout(URL_OF_SET, {
        method: "PATCH",
        body: bodyOfBytes(most),
      });
      held.settle[0].resolve();
      await answered;

      const failing = fetchWithTimeout(URL_OF_SET, {
        method: "PATCH",
        body: bodyOfBytes(most),
      });
      held.settle[1].reject(new TypeError("Failed to fetch"));
      await expect(failing).rejects.toThrow(TypeError);

      const last = fetchWithTimeout(URL_OF_SET, {
        method: "PATCH",
        body: bodyOfBytes(most),
      });

      expect(keepaliveOf(globalThis.fetch, 0)).toBe(true);
      expect(keepaliveOf(globalThis.fetch, 1)).toBe(true);
      expect(keepaliveOf(globalThis.fetch, 2)).toBe(true);

      held.settle[2].resolve();
      await last;
    });
  });

  describe("상관 ID", () => {
    it("호출자 헤더를 지키면서 traceparent를 붙이고 응답에 상관 ID를 남긴다", async () => {
      let sent: Headers | undefined;
      globalThis.fetch = vi.fn(async (_input, init) => {
        sent = new Headers(init?.headers);
        return new Response("{}");
      });

      const response = await fetchWithTimeout(
        "/api/presentations/V1StGXR8_Z5jdHi6B-myT",
        { method: "PATCH", headers: { "content-type": "application/json" } },
      );

      expect(sent?.get("content-type")).toBe("application/json");
      const traceId = TRACEPARENT.exec(sent?.get("traceparent") ?? "")?.[1];
      expect(traceId).toBeDefined();
      expect(requestMetaOf(response)).toEqual({
        requestId: traceId,
        route: "/api/presentations/:id",
      });
    });

    it("호출자가 넘긴 traceparent는 그대로 둔다", async () => {
      const traceparent = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
      let sent: Headers | undefined;
      globalThis.fetch = vi.fn(async (_input, init) => {
        sent = new Headers(init?.headers);
        return new Response("{}");
      });

      const response = await fetchWithTimeout("/api/health", {
        headers: { traceparent },
      });

      expect(sent?.get("traceparent")).toBe(traceparent);
      expect(requestMetaOf(response)?.requestId).toBe("a".repeat(32));
    });

    it("요청마다 다른 상관 ID를 만든다", async () => {
      globalThis.fetch = vi.fn(async () => new Response("{}"));

      const first = await fetchWithTimeout("/api/health");
      const second = await fetchWithTimeout("/api/health");

      expect(requestMetaOf(first)?.requestId).not.toBe(
        requestMetaOf(second)?.requestId,
      );
    });

    it("응답 없이 실패해도 던진 오류에 같은 상관 ID를 남긴다", async () => {
      let sent: Headers | undefined;
      const timeout = new DOMException("timed out", "TimeoutError");
      globalThis.fetch = vi.fn(async (_input, init) => {
        sent = new Headers(init?.headers);
        throw timeout;
      });

      await expect(
        fetchWithTimeout("/api/decks/V1StGXR8_Z5jdHi6B-myT"),
      ).rejects.toBe(timeout);

      expect(requestMetaOf(timeout)).toEqual({
        requestId: TRACEPARENT.exec(sent?.get("traceparent") ?? "")?.[1],
        route: "/api/decks/:id",
      });
    });
  });
});
