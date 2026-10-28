import { describe, it, expect, beforeEach } from "vitest";
import { env } from "../test/env";
import { BackgroundListResponseSchema } from "#shared";
import { clearDb } from "../../db/test/fixtures";
import { createApp } from "../index";
import { resetBackgrounds } from "../test/backgrounds";

const app = createApp();

async function list() {
  const res = await app.request("/api/backgrounds", {}, env);
  expect(res.status).toBe(200);
  return BackgroundListResponseSchema.parse(await res.json());
}

describe("배경 갤러리 API", () => {
  let serviceIds: string[] = [];

  beforeEach(async () => {
    await clearDb(env.DB);
    serviceIds = await resetBackgrounds(2);
  });

  it("로그인 없이 기본 제공 배경 목록을 준다", async () => {
    const body = await list();
    expect(body.backgrounds.map((bg) => bg.id)).toEqual(serviceIds);
  });

  it("앱에서 배경을 올리거나 지우는 경로는 없다 (등록과 정리는 스크립트로만)", async () => {
    const upload = await app.request(
      "/api/backgrounds/uploads",
      {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
        body: new FormData(),
      },
      env,
    );
    expect(upload.status).toBe(404);

    const remove = await app.request(
      `/api/backgrounds/uploads/${serviceIds[0]}`,
      { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } },
      env,
    );
    expect(remove.status).toBe(404);
    expect((await list()).backgrounds.map((bg) => bg.id)).toEqual(serviceIds);
  });
});

describe("배경 검색", () => {
  it("서버 검색 경로는 없다 (갤러리가 받아 둔 목록으로 기기에서 찾는다)", async () => {
    const res = await app.request("/api/backgrounds/search?q=성탄", {}, env);
    expect(res.status).toBe(404);
  });
});
