import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils";
import { user, decks, presentations, presentationItems } from "../schema";
import {
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  type PresentationDocument,
} from "#shared";
import {
  deletePresentation,
  upsertPresentationDocument,
  getPresentationDocumentsByUserId,
} from "./presentations";

const DOC_ID = "100000000000000000001";

function makeDoc(
  userId: string,
  overrides: Partial<PresentationDocument> = {},
): PresentationDocument {
  const deckId = "c00000000000000000001";
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: [
      {
        id: "300000000000000000001",
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

describe("프레젠테이션 쿼리", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  const userAId = "000000000000000000001";
  const userBId = "000000000000000000002";

  beforeEach(async () => {
    const testDb = createTestDb();
    db = testDb.db;

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
  });

  describe("deletePresentation", () => {
    it("should delete presentation and cascade-delete cloned decks and presentation_items (no orphans)", async () => {
      await db.insert(decks).values({
        id: "deck-song-1",
        userId: userAId,
        scope: "library",
        title: "Song 1: 꽃들도",
        lyricsRaw: "이곳에 생명샘 솟아나",
        slides: "[]",
        style: "{}",
        visibility: "public",
      });
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));
      const clonedDeckId = "c00000000000000000001";

      expect(
        await db.select().from(decks).where(eq(decks.id, clonedDeckId)),
      ).toHaveLength(1);

      await deletePresentation(db, DOC_ID, userAId);

      expect(
        await db
          .select()
          .from(presentations)
          .where(eq(presentations.id, DOC_ID)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(presentationItems)
          .where(eq(presentationItems.presentationId, DOC_ID)),
      ).toHaveLength(0);
      expect(
        await db.select().from(decks).where(eq(decks.id, clonedDeckId)),
      ).toHaveLength(0);
      expect(
        await db.select().from(decks).where(eq(decks.id, "deck-song-1")),
      ).toHaveLength(1);
    });
  });

  describe("문서 단위 업서트 (동기화)", () => {
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
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));
      const [restored] = await getPresentationDocumentsByUserId(db, userAId);

      expect(restored.id).toBe(DOC_ID);
      expect(restored.items[0].deck.id).toBe("c00000000000000000001");
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

      const orphans = await db
        .select()
        .from(decks)
        .where(eq(decks.presentationId, DOC_ID));
      expect(orphans).toHaveLength(0);
    });

    it("본문의 userId를 믿지 않고 세션 소유자로 강제한다", async () => {
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
  });
});
