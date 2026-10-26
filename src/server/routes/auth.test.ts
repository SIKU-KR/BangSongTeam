import { beforeEach, describe, expect, it } from "vitest";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { FALLBACK_USER_NAME } from "#shared";
import { env } from "../test/env";
import { clearDb } from "../../db/test/fixtures";
import app from "../index";
import { ACCOUNT_LINKING, getAuth } from "../lib/auth";

const ORIGIN = env.BETTER_AUTH_URL ?? "";

async function post(
  path: string,
  body: unknown,
  ip: string,
): Promise<Response> {
  return await app.request(
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function signUp(
  email: string,
  ip: string,
  password = "password-1234",
): Promise<Response> {
  return await post(
    "/api/auth/sign-up/email",
    { email, password, name: "찬양팀" },
    ip,
  );
}

function sessionCookie(res: Response): string {
  const cookie = res.headers
    .getSetCookie()
    .find((value) => value.startsWith("better-auth.session_token="));
  return cookie?.split(";")[0] ?? "";
}

async function googleSignIn(email: string): Promise<string | undefined> {
  const context = await getAuth(env).$context;
  const result = await handleOAuthUserInfo({ context } as never, {
    userInfo: {
      id: "google-sub-1",
      email,
      name: "구글 사용자",
      emailVerified: true,
    },
    account: { providerId: "google", accountId: "google-sub-1" },
    callbackURL: "/",
  });
  return result.error ?? undefined;
}

describe("이메일·비밀번호 인증", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
  });

  it("가입하면 바로 로그인되고, 다시 비밀번호로 로그인할 수 있다", async () => {
    const created = await signUp("team@example.com", "10.0.0.1");
    expect(created.status).toBe(200);
    const cookie = sessionCookie(created);
    expect(cookie).not.toBe("");

    const session = await app.request(
      "/api/auth/get-session",
      { headers: { cookie } },
      env,
    );
    const body = (await session.json()) as { user: { email: string } };
    expect(body.user.email).toBe("team@example.com");

    const signedIn = await post(
      "/api/auth/sign-in/email",
      { email: "team@example.com", password: "password-1234" },
      "10.0.0.1",
    );
    expect(signedIn.status).toBe(200);
    expect(sessionCookie(signedIn)).not.toBe("");
  });

  it("비밀번호는 Argon2id 해시로만 저장한다", async () => {
    await signUp("hash@example.com", "10.0.0.2");

    const context = await getAuth(env).$context;
    const user = await context.internalAdapter.findUserByEmail(
      "hash@example.com",
      { includeAccounts: true },
    );
    const credential = user?.accounts.find(
      (account) => account.providerId === "credential",
    );
    expect(credential?.password).toMatch(/^\$argon2id\$/);
    expect(credential?.password).not.toContain("password-1234");
  });

  it("틀린 비밀번호와 없는 계정은 세션 없이 거절한다", async () => {
    await signUp("wrong@example.com", "10.0.0.3");

    for (const credentials of [
      { email: "wrong@example.com", password: "wrong-password" },
      { email: "nobody@example.com", password: "password-1234" },
    ]) {
      const res = await post(
        "/api/auth/sign-in/email",
        credentials,
        "10.0.0.3",
      );
      expect(res.status).toBe(401);
      expect(sessionCookie(res)).toBe("");
    }
  });

  it("같은 이메일로 다시 가입할 수 없고, 짧은 비밀번호는 받지 않는다", async () => {
    await signUp("dup@example.com", "10.0.0.4");

    const duplicate = await signUp("dup@example.com", "10.0.0.4");
    const short = await signUp("short@example.com", "10.0.0.4", "short");

    expect(duplicate.status).toBeGreaterThanOrEqual(400);
    expect(sessionCookie(duplicate)).toBe("");
    expect(short.status).toBe(400);
  });
});

describe("표시 이름", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
  });

  async function storedName(email: string): Promise<unknown> {
    const context = await getAuth(env).$context;
    return (await context.internalAdapter.findUserByEmail(email))?.user.name;
  }

  async function signUpNamed(
    email: string,
    name: string,
    ip: string,
  ): Promise<Response> {
    return await post(
      "/api/auth/sign-up/email",
      { email, password: "password-1234", name },
      ip,
    );
  }

  it("가입할 때 긴 이름은 거절하지 않고 50자로 줄여 저장한다", async () => {
    const res = await signUpNamed(
      "long@example.com",
      "a".repeat(150),
      "10.0.1.1",
    );

    expect(res.status).toBe(200);
    expect(await storedName("long@example.com")).toBe("a".repeat(50));
  });

  it("공백뿐인 이름은 기본 이름으로 저장한다", async () => {
    const res = await signUpNamed("blank@example.com", "   ", "10.0.1.2");

    expect(res.status).toBe(200);
    expect(await storedName("blank@example.com")).toBe(
      FALLBACK_USER_NAME.default,
    );
  });

  it("쓰지 않는 /update-user는 404이고 이름을 바꾸지 않는다", async () => {
    const created = await signUpNamed("keep@example.com", "찬양팀", "10.0.1.3");
    const res = await app.request(
      "/api/auth/update-user",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-forwarded-for": "10.0.1.3",
          cookie: sessionCookie(created),
        },
        body: JSON.stringify({ name: 0 }),
      },
      env,
    );

    expect(res.status).toBe(404);
    expect(await storedName("keep@example.com")).toBe("찬양팀");
  });

  it("다른 경로로 이름을 바꿀 때도 다듬고, 이름이 없는 수정은 이름을 그대로 둔다", async () => {
    await signUpNamed("update@example.com", "찬양팀", "10.0.1.4");
    const context = await getAuth(env).$context;
    const found =
      await context.internalAdapter.findUserByEmail("update@example.com");
    const id = found?.user.id ?? "";

    await context.internalAdapter.updateUser(id, {
      name: { x: 1 } as unknown as string,
    });
    expect(await storedName("update@example.com")).toBe(
      FALLBACK_USER_NAME.default,
    );

    await context.internalAdapter.updateUser(id, { name: "  새 이름  " });
    await context.internalAdapter.updateUser(id, { emailVerified: true });
    expect(await storedName("update@example.com")).toBe("새 이름");
  });
});

describe("소셜 로그인 계정 연결", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
  });

  it("연결 설정이 이메일 미인증 계정과의 연결을 막도록 고정돼 있다", () => {
    expect(ACCOUNT_LINKING.requireLocalEmailVerified).toBe(true);
  });

  it("메일 인증 없이 가입한 계정에는 같은 이메일의 Google 로그인을 묶지 않는다", async () => {
    await signUp("victim@example.com", "10.0.0.5");

    expect(await googleSignIn("victim@example.com")).toBe("account not linked");

    const context = await getAuth(env).$context;
    const user = await context.internalAdapter.findUserByEmail(
      "victim@example.com",
      { includeAccounts: true },
    );
    expect(user?.accounts.map((account) => account.providerId)).toEqual([
      "credential",
    ]);
  });

  it("이메일이 인증된 기존 계정에는 묶인다", async () => {
    await signUp("verified@example.com", "10.0.0.6");
    const context = await getAuth(env).$context;
    const found = await context.internalAdapter.findUserByEmail(
      "verified@example.com",
    );
    await context.internalAdapter.updateUser(found?.user.id ?? "", {
      emailVerified: true,
    });

    expect(await googleSignIn("verified@example.com")).toBeUndefined();
  });
});
