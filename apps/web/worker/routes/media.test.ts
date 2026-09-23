import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { mediaRoute } from "./media";

/**
 * 미디어 프록시 응답 헤더 검증.
 *
 * 배경 영상은 불변 자산이므로 캐시 헤더가 붙어야 하고(TECH_SPEC 5.4-1),
 * Service Worker가 Range 재생을 캐시에서 만들어 내려면 206 경로도
 * 같은 규칙을 따라야 한다.
 */
const app = new Hono<AppEnv>().route("/api/media", mediaRoute);

const KEY = "loops/test_loop.mp4";
const BODY = "0123456789abcdef";
const IMMUTABLE = "public, max-age=31536000, immutable";

beforeAll(async () => {
  await env.MEDIA_BUCKET.put(KEY, BODY);
});

describe("GET /api/media/*", () => {
  it("전체 응답(200)에 불변 캐시 헤더를 붙인다", async () => {
    const res = await app.request(`/api/media/${KEY}`, {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe(BODY);
  });

  it("부분 응답(206)에도 같은 캐시 헤더를 붙인다", async () => {
    const res = await app.request(
      `/api/media/${KEY}`,
      { headers: { range: "bytes=0-3" } },
      env,
    );

    expect(res.status).toBe(206);
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(res.headers.get("content-range")).toBe(`bytes 0-3/${BODY.length}`);
    expect(await res.text()).toBe("0123");
  });

  it("없는 키는 404이며 캐시되지 않는다", async () => {
    const res = await app.request("/api/media/loops/missing.mp4", {}, env);

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).not.toBe(IMMUTABLE);
  });
});
