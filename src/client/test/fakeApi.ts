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
 */
export function installFakeApi(
  routes: Record<string, FakeRoute>,
  options: { offline?: boolean } = {},
): FakeApi {
  const original = globalThis.fetch;
  // jsdom의 AbortSignal.timeout은 Vitest 4 fake timer와 다른 Window 타이머를 쓴다.
  // https://github.com/jsdom/jsdom/blob/30.1.0/lib/jsdom/living/aborting/AbortSignal-impl.js
  const timeout = vi.isFakeTimers()
    ? vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
        const controller = new AbortController();
        setTimeout(() => {
          controller.abort(
            new DOMException("The operation timed out.", "TimeoutError"),
          );
        }, milliseconds);
        return controller.signal;
      })
    : undefined;
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

      const signal = init?.signal ?? request?.signal;
      if (signal?.aborted) {
        throw (
          signal.reason ??
          new DOMException("This operation was aborted", "AbortError")
        );
      }

      const route = matchers.find(
        (m) => m.method === method && m.regex.test(url.pathname),
      );

      const result = await new Promise<{ status?: number; body: unknown }>(
        (resolve, reject) => {
          let done = false;
          const onAbort = () => {
            if (done) return;
            done = true;
            reject(
              signal?.reason ??
                new DOMException("This operation was aborted", "AbortError"),
            );
          };
          if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
          }
          Promise.resolve(
            route
              ? route.handler({ url, method, body })
              : { status: 404, body: { error: "Not Found" } },
          )
            .then((res) => {
              if (done) return;
              done = true;
              if (signal) signal.removeEventListener("abort", onAbort);
              resolve(res);
            })
            .catch((err) => {
              if (done) return;
              done = true;
              if (signal) signal.removeEventListener("abort", onAbort);
              reject(err);
            });
        },
      );
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
      timeout?.mockRestore();
    },
  };
}
