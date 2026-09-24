import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../index";
import type { Bindings } from "../types";
import { ID_PATTERN } from "#shared";
import {
  isEmailLoginEnabled,
  isEmailSignupAllowed,
  parseEmailAllowlist,
} from "../lib/auth";

const ALLOWED = "worship.team@email.test";
const PASSWORD = "correct-horse-battery";

function withAllowlist(allowlist: string | undefined): Bindings {
  return {
    ...env,
    EMAIL_SIGNUP_ALLOWLIST: allowlist,
    DEV_LOGIN_ENABLED: undefined,
    KAKAO_CLIENT_ID: "",
    KAKAO_CLIENT_SECRET: "",
    NAVER_CLIENT_ID: "",
    NAVER_CLIENT_SECRET: "",
  };
}

function post(
  url: string,
  body: unknown,
  bindings: Bindings,
  headers: Record<string, string> = {},
) {
  return app.request(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    bindings,
  );
}

function signUp(bindings: Bindings, overrides: Record<string, string> = {}) {
  return post(
    "/api/email-signup",
    { email: ALLOWED, password: PASSWORD, name: "찬양팀", ...overrides },
    bindings,
  );
}

async function countUsers(email: string): Promise<number> {
  const rows = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
    .bind(email)
    .all();
  return rows.results.length;
}

describe("가입 허용 목록", () => {
  it("쉼표·공백·줄바꿈을 섞어 써도 되고 대소문자를 무시한다", () => {
    expect(
      parseEmailAllowlist(" A@Email.test, b@email.test\nc@email.test ,, "),
    ).toEqual(new Set(["a@email.test", "b@email.test", "c@email.test"]));
  });

  it("비어 있으면 이메일 로그인이 꺼진다", () => {
    for (const raw of [undefined, "", " , \n"]) {
      expect(isEmailLoginEnabled(withAllowlist(raw))).toBe(false);
    }
    expect(isEmailLoginEnabled(withAllowlist(ALLOWED))).toBe(true);
  });

  it("목록에 있는 주소만 가입할 수 있다", () => {
    const bindings = withAllowlist(ALLOWED);
    expect(isEmailSignupAllowed(bindings, " Worship.Team@Email.test ")).toBe(
      true,
    );
    expect(isEmailSignupAllowed(bindings, "stranger@email.test")).toBe(false);
  });
});

describe("이메일 가입·로그인", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM session");
    await env.DB.exec("DELETE FROM account");
    await env.DB.exec("DELETE FROM user WHERE email LIKE '%@email.test'");
  });

  it("허용 목록이 없으면 가입 경로는 404이고 로그인도 막힌다", async () => {
    const bindings = withAllowlist(undefined);

    expect((await signUp(bindings)).status).toBe(404);

    const config = await app.request("/api/auth-config", {}, bindings);
    expect(await config.json()).toMatchObject({ emailLogin: false });

    const signIn = await post(
      "/api/auth/sign-in/email",
      { email: ALLOWED, password: PASSWORD },
      bindings,
    );
    expect(signIn.status).toBeGreaterThanOrEqual(400);
  });

  it("auth-config가 이메일 로그인 가용 여부를 알려 준다", async () => {
    const res = await app.request(
      "/api/auth-config",
      {},
      withAllowlist(ALLOWED),
    );
    expect(await res.json()).toMatchObject({ emailLogin: true });
  });

  it("허용된 이메일은 가입과 동시에 세션 쿠키를 받는다", async () => {
    const res = await signUp(withAllowlist(ALLOWED), {
      email: "Worship.Team@Email.test",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/session_token/);

    const users = await env.DB.prepare(
      "SELECT id, email_verified AS verified FROM user WHERE email = ?",
    )
      .bind(ALLOWED)
      .all<{ id: string; verified: number }>();
    expect(users.results).toHaveLength(1);
    expect(users.results[0].id).toMatch(ID_PATTERN);
    expect(users.results[0].verified).toBe(0);
  });

  it("비밀번호는 PBKDF2 형식으로 저장된다", async () => {
    await signUp(withAllowlist(ALLOWED));

    const row = await env.DB.prepare(
      "SELECT a.password FROM account a JOIN user u ON u.id = a.user_id WHERE u.email = ?",
    )
      .bind(ALLOWED)
      .first<{ password: string }>();
    expect(row?.password).toMatch(/^pbkdf2-sha256\$/);
  });

  it("허용 목록에 없는 이메일은 403이고 계정이 생기지 않는다", async () => {
    const res = await signUp(withAllowlist(ALLOWED), {
      email: "stranger@email.test",
    });

    expect(res.status).toBe(403);
    expect(await countUsers("stranger@email.test")).toBe(0);
  });

  it("이미 가입된 이메일은 다시 가입할 수 없다", async () => {
    const bindings = withAllowlist(ALLOWED);
    await signUp(bindings);

    const again = await signUp(bindings);
    expect(again.status).toBe(422);
    expect(await countUsers(ALLOWED)).toBe(1);
  });

  it("짧은 비밀번호는 400이다", async () => {
    const res = await signUp(withAllowlist(ALLOWED), { password: "short" });
    expect(res.status).toBe(400);
  });

  it("Better Auth 공개 가입 경로는 허용 목록이 있어도 닫혀 있다", async () => {
    const res = await post(
      "/api/auth/sign-up/email",
      { email: "stranger@email.test", password: PASSWORD, name: "외부인" },
      withAllowlist(ALLOWED),
    );

    expect(res.status).toBe(404);
    expect(await countUsers("stranger@email.test")).toBe(0);
  });

  it("가입한 계정은 맞는 비밀번호로만 로그인된다", async () => {
    await signUp(withAllowlist(ALLOWED));

    const ok = await post(
      "/api/auth/sign-in/email",
      { email: ALLOWED, password: PASSWORD },
      withAllowlist(ALLOWED),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/session_token/);

    const wrong = await post(
      "/api/auth/sign-in/email",
      { email: ALLOWED, password: "wrong-password" },
      withAllowlist(ALLOWED),
    );
    expect(wrong.status).toBe(401);
  });

  it("같은 IP의 로그인 시도가 몰리면 429로 끊는다", async () => {
    const bindings = withAllowlist(ALLOWED);
    const attempt = () =>
      post(
        "/api/auth/sign-in/email",
        { email: ALLOWED, password: "wrong-password" },
        bindings,
        { "cf-connecting-ip": "203.0.113.7" },
      );

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await attempt()).status);

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
  });

  it("개발자 로그인은 허용 목록과 무관하게 계속 동작한다", async () => {
    const res = await post(
      "/api/dev-login",
      { email: "someone@email.test" },
      { ...withAllowlist(undefined), DEV_LOGIN_ENABLED: "true" },
      {},
    );

    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("set-cookie")).toMatch(/session_token/);
  });
});
