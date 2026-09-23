import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import type { BackgroundMedia } from "@repo/shared";
import app from "./index";

describe("Task 4.6: Miniflare/workerd 환경 Worker 및 D1 통합 테스트", () => {
  beforeAll(async () => {
    // 테이블과 사전 주입 배경 10건 모두 worker/test/setup.ts가 실제
    // 마이그레이션(0000~0002)으로 만든다. 여기서는 R2만 채운다.

    // R2 버킷에 테스트 모션 비디오 객체 적재
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

    it("자격증명이 설정된 프로바이더는 인가 URL을 돌려준다", async () => {
      // .dev.vars의 로컬 설정에 기대지 않도록 자격증명을 직접 넘긴다.
      const res = await app.request(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "kakao", callbackURL: "/" }),
        },
        {
          ...env,
          KAKAO_CLIENT_ID: "test-client-id",
          KAKAO_CLIENT_SECRET: "test-client-secret",
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      expect(body.url).toContain("kauth.kakao.com");
      expect(body.url).toContain("api%2Fauth%2Fcallback%2Fkakao");
    });

    it("자격증명이 없는 프로바이더는 404다", async () => {
      // 빈 문자열로 OAuth를 열어 두면 설정 실수가 런타임까지 숨는다.
      const res = await app.request(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: "kakao", callbackURL: "/" }),
        },
        { ...env, KAKAO_CLIENT_ID: "", KAKAO_CLIENT_SECRET: "" },
      );

      expect(res.status).toBe(404);
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
  describe("동기화 라우트 마운트 (/api/presentations, /api/decks)", () => {
    it("세션 없이 접근하면 401이다 (404가 아니다)", async () => {
      // 404면 라우트가 안 붙은 것이고, 200이면 인증이 안 걸린 것이다.
      // 실제 마운트된 앱에서 requireAuth가 살아 있는지 여기서만 확인할 수 있다.
      for (const path of ["/api/presentations", "/api/decks"]) {
        const res = await app.request(path, {}, env);
        expect(res.status, path).toBe(401);
      }
    });

    it("쓰기·삭제도 세션 없이는 401이다", async () => {
      const id = "10000000-0000-4000-8000-0000000000ff";

      const put = await app.request(
        `/api/presentations/${id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
        env,
      );
      expect(put.status).toBe(401);

      const del = await app.request(
        `/api/decks/${id}`,
        { method: "DELETE" },
        env,
      );
      expect(del.status).toBe(401);
    });
  });
});
