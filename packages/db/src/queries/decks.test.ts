import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils";
import {
  sanitizeFts5Query,
  getMyLibraryDecks,
  getByIdScoped,
  getPublicById,
  searchPublicDecks,
  upsertLyricVersion,
} from "./decks";
import { user, lyricsCatalog, lyricsVersions, decks } from "../schema";

describe("FTS5 Query Sanitizer (sanitizeFts5Query)", () => {
  it("should wrap alphanumeric and Korean words in double quotes", () => {
    expect(sanitizeFts5Query("은혜로운 찬양")).toBe('"은혜로운" "찬양"');
    expect(sanitizeFts5Query("Lord I Lift")).toBe('"Lord" "I" "Lift"');
    expect(sanitizeFts5Query("10000 Reasons")).toBe('"10000" "Reasons"');
  });

  it("should strip special characters, FTS5 syntax operators, and injection attempts", () => {
    expect(sanitizeFts5Query('은혜* AND OR NOT "찬양"')).toBe(
      '"은혜" "AND" "OR" "NOT" "찬양"',
    );
    expect(sanitizeFts5Query("찬양 (곡: 1) ^ $ @ # !")).toBe('"찬양" "곡" "1"');
  });

  it("should return empty string for empty or whitespace-only inputs", () => {
    expect(sanitizeFts5Query("")).toBe("");
    expect(sanitizeFts5Query("   ")).toBe("");
    expect(sanitizeFts5Query("!@#$%^&*()")).toBe("");
  });
});

describe("D1 Scoped Deck Queries", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  const userAId = "00000000-0000-0000-0000-000000000001";
  const userBId = "00000000-0000-0000-0000-000000000002";
  const catalogId = "10000000-0000-0000-0000-000000000001";

  beforeEach(async () => {
    const testDb = createTestDb();
    db = testDb.db;

    // Seed test users
    await db.insert(user).values([
      {
        id: userAId,
        name: "User A",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userBId,
        name: "User B",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Seed catalog
    await db.insert(lyricsCatalog).values({
      id: catalogId,
      title: "은혜로다",
      artist: "예수전도단",
      titleNorm: "은혜로다",
      artistNorm: "예수전도단",
      lyricsCanonical: "시작됐네 우리 주님의 능력이",
      versionCount: 1,
      status: "single",
    });
  });

  describe("getMyLibraryDecks", () => {
    it("should return only library decks belonging to the user", async () => {
      // User A master library deck
      await db.insert(decks).values({
        id: "d1",
        userId: userAId,
        scope: "library",
        title: "User A Deck 1",
        lyricsRaw: "가사",
        slides: "[]",
        style: "{}",
        visibility: "private",
      });

      // User A presentation cloned deck (must be excluded from library view)
      await db.insert(decks).values({
        id: "d2",
        userId: userAId,
        scope: "presentation",
        title: "User A Presentation Deck",
        lyricsRaw: "가사",
        slides: "[]",
        style: "{}",
        visibility: "private",
      });

      // User B library deck
      await db.insert(decks).values({
        id: "d3",
        userId: userBId,
        scope: "library",
        title: "User B Deck",
        lyricsRaw: "가사",
        slides: "[]",
        style: "{}",
        visibility: "private",
      });

      const userADecks = await getMyLibraryDecks(db, userAId);
      expect(userADecks).toHaveLength(1);
      expect(userADecks[0].id).toBe("d1");
      expect(userADecks[0].scope).toBe("library");
    });
  });

  describe("getByIdScoped", () => {
    it("should return deck only when userId matches", async () => {
      await db.insert(decks).values({
        id: "d-scoped",
        userId: userAId,
        title: "Private Deck",
        lyricsRaw: "가사",
        slides: "[]",
        style: "{}",
        visibility: "private",
      });

      const found = await getByIdScoped(db, "d-scoped", userAId);
      expect(found).not.toBeNull();
      expect(found?.id).toBe("d-scoped");

      const notFound = await getByIdScoped(db, "d-scoped", userBId);
      expect(notFound).toBeNull();
    });
  });

  describe("getPublicById", () => {
    it("should return public deck and reject private deck", async () => {
      await db.insert(decks).values([
        {
          id: "pub-deck",
          userId: userAId,
          title: "Public Deck",
          lyricsRaw: "가사",
          slides: "[]",
          style: "{}",
          visibility: "public",
        },
        {
          id: "priv-deck",
          userId: userAId,
          title: "Private Deck",
          lyricsRaw: "가사",
          slides: "[]",
          style: "{}",
          visibility: "private",
        },
      ]);

      const pubResult = await getPublicById(db, "pub-deck");
      expect(pubResult).not.toBeNull();
      expect(pubResult?.id).toBe("pub-deck");

      const privResult = await getPublicById(db, "priv-deck");
      expect(privResult).toBeNull();
    });
  });

  describe("searchPublicDecks", () => {
    beforeEach(async () => {
      await db.insert(decks).values([
        {
          id: "s1",
          userId: userAId,
          title: "은혜로운 주의 사랑",
          artist: "어노인팅",
          lyricsRaw: "가사 1",
          slides: "[]",
          style: "{}",
          visibility: "public",
          forkCount: 10,
        },
        {
          id: "s2",
          userId: userAId,
          title: "주의 은혜로",
          artist: "마커스",
          lyricsRaw: "가사 2",
          slides: "[]",
          style: "{}",
          visibility: "public",
          forkCount: 50,
        },
        {
          id: "s3",
          userId: userAId,
          title: "은혜 비공개곡",
          artist: "비공개",
          lyricsRaw: "가사 3",
          slides: "[]",
          style: "{}",
          visibility: "private",
          forkCount: 99,
        },
        {
          id: "s4",
          userId: userAId,
          title: "꽃들도",
          artist: "JWorship",
          lyricsRaw: "가사 4",
          slides: "[]",
          style: "{}",
          visibility: "public",
          forkCount: 20,
        },
      ]);
    });

    it("should search using FTS5 Trigram MATCH when query length >= 3", async () => {
      const results = await searchPublicDecks(db, "은혜로운");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("s1");
    });

    it("should search using LIKE fallback when query length <= 2", async () => {
      const results = await searchPublicDecks(db, "은혜");
      expect(results).toHaveLength(2);
      // Sorted by forkCount desc
      expect(results[0].id).toBe("s2"); // forkCount: 50
      expect(results[1].id).toBe("s1"); // forkCount: 10
      // Must not include s3 (private)
      expect(results.some((r) => r.id === "s3")).toBe(false);
    });

    it("should return empty array for empty query", async () => {
      expect(await searchPublicDecks(db, "")).toEqual([]);
      expect(await searchPublicDecks(db, "   ")).toEqual([]);
    });
  });

  describe("upsertLyricVersion", () => {
    it("should idempotently insert and update a user lyric version (1 person 1 vote)", async () => {
      await upsertLyricVersion(db, {
        catalogId,
        userId: userAId,
        deckId: "deck-1",
        lyrics: "초기 가사 버전",
      });

      // Upsert again with revised lyrics
      await upsertLyricVersion(db, {
        catalogId,
        userId: userAId,
        deckId: "deck-2",
        lyrics: "수정된 가사 버전",
      });

      const versions = await db
        .select()
        .from(lyricsVersions)
        .where(eq(lyricsVersions.userId, userAId));

      expect(versions).toHaveLength(1);
      expect(versions[0].lyrics).toBe("수정된 가사 버전");
      expect(versions[0].deckId).toBe("deck-2");
    });
  });
});
