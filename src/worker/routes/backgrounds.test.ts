import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { BackgroundListResponseSchema } from "#shared";
import { createD1Client, decks } from "#db";
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
