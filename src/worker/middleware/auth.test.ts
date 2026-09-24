import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import {
  createOptionalSession,
  createRequireAuth,
  type SessionReader,
} from "./auth";
import type { AppEnv, Bindings } from "../types";

const TEST_ENV = {
  DB: {} as D1Database,
  MEDIA_BUCKET: {} as R2Bucket,
} as Bindings;

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

describe("optionalSession 미들웨어", () => {
  function buildOptionalApp(readSession: SessionReader) {
    return new Hono<AppEnv>().get(
      "/open",
      createOptionalSession(readSession),
      (c) => c.json({ userId: c.get("userId") ?? null }, 200),
    );
  }

  it("세션이 있으면 userId를 채운다", async () => {
    const app = buildOptionalApp(async () => ({
      userId: "8f14e45fc1a2b3c4d5e6f",
    }));
    const res = await app.request("/open", {}, TEST_ENV);
    expect(await res.json()).toEqual({ userId: "8f14e45fc1a2b3c4d5e6f" });
  });

  it("세션이 없거나 조회가 실패해도 비로그인으로 통과시킨다", async () => {
    for (const readSession of [
      async () => null,
      async () => {
        throw new Error("session store unavailable");
      },
    ] satisfies SessionReader[]) {
      const res = await buildOptionalApp(readSession).request(
        "/open",
        {},
        TEST_ENV,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ userId: null });
    }
  });
});
