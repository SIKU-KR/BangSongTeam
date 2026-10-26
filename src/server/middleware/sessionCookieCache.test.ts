import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "../test/env";
import { makeSignature } from "better-auth/crypto";
import { COLLECTIONS, type Db } from "#db";
import { clearDb, seedDocs, userDoc } from "../../db/test/fixtures";
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
  const id = createId();
  await env.DB.collection(COLLECTIONS.sessions)
    .doc(id)
    .set({
      id,
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
  const sessions = await env.DB.collection(COLLECTIONS.sessions)
    .where("userId", "==", USER_ID)
    .get();
  await Promise.all(sessions.docs.map((doc) => doc.ref.delete()));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("세션 쿠키 캐시", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
    await seedDocs(env.DB, {
      users: [
        userDoc({
          id: USER_ID,
          name: "쿠키 캐시",
          email: "cookie-cache@example.com",
        }),
      ],
    });
  });

  it("쿠키 캐시가 없어 Firestore를 읽은 요청은 새 쿠키 캐시를 응답에 싣는다", async () => {
    const res = await listFolders(await login());

    expect(res.status).toBe(200);
    expect(hasCookie(cookiePairs(res), SESSION_DATA)).toBe(true);
  });

  it("쿠키 캐시가 살아 있으면 Firestore의 세션을 읽지 않는다", async () => {
    const token = await login();
    const first = await listFolders(token);
    const cache = cookieHeader(cookiePairs(first), [SESSION_DATA]);
    await deleteSessions();

    const cached = await listFolders(`${token}; ${cache}`);
    expect(cached.status).toBe(200);

    const uncached = await listFolders(token);
    expect(uncached.status).toBe(401);
  });

  it("서명이 맞지 않는 세션 쿠키는 예외 없이 401로 끝난다", async () => {
    const token = await login();
    const res = await listFolders(token.replace(/.$/, "x"));

    expect(res.status).toBe(401);
  });

  it("세션 저장소가 실패하면 로그아웃으로 오인되지 않게 401이 아니라 5xx로 내린다", async () => {
    const token = await login();
    const brokenDb = new Proxy(env.DB, {
      get(target, prop) {
        if (
          ["collection", "runTransaction", "getAll", "batch"].includes(
            String(prop),
          )
        ) {
          return () => {
            throw Object.assign(new Error("14 UNAVAILABLE: storage"), {
              code: 14,
            });
          };
        }
        return Reflect.get(target, prop);
      },
    }) as Db;
    const brokenBindings: Bindings = { ...env, DB: brokenDb };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await app.request(
      "/api/folders",
      { headers: { cookie: token } },
      brokenBindings,
    );

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
