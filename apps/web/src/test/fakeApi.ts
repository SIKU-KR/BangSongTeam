import { vi } from "vitest";

export type FakeRoute = (request: {
  url: URL;
  method: string;
  body: unknown;
}) =>
  | { status?: number; body: unknown }
  | Promise<{ status?: number; body: unknown }>;

export interface FakeApi {
  calls: { method: string; path: string; search: string; body: unknown }[];
  restore: () => void;
}

/**
 * Hono RPC 클라이언트가 부르는 `fetch`를 가짜 서버로 바꾼다.
 *
 * `routes`의 키는 `"GET /api/catalog/search"`처럼 메서드와 경로다 (쿼리 문자열 제외).
 * 경로의 `:id` 자리는 `*`로 쓴다 (`"POST /api/decks/*\/fork"`).
 * 등록되지 않은 경로는 404를 돌려주고, `offline: true`면 모든 요청이 네트워크 오류로 끝난다.
 */
export function installFakeApi(
  routes: Record<string, FakeRoute>,
  options: { offline?: boolean } = {},
): FakeApi {
  const original = globalThis.fetch;
  const calls: FakeApi["calls"] = [];

  const matchers = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(" ");
    const regex = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")}$`,
    );
    return { method, regex, handler };
  });

  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(
        request ? request.url : String(input),
        "http://localhost",
      );
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const rawBody =
        init?.body ?? (request ? await request.text() : undefined);
      const body =
        typeof rawBody === "string" && rawBody
          ? JSON.parse(rawBody)
          : undefined;
      calls.push({ method, path: url.pathname, search: url.search, body });

      if (options.offline) throw new TypeError("Failed to fetch");

      const route = matchers.find(
        (m) => m.method === method && m.regex.test(url.pathname),
      );
      const result = route
        ? await route.handler({ url, method, body })
        : { status: 404, body: { error: "Not Found" } };
      return new Response(JSON.stringify(result.body), {
        status: result.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    },
  ) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
