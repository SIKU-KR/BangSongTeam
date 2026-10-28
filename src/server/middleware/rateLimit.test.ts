import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";
import { limitPerClientIp } from "./rateLimit";

function limitedApp(now: () => number): Hono<AppEnv> {
  return new Hono<AppEnv>().get(
    "/",
    limitPerClientIp({ limit: 1, windowMs: 60_000, now }),
    (c) => c.body(null, 204),
  );
}

describe("limitPerClientIp", () => {
  it("한도를 넘으면 429와 함께 창이 끝날 때까지 남은 초를 Retry-After로 알려 준다", async () => {
    let now = 0;
    const app = limitedApp(() => now);
    const request = (): Promise<Response> =>
      Promise.resolve(
        app.request("/", { headers: { "x-forwarded-for": "198.51.100.7" } }),
      );

    const first = await request();
    expect(first.status).toBe(204);
    expect(first.headers.has("retry-after")).toBe(false);

    now = 15_500;
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("45");
    expect(await limited.json()).toEqual({
      error: API_ERRORS.tooManyRequests,
    });

    now = 59_999;
    expect((await request()).headers.get("retry-after")).toBe("1");
    now = 60_000;
    expect((await request()).status).toBe(204);
  });
});
