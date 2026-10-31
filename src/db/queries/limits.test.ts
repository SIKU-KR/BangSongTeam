import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { signUpQuotaDocId, signUpQuotasCol } from "../collections";
import { createTestDb } from "../test/fixtures";
import { DAILY_SIGN_UPS_PER_IP, quotaDay, takeSignUpQuota } from "./limits";

const DAY = new Date("2026-10-27T05:00:00.000Z");
const NEXT_KST_MIDNIGHT = new Date("2026-10-27T15:00:00.000Z");

describe("이메일 가입 하루 한도", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
  });

  it("날짜는 한국 시간으로 정한다", () => {
    expect(quotaDay(new Date("2026-10-27T14:59:59.999Z"))).toBe("2026-10-27");
    expect(quotaDay(NEXT_KST_MIDNIGHT)).toBe("2026-10-28");
  });

  it("IP 키마다 하루 한도까지 세고, 지난 날의 문서는 TTL 정책이 지우도록 만료 시각을 단다", async () => {
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

  it("동시에 와도 한도보다 많이 받지 않는다", async () => {
    for (let i = 0; i < DAILY_SIGN_UPS_PER_IP - 1; i++) {
      await takeSignUpQuota(db, "key-a", DAY);
    }

    const results = await Promise.all(
      Array.from({ length: 4 }, () => takeSignUpQuota(db, "key-a", DAY)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
