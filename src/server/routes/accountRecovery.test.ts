import { beforeEach, describe, expect, it } from "vitest";
import { OFFICIAL_LIBRARY_USER_ID } from "#shared";
import { userEmailDocId, userEmailsCol, usersCol } from "#db";
import { addPasswordLogin } from "../../db/ops/accountRecovery";
import {
  clearDb,
  seedAccount,
  seedDocs,
  userDoc,
} from "../../db/test/fixtures";
import app from "../index";
import { SYNTHETIC_EMAIL_DOMAIN } from "../lib/auth";
import { hashPassword } from "../lib/password";
import { env } from "../test/env";

const KAKAO_USER = "000000000000000kakao1";
const GOOGLE_USER = "00000000000000google1";
const EMAIL_USER = "000000000000000email1";
const SYNTHETIC = `kakao_42@${SYNTHETIC_EMAIL_DOMAIN}`;
const NOW = new Date("2026-10-27T00:00:00.000Z");

describe("이메일·비밀번호 로그인 더하기", () => {
  const db = env.DB;
  const EMAIL = "member@example.com";
  const PASSWORD = "temporary-pass-1234";

  const signIn = (email: string, password: string, ip: string) =>
    app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: env.BETTER_AUTH_URL,
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ email, password }),
      },
      env,
    );

  const sessionUserId = async (res: Response): Promise<string | undefined> => {
    const cookie = res.headers
      .getSetCookie()
      .find((value) => value.startsWith("better-auth.session_token="))
      ?.split(";")[0];
    const session = await app.request(
      "/api/auth/get-session",
      { headers: { cookie: cookie ?? "" } },
      env,
    );
    return ((await session.json()) as { user?: { id: string } } | null)?.user
      ?.id;
  };

  const reservation = async (email: string) =>
    (await userEmailsCol(db).doc(userEmailDocId(email)).get()).data();

  beforeEach(async () => {
    await clearDb(db);
    await seedDocs(db, {
      users: [
        userDoc({ id: KAKAO_USER, name: "카카오 사용자", email: SYNTHETIC }),
      ],
    });
    await seedAccount(db, KAKAO_USER, "kakao");
    await userEmailsCol(db)
      .doc(userEmailDocId(SYNTHETIC))
      .set({ userId: KAKAO_USER });
  });

  it("미리보기는 바꿀 이메일만 알려 주고 아무것도 쓰지 않는다", async () => {
    expect(
      await addPasswordLogin(db, { userId: KAKAO_USER, email: EMAIL }),
    ).toEqual({
      status: "ready",
      userId: KAKAO_USER,
      email: EMAIL,
      previousEmail: SYNTHETIC,
    });
    expect((await usersCol(db).doc(KAKAO_USER).get()).data()?.email).toBe(
      SYNTHETIC,
    );
    expect(await reservation(SYNTHETIC)).toEqual({ userId: KAKAO_USER });
    expect(await reservation(EMAIL)).toBeUndefined();
    expect((await signIn(EMAIL, PASSWORD, "10.9.0.1")).status).toBe(401);
  });

  it("옮겨 온 카카오 사용자가 그 계정 그대로 이메일·비밀번호로 로그인한다", async () => {
    const result = await addPasswordLogin(db, {
      userId: KAKAO_USER,
      email: " Member@Example.com ",
      apply: true,
      passwordHash: await hashPassword(PASSWORD),
      now: NOW,
    });

    expect(result).toEqual({
      status: "added",
      userId: KAKAO_USER,
      email: EMAIL,
      previousEmail: SYNTHETIC,
    });
    const res = await signIn(EMAIL, PASSWORD, "10.9.0.2");
    expect(res.status).toBe(200);
    expect(await sessionUserId(res)).toBe(KAKAO_USER);
    expect(await reservation(EMAIL)).toEqual({ userId: KAKAO_USER });
    expect(await reservation(SYNTHETIC)).toBeUndefined();
    expect((await usersCol(db).doc(KAKAO_USER).get()).data()).toMatchObject({
      email: EMAIL,
      emailVerified: false,
      updatedAt: NOW,
    });
  });

  it("다른 사용자가 쓰는 이메일, 이미 있는 비밀번호, 소셜로만 들어오지 않는 사용자는 막는다", async () => {
    await seedDocs(db, {
      users: [
        userDoc({ id: EMAIL_USER, email: "taken@example.com" }),
        userDoc({ id: GOOGLE_USER, email: "google@example.com" }),
      ],
    });
    await seedAccount(db, EMAIL_USER, "credential");
    await seedAccount(db, GOOGLE_USER, "kakao");
    await seedAccount(db, GOOGLE_USER, "google");

    expect(
      await addPasswordLogin(db, {
        userId: KAKAO_USER,
        email: "taken@example.com",
      }),
    ).toEqual({ status: "email_taken", heldBy: EMAIL_USER });
    expect(
      await addPasswordLogin(db, { userId: EMAIL_USER, email: EMAIL }),
    ).toEqual({ status: "has_password" });
    expect(
      await addPasswordLogin(db, { userId: GOOGLE_USER, email: EMAIL }),
    ).toEqual({ status: "not_social_only", providers: ["google", "kakao"] });
    expect(
      await addPasswordLogin(db, { userId: KAKAO_USER, email: "not-email" }),
    ).toEqual({ status: "invalid_email" });
    expect(
      await addPasswordLogin(db, {
        userId: "000000000000000nobody",
        email: EMAIL,
      }),
    ).toEqual({ status: "not_found" });
    expect(
      await addPasswordLogin(db, {
        userId: OFFICIAL_LIBRARY_USER_ID,
        email: EMAIL,
      }),
    ).toEqual({ status: "official" });
  });
});
