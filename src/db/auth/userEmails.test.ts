import { beforeEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth/minimal";
import type { Db } from "../client";
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

async function linkCredential(userId: string): Promise<void> {
  await db
    .collection(COLLECTIONS.accounts)
    .doc(`account-${userId}`)
    .set({
      id: `account-${userId}`,
      userId,
      providerId: "credential",
      accountId: userId,
    });
}

async function usersWithEmail(email: string): Promise<number> {
  return (
    await db.collection(COLLECTIONS.users).where("email", "==", email).get()
  ).size;
}

async function reservationHolders(): Promise<unknown[]> {
  return (await db.collection(COLLECTIONS.userEmails).get()).docs.map((doc) =>
    doc.get("userId"),
  );
}

function pauseBeforeWriting(
  target: Db,
  resume: Promise<void>,
): { db: Db; paused: Promise<void> } {
  let markPaused: () => void = () => {};
  const paused = new Promise<void>((resolve) => {
    markPaused = resolve;
  });
  const hold = async (): Promise<void> => {
    markPaused();
    await resume;
  };
  const gated = new Proxy(target, {
    get(inner, prop) {
      if (prop === "runTransaction") {
        return async (...args: Parameters<Db["runTransaction"]>) => {
          await hold();
          return await inner.runTransaction(...args);
        };
      }
      if (prop === "batch") {
        return () => {
          const batch = inner.batch();
          const commit = batch.commit.bind(batch);
          batch.commit = async () => {
            await hold();
            return await commit();
          };
          return batch;
        };
      }
      const value = Reflect.get(inner, prop, inner) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(inner)
        : value;
    },
  });
  return { db: gated, paused };
}

describe("releaseAbandonedSignUp", () => {
  beforeEach(async () => {
    await clearDb(db);
  });

  it("자격증명 없이 남은 지 오래된 미인증 사용자를 지우고 이메일을 풀어 준다", async () => {
    await signUpWithoutCredential("left@example.com", LONG_AGO);

    expect(await releaseAbandonedSignUp(db, "Left@Example.com", NOW)).toBe(
      "released",
    );
    expect(await usersWithEmail("left@example.com")).toBe(0);
    expect(
      (await db.collection(COLLECTIONS.userEmails).get()).empty,
    ).toBeTruthy();

    await signUpWithoutCredential("left@example.com", NOW);
    expect(await usersWithEmail("left@example.com")).toBe(1);
  });

  it("방금 만든 사용자는 가입이 아직 진행 중일 수 있어 지우지 않고 진행 중이라고 알린다", async () => {
    await signUpWithoutCredential(
      "fresh@example.com",
      new Date(NOW.getTime() - ABANDONED_SIGN_UP_MIN_AGE_MS / 2),
    );

    expect(await releaseAbandonedSignUp(db, "fresh@example.com", NOW)).toBe(
      "inProgress",
    );
    expect(await usersWithEmail("fresh@example.com")).toBe(1);
  });

  it("방금 가입을 마쳐 계정이 있는 사용자는 진행 중으로 보지 않는다", async () => {
    const id = await signUpWithoutCredential(
      "done@example.com",
      new Date(NOW.getTime() - ABANDONED_SIGN_UP_MIN_AGE_MS / 2),
    );
    await linkCredential(id);

    expect(await releaseAbandonedSignUp(db, "done@example.com", NOW)).toBe(
      "none",
    );
    expect(await usersWithEmail("done@example.com")).toBe(1);
  });

  it("만든 시각이 없는 사용자 문서는 예외 없이 그대로 둔다", async () => {
    const { createdAt, ...withoutCreatedAt } = userDoc({
      id: "undated00000000000001",
      email: "undated@example.com",
    });
    void createdAt;
    await db
      .collection(COLLECTIONS.users)
      .doc(withoutCreatedAt.id)
      .set(withoutCreatedAt);

    expect(await releaseAbandonedSignUp(db, "undated@example.com", NOW)).toBe(
      "none",
    );
    expect(await usersWithEmail("undated@example.com")).toBe(1);
  });

  it("연결된 계정이 있으면 지우지 않는다", async () => {
    const id = await signUpWithoutCredential("linked@example.com", LONG_AGO);
    await linkCredential(id);

    expect(await releaseAbandonedSignUp(db, "linked@example.com", NOW)).toBe(
      "none",
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
      "none",
    );
    expect(await releaseAbandonedSignUp(db, "agreed@example.com", NOW)).toBe(
      "none",
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
      "none",
    );
    expect(await usersWithEmail("twin@example.com")).toBe(2);
  });

  it("치우는 사이에 같은 이메일의 다른 가입이 먼저 끝나면 그 새 사용자의 예약은 지우지 않는다", async () => {
    await signUpWithoutCredential("race@example.com", LONG_AGO);
    let resume: () => void = () => {};
    const slow = pauseBeforeWriting(
      db,
      new Promise<void>((resolve) => {
        resume = resolve;
      }),
    );

    const late = releaseAbandonedSignUp(slow.db, "race@example.com", NOW);
    await slow.paused;
    expect(await releaseAbandonedSignUp(db, "race@example.com", NOW)).toBe(
      "released",
    );
    const newUserId = await signUpWithoutCredential("race@example.com", NOW);
    resume();

    expect(await late).toBe("none");
    expect(await usersWithEmail("race@example.com")).toBe(1);
    expect(await reservationHolders()).toEqual([newUserId]);
  });

  it("같은 가입을 동시에 치워도 한 번만 치운다", async () => {
    await signUpWithoutCredential("twice@example.com", LONG_AGO);

    const released = await Promise.all([
      releaseAbandonedSignUp(db, "twice@example.com", NOW),
      releaseAbandonedSignUp(db, "twice@example.com", NOW),
    ]);

    expect(released.sort()).toEqual(["none", "released"]);
    expect(await usersWithEmail("twice@example.com")).toBe(0);
    expect(await reservationHolders()).toEqual([]);
  });
});
