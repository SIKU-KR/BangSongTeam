import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { makeSignature } from "better-auth/crypto";
import { createD1Client, session, user } from "#db";
import { createId } from "#shared";
import app from "../index";
import { getAuth } from "../lib/auth";
import type { Bindings } from "../types";

const USER_ID = createId();
const SESSION_DATA = "better-auth.session_data";

const bindings: Bindings = { ...env };

function cookiePairs(res: Response): Map<string, string> {
  return new Map(
    res.headers.getSetCookie().map((cookie) => {
      const pair = cookie.split(";")[0];
      const index = pair.indexOf("=");
      return [pair.slice(0, index), pair.slice(index + 1)];
    }),
  );
}

function hasCookie(cookies: Map<string, string>, suffix: string): boolean {
  return [...cookies.keys()].some((name) => name.endsWith(suffix));
}

function cookieHeader(
  cookies: Map<string, string>,
  suffixes: string[],
): string {
  return [...cookies]
    .filter(([name]) => suffixes.some((suffix) => name.endsWith(suffix)))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function login(): Promise<string> {
  const now = new Date();
  const token = createId();
  await createD1Client(env.DB)
    .insert(session)
    .values({
      id: createId(),
      userId: USER_ID,
      token,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });

  const ctx = await getAuth(bindings).$context;
  const signed = `${token}.${await makeSignature(token, ctx.secret)}`;
  return `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
}

async function listFolders(cookie: string): Promise<Response> {
  return await app.request("/api/folders", { headers: { cookie } }, bindings);
}

async function deleteSessions(): Promise<void> {
  await createD1Client(env.DB)
    .delete(session)
    .where(eq(session.userId, USER_ID));
}

describe("세션 쿠키 캐시", () => {
  beforeEach(async () => {
    const db = createD1Client(env.DB);
    await db.delete(user).where(eq(user.id, USER_ID));
    const now = new Date();
    await db.insert(user).values({
      id: USER_ID,
      name: "쿠키 캐시",
      email: "cookie-cache@example.com",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("쿠키 캐시가 없어 D1을 읽은 요청은 새 쿠키 캐시를 응답에 싣는다", async () => {
    const res = await listFolders(await login());

    expect(res.status).toBe(200);
    expect(hasCookie(cookiePairs(res), SESSION_DATA)).toBe(true);
  });

  it("쿠키 캐시가 살아 있으면 D1의 세션을 읽지 않는다", async () => {
    const token = await login();
    const first = await listFolders(token);
    const cache = cookieHeader(cookiePairs(first), [SESSION_DATA]);
    await deleteSessions();

    const cached = await listFolders(`${token}; ${cache}`);
    expect(cached.status).toBe(200);

    const uncached = await listFolders(token);
    expect(uncached.status).toBe(401);
  });
});
