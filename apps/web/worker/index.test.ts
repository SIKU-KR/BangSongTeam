import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { createD1Client, seedBackgrounds } from "@repo/db";
import type { BackgroundMedia } from "@repo/shared";
import app from "./index";

describe("Task 4.6: Miniflare/workerd 환경 Worker 및 D1 통합 테스트", () => {
  beforeAll(async () => {
    // 테이블은 worker/test/setup.ts가 실제 마이그레이션으로 만든다.
    // 여기서는 데이터만 채운다.

    // 1. 초기 10개 모션 루프 영상 데이터 시드
    const db = createD1Client(env.DB);
    await seedBackgrounds(db);

    // 2. R2 버킷에 테스트 모션 비디오 객체 적재
    await env.MEDIA_BUCKET.put(
      "loops/warm_light_flow.mp4",
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      {
        httpMetadata: { contentType: "video/mp4" },
      },
    );
  });

  it("GET /api/health returns 200 OK with { status: 'ok' } in workerd runtime", async () => {
    const res = await app.request("/api/health", {}, env);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });

  it("GET /api/unknown-path returns 404 in workerd runtime", async () => {
    const res = await app.request("/api/unknown-path", {}, env);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toHaveProperty("error");
  });

  it("GET /api/backgrounds returns 200 with 10 seeded motion backgrounds from workerd D1", async () => {
    const res = await app.request("/api/backgrounds", {}, env);
    expect(res.status).toBe(200);

    const json = (await res.json()) as BackgroundMedia[];
    expect(json).toBeInstanceOf(Array);
    expect(json).toHaveLength(10);

    // Verify first background item has correct URLs and properties
    const first = json[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("title");
    expect(first).toHaveProperty("r2Key");
    expect(first).toHaveProperty("posterKey");
    expect(first).toHaveProperty("durationSec");
    expect(first).toHaveProperty("license");
    expect(first.tags).toBeInstanceOf(Array);
    expect(first.tags.length).toBeGreaterThan(0);
    expect(first.cdnUrl).toMatch(/^https:\/\/.+\/loops\/.+\.mp4$/);
    expect(first.posterUrl).toMatch(/^https:\/\/.+\/posters\/.+\.webp$/);
  });

  it("GET /api/backgrounds?limit=3 limits the number of returned backgrounds", async () => {
    const res = await app.request("/api/backgrounds?limit=3", {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as BackgroundMedia[];
    expect(json).toHaveLength(3);
  });

  it("GET /api/backgrounds?tag= filters by exact tag", async () => {
    const res = await app.request(
      `/api/backgrounds?tag=${encodeURIComponent("웅장한")}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as BackgroundMedia[];
    expect(json.length).toBeGreaterThan(0);
    expect(json.length).toBeLessThan(10);
    for (const bg of json) expect(bg.tags).toContain("웅장한");
  });

  it("GET /api/backgrounds?q= searches titles including choseong", async () => {
    const byText = await app.request(
      `/api/backgrounds?q=${encodeURIComponent("호수")}`,
      {},
      env,
    );
    const textJson = (await byText.json()) as BackgroundMedia[];
    expect(textJson.map((bg) => bg.title)).toEqual(["고요한 호수 물결"]);

    const byChoseong = await app.request(
      `/api/backgrounds?q=${encodeURIComponent("ㅎㅅ")}`,
      {},
      env,
    );
    const choseongJson = (await byChoseong.json()) as BackgroundMedia[];
    expect(choseongJson.map((bg) => bg.title)).toContain("고요한 호수 물결");
  });

  it("GET /api/backgrounds rejects invalid query with 400", async () => {
    for (const qs of ["limit=abc", "limit=0", "limit=101", "limit=1.5"]) {
      const res = await app.request(`/api/backgrounds?${qs}`, {}, env);
      expect(res.status, qs).toBe(400);
    }
  });

  it("GET /api/media/:key streams full video from R2 bucket with 200 OK", async () => {
    const res = await app.request(
      "/api/media/loops/warm_light_flow.mp4",
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("10");
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBe(10);
  });

  it("GET /api/media/:key with Range header returns 206 Partial Content", async () => {
    const res = await app.request(
      "/api/media/loops/warm_light_flow.mp4",
      {
        headers: { Range: "bytes=0-4" },
      },
      env,
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-range")).toBe("bytes 0-4/10");
    expect(res.headers.get("content-length")).toBe("5");
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBe(5);
  });

  it("GET /api/media/:key returns 404 for non-existent key", async () => {
    const res = await app.request("/api/media/loops/non_existent.mp4", {}, env);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Media not found" });
  });

  describe("Better Auth 마운트 (/api/auth/*)", () => {
    it("세션이 없어도 get-session이 500이 아니라 정상 응답을 준다", async () => {
      // 미로그인은 정상 상태다. 여기서 500이 나면 부팅 시 세션 확인이
      // 에러 배너를 띄우게 된다.
      const res = await app.request("/api/auth/get-session", {}, env);

      expect(res.status).toBeLessThan(500);
    });

    it("소셜 로그인 엔드포인트가 라우팅된다 (404가 아니다)", async () => {
      const res = await app.request(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "kakao", callbackURL: "/" }),
        },
        env,
      );

      // 자격증명이 플레이스홀더라 성공까지는 못 가지만,
      // Hono가 Better Auth로 넘겼다면 404는 아니다.
      expect(res.status).not.toBe(404);
    });

    it("인증 경로는 Hono의 전역 404가 아니라 Better Auth가 처리한다", async () => {
      const unknownAuth = await app.request(
        "/api/auth/nonexistent-endpoint",
        {},
        env,
      );
      const unknownApi = await app.request("/api/nonexistent", {}, env);

      // 둘 다 404지만, 인증 경로는 Better Auth 핸들러까지 들어갔으므로
      // Hono의 전역 notFound 본문({ error: "Not Found" })이 아니다.
      expect(await unknownApi.json()).toEqual({ error: "Not Found" });
      expect(await unknownAuth.text()).not.toBe(
        JSON.stringify({ error: "Not Found" }),
      );
    });
  });
});
