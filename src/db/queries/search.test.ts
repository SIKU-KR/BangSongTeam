import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbResult } from "../test-utils";
import {
  backgrounds,
  decks,
  decksFts,
  user,
  type NewBackground,
  type NewDeck,
} from "../schema";
import { planSearch, sanitizeFts5Query, searchPublicDecks } from "./search";

const USER_A = "00000000x000000000001";
const USER_B = "00000000x000000000002";

function deckRow(overrides: Partial<NewDeck> & { id: string }): NewDeck {
  return {
    userId: USER_A,
    title: "제목",
    artist: "",
    lyricsRaw: "가사",
    slides: "[]",
    style: "{}",
    visibility: "public",
    scope: "library",
    ...overrides,
  };
}

describe("sanitizeFts5Query", () => {
  it("wraps words in double quotes", () => {
    expect(sanitizeFts5Query("은혜로운 찬양")).toBe('"은혜로운" "찬양"');
    expect(sanitizeFts5Query("10000 Reasons")).toBe('"10000" "Reasons"');
  });

  it("strips FTS5 operators and injection attempts", () => {
    expect(sanitizeFts5Query('은혜* AND OR NOT "찬양"')).toBe(
      '"은혜" "AND" "OR" "NOT" "찬양"',
    );
    expect(sanitizeFts5Query("찬양 (곡: 1) ^ $ @ # !")).toBe('"찬양" "곡" "1"');
    expect(sanitizeFts5Query("!@#$%^&*()")).toBe("");
  });
});

describe("planSearch", () => {
  it("browses by popularity for an empty query", () => {
    expect(planSearch("")).toEqual({ kind: "browse" });
    expect(planSearch("   ")).toEqual({ kind: "browse" });
  });

  it("returns nothing when only symbols remain", () => {
    expect(planSearch("%%")).toEqual({ kind: "nothing" });
    expect(planSearch('"*"')).toEqual({ kind: "nothing" });
  });

  it("sends 3+ character tokens to MATCH (FTS5 trigram)", () => {
    expect(planSearch("은혜로운")).toEqual({
      kind: "search",
      match: '"은혜로운"',
      likePatterns: [],
    });
  });

  it("sends ≤2 character tokens to LIKE", () => {
    expect(planSearch("은혜")).toEqual({
      kind: "search",
      match: null,
      likePatterns: ["%은혜%"],
    });
  });

  it("splits mixed queries by token instead of by total length", () => {
    expect(planSearch("주 은혜로")).toEqual({
      kind: "search",
      match: '"은혜로"',
      likePatterns: ["%주%"],
    });
  });
});

describe("searchPublicDecks", () => {
  let testDb: TestDbResult;
  let db: TestDbResult["db"];

  beforeEach(async () => {
    testDb = createTestDb();
    db = testDb.db;
    await db.insert(user).values([
      {
        id: USER_A,
        name: "김찬양",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: USER_B,
        name: "이예배",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await db.insert(decks).values([
      deckRow({
        id: "s1",
        title: "은혜로운 주의 사랑",
        artist: "어노인팅",
        forkCount: 10,
      }),
      deckRow({
        id: "s2",
        title: "주의 은혜로",
        artist: "마커스",
        forkCount: 50,
        userId: USER_B,
      }),
      deckRow({
        id: "s3",
        title: "은혜 비공개곡",
        visibility: "private",
        forkCount: 99,
      }),
      deckRow({
        id: "s4",
        title: "꽃들도",
        artist: "JWorship",
        forkCount: 20,
        lyricsRaw: "이 곳에 오셔서 은혜를 베푸소서",
      }),
      deckRow({
        id: "s5",
        title: "은혜 세트 복제본",
        scope: "presentation",
        forkCount: 80,
      }),
      deckRow({
        id: "s6",
        title: "은혜 게시 중단",
        forkCount: 70,
        takedownAt: new Date(),
      }),
    ]);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("uses FTS5 MATCH for queries of 3+ characters", async () => {
    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual(["s1"]);
  });

  it("uses LIKE for short queries, sorted by fork count", async () => {
    expect(ids(await searchPublicDecks(db, "은혜"))).toEqual([
      "s2",
      "s4",
      "s1",
    ]);
  });

  it("searches lyrics as well as title and artist", async () => {
    expect(ids(await searchPublicDecks(db, "베푸소서"))).toEqual(["s4"]);
  });

  it("ANDs MATCH and LIKE tokens", async () => {
    expect(ids(await searchPublicDecks(db, "주의 마커스"))).toEqual(["s2"]);
    expect(ids(await searchPublicDecks(db, "사랑 마커스"))).toEqual([]);
  });

  it("never returns private decks, presentation clones or taken-down decks", async () => {
    const all = ids(await searchPublicDecks(db, ""));
    for (const hidden of ["s3", "s5", "s6"]) {
      expect(all).not.toContain(hidden);
      expect(ids(await searchPublicDecks(db, "은혜"))).not.toContain(hidden);
      expect(ids(await searchPublicDecks(db, "은혜로운"))).not.toContain(
        hidden,
      );
    }
  });

  it("browses public decks by popularity on an empty query", async () => {
    expect(ids(await searchPublicDecks(db, ""))).toEqual(["s2", "s4", "s1"]);
    expect(ids(await searchPublicDecks(db, "", 1))).toEqual(["s2"]);
  });

  it("returns the author's display name", async () => {
    const [row] = await searchPublicDecks(db, "마커스");
    expect(row.authorName).toBe("이예배");
  });

  it("treats wildcard and FTS syntax as literals", async () => {
    expect(await searchPublicDecks(db, "%")).toEqual([]);
    expect(await searchPublicDecks(db, "_")).toEqual([]);
    expect(await searchPublicDecks(db, '" OR 1=1 --')).toEqual([]);
    expect(ids(await searchPublicDecks(db, "은혜* (")).sort()).toEqual([
      "s1",
      "s2",
      "s4",
    ]);
  });

  it("follows visibility changes through the FTS triggers", async () => {
    await db
      .update(decks)
      .set({ visibility: "private" })
      .where(eq(decks.id, "s1"));
    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual([]);

    await db
      .update(decks)
      .set({ visibility: "public" })
      .where(eq(decks.id, "s1"));
    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual(["s1"]);

    await db
      .update(decks)
      .set({ title: "새 제목입니다" })
      .where(eq(decks.id, "s1"));
    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual([]);
    expect(ids(await searchPublicDecks(db, "새 제목입니다"))).toEqual(["s1"]);

    await db.delete(decks).where(eq(decks.id, "s1"));
    expect(ids(await searchPublicDecks(db, "새 제목입니다"))).toEqual([]);
  });

  it("reads only the card columns in a single query", async () => {
    const prepare = vi.spyOn(testDb.sqlite, "prepare");

    await searchPublicDecks(db, "은혜로운");

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).not.toMatch(/"lyrics_raw"|"style"/);
  });

  it("builds the card from the lowest-order slide", async () => {
    await db
      .update(decks)
      .set({
        slides: JSON.stringify([
          { id: "b", order: 1, lines: ["둘째"] },
          { id: "a", order: 0, lines: ["첫째 줄", "첫째 둘째 줄"] },
          { id: "c", order: 2, lines: ["셋째"] },
        ]),
      })
      .where(eq(decks.id, "s1"));

    const [card] = await searchPublicDecks(db, "은혜로운");

    expect(card).toMatchObject({
      id: "s1",
      title: "은혜로운 주의 사랑",
      artist: "어노인팅",
      authorName: "김찬양",
      forkCount: 10,
      firstSlidePreview: ["첫째 줄", "첫째 둘째 줄"],
      slideCount: 3,
    });
    expect(card).not.toHaveProperty("lyricsRaw");
  });

  it("returns an empty preview for empty or malformed slides", async () => {
    await db
      .update(decks)
      .set({ slides: "not json" })
      .where(eq(decks.id, "s2"));

    const cards = await searchPublicDecks(db, "");

    for (const card of cards) {
      expect(card.firstSlidePreview).toEqual([]);
      expect(card.slideCount).toBe(0);
    }
  });

  it("keeps only service backgrounds on the card", async () => {
    const background = (
      id: string,
      source: NewBackground["source"],
    ): NewBackground => ({
      id,
      title: id,
      r2Key: `${id}.mp4`,
      posterKey: `${id}.jpg`,
      durationSec: 10,
      license: "CC0",
      tags: "[]",
      source,
    });
    await db
      .insert(backgrounds)
      .values([background("svc", "service"), background("upl", "user")]);
    for (const [deckId, backgroundId] of [
      ["s1", "svc"],
      ["s2", "upl"],
    ]) {
      await db.update(decks).set({ backgroundId }).where(eq(decks.id, deckId));
    }

    const cards = await searchPublicDecks(db, "");

    expect(
      Object.fromEntries(cards.map((card) => [card.id, card.backgroundId])),
    ).toEqual({ s1: "svc", s2: null, s4: null });
  });

  it("does not index presentation clones via the FTS triggers", async () => {
    const rows = await db
      .select({ deckId: decksFts.deckId })
      .from(decksFts)
      .orderBy(decksFts.deckId);
    expect(rows.map((r) => r.deckId)).toEqual(["s1", "s2", "s4"]);
  });
});
