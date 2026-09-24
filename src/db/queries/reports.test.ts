import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { decks, reports, user } from "../schema";
import { createReport } from "./reports";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const PUB = "c00000000000000000001";
const PRIV = "c00000000000000000002";

describe("createReport", () => {
  let testDb: TestDbResult;
  let db: TestDbResult["db"];

  beforeEach(async () => {
    testDb = createTestDb();
    db = testDb.db;
    await db.insert(user).values([
      { id: A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
    const base = {
      userId: A,
      title: "곡",
      lyricsRaw: "가사",
      slides: "[]",
      style: "{}",
    };
    await db.insert(decks).values([
      { ...base, id: PUB, visibility: "public" },
      { ...base, id: PRIV },
    ]);
  });

  afterEach(() => testDb.sqlite.close());

  it("records a pending report with the reporter and details", async () => {
    const result = await createReport(db, B, {
      targetType: "deck",
      targetId: PUB,
      reason: "lyrics_error",
      details: "  2절 가사가 틀렸어요 ",
    });
    expect(result.status).toBe("ok");
    const [saved] = await db.select().from(reports);
    expect(saved).toMatchObject({
      userId: B,
      targetType: "deck",
      targetId: PUB,
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
});
