import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createRequireAuth, type SessionReader } from "./auth";
import type { AppEnv, Bindings } from "../types";

const TEST_ENV = {
  DB: {} as D1Database,
  MEDIA_BUCKET: {} as R2Bucket,
  AI: {} as Ai,
} as Bindings;

/** requireAuth 뒤에 붙어 userId를 그대로 돌려주는 최소 앱 */
function buildApp(readSession: SessionReader, onHandler = vi.fn()) {
  return new Hono<AppEnv>().get(
    "/protected",
    createRequireAuth(readSession),
    (c) => {
      onHandler();
      return c.json({ userId: c.get("userId") }, 200);
    },
  );
}

describe("requireAuth 미들웨어", () => {
  it("세션이 없으면 401을 주고 핸들러를 실행하지 않는다", async () => {
    const handler = vi.fn();
    const app = buildApp(async () => null, handler);

    const res = await app.request("/protected", {}, TEST_ENV);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect(handler).not.toHaveBeenCalled();
  });

  it("세션이 있으면 userId를 컨텍스트에 넣고 핸들러를 실행한다", async () => {
    const handler = vi.fn();
    const app = buildApp(
      async () => ({ userId: "8f14e45fc1a2b3c4d5e6f" }),
      handler,
    );

    const res = await app.request("/protected", {}, TEST_ENV);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "8f14e45fc1a2b3c4d5e6f",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("세션 조회가 예외를 던지면 500이 아니라 401로 처리한다", async () => {
    // 만료·손상된 쿠키는 '서버 오류'가 아니라 '로그인 안 됨'이다.
    // 500으로 새면 클라이언트가 재로그인 대신 재시도 루프를 돈다.
    const handler = vi.fn();
    const app = buildApp(async () => {
      throw new Error("session store unavailable");
    }, handler);

    const res = await app.request("/protected", {}, TEST_ENV);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("세션 리더에 요청 헤더를 그대로 넘긴다", async () => {
    const readSession = vi.fn<SessionReader>(async () => ({
      userId: "8f14e45fc1a2b3c4d5e6f",
    }));
    const app = buildApp(readSession);

    await app.request(
      "/protected",
      { headers: { cookie: "better-auth.session_token=abc" } },
      TEST_ENV,
    );

    expect(readSession).toHaveBeenCalledTimes(1);
    const passed = readSession.mock.calls[0][0];
    expect(passed.headers.get("cookie")).toBe("better-auth.session_token=abc");
  });
});
