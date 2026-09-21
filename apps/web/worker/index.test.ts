import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { createD1Client, seedBackgrounds } from "@repo/db";
import type { BackgroundMedia } from "@repo/shared";
import app from "./index";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    MEDIA_BUCKET: R2Bucket;
    AI: Ai;
    QUEUE: Queue;
    R2_PUBLIC_DOMAIN?: string;
  }
}

describe("Task 4.6: Miniflare/workerd 환경 Worker 및 D1 통합 테스트", () => {
  beforeAll(async () => {
    // 1. D1 SQLite 테이블 생성 (workerd 런타임 내 인메모리 D1 인스턴스)
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS backgrounds (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, r2_key TEXT NOT NULL, poster_key TEXT NOT NULL, duration_sec INTEGER NOT NULL, license TEXT NOT NULL, tags TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()));",
    );

    // 2. 초기 10개 모션 루프 영상 데이터 시드
    const db = createD1Client(env.DB);
    await seedBackgrounds(db);
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
});
