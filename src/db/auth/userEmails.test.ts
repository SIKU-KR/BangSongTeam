import { beforeEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth/minimal";
import { COLLECTIONS } from "../collections";
import { clearDb, createTestDb, seedDocs, userDoc } from "../test/fixtures";
import { firestoreAdapter } from "./firestoreAdapter";
import {
  ABANDONED_SIGN_UP_MIN_AGE_MS,
  releaseAbandonedSignUp,
} from "./userEmails";

const db = createTestDb();
const NOW = new Date("2026-10-27T09:00:00.000Z");
const LONG_AGO = new Date(NOW.getTime() - 2 * ABANDONED_SIGN_UP_MIN_AGE_MS);

async function authContext() {
  return await betterAuth({
    database: firestoreAdapter(db),
    secret: "user-emails-test-secret-0123456789-abcdefghij",
    baseURL: "http://localhost:5173",
    telemetry: { enabled: false },
  }).$context;
}

async function signUpWithoutCredential(
  email: string,
  createdAt: Date,
): Promise<string> {
  const ctx = await authContext();
  const user = await ctx.internalAdapter.createUser(
    { email, name: "찬양팀", createdAt },
    { method: "email-password" },
  );
  return user.id;
}

async function usersWithEmail(email: string): Promise<number> {
  return (
    await db.collection(COLLECTIONS.users).where("email", "==", email).get()
  ).size;
}

describe("releaseAbandonedSignUp", () => {
  beforeEach(async () => {
    await clearDb(db);
  });

  it("자격증명 없이 남은 지 오래된 미인증 사용자를 지우고 이메일을 풀어 준다", async () => {
    await signUpWithoutCredential("left@example.com", LONG_AGO);

    expect(await releaseAbandonedSignUp(db, "Left@Example.com", NOW)).toBe(
      true,
    );
    expect(await usersWithEmail("left@example.com")).toBe(0);
    expect(
      (await db.collection(COLLECTIONS.userEmails).get()).empty,
    ).toBeTruthy();

    await signUpWithoutCredential("left@example.com", NOW);
    expect(await usersWithEmail("left@example.com")).toBe(1);
  });

  it("방금 만든 사용자는 가입이 아직 진행 중일 수 있어 그대로 둔다", async () => {
    await signUpWithoutCredential(
      "fresh@example.com",
      new Date(NOW.getTime() - ABANDONED_SIGN_UP_MIN_AGE_MS / 2),
    );

    expect(await releaseAbandonedSignUp(db, "fresh@example.com", NOW)).toBe(
      false,
    );
    expect(await usersWithEmail("fresh@example.com")).toBe(1);
  });

  it("연결된 계정이 있으면 지우지 않는다", async () => {
    const id = await signUpWithoutCredential("linked@example.com", LONG_AGO);
    await db.collection(COLLECTIONS.accounts).doc("account-1").set({
      id: "account-1",
      userId: id,
      providerId: "credential",
      accountId: id,
    });

    expect(await releaseAbandonedSignUp(db, "linked@example.com", NOW)).toBe(
      false,
    );
    expect(await usersWithEmail("linked@example.com")).toBe(1);
  });

  it("인증된 이메일이거나 약관에 동의한 사용자는 계정이 없어도 지우지 않는다", async () => {
    await seedDocs(db, {
      users: [
        userDoc({
          id: "verified000000000001",
          email: "bot@example.com",
          emailVerified: true,
          createdAt: LONG_AGO,
        }),
        userDoc({
          id: "agreed00000000000001",
          email: "agreed@example.com",
          termsAgreedAt: LONG_AGO,
          createdAt: LONG_AGO,
        }),
      ],
    });

    expect(await releaseAbandonedSignUp(db, "bot@example.com", NOW)).toBe(
      false,
    );
    expect(await releaseAbandonedSignUp(db, "agreed@example.com", NOW)).toBe(
      false,
    );
    expect(await usersWithEmail("bot@example.com")).toBe(1);
    expect(await usersWithEmail("agreed@example.com")).toBe(1);
  });

  it("같은 이메일의 사용자가 둘이면 어느 쪽도 지우지 않는다", async () => {
    await seedDocs(db, {
      users: [
        userDoc({
          id: "twin0000000000000001",
          email: "twin@example.com",
          createdAt: LONG_AGO,
        }),
        userDoc({
          id: "twin0000000000000002",
          email: "twin@example.com",
          createdAt: LONG_AGO,
        }),
      ],
    });

    expect(await releaseAbandonedSignUp(db, "twin@example.com", NOW)).toBe(
      false,
    );
    expect(await usersWithEmail("twin@example.com")).toBe(2);
  });
});
