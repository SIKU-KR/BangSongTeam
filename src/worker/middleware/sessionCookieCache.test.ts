import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { eq, like } from "drizzle-orm";
import { account, createD1Client, session, user } from "#db";
import app from "../index";
import type { Bindings } from "../types";
import { clearTables } from "../test/db";

const EMAIL = "cookie-cache@dev.local";

const bindings: Bindings = {
  ...env,
  DEV_LOGIN_ENABLED: "true",
  KAKAO_CLIENT_ID: "",
  KAKAO_CLIENT_SECRET: "",
  NAVER_CLIENT_ID: "",
  NAVER_CLIENT_SECRET: "",
};

function cookiePairs(res: Response): Map<string, string> {
  return new Map(
    res.headers.getSetCookie().map((cookie) => {
      const pair = cookie.split(";")[0];
      const index = pair.indexOf("=");
      return [pair.slice(0, index), pair.slice(index + 1)];
    }),
  );
}

const SESSION_TOKEN = "better-auth.session_token";
const SESSION_DATA = "better-auth.session_data";

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

async function login(): Promise<Map<string, string>> {
  const res = await app.request(
    "/api/dev-login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL }),
    },
    bindings,
  );
  expect(res.status).toBeLessThan(400);
  return cookiePairs(res);
}

async function listFolders(cookie: string): Promise<Response> {
  return await app.request("/api/folders", { headers: { cookie } }, bindings);
}

async function deleteSessions(): Promise<void> {
  const db = createD1Client(env.DB);
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, EMAIL));
  await db.delete(session).where(eq(session.userId, row.id));
}

describe("세션 쿠키 캐시", () => {
  beforeEach(async () => {
    await clearTables(session, account);
    await createD1Client(env.DB)
      .delete(user)
      .where(like(user.email, "%@dev.local"));
  });

  it("로그인 응답이 세션 토큰과 함께 쿠키 캐시를 준다", async () => {
    const cookies = await login();

    expect(hasCookie(cookies, SESSION_TOKEN)).toBe(true);
    expect(hasCookie(cookies, SESSION_DATA)).toBe(true);
  });

  it("쿠키 캐시가 살아 있으면 D1의 세션을 읽지 않는다", async () => {
    const cookies = await login();
    await deleteSessions();

    const cached = await listFolders(
      cookieHeader(cookies, [SESSION_TOKEN, SESSION_DATA]),
    );
    expect(cached.status).toBe(200);

    const uncached = await listFolders(cookieHeader(cookies, [SESSION_TOKEN]));
    expect(uncached.status).toBe(401);
  });

  it("쿠키 캐시가 없어 D1을 읽은 요청은 새 쿠키 캐시를 응답에 싣는다", async () => {
    const cookies = await login();

    const res = await listFolders(cookieHeader(cookies, [SESSION_TOKEN]));

    expect(res.status).toBe(200);
    expect(hasCookie(cookiePairs(res), SESSION_DATA)).toBe(true);
  });
});
