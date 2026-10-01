import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { inArray } from "drizzle-orm";
import { BackgroundListResponseSchema } from "#shared";
import { createD1Client, decks, user } from "#db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import { insertUserBackgroundRow, resetBackgrounds } from "../test/backgrounds";

const MEMBER = "bbbbbbbb5000000000002";
const LEGACY_UPLOAD = "othr50000000000000001";

let currentUser: string | null = MEMBER;
const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;
const app = createApp({ readSession: fakeSession });

async function list() {
  const res = await app.request("/api/backgrounds", {}, env);
  expect(res.status).toBe(200);
  return BackgroundListResponseSchema.parse(await res.json());
}

describe("배경 갤러리 API", () => {
  let serviceIds: string[] = [];

  beforeEach(async () => {
    const db = createD1Client(env.DB);
    await db.delete(decks);
    await db.delete(user).where(inArray(user.id, [MEMBER]));
    await db.insert(user).values({
      id: MEMBER,
      name: "회원",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    serviceIds = await resetBackgrounds(2);
    await insertUserBackgroundRow(MEMBER, LEGACY_UPLOAD, 5000);
    currentUser = MEMBER;
  });

  it("누구에게나 같은 기본 제공 배경 목록을 주고 예전 사용자 업로드는 뺀다", async () => {
    for (const who of [null, MEMBER]) {
      currentUser = who;
      const body = await list();
      expect(body.backgrounds.map((bg) => bg.id)).toEqual(serviceIds);
    }
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
