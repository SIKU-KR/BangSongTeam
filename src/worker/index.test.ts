import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import type { BackgroundListResponse } from "#shared";
import app from "./index";

describe("Miniflare/workerd 환경 Worker 및 D1 통합 테스트", () => {
  beforeAll(async () => {
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

  it("처리되지 않은 오류는 내부 메시지를 숨기고 500을 준다", async () => {
    const brokenBucket = {
      get: async () => {
        throw new Error("R2 internal: prj-ppt-media unreachable");
      },
    } as unknown as R2Bucket;

    const res = await app.request(
      "/api/media/loops/warm_light_flow.mp4",
      {},
      { ...env, MEDIA_BUCKET: brokenBucket },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
  });

  it("GET /api/unknown-path returns 404 in workerd runtime", async () => {
    const res = await app.request("/api/unknown-path", {}, env);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toHaveProperty("error");
  });

  it("GET /api/backgrounds는 비로그인에게 사전 주입 배경만 주고 사용량은 null이다", async () => {
    const res = await app.request("/api/backgrounds", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");

    const json = (await res.json()) as BackgroundListResponse;
    expect(json.usage).toBeNull();
    expect(json.backgrounds.every((bg) => bg.source === "service")).toBe(true);
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
      const res = await app.request("/api/auth/get-session", {}, env);

      expect(res.status).toBeLessThan(500);
    });

    it("자격증명이 설정된 프로바이더는 인가 URL을 돌려준다", async () => {
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

      expect(await unknownApi.json()).toEqual({ error: "Not Found" });
      expect(await unknownAuth.text()).not.toBe(
        JSON.stringify({ error: "Not Found" }),
      );
    });
  });
  describe("동기화 라우트 마운트 (/api/presentations, /api/decks)", () => {
    it("세션 없이 접근하면 401이다 (404가 아니다)", async () => {
      for (const path of ["/api/presentations", "/api/decks"]) {
        const res = await app.request(path, {}, env);
        expect(res.status, path).toBe(401);
      }
    });

    it("쓰기·삭제도 세션 없이는 401이다", async () => {
      const id = "1000000000000000000ff";

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
