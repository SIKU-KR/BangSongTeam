import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { decksCol, reportsCol } from "../collections";
import { searchPublicDecks } from "../queries/search";
import { setDeckVisibility } from "../queries/sharing";
import { createTestDb, deckDoc, seedDocs, userDoc } from "../test/fixtures";
import {
  listPendingReports,
  listPublicDescendants,
  rejectReport,
  resolveReport,
  resolveReportsForTarget,
  restoreDeck,
  takedownDeck,
} from "./moderation";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const DECK = "c00000000000000000001";
const FORK = "c00000000000000000002";

describe("신고·게시 중단 운영 작업", () => {
  let db: Db;

  const deckState = async (id: string) => {
    const deck = (await decksCol(db).doc(id).get()).data();
    return { visibility: deck?.visibility, takedownAt: deck?.takedownAt };
  };
  const report = async (id: string) => {
    const row = (await reportsCol(db).doc(id).get()).data();
    return { status: row?.status, resolutionNote: row?.resolutionNote };
  };

  beforeEach(async () => {
    db = createTestDb();
    const deck = {
      title: "시선",
      visibility: "public",
      publishedAt: new Date(1000),
      slides: JSON.stringify([{ id: "s", order: 0, lines: ["시선"] }]),
    } as const;
    await seedDocs(db, {
      users: [userDoc({ id: A, name: "A" }), userDoc({ id: B, name: "B" })],
      decks: [
        deckDoc({ ...deck, id: DECK, userId: A }),
        deckDoc({
          ...deck,
          id: FORK,
          userId: B,
          forkedFrom: DECK,
          forkedFromAuthorName: "A",
        }),
      ],
    });
    const base = {
      details: null,
      status: "pending" as const,
      resolvedAt: null,
      resolutionNote: null,
    };
    await reportsCol(db)
      .doc("r1")
      .set({
        ...base,
        id: "r1",
        reporterId: B,
        deckId: DECK,
        reason: "copyright",
        createdAt: new Date(0),
      });
    await reportsCol(db)
      .doc("r2")
      .set({
        ...base,
        id: "r2",
        reporterId: A,
        deckId: FORK,
        reason: "lyrics_error",
        createdAt: new Date(1),
      });
  });

  it("lists pending reports with the target title", async () => {
    const rows = await listPendingReports(db);
    expect(rows.map((r) => [r.id, r.targetTitle])).toEqual([
      ["r1", "시선"],
      ["r2", "시선"],
    ]);
  });

  it("takes a deck down, removes it from search and blocks republishing", async () => {
    expect(await takedownDeck(db, DECK)).toBe(true);
    const takenDown = await deckState(DECK);
    expect(takenDown.visibility).toBe("private");
    expect(takenDown.takedownAt).not.toBeNull();
    expect((await searchPublicDecks(db, "시선")).map((d) => d.id)).toEqual([
      FORK,
    ]);
    expect((await setDeckVisibility(db, A, DECK, "public")).status).toBe(
      "taken_down",
    );

    expect((await listPublicDescendants(db, DECK)).map((r) => r.id)).toEqual([
      FORK,
    ]);

    await resolveReportsForTarget(db, DECK, "권리자 요청");
    expect(await report("r1")).toEqual({
      status: "resolved",
      resolutionNote: "권리자 요청",
    });

    await restoreDeck(db, DECK);
    expect(await deckState(DECK)).toEqual({
      visibility: "private",
      takedownAt: null,
    });
    expect((await setDeckVisibility(db, A, DECK, "public")).status).toBe("ok");
  });

  it("resolves or rejects single reports", async () => {
    await rejectReport(db, "r2", "오류 아님");
    expect((await report("r2")).status).toBe("rejected");
    await resolveReport(db, "r1", "처리");
    expect(await listPendingReports(db)).toHaveLength(0);
  });
});
