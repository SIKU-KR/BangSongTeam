import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../index";
import type { Bindings } from "../types";
import { ID_PATTERN } from "@repo/shared";
import { isDevLoginEnabled } from "../lib/auth";

function withDevLogin(enabled: boolean): Bindings {
  return {
    ...env,
    DEV_LOGIN_ENABLED: enabled ? "true" : undefined,
    KAKAO_CLIENT_ID: "",
    KAKAO_CLIENT_SECRET: "",
    NAVER_CLIENT_ID: "",
    NAVER_CLIENT_SECRET: "",
  };
}

function post(url: string, body: unknown, bindings: Bindings) {
  return app.request(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings,
  );
}

describe("개발자 로그인 가드", () => {
  it("플래그가 없으면 꺼져 있다 (기본값)", () => {
    expect(
      isDevLoginEnabled({} as Bindings, "http://localhost:5173/api/dev-login"),
    ).toBe(false);
  });

  it("플래그가 있고 localhost면 켜진다", () => {
    for (const host of [
      "http://localhost:5173/api/dev-login",
      "http://127.0.0.1:8787/api/dev-login",
    ]) {
      expect(isDevLoginEnabled(withDevLogin(true), host)).toBe(true);
    }
  });

  it("플래그가 있어도 실제 도메인에서는 죽는다", () => {
    for (const host of [
      "https://worship-slide.com/api/dev-login",
      "https://prj-ppt-web.workers.dev/api/dev-login",
      "https://localhost.attacker.com/api/dev-login",
    ]) {
      expect(isDevLoginEnabled(withDevLogin(true), host)).toBe(false);
    }
  });

  it("플래그 값이 'true'가 아니면 꺼져 있다", () => {
    for (const value of ["1", "yes", "TRUE", ""]) {
      expect(
        isDevLoginEnabled(
          { DEV_LOGIN_ENABLED: value } as Bindings,
          "http://localhost:5173/api/dev-login",
        ),
      ).toBe(false);
    }
  });

  it("잘못된 URL은 안전하게 거절한다", () => {
    expect(isDevLoginEnabled(withDevLogin(true), "not-a-url")).toBe(false);
  });
});

describe("개발자 로그인 라우트", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec(
      "DELETE FROM user WHERE email LIKE '%@worship.local' OR email LIKE '%@dev.local'",
    );
  });

  it("비활성 상태에서는 404다 (존재를 드러내지 않는다)", async () => {
    const res = await post("/api/dev-login", {}, withDevLogin(false));
    expect(res.status).toBe(404);
  });

  it("처음 호출하면 계정을 만들고 세션 쿠키를 준다", async () => {
    const res = await post("/api/dev-login", {}, withDevLogin(true));

    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("set-cookie")).toMatch(/session_token/);
  });

  it("두 번째 호출은 같은 계정으로 로그인한다 (중복 생성 없음)", async () => {
    await post("/api/dev-login", {}, withDevLogin(true));
    const second = await post("/api/dev-login", {}, withDevLogin(true));

    expect(second.status).toBeLessThan(400);

    const users = await env.DB.prepare(
      "SELECT id FROM user WHERE email = 'dev@worship.local'",
    ).all();
    expect(users.results).toHaveLength(1);
  });

  it("개발자 계정 id는 21자 NanoID다 (DeckSchema.userId를 통과해야 한다)", async () => {
    await post("/api/dev-login", {}, withDevLogin(true));

    const users = await env.DB.prepare(
      "SELECT id FROM user WHERE email = 'dev@worship.local'",
    ).all();
    expect(users.results[0].id).toMatch(ID_PATTERN);
  });

  it("이메일을 바꾸면 다른 계정이 된다 (교차 사용자 확인용)", async () => {
    await post("/api/dev-login", { email: "a@dev.local" }, withDevLogin(true));
    await post("/api/dev-login", { email: "b@dev.local" }, withDevLogin(true));

    const users = await env.DB.prepare(
      "SELECT id FROM user WHERE email IN ('a@dev.local','b@dev.local')",
    ).all();
    expect(users.results).toHaveLength(2);
  });

  it("이메일 형식이 아니면 400이다", async () => {
    const res = await post(
      "/api/dev-login",
      { email: "not-an-email" },
      withDevLogin(true),
    );
    expect(res.status).toBe(400);
  });

  it("auth-config가 개발자 로그인 가용 여부를 알려 준다", async () => {
    const on = await app.request("/api/auth-config", {}, withDevLogin(true));
    expect(await on.json()).toMatchObject({ devLogin: true });

    const off = await app.request("/api/auth-config", {}, withDevLogin(false));
    expect(await off.json()).toMatchObject({ devLogin: false });
  });

  it("auth-config는 설정된 소셜 프로바이더만 알려 준다", async () => {
    const none = await app.request("/api/auth-config", {}, withDevLogin(true));
    expect((await none.json()) as { providers: string[] }).toMatchObject({
      providers: [],
    });

    const kakao = await app.request(
      "/api/auth-config",
      {},
      {
        ...withDevLogin(true),
        KAKAO_CLIENT_ID: "real-id",
        KAKAO_CLIENT_SECRET: "real-secret",
      },
    );
    expect((await kakao.json()) as { providers: string[] }).toMatchObject({
      providers: ["kakao"],
    });
  });
});
