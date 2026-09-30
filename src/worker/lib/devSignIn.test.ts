import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { inArray } from "drizzle-orm";
import { DEV_USERS } from "#shared";
import { createD1Client, user } from "#db";
import { createApp } from "../index";
import { DEV_SIGN_IN_REDIRECT } from "./devSignIn";

const [OWNER, MEMBER] = DEV_USERS;
const REGULAR_USER = "regular0000000000dev1";
const app = createApp();

async function signIn(query = ""): Promise<Response> {
  return await app.request(`/api/auth/dev/sign-in${query}`, {}, env);
}

function sessionCookie(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

describe("GET /api/auth/dev/sign-in", () => {
  beforeEach(async () => {
    const db = createD1Client(env.DB);
    const ids = [OWNER.id, MEMBER.id, REGULAR_USER];
    await db.delete(user).where(inArray(user.id, ids));
    const now = new Date();
    await db
      .insert(user)
      .values(
        ids.map((id) => ({ id, name: id, createdAt: now, updatedAt: now })),
      );
  });

  it("시드 계정 세션 쿠키를 심고 드라이브로 보낸다", async () => {
    const res = await signIn(`?userId=${MEMBER.id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(DEV_SIGN_IN_REDIRECT);

    const session = await app.request(
      "/api/auth/get-session",
      { headers: { cookie: sessionCookie(res) } },
      env,
    );
    const body = (await session.json()) as { user: { id: string } };
    expect(body.user.id).toBe(MEMBER.id);
  });

  it("userId가 없으면 첫 시드 계정으로 들어간다", async () => {
    const res = await signIn();
    const session = await app.request(
      "/api/auth/get-session",
      { headers: { cookie: sessionCookie(res) } },
      env,
    );
    const body = (await session.json()) as { user: { id: string } };
    expect(body.user.id).toBe(OWNER.id);
  });

  it("시드 계정이 아닌 사용자로는 들어갈 수 없다", async () => {
    const res = await signIn(`?userId=${REGULAR_USER}`);
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("시드하지 않은 D1에서는 404", async () => {
    await createD1Client(env.DB)
      .delete(user)
      .where(inArray(user.id, [OWNER.id]));
    const res = await signIn();
    expect(res.status).toBe(404);
  });
});
