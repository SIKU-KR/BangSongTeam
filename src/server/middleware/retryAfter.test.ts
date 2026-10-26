import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { createRetryAfterPolicy, retryAfterOnUnavailable } from "./retryAfter";

function clock(start = 1_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let at = start;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}

function draws(next: () => number, count: number): number[] {
  return Array.from({ length: count }, () => next());
}

describe("createRetryAfterPolicy", () => {
  it("연달아 실패할수록 상한이 두 배씩 늘고 60초에서 멈춘다", () => {
    const { now } = clock();

    expect(draws(createRetryAfterPolicy({ now, random: () => 1 }), 7)).toEqual([
      4, 8, 16, 32, 60, 60, 60,
    ]);
    expect(draws(createRetryAfterPolicy({ now, random: () => 0 }), 7)).toEqual([
      2, 4, 8, 16, 30, 30, 30,
    ]);
  });

  it("같은 단계에서도 값을 흩뜨려 클라이언트가 같은 박자로 몰리지 않는다", () => {
    const { now } = clock();
    const values = [0, 0.25, 0.5, 0.75, 0.99].map((random) =>
      createRetryAfterPolicy({ now, random: () => random })(),
    );

    expect(new Set(values).size).toBeGreaterThan(1);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(4);
    }
  });

  it("60초 동안 일시 장애가 없으면 처음부터 다시 센다", () => {
    const { now, advance } = clock();
    const next = createRetryAfterPolicy({ now, random: () => 1 });

    expect(draws(next, 3)).toEqual([4, 8, 16]);
    advance(59_999);
    expect(next()).toBe(32);
    advance(60_000);
    expect(next()).toBe(4);
  });
});

describe("retryAfterOnUnavailable", () => {
  function appReturning(status: 200 | 404 | 500 | 503, retryAfter?: string) {
    const policy = createRetryAfterPolicy({ random: () => 1 });
    return new Hono<AppEnv>()
      .use("*", retryAfterOnUnavailable(policy))
      .get("/thing", (c) => {
        if (retryAfter) c.header("Retry-After", retryAfter);
        return c.json({ error: "x" }, status);
      })
      .get("/throws", () => {
        throw Object.assign(new Error("14 UNAVAILABLE"), { code: 14 });
      })
      .onError((_err, c) => c.json({ error: "busy" }, 503));
  }

  it("503 응답마다 늘어나는 Retry-After를 단다", async () => {
    const app = appReturning(503);

    const headers = [];
    for (let index = 0; index < 3; index += 1) {
      headers.push((await app.request("/thing")).headers.get("retry-after"));
    }

    expect(headers).toEqual(["4", "8", "16"]);
  });

  it("onError가 만든 503에도 단다", async () => {
    const res = await appReturning(200).request("/throws");

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("4");
  });

  it("503이 아닌 응답에는 달지 않고, 라우트가 정한 값은 그대로 둔다", async () => {
    for (const status of [200, 404, 500] as const) {
      expect(
        (await appReturning(status).request("/thing")).headers.get(
          "retry-after",
        ),
      ).toBeNull();
    }
    expect(
      (await appReturning(503, "7").request("/thing")).headers.get(
        "retry-after",
      ),
    ).toBe("7");
  });
});
