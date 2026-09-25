import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { count, eq } from "drizzle-orm";
import { createTestDb, type TestDbResult } from "../test-utils";
import { decks, decksFts, reports, user } from "../schema";
import { MODERATION_SQL } from "./moderationSql";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const DECK = "c00000000000000000001";
const FORK = "c00000000000000000002";

describe("운영 SQL (moderation runbook)", () => {
  let testDb: TestDbResult;
  const run = (key: keyof typeof MODERATION_SQL, params: object = {}) =>
    testDb.sqlite.prepare(MODERATION_SQL[key]).run(params);
  const all = (key: keyof typeof MODERATION_SQL, params: object = {}) =>
    testDb.sqlite.prepare(MODERATION_SQL[key]).all(params) as Record<
      string,
      unknown
    >[];
  const deckState = (id: string) =>
    testDb.db
      .select({ visibility: decks.visibility, takedownAt: decks.takedownAt })
      .from(decks)
      .where(eq(decks.id, id))
      .get();
  const report = (id: string) =>
    testDb.db
      .select({
        status: reports.status,
        resolutionNote: reports.resolutionNote,
      })
      .from(reports)
      .where(eq(reports.id, id))
      .get();

  beforeEach(() => {
    testDb = createTestDb();
    const epoch = new Date(0);
    testDb.db
      .insert(user)
      .values([
        { id: A, name: "A", createdAt: epoch, updatedAt: epoch },
        { id: B, name: "B", createdAt: epoch, updatedAt: epoch },
      ])
      .run();
    const deck = {
      userId: A,
      title: "시선",
      lyricsRaw: "가사",
      slides: "[]",
      style: "{}",
      visibility: "public",
      publishedAt: new Date(1000),
    } as const;
    testDb.db
      .insert(decks)
      .values([
        { ...deck, id: DECK },
        { ...deck, id: FORK, userId: B, forkedFrom: DECK, origin: "fork" },
      ])
      .run();
    testDb.db
      .insert(reports)
      .values([
        {
          id: "r1",
          userId: B,
          targetType: "deck",
          targetId: DECK,
          reason: "copyright",
        },
        {
          id: "r2",
          userId: A,
          targetType: "deck",
          targetId: FORK,
          reason: "lyrics_error",
        },
      ])
      .run();
  });

  afterEach(() => testDb.sqlite.close());

  it("lists pending reports with the target title", () => {
    const rows = all("LIST_PENDING_REPORTS");
    expect(rows.map((r) => [r.id, r.target_title])).toEqual([
      ["r1", "시선"],
      ["r2", "시선"],
    ]);
  });

  it("takes a deck down, removes it from search and blocks republishing", () => {
    run("TAKEDOWN_DECK", { deck_id: DECK });
    const takenDown = deckState(DECK);
    expect(takenDown?.visibility).toBe("private");
    expect(takenDown?.takedownAt).not.toBeNull();
    expect(
      testDb.db
        .select({ n: count() })
        .from(decksFts)
        .where(eq(decksFts.deckId, DECK))
        .get()?.n,
    ).toBe(0);

    expect(
      all("LIST_PUBLIC_DESCENDANTS", { deck_id: DECK }).map((r) => r.id),
    ).toEqual([FORK]);

    run("RESOLVE_REPORTS_FOR_TARGET", { target_id: DECK, note: "권리자 요청" });
    expect(report("r1")).toEqual({
      status: "resolved",
      resolutionNote: "권리자 요청",
    });

    run("RESTORE_DECK", { deck_id: DECK });
    expect(deckState(DECK)).toEqual({
      visibility: "private",
      takedownAt: null,
    });
  });

  it("resolves or rejects single reports", () => {
    run("REJECT_REPORT", { report_id: "r2", note: "오류 아님" });
    expect(report("r2")?.status).toBe("rejected");
    run("RESOLVE_REPORT", { report_id: "r1", note: "처리" });
    expect(all("LIST_PENDING_REPORTS")).toHaveLength(0);
  });
});
