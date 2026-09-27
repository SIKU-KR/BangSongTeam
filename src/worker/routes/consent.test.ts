import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { inArray } from "drizzle-orm";
import { createD1Client, user } from "#db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

const USER_A = "aaaaaaaa00000000000c1";
const USER_B = "bbbbbbbb00000000000c2";

let currentUser: string | null = USER_A;
const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;

const app = createApp({ readSession: fakeSession });

const AGREE_ALL = { ageOver14: true, terms: true, privacy: true };

async function agree(body: unknown): Promise<Response> {
  return await app.request(
    "/api/consent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function status(): Promise<{ agreedAt: string | null }> {
  const res = await app.request("/api/consent", {}, env);
  expect(res.status).toBe(200);
  return (await res.json()) as { agreedAt: string | null };
}

describe("/api/consent", () => {
  beforeEach(async () => {
    currentUser = USER_A;
    const db = createD1Client(env.DB);
    await db.delete(user).where(inArray(user.id, [USER_A, USER_B]));
    const now = new Date();
    await db.insert(user).values([
      { id: USER_A, name: "A", createdAt: now, updatedAt: now },
      { id: USER_B, name: "B", createdAt: now, updatedAt: now },
    ]);
  });

  it("로그인하지 않으면 401", async () => {
    currentUser = null;
    expect((await app.request("/api/consent", {}, env)).status).toBe(401);
    expect((await agree(AGREE_ALL)).status).toBe(401);
  });

  it("동의 전에는 null이고, 동의하면 시각이 기록된다", async () => {
    expect(await status()).toEqual({ agreedAt: null });

    const res = await agree(AGREE_ALL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agreedAt: string };
    expect(Date.parse(body.agreedAt)).not.toBeNaN();

    expect(await status()).toEqual(body);
  });

  it.each([
    { ...AGREE_ALL, ageOver14: false },
    { ...AGREE_ALL, terms: false },
    { ageOver14: true, terms: true },
  ])("필수 항목이 하나라도 빠지면 400: %o", async (body) => {
    expect((await agree(body)).status).toBe(400);
    expect(await status()).toEqual({ agreedAt: null });
  });

  it("다른 사용자의 동의 상태에 영향을 주지 않는다", async () => {
    await agree(AGREE_ALL);
    currentUser = USER_B;
    expect(await status()).toEqual({ agreedAt: null });
  });
});
