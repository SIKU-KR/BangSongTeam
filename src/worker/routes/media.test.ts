import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { mediaRoute } from "./media";

const app = new Hono<AppEnv>().route("/api/media", mediaRoute);

const KEY = "loops/test_loop.mp4";
const BODY = "0123456789abcdef";
const EMPTY_KEY = "loops/empty.mp4";
const IMMUTABLE = "public, max-age=31536000, immutable";

beforeAll(async () => {
  await env.MEDIA_BUCKET.put(KEY, BODY);
  await env.MEDIA_BUCKET.put(EMPTY_KEY, "");
});

const requestRange = async (range: string, key = KEY): Promise<Response> =>
  app.request(`/api/media/${key}`, { headers: { range } }, env);

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

  it.each(["bytes=16-", "bytes=100-200", "bytes=5-2", "bytes=-0"])(
    "만족할 수 없는 범위(%s)는 500이 아니라 416과 전체 크기를 돌려준다",
    async (range) => {
      const res = await requestRange(range);

      expect(res.status).toBe(416);
      expect(res.headers.get("content-range")).toBe(`bytes */${BODY.length}`);
      expect(res.headers.get("cache-control")).not.toBe(IMMUTABLE);
      expect(await res.text()).toBe("");
    },
  );

  it("크기를 넘는 끝 위치는 마지막 바이트까지로 줄여 206을 돌려준다", async () => {
    const res = await requestRange("bytes=10-100");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 10-15/${BODY.length}`);
    expect(res.headers.get("content-length")).toBe("6");
    expect(await res.text()).toBe("abcdef");
  });

  it("suffix 범위는 끝에서부터 잘라 206을 돌려준다", async () => {
    const res = await requestRange("bytes=-4");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 12-15/${BODY.length}`);
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("cdef");
  });

  it("파일보다 긴 suffix 범위는 전체를 206으로 돌려준다", async () => {
    const res = await requestRange("bytes=-100");

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-15/${BODY.length}`);
    expect(await res.text()).toBe(BODY);
  });

  it.each(["bytes=abc", "items=0-1", "bytes=0-1,4-5", "bytes=-"])(
    "구문이 깨졌거나 지원하지 않는 헤더(%s)는 무시하고 전체를 200으로 돌려준다",
    async (range) => {
      const res = await requestRange(range);

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(res.headers.get("content-range")).toBeNull();
      expect(await res.text()).toBe(BODY);
    },
  );

  it("없는 키에 Range를 보내도 404이다", async () => {
    const res = await requestRange("bytes=0-3", "loops/missing.mp4");

    expect(res.status).toBe(404);
  });

  it("빈 객체에 Range를 보내면 416과 크기 0을 돌려준다", async () => {
    const res = await requestRange("bytes=0-", EMPTY_KEY);

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */0");
  });
});
