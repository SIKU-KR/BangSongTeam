import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  API_ERRORS,
  BackgroundListResponseSchema,
  SearchBackgroundsResponseSchema,
} from "#shared";
import { createD1Client, decks } from "#db";
import { createApp } from "../index";
import { resetBackgrounds } from "../test/backgrounds";
import type { AppDeps } from "../deps";

const app = createApp();

async function list() {
  const res = await app.request("/api/backgrounds", {}, env);
  expect(res.status).toBe(200);
  return BackgroundListResponseSchema.parse(await res.json());
}

describe("배경 갤러리 API", () => {
  let serviceIds: string[] = [];

  beforeEach(async () => {
    await createD1Client(env.DB).delete(decks);
    serviceIds = await resetBackgrounds(2);
  });

  it("로그인 없이 기본 제공 배경 목록을 준다", async () => {
    const body = await list();
    expect(body.backgrounds.map((bg) => bg.id)).toEqual(serviceIds);
  });

  it("앱에서 배경을 올리거나 지우는 경로는 없다 (등록과 정리는 스크립트로만)", async () => {
    const upload = await app.request(
      "/api/backgrounds/uploads",
      { method: "POST", body: new FormData() },
      env,
    );
    expect(upload.status).toBe(404);

    const remove = await app.request(
      `/api/backgrounds/uploads/${serviceIds[0]}`,
      { method: "DELETE" },
      env,
    );
    expect(remove.status).toBe(404);
    expect((await list()).backgrounds.map((bg) => bg.id)).toEqual(serviceIds);
  });
});

describe("배경 검색 API", () => {
  const search = (q: string, searchBackgrounds: AppDeps["searchBackgrounds"]) =>
    createApp({ searchBackgrounds }).request(
      `/api/backgrounds/search?q=${encodeURIComponent(q)}`,
      {},
      env,
    );

  it("로그인 없이 검색어와 가까운 배경을 순서대로 주고 공유 캐시에 둔다", async () => {
    const searcher = vi.fn(async () => [
      { id: "a".repeat(21), score: 0.71 },
      { id: "b".repeat(21), score: 0.62 },
    ]);
    const res = await search("  잔잔한 파란 배경 ", searcher);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(searcher).toHaveBeenCalledWith(
      expect.anything(),
      "잔잔한 파란 배경",
    );
    const body = SearchBackgroundsResponseSchema.parse(await res.json());
    expect(body.results.map((result) => result.id)).toEqual([
      "a".repeat(21),
      "b".repeat(21),
    ]);
  });

  it("빈 검색어와 50자를 넘는 검색어는 받지 않는다", async () => {
    const searcher = vi.fn(async () => []);
    expect((await search("   ", searcher)).status).toBe(400);
    expect((await search("가".repeat(51), searcher)).status).toBe(400);
    expect(searcher).not.toHaveBeenCalled();
  });

  it("임베딩·벡터 검색이 실패하면 503과 안내 문장을 준다", async () => {
    const res = await search("성탄", async () => {
      throw new Error("AI binding unavailable");
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: API_ERRORS.media.searchUnavailable,
    });
  });
});
