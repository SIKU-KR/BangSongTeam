import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbResult } from "../test-utils";
import { decks, user, type NewDeck } from "../schema";
import {
  forkPublicDeck,
  getPublicDeckDetail,
  setDeckVisibility,
  toPublicDeckSummary,
} from "./sharing";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const DECK = "c0000000-0000-4000-8000-000000000001";

const SLIDES = JSON.stringify([
  { id: "s2", order: 1, lines: ["둘째 슬라이드"] },
  { id: "s1", order: 0, lines: ["첫 줄", "둘째 줄"] },
]);

function row(overrides: Partial<NewDeck> = {}): NewDeck {
  return {
    id: DECK,
    userId: A,
    scope: "library",
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: "첫 줄\n둘째 줄\n\n둘째 슬라이드",
    slides: SLIDES,
    style: "{}",
    ...overrides,
  };
}

describe("공유 쿼리 헬퍼", () => {
  let testDb: TestDbResult;
  let db: TestDbResult["db"];

  beforeEach(async () => {
    testDb = createTestDb();
    db = testDb.db;
    await db.insert(user).values([
      { id: A, name: "김찬양", createdAt: new Date(), updatedAt: new Date() },
      { id: B, name: "이예배", createdAt: new Date(), updatedAt: new Date() },
    ]);
  });

  afterEach(() => testDb.sqlite.close());

  async function readRow(id: string) {
    const [r] = await db.select().from(decks).where(eq(decks.id, id));
    return r;
  }

  describe("toPublicDeckSummary", () => {
    it("keeps only the first slide and never the owner id", async () => {
      await db.insert(decks).values(row());
      const summary = toPublicDeckSummary(await readRow(DECK), "김찬양");
      expect(summary.firstSlidePreview).toEqual(["첫 줄", "둘째 줄"]);
      expect(summary.slideCount).toBe(2);
      expect(summary.authorName).toBe("김찬양");
      expect(summary).not.toHaveProperty("userId");
      expect(summary).not.toHaveProperty("lyricsRaw");
    });
  });

  describe("setDeckVisibility", () => {
    beforeEach(async () => {
      await db.insert(decks).values(row());
    });

    it("publishes my library deck and records the consent time", async () => {
      const result = await setDeckVisibility(db, A, DECK, "public");
      expect(result.status).toBe("ok");
      const saved = await readRow(DECK);
      expect(saved.visibility).toBe("public");
      expect(saved.publishedAt).toBeInstanceOf(Date);
    });

    it("goes back to private", async () => {
      await setDeckVisibility(db, A, DECK, "public");
      await setDeckVisibility(db, A, DECK, "private");
      expect((await readRow(DECK)).visibility).toBe("private");
    });

    it("treats someone else's deck as not found", async () => {
      expect((await setDeckVisibility(db, B, DECK, "public")).status).toBe(
        "not_found",
      );
      expect((await readRow(DECK)).visibility).toBe("private");
    });

    it("refuses presentation clones, taken-down decks and empty decks", async () => {
      await db
        .insert(decks)
        .values([
          row({ id: "clone", scope: "presentation" }),
          row({ id: "down", takedownAt: new Date() }),
          row({ id: "empty", slides: "[]" }),
        ]);
      expect((await setDeckVisibility(db, A, "clone", "public")).status).toBe(
        "not_library",
      );
      expect((await setDeckVisibility(db, A, "down", "public")).status).toBe(
        "taken_down",
      );
      expect((await setDeckVisibility(db, A, "empty", "public")).status).toBe(
        "empty",
      );
      // 게시 중단된 덱도 비공개로 돌리는 것은 된다
      expect((await setDeckVisibility(db, A, "down", "private")).status).toBe(
        "ok",
      );
    });
  });

  describe("getPublicDeckDetail", () => {
    it("returns full lyrics for public decks only", async () => {
      await db.insert(decks).values(row());
      expect(await getPublicDeckDetail(db, DECK)).toBeNull();

      await setDeckVisibility(db, A, DECK, "public");
      const detail = await getPublicDeckDetail(db, DECK);
      expect(detail?.lyricsRaw).toContain("둘째 슬라이드");
      expect(detail?.slides).toHaveLength(2);
      expect(detail?.authorName).toBe("김찬양");
    });
  });

  describe("forkPublicDeck", () => {
    beforeEach(async () => {
      await db.insert(decks).values(row({ visibility: "public" }));
    });

    it("creates a private fork in my library and bumps the fork count once", async () => {
      const result = await forkPublicDeck(db, B, DECK);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.alreadyOwned).toBe(false);
      expect(result.deck).toMatchObject({
        userId: B,
        scope: "library",
        visibility: "private",
        forkedFrom: DECK,
        forkedFromAuthorName: "김찬양",
        forkCount: 0,
        origin: "fork",
        title: "은혜로다",
      });
      expect(result.deck.id).not.toBe(DECK);
      expect(result.deck.slides).toHaveLength(2);
      expect((await readRow(DECK)).forkCount).toBe(1);
    });

    it("is idempotent: a second fork returns the first and does not count again", async () => {
      const first = await forkPublicDeck(db, B, DECK);
      const second = await forkPublicDeck(db, B, DECK);
      if (first.status !== "ok" || second.status !== "ok") throw new Error();
      expect(second.alreadyOwned).toBe(true);
      expect(second.deck.id).toBe(first.deck.id);
      expect((await readRow(DECK)).forkCount).toBe(1);
    });

    it("returns my own deck instead of forking it", async () => {
      const result = await forkPublicDeck(db, A, DECK);
      if (result.status !== "ok") throw new Error();
      expect(result.alreadyOwned).toBe(true);
      expect(result.deck.id).toBe(DECK);
      expect((await readRow(DECK)).forkCount).toBe(0);
    });

    it("cannot fork private, taken-down or unknown decks", async () => {
      await db
        .insert(decks)
        .values([
          row({ id: "priv" }),
          row({ id: "down", visibility: "public", takedownAt: new Date() }),
        ]);
      for (const id of ["priv", "down", "nope"]) {
        expect((await forkPublicDeck(db, B, id)).status).toBe("not_found");
      }
    });

    it("keeps the fork when the original goes private or is deleted", async () => {
      const result = await forkPublicDeck(db, B, DECK);
      if (result.status !== "ok") throw new Error();
      await db.delete(decks).where(eq(decks.id, DECK));
      expect((await readRow(result.deck.id)).forkedFromAuthorName).toBe(
        "김찬양",
      );
    });
  });
});
