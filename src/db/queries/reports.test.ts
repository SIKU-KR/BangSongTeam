import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { reportsCol } from "../collections";
import { createTestDb, deckDoc, seedDocs, userDoc } from "../test/fixtures";
import { createReport } from "./reports";
import { deleteDeckScoped } from "./decks";

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
        deckDoc({ id: PUB, userId: A, visibility: "public" }),
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
});
