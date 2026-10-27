import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import {
  reportsCol,
  userQuotaDocId,
  userQuotasCol,
  usersCol,
} from "../collections";
import {
  createTestDb,
  deckDoc,
  seedDocs,
  seedUserQuota,
  userDoc,
} from "../test/fixtures";
import { createReport } from "./reports";
import { deleteDeckScoped } from "./decks";
import { DAILY_USER_LIMITS, quotaDay } from "./limits";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const PUB = "c00000000000000000001";
const PRIV = "c00000000000000000002";

async function allReports(db: Db) {
  return (await reportsCol(db).get()).docs.map((doc) => doc.data());
}

describe("createReport", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [userDoc({ id: A, name: "A" }), userDoc({ id: B, name: "B" })],
      decks: [
        deckDoc({ id: PUB, userId: A, title: "은혜", visibility: "public" }),
        deckDoc({ id: PRIV, userId: A }),
      ],
    });
  });

  it("records a pending report with the reporter and details", async () => {
    const result = await createReport(db, B, {
      targetType: "deck",
      targetId: PUB,
      reason: "lyrics_error",
      details: "  2절 가사가 틀렸어요 ",
    });
    expect(result.status).toBe("ok");
    const [saved] = await allReports(db);
    expect(saved).toMatchObject({
      reporterId: B,
      deckId: PUB,
      reason: "lyrics_error",
      details: "2절 가사가 틀렸어요",
      status: "pending",
    });
  });

  it("does not accept reports on private or unknown targets", async () => {
    for (const input of [
      { targetType: "deck" as const, targetId: PRIV },
      {
        targetType: "deck" as const,
        targetId: "c0000000000000000dead",
      },
    ]) {
      expect(
        (await createReport(db, B, { ...input, reason: "inappropriate" }))
          .status,
      ).toBe("not_found");
    }
  });

  it("rejects a second pending report on the same target from the same user", async () => {
    const input = {
      targetType: "deck" as const,
      targetId: PUB,
      reason: "copyright" as const,
    };
    expect((await createReport(db, B, input)).status).toBe("ok");
    expect((await createReport(db, B, input)).status).toBe("duplicate");
    expect((await createReport(db, A, input)).status).toBe("ok");
  });

  it("동시에 같은 신고를 보내도 처리 대기 신고는 하나만 남는다", async () => {
    const input = {
      targetType: "deck" as const,
      targetId: PUB,
      reason: "copyright" as const,
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => createReport(db, B, input)),
    );
    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(await allReports(db)).toHaveLength(1);
  });

  it("keeps the report when the deck is deleted", async () => {
    await createReport(db, B, {
      targetType: "deck",
      targetId: PUB,
      reason: "copyright",
    });
    expect(await deleteDeckScoped(db, PUB, A)).toBe(true);

    const [saved] = await allReports(db);
    expect(saved).toMatchObject({
      reporterId: B,
      deckId: null,
      reason: "copyright",
    });
  });

  it("곡이 지워져도 신고에 남긴 곡 주인과 제목은 그대로 남는다", async () => {
    await createReport(db, B, {
      targetType: "deck",
      targetId: PUB,
      reason: "copyright",
    });
    expect(await deleteDeckScoped(db, PUB, A)).toBe(true);

    const [saved] = await allReports(db);
    expect(saved).toMatchObject({
      deckId: null,
      targetUserId: A,
      targetTitle: "은혜",
    });
  });

  describe("계정 제한과 하루 한도", () => {
    const DAY = new Date("2026-10-27T05:00:00.000Z");
    const NEXT_DAY = new Date("2026-10-28T05:00:00.000Z");
    const input = {
      targetType: "deck" as const,
      targetId: PUB,
      reason: "inappropriate" as const,
    };
    const reportsCounted = async (userId: string) =>
      (
        await userQuotasCol(db)
          .doc(userQuotaDocId(userId, quotaDay(DAY)))
          .get()
      ).data()?.report ?? 0;

    it("운영자가 제한한 계정의 신고는 받지 않는다", async () => {
      await usersCol(db).doc(B).update({ bannedAt: new Date() });

      expect((await createReport(db, B, input)).status).toBe("banned");
      expect(await allReports(db)).toHaveLength(0);
    });

    it("하루 신고 한도를 다 쓰면 다음 날까지 받지 않는다", async () => {
      await seedUserQuota(db, B, DAY, { report: DAILY_USER_LIMITS.report });

      expect((await createReport(db, B, input, DAY)).status).toBe(
        "rate_limited",
      );
      expect(await allReports(db)).toHaveLength(0);
      expect((await createReport(db, B, input, NEXT_DAY)).status).toBe("ok");
    });

    it("받은 신고만 한도를 쓴다", async () => {
      expect(
        (await createReport(db, B, { ...input, targetId: PRIV }, DAY)).status,
      ).toBe("not_found");
      expect((await createReport(db, B, input, DAY)).status).toBe("ok");
      expect((await createReport(db, B, input, DAY)).status).toBe("duplicate");

      expect(await reportsCounted(B)).toBe(1);
    });
  });
});
