import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import {
  signUpQuotaDocId,
  signUpQuotasCol,
  userQuotaDocId,
  userQuotasCol,
} from "../collections";
import { createTestDb, userDoc } from "../test/fixtures";
import {
  DAILY_SIGN_UPS_PER_IP,
  DAILY_USER_LIMITS,
  isBannedUser,
  prepareUserQuota,
  quotaDay,
  takeSignUpQuota,
  type UserQuotaAction,
} from "./limits";

const A = "00000000000000000000a";
const DAY = new Date("2026-10-27T05:00:00.000Z");
const NEXT_KST_MIDNIGHT = new Date("2026-10-27T15:00:00.000Z");

describe("계정 제한", () => {
  it("제한 시각이 있는 사용자만 제한된 것으로 본다", () => {
    expect(isBannedUser(userDoc({ id: A, bannedAt: new Date() }))).toBe(true);
    expect(isBannedUser(userDoc({ id: A }))).toBe(false);
    expect(isBannedUser(undefined)).toBe(false);

    const { bannedAt, ...legacy } = userDoc({ id: A });
    void bannedAt;
    expect(isBannedUser(legacy as never)).toBe(false);
  });
});

describe("하루 한도", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  const take = (action: UserQuotaAction, now: Date = DAY) =>
    db.runTransaction(async (tx) => {
      const quota = await prepareUserQuota(tx, db, A, action, now);
      if (quota.exceeded) return false;
      quota.take();
      return true;
    });

  it("날짜는 한국 시간으로 정한다", () => {
    expect(quotaDay(new Date("2026-10-27T14:59:59.999Z"))).toBe("2026-10-27");
    expect(quotaDay(NEXT_KST_MIDNIGHT)).toBe("2026-10-28");
  });

  it("그날 한도까지만 받고 한국 시간 0시가 지나면 다시 센다", async () => {
    const taken: boolean[] = [];
    for (let i = 0; i <= DAILY_USER_LIMITS.report; i++) {
      taken.push(await take("report"));
    }

    expect(taken.filter(Boolean)).toHaveLength(DAILY_USER_LIMITS.report);
    expect(taken.at(-1)).toBe(false);
    expect(await take("report", NEXT_KST_MIDNIGHT)).toBe(true);
  });

  it("하는 일마다 따로 센다", async () => {
    for (let i = 0; i < DAILY_USER_LIMITS.report; i++) await take("report");

    expect(await take("report")).toBe(false);
    expect(await take("publish")).toBe(true);
  });

  it("동시에 와도 한도보다 많이 받지 않는다", async () => {
    for (let i = 0; i < DAILY_USER_LIMITS.report - 1; i++) {
      await take("report");
    }

    const results = await Promise.all(
      Array.from({ length: 4 }, () => take("report")),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("지난 날의 문서는 TTL 정책이 지우도록 만료 시각을 단다", async () => {
    await take("publish");

    expect(
      (
        await userQuotasCol(db).doc(userQuotaDocId(A, "2026-10-27")).get()
      ).data(),
    ).toEqual({
      userId: A,
      day: "2026-10-27",
      publish: 1,
      fork: 0,
      report: 0,
      expiresAt: new Date("2026-10-28T15:00:00.000Z"),
    });
  });

  it("이메일 가입은 IP 키마다 하루 한도까지 센다", async () => {
    const taken: boolean[] = [];
    for (let i = 0; i <= DAILY_SIGN_UPS_PER_IP; i++) {
      taken.push(await takeSignUpQuota(db, "key-a", DAY));
    }

    expect(taken.filter(Boolean)).toHaveLength(DAILY_SIGN_UPS_PER_IP);
    expect(taken.at(-1)).toBe(false);
    expect(await takeSignUpQuota(db, "key-b", DAY)).toBe(true);
    expect(await takeSignUpQuota(db, "key-a", NEXT_KST_MIDNIGHT)).toBe(true);
    expect(
      (
        await signUpQuotasCol(db)
          .doc(signUpQuotaDocId("key-a", "2026-10-27"))
          .get()
      ).data(),
    ).toEqual({
      day: "2026-10-27",
      signUps: DAILY_SIGN_UPS_PER_IP,
      expiresAt: new Date("2026-10-28T15:00:00.000Z"),
    });
  });
});
