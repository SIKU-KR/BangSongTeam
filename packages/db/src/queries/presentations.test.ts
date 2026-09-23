import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils";
import { user, decks, presentations, presentationItems } from "../schema";
import {
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  type PresentationDocument,
} from "@repo/shared";
import {
  createPresentationWithClonedDecks,
  getPresentationWithDecks,
  getPresentationsByUserId,
  deletePresentation,
  upsertPresentationDocument,
  updatePresentation,
  getPresentationDocumentsByUserId,
} from "./presentations";
import { getMyLibraryDecks } from "./decks";

describe("D1 Presentation Queries & Clone-on-Add Isolation", () => {
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

  describe("createPresentationWithClonedDecks", () => {
    it("should clone decks with scope='presentation' and preserve order", async () => {
      const presentation = await createPresentationWithClonedDecks(db, {
        userId: userAId,
        title: "2026-09-27 주일예배",
        serviceDate: "2026-09-27",
        sourceDeckIds: [sourceDeck2Id, sourceDeck1Id],
      });

      expect(presentation.title).toBe("2026-09-27 주일예배");
      expect(presentation.serviceDate).toBe("2026-09-27");
      expect(presentation.items).toHaveLength(2);

      // Verify order
      expect(presentation.items[0].order).toBe(0);
      expect(presentation.items[0].deck.title).toBe("Song 2: 은혜로다");
      expect(presentation.items[0].deck.scope).toBe("presentation");
      expect(presentation.items[0].deck.presentationId).toBe(presentation.id);
      expect(presentation.items[0].deck.forkedFrom).toBe(sourceDeck2Id);
      expect(presentation.items[0].deck.id).not.toBe(sourceDeck2Id); // Cloned ID

      expect(presentation.items[1].order).toBe(1);
      expect(presentation.items[1].deck.title).toBe("Song 1: 꽃들도");
      expect(presentation.items[1].deck.scope).toBe("presentation");
      expect(presentation.items[1].deck.presentationId).toBe(presentation.id);
      expect(presentation.items[1].deck.forkedFrom).toBe(sourceDeck1Id);

      // Verify Clone-on-Add Isolation: Library still has only 2 master decks
      const libraryDecks = await getMyLibraryDecks(db, userAId);
      expect(libraryDecks).toHaveLength(2);
      expect(libraryDecks.every((d) => d.scope === "library")).toBe(true);
    });

    it("should throw error if any source deck does not exist", async () => {
      await expect(
        createPresentationWithClonedDecks(db, {
          userId: userAId,
          title: "Invalid Presentation",
          serviceDate: "2026-09-27",
          sourceDeckIds: ["non-existent-deck-id"],
        }),
      ).rejects.toThrow(
        "Source deck with id 'non-existent-deck-id' not found.",
      );
    });
  });

  describe("getPresentationWithDecks", () => {
    it("should return presentation with hydrated decks for owner and reject other users", async () => {
      const created = await createPresentationWithClonedDecks(db, {
        userId: userAId,
        title: "찬양팀 프레젠테이션",
        serviceDate: "2026-10-04",
        sourceDeckIds: [sourceDeck1Id],
      });

      // Owner lookup
      const found = await getPresentationWithDecks(db, created.id, userAId);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.items).toHaveLength(1);
      expect(found?.items[0].deck.title).toBe("Song 1: 꽃들도");

      // Non-owner lookup (must return null to prevent data leakage)
      const unauthorized = await getPresentationWithDecks(
        db,
        created.id,
        userBId,
      );
      expect(unauthorized).toBeNull();
    });
  });

  describe("getPresentationsByUserId", () => {
    it("should return presentations belonging only to the specified user ordered by date", async () => {
      await createPresentationWithClonedDecks(db, {
        userId: userAId,
        title: "A 1주차",
        serviceDate: "2026-09-06",
        sourceDeckIds: [],
      });
      await createPresentationWithClonedDecks(db, {
        userId: userAId,
        title: "A 2주차",
        serviceDate: "2026-09-13",
        sourceDeckIds: [],
      });
      await createPresentationWithClonedDecks(db, {
        userId: userBId,
        title: "B 프레젠테이션",
        serviceDate: "2026-09-20",
        sourceDeckIds: [],
      });

      const userAPresentations = await getPresentationsByUserId(db, userAId);
      expect(userAPresentations).toHaveLength(2);
      expect(userAPresentations[0].serviceDate).toBe("2026-09-13"); // desc
      expect(userAPresentations[1].serviceDate).toBe("2026-09-06");
    });
  });

  describe("deletePresentation", () => {
    it("should delete presentation and cascade-delete cloned decks and presentation_items (no orphans)", async () => {
      const presentation = await createPresentationWithClonedDecks(db, {
        userId: userAId,
        title: "삭제될 프레젠테이션",
        serviceDate: "2026-09-27",
        sourceDeckIds: [sourceDeck1Id],
      });

      const clonedDeckId = presentation.items[0].deckId;

      // Ensure cloned deck exists before deletion
      const beforeDeck = await db
        .select()
        .from(decks)
        .where(eq(decks.id, clonedDeckId));
      expect(beforeDeck).toHaveLength(1);

      // Delete presentation
      await deletePresentation(db, presentation.id, userAId);

      // Verify presentation is gone
      const afterPresentation = await db
        .select()
        .from(presentations)
        .where(eq(presentations.id, presentation.id));
      expect(afterPresentation).toHaveLength(0);

      // Verify presentation_items is cascade deleted
      const afterItems = await db
        .select()
        .from(presentationItems)
        .where(eq(presentationItems.presentationId, presentation.id));
      expect(afterItems).toHaveLength(0);

      // Verify cloned deck is cascade deleted via ON DELETE CASCADE (presentation_id)
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
  describe("문서 단위 업서트 (M3-B 동기화)", () => {
    const DOC_ID = "10000000-0000-4000-8000-000000000001";

    function makeDoc(
      userId: string,
      overrides: Partial<PresentationDocument> = {},
    ): PresentationDocument {
      const deckId = "c0000000-0000-4000-8000-000000000001";
      return PresentationDocumentSchema.parse({
        id: DOC_ID,
        userId,
        title: "주일 1부 예배",
        serviceDate: "2026-09-27",
        items: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            presentationId: DOC_ID,
            deckId,
            order: 0,
            deck: {
              id: deckId,
              userId,
              scope: "presentation",
              presentationId: DOC_ID,
              title: "은혜로다",
              artist: "예수전도단",
              lyricsRaw: "시작됐네",
              slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
              backgroundId: null,
              style: { ...DEFAULT_DECK_STYLE, overlayOpacity: 70 },
              visibility: "private",
              forkedFrom: null,
              forkCount: 0,
              createdAt: "2026-09-20T00:00:00.000Z",
              updatedAt: "2026-09-21T00:00:00.000Z",
            },
          },
        ],
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
        ...overrides,
      });
    }

    it("저장한 문서를 곡·스타일까지 그대로 되읽는다", async () => {
      expect(
        await upsertPresentationDocument(db, userAId, makeDoc(userAId)),
      ).toBe(true);

      const [restored] = await getPresentationDocumentsByUserId(db, userAId);
      expect(restored.title).toBe("주일 1부 예배");
      expect(restored.items).toHaveLength(1);
      expect(restored.items[0].deck.title).toBe("은혜로다");
      expect(restored.items[0].deck.style.overlayOpacity).toBe(70);
      expect(restored.items[0].deck.slides[0].lines).toEqual(["시작됐네"]);
    });

    it("클라이언트가 만든 id를 그대로 보존한다", async () => {
      // id가 기기마다 새로 생기면 동기화가 병합이 아니라 중복 생성이 된다.
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));
      const [restored] = await getPresentationDocumentsByUserId(db, userAId);

      expect(restored.id).toBe(DOC_ID);
      expect(restored.items[0].deck.id).toBe(
        "c0000000-0000-4000-8000-000000000001",
      );
    });

    it("두 번 저장해도 문서가 중복되지 않는다 (멱등)", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));

      expect(await getPresentationDocumentsByUserId(db, userAId)).toHaveLength(
        1,
      );
    });

    it("곡을 지운 문서로 덮어쓰면 서버에서도 사라진다", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));
      await upsertPresentationDocument(
        db,
        userAId,
        makeDoc(userAId, { items: [] }),
      );

      const [restored] = await getPresentationDocumentsByUserId(db, userAId);
      expect(restored.items).toHaveLength(0);

      // 고아 덱이 남으면 다음 조회에서 되살아난다.
      const orphans = await db
        .select()
        .from(decks)
        .where(eq(decks.presentationId, DOC_ID));
      expect(orphans).toHaveLength(0);
    });

    it("본문의 userId를 믿지 않고 세션 소유자로 강제한다", async () => {
      // 남의 계정으로 문서를 심는 경로를 막는다.
      await upsertPresentationDocument(
        db,
        userAId,
        makeDoc(userBId, { userId: userBId }),
      );

      expect(await getPresentationDocumentsByUserId(db, userBId)).toHaveLength(
        0,
      );
      const [mine] = await getPresentationDocumentsByUserId(db, userAId);
      expect(mine.userId).toBe(userAId);
    });

    it("남의 문서는 덮어쓰지 못한다", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));

      const hijacked = await upsertPresentationDocument(
        db,
        userBId,
        makeDoc(userBId, { title: "탈취" }),
      );

      expect(hijacked).toBe(false);
      const [mine] = await getPresentationDocumentsByUserId(db, userAId);
      expect(mine.title).toBe("주일 1부 예배");
    });

    it("빈 저장소에서 목록은 빈 배열이다 (에러 아님)", async () => {
      expect(await getPresentationDocumentsByUserId(db, userAId)).toEqual([]);
    });

    it("제목·예배일 수정은 소유자에게만 허용된다", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));

      expect(
        await updatePresentation(db, DOC_ID, userBId, { title: "탈취" }),
      ).toBe(false);
      expect(
        await updatePresentation(db, DOC_ID, userAId, {
          title: "주일 2부 예배",
        }),
      ).toBe(true);

      const [updated] = await getPresentationDocumentsByUserId(db, userAId);
      expect(updated.title).toBe("주일 2부 예배");
    });
  });

  describe("복제 원본 소유권 검증", () => {
    it("남의 비공개 덱은 복제하지 못한다", async () => {
      // 예전에는 id만 알면 남의 비공개 덱을 복제할 수 있었다 (D1에 RLS가 없다).
      // sourceDeck2는 userA 소유의 private 덱이다.
      await expect(
        createPresentationWithClonedDecks(db, {
          userId: userBId,
          title: "가로채기",
          serviceDate: "2026-09-27",
          sourceDeckIds: [sourceDeck2Id],
        }),
      ).rejects.toThrow();
    });

    it("공개 덱은 다른 사용자도 복제할 수 있다", async () => {
      // sourceDeck1은 시드에서 이미 public이다.
      const created = await createPresentationWithClonedDecks(db, {
        userId: userBId,
        title: "공개 덱 포크",
        serviceDate: "2026-09-27",
        sourceDeckIds: [sourceDeck1Id],
      });

      expect(created.items).toHaveLength(1);
      expect(created.items[0].deck.userId).toBe(userBId);
      expect(created.items[0].deck.visibility).toBe("private");
    });
  });
});
