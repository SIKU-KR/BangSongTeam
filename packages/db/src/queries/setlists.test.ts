import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils";
import { user, decks, setlists, setlistItems } from "../schema";
import {
  createSetlistWithClonedDecks,
  getSetlistWithDecks,
  getSetlistsByUserId,
  deleteSetlist,
} from "./setlists";
import { getMyLibraryDecks } from "./decks";

describe("D1 Setlist Queries & Clone-on-Add Isolation", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  const userAId = "00000000-0000-0000-0000-000000000001";
  const userBId = "00000000-0000-0000-0000-000000000002";

  let sourceDeck1Id: string;
  let sourceDeck2Id: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    db = testDb.db;

    // Seed test users
    await db.insert(user).values([
      {
        id: userAId,
        name: "Worship Leader",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userBId,
        name: "Other User",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    sourceDeck1Id = "deck-song-1";
    sourceDeck2Id = "deck-song-2";

    // Seed library master decks for user A
    await db.insert(decks).values([
      {
        id: sourceDeck1Id,
        userId: userAId,
        scope: "library",
        title: "Song 1: 꽃들도",
        artist: "JWorship",
        lyricsRaw: "이곳에 생명샘 솟아나",
        slides: "[]",
        style: '{"fontFamily":"Pretendard"}',
        visibility: "public",
        forkCount: 5,
      },
      {
        id: sourceDeck2Id,
        userId: userAId,
        scope: "library",
        title: "Song 2: 은혜로다",
        artist: "예수전도단",
        lyricsRaw: "시작됐네 우리 주님의 능력이",
        slides: "[]",
        style: '{"fontFamily":"Noto Sans KR"}',
        visibility: "private",
        forkCount: 0,
      },
    ]);
  });

  describe("createSetlistWithClonedDecks", () => {
    it("should clone decks with scope='setlist' and preserve order", async () => {
      const setlist = await createSetlistWithClonedDecks(db, {
        userId: userAId,
        title: "2026-09-27 주일예배",
        serviceDate: "2026-09-27",
        sourceDeckIds: [sourceDeck2Id, sourceDeck1Id],
      });

      expect(setlist.title).toBe("2026-09-27 주일예배");
      expect(setlist.serviceDate).toBe("2026-09-27");
      expect(setlist.items).toHaveLength(2);

      // Verify order
      expect(setlist.items[0].order).toBe(0);
      expect(setlist.items[0].deck.title).toBe("Song 2: 은혜로다");
      expect(setlist.items[0].deck.scope).toBe("setlist");
      expect(setlist.items[0].deck.setlistId).toBe(setlist.id);
      expect(setlist.items[0].deck.forkedFrom).toBe(sourceDeck2Id);
      expect(setlist.items[0].deck.id).not.toBe(sourceDeck2Id); // Cloned ID

      expect(setlist.items[1].order).toBe(1);
      expect(setlist.items[1].deck.title).toBe("Song 1: 꽃들도");
      expect(setlist.items[1].deck.scope).toBe("setlist");
      expect(setlist.items[1].deck.setlistId).toBe(setlist.id);
      expect(setlist.items[1].deck.forkedFrom).toBe(sourceDeck1Id);

      // Verify Clone-on-Add Isolation: Library still has only 2 master decks
      const libraryDecks = await getMyLibraryDecks(db, userAId);
      expect(libraryDecks).toHaveLength(2);
      expect(libraryDecks.every((d) => d.scope === "library")).toBe(true);
    });

    it("should throw error if any source deck does not exist", async () => {
      await expect(
        createSetlistWithClonedDecks(db, {
          userId: userAId,
          title: "Invalid Setlist",
          serviceDate: "2026-09-27",
          sourceDeckIds: ["non-existent-deck-id"],
        }),
      ).rejects.toThrow(
        "Source deck with id 'non-existent-deck-id' not found.",
      );
    });
  });

  describe("getSetlistWithDecks", () => {
    it("should return setlist with hydrated decks for owner and reject other users", async () => {
      const created = await createSetlistWithClonedDecks(db, {
        userId: userAId,
        title: "찬양팀 콘티",
        serviceDate: "2026-10-04",
        sourceDeckIds: [sourceDeck1Id],
      });

      // Owner lookup
      const found = await getSetlistWithDecks(db, created.id, userAId);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.items).toHaveLength(1);
      expect(found?.items[0].deck.title).toBe("Song 1: 꽃들도");

      // Non-owner lookup (must return null to prevent data leakage)
      const unauthorized = await getSetlistWithDecks(db, created.id, userBId);
      expect(unauthorized).toBeNull();
    });
  });

  describe("getSetlistsByUserId", () => {
    it("should return setlists belonging only to the specified user ordered by date", async () => {
      await createSetlistWithClonedDecks(db, {
        userId: userAId,
        title: "A 1주차",
        serviceDate: "2026-09-06",
        sourceDeckIds: [],
      });
      await createSetlistWithClonedDecks(db, {
        userId: userAId,
        title: "A 2주차",
        serviceDate: "2026-09-13",
        sourceDeckIds: [],
      });
      await createSetlistWithClonedDecks(db, {
        userId: userBId,
        title: "B 콘티",
        serviceDate: "2026-09-20",
        sourceDeckIds: [],
      });

      const userASetlists = await getSetlistsByUserId(db, userAId);
      expect(userASetlists).toHaveLength(2);
      expect(userASetlists[0].serviceDate).toBe("2026-09-13"); // desc
      expect(userASetlists[1].serviceDate).toBe("2026-09-06");
    });
  });

  describe("deleteSetlist", () => {
    it("should delete setlist and cascade-delete cloned decks and setlist_items (no orphans)", async () => {
      const setlist = await createSetlistWithClonedDecks(db, {
        userId: userAId,
        title: "삭제될 콘티",
        serviceDate: "2026-09-27",
        sourceDeckIds: [sourceDeck1Id],
      });

      const clonedDeckId = setlist.items[0].deckId;

      // Ensure cloned deck exists before deletion
      const beforeDeck = await db
        .select()
        .from(decks)
        .where(eq(decks.id, clonedDeckId));
      expect(beforeDeck).toHaveLength(1);

      // Delete setlist
      await deleteSetlist(db, setlist.id, userAId);

      // Verify setlist is gone
      const afterSetlist = await db
        .select()
        .from(setlists)
        .where(eq(setlists.id, setlist.id));
      expect(afterSetlist).toHaveLength(0);

      // Verify setlist_items is cascade deleted
      const afterItems = await db
        .select()
        .from(setlistItems)
        .where(eq(setlistItems.setlistId, setlist.id));
      expect(afterItems).toHaveLength(0);

      // Verify cloned deck is cascade deleted via ON DELETE CASCADE (setlist_id)
      const afterDeck = await db
        .select()
        .from(decks)
        .where(eq(decks.id, clonedDeckId));
      expect(afterDeck).toHaveLength(0);

      // Verify original master deck is completely unaffected
      const masterDeck = await db
        .select()
        .from(decks)
        .where(eq(decks.id, sourceDeck1Id));
      expect(masterDeck).toHaveLength(1);
    });
  });
});
