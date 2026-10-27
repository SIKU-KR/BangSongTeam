import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Query } from "@google-cloud/firestore";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { FALLBACK_USER_NAME } from "#shared";
import { COLLECTIONS, runBulk, type Db } from "#db";
import { env } from "../test/env";
import { clearDb } from "../../db/test/fixtures";
import app from "../index";
import {
  ACCOUNT_LINKING,
  buildKakaoUser,
  buildNaverUser,
  getAuth,
} from "../lib/auth";

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

async function socialSignIn(
  providerId: string,
  accountId: string,
  userInfo: { email: string; name: string; emailVerified: boolean },
): Promise<string | undefined> {
  const context = await getAuth(env).$context;
  const result = await handleOAuthUserInfo({ context } as never, {
    userInfo: { id: accountId, ...userInfo },
    account: { providerId, accountId },
    callbackURL: "/",
  });
  return result.error ?? undefined;
}

async function googleSignIn(email: string): Promise<string | undefined> {
  return await socialSignIn("google", "google-sub-1", {
    email,
    name: "구글 사용자",
    emailVerified: true,
  });
}

async function createVerifiedUser(email: string): Promise<string> {
  const context = await getAuth(env).$context;
  const user = await context.internalAdapter.createUser(
    { email, name: "기존 사용자", emailVerified: true },
    { method: "oauth", oauth: { providerId: "google" } },
  );
  return user.id;
}

async function linkedProviders(email: string): Promise<string[]> {
  const context = await getAuth(env).$context;
  const user = await context.internalAdapter.findUserByEmail(email, {
    includeAccounts: true,
  });
  return user?.accounts.map((account) => account.providerId) ?? [];
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

describe("가입이 겹치거나 중간에 실패할 때", () => {
  const MINUTE_MS = 60_000;

  beforeEach(async () => {
    await clearDb(env.DB);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function usersWithEmail(email: string): Promise<number> {
    return (
      await env.DB.collection(COLLECTIONS.users)
        .where("email", "==", email)
        .get()
    ).size;
  }

  function bindMethods<T extends object>(
    target: T,
    override: (prop: string | symbol) => unknown,
  ): T {
    return new Proxy(target, {
      get(inner, prop) {
        const replaced = override(prop);
        if (replaced !== undefined) return replaced;
        const value = Reflect.get(inner, prop, inner) as unknown;
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(inner)
          : value;
      },
    });
  }

  function failFirstCredentialSave(db: Db): Db {
    let failed = false;
    const failOnce = () => {
      failed = true;
      return Promise.reject(
        Object.assign(new Error("14 UNAVAILABLE"), { code: 14 }),
      );
    };
    return bindMethods(db, (prop) =>
      prop === "collection"
        ? (name: string) => {
            const collection = db.collection(name);
            if (name !== COLLECTIONS.accounts) return collection;
            return bindMethods(collection, (method) =>
              method === "doc"
                ? (id: string) =>
                    bindMethods(collection.doc(id), (op) =>
                      op === "create" && !failed ? failOnce : undefined,
                    )
                : undefined,
            );
          }
        : undefined,
    );
  }

  it("같은 이메일로 동시에 가입해도 사용자는 하나만 생긴다", async () => {
    const statuses = (
      await Promise.all(
        ["10.0.5.1", "10.0.5.2", "10.0.5.3"].map((ip) =>
          signUp("race@example.com", ip),
        ),
      )
    ).map((res) => res.status);

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 422)).toHaveLength(2);
    expect(await usersWithEmail("race@example.com")).toBe(1);
  });

  it("비밀번호 저장이 실패한 가입은 잠시 뒤 같은 이메일로 다시 가입하고 로그인할 수 있다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const startedAt = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(startedAt);
    const body = {
      email: "retry@example.com",
      password: "password-1234",
      name: "찬양팀",
    };

    const failed = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-forwarded-for": "10.0.5.4",
        },
        body: JSON.stringify(body),
      },
      { ...env, DB: failFirstCredentialSave(env.DB) },
    );
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await usersWithEmail("retry@example.com")).toBe(1);

    expect(
      (await post("/api/auth/sign-up/email", body, "10.0.5.5")).status,
    ).toBe(422);

    vi.setSystemTime(startedAt + 2 * MINUTE_MS);
    const retried = await post("/api/auth/sign-up/email", body, "10.0.5.6");
    expect(retried.status).toBe(200);
    expect(await usersWithEmail("retry@example.com")).toBe(1);

    const signedIn = await post(
      "/api/auth/sign-in/email",
      { email: body.email, password: body.password },
      "10.0.5.7",
    );
    expect(signedIn.status).toBe(200);
  });
});

describe("OAuth 콜백", () => {
  const MINUTE_MS = 60_000;

  beforeEach(async () => {
    await clearDb(env.DB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedStates(
    count: number,
    expiresAt: Date,
    prefix: string,
  ): Promise<void> {
    await runBulk(env.DB, (writer) =>
      Array.from({ length: count }, (_, i) =>
        writer.set(
          env.DB.collection(COLLECTIONS.verifications).doc(`${prefix}-${i}`),
          {
            id: `${prefix}-${i}`,
            identifier: `${prefix}-state-${i}`,
            value: "{}",
            expiresAt,
            createdAt: new Date(expiresAt.getTime() - 10 * MINUTE_MS),
            updatedAt: new Date(expiresAt.getTime() - 10 * MINUTE_MS),
          },
        ),
      ),
    );
  }

  it("만료된 state를 지우려고 쌓인 state를 모두 읽지 않는다", async () => {
    await seedStates(150, new Date(Date.now() - MINUTE_MS), "old");
    await seedStates(150, new Date(Date.now() + MINUTE_MS), "live");
    const sizes: number[] = [];
    const get = Query.prototype.get;
    vi.spyOn(Query.prototype, "get").mockImplementation(async function (
      this: Query,
    ) {
      const snapshot = await get.call(this);
      sizes.push(snapshot.size);
      return snapshot;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await app.request(
      "/api/auth/callback/google?state=missing&code=x",
      { headers: { "x-forwarded-for": "10.0.4.1" } },
      { ...env, GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "secret" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=state_mismatch");
    expect(Math.max(0, ...sizes)).toBeLessThanOrEqual(1);
    expect(
      (await env.DB.collection(COLLECTIONS.verifications).count().get()).data()
        .count,
    ).toBe(300);
  });
});

describe("로그인 유지 기간", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(async () => {
    await clearDb(env.DB);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function sessionEmail(cookie: string): Promise<string | null> {
    const res = await app.request(
      "/api/auth/get-session",
      { headers: { cookie } },
      env,
    );
    const body = (await res.json()) as { user?: { email: string } } | null;
    return body?.user?.email ?? null;
  }

  function freezeClock(): number {
    const startedAt = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(startedAt);
    return startedAt;
  }

  it("한 주에 한 번만 열어도 로그인이 이어진다", async () => {
    const startedAt = freezeClock();
    const cookie = sessionCookie(
      await signUp("weekly@example.com", "10.0.3.1"),
    );

    vi.setSystemTime(startedAt + 8 * DAY_MS);

    expect(await sessionEmail(cookie)).toBe("weekly@example.com");
  });

  it("쓸 때마다 유지 기간이 다시 30일로 늘어난다", async () => {
    const startedAt = freezeClock();
    const cookie = sessionCookie(
      await signUp("sliding@example.com", "10.0.3.2"),
    );

    vi.setSystemTime(startedAt + 20 * DAY_MS);
    expect(await sessionEmail(cookie)).toBe("sliding@example.com");

    vi.setSystemTime(startedAt + 45 * DAY_MS);
    expect(await sessionEmail(cookie)).toBe("sliding@example.com");
  });

  it("30일 넘게 쓰지 않으면 다시 로그인해야 한다", async () => {
    const startedAt = freezeClock();
    const cookie = sessionCookie(await signUp("idle@example.com", "10.0.3.3"));

    vi.setSystemTime(startedAt + 31 * DAY_MS);

    expect(await sessionEmail(cookie)).toBeNull();
  });
});

describe("로그인 빈도 제한", () => {
  const googleEnv = {
    ...env,
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
  };

  beforeEach(async () => {
    await clearDb(env.DB);
  });

  it("같은 교회 와이파이에서 여럿이 함께 소셜 로그인을 시작해도 막지 않는다", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.request(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: ORIGIN,
            "x-forwarded-for": "10.0.2.1",
          },
          body: JSON.stringify({
            provider: "google",
            callbackURL: "/presentations",
          }),
        },
        googleEnv,
      );
      statuses.push(res.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("비밀번호 로그인은 IP마다 10초에 3번까지만 받는다", async () => {
    await signUp("limit@example.com", "10.0.2.2");

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await post(
        "/api/auth/sign-in/email",
        { email: "limit@example.com", password: "wrong-password" },
        "10.0.2.3",
      );
      statuses.push(res.status);
    }

    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it("이메일 가입도 IP마다 10초에 3번까지만 받는다", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await signUp(`flood-${i}@example.com`, "10.0.2.4")).status,
      );
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
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

  it("채움 문자와 폭 없는 문자뿐인 이름도 기본 이름으로 저장한다", async () => {
    const res = await signUpNamed(
      "filler@example.com",
      "\u200B\u3164\u115F",
      "10.0.1.5",
    );

    expect(res.status).toBe(200);
    expect(await storedName("filler@example.com")).toBe(
      FALLBACK_USER_NAME.default,
    );
  });

  it("글 방향을 바꾸는 제어 문자는 빼고 저장한다", async () => {
    const res = await signUpNamed(
      "bidi@example.com",
      "\u202E관리자",
      "10.0.1.6",
    );

    expect(res.status).toBe(200);
    expect(await storedName("bidi@example.com")).toBe("관리자");
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

  it("다른 카카오계정으로 넘어간 이메일로는 같은 이메일의 기존 계정에 묶지 않는다", async () => {
    await createVerifiedUser("moved@example.com");
    const profile = {
      id: 777,
      kakao_account: {
        email: "moved@example.com",
        is_email_verified: true,
        is_email_valid: false,
      },
    };

    expect(await socialSignIn("kakao", "777", buildKakaoUser(profile))).toBe(
      "account not linked",
    );
    expect(await linkedProviders("moved@example.com")).toEqual([]);
  });

  it("카카오가 인증했고 지금도 유효하다고 한 이메일은 기존 계정에 묶는다", async () => {
    await createVerifiedUser("valid@example.com");
    const profile = {
      id: 778,
      kakao_account: {
        email: "valid@example.com",
        is_email_verified: true,
        is_email_valid: true,
      },
    };

    expect(
      await socialSignIn("kakao", "778", buildKakaoUser(profile)),
    ).toBeUndefined();
    expect(await linkedProviders("valid@example.com")).toEqual(["kakao"]);
  });

  it("네이버 이메일로는 같은 이메일의 기존 계정에 묶지 않는다", async () => {
    await createVerifiedUser("naver@example.com");
    const profile = { response: { id: "n-1", email: "naver@example.com" } };

    expect(await socialSignIn("naver", "n-1", buildNaverUser(profile))).toBe(
      "account not linked",
    );
    expect(await linkedProviders("naver@example.com")).toEqual([]);
  });
});
