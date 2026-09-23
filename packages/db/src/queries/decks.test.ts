import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils";
import {
  getMyLibraryDecks,
  getByIdScoped,
  getPublicById,
  upsertLyricVersion,
  upsertDeck,
  deleteDeckScoped,
} from "./decks";
import { user, lyricsCatalog, lyricsVersions, decks } from "../schema";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "@repo/shared";
import { toSharedDeck } from "./mappers";

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

    it("rejects public presentation clones and taken-down decks", async () => {
      await db.insert(decks).values([
        {
          id: "clone-deck",
          userId: userAId,
          scope: "presentation",
          title: "세트 복제본",
          lyricsRaw: "가사",
          slides: "[]",
          style: "{}",
          visibility: "public",
        },
        {
          id: "down-deck",
          userId: userAId,
          title: "게시 중단",
          lyricsRaw: "가사",
          slides: "[]",
          style: "{}",
          visibility: "public",
          takedownAt: new Date(),
        },
      ]);
      expect(await getPublicById(db, "clone-deck")).toBeNull();
      expect(await getPublicById(db, "down-deck")).toBeNull();
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

describe("덱 쓰기 헬퍼 (M3-B 보관함 동기화)", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  const ownerId = "00000000-0000-4000-8000-000000000001";
  const strangerId = "00000000-0000-4000-8000-000000000002";
  const DECK_ID = "c0000000-0000-4000-8000-000000000001";

  function makeDeck(userId: string, overrides: Partial<Deck> = {}): Deck {
    return DeckSchema.parse({
      id: DECK_ID,
      userId,
      catalogId: null,
      scope: "library",
      presentationId: null,
      title: "은혜로다",
      artist: "예수전도단",
      lyricsRaw: "시작됐네",
      slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
      backgroundId: null,
      style: { ...DEFAULT_DECK_STYLE, fontSizeVw: 5.5 },
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-21T00:00:00.000Z",
      ...overrides,
    });
  }

  async function readDeck(id: string): Promise<Deck> {
    const [row] = await db.select().from(decks).where(eq(decks.id, id));
    return toSharedDeck(row);
  }

  beforeEach(async () => {
    db = createTestDb().db;
    await db.insert(user).values([
      {
        id: ownerId,
        name: "주인",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: strangerId,
        name: "남",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  it("새 덱을 삽입하고 슬라이드·스타일을 보존한다", async () => {
    expect(await upsertDeck(db, ownerId, makeDeck(ownerId))).not.toBeNull();

    const saved = await readDeck(DECK_ID);
    expect(saved.title).toBe("은혜로다");
    expect(saved.slides[0].lines).toEqual(["시작됐네"]);
    expect(saved.style.fontSizeVw).toBe(5.5);
  });

  it("같은 id로 다시 저장하면 갱신된다 (중복 삽입 아님)", async () => {
    await upsertDeck(db, ownerId, makeDeck(ownerId));
    await upsertDeck(
      db,
      ownerId,
      makeDeck(ownerId, { title: "은혜로다 (수정)" }),
    );

    const rows = await db.select().from(decks).where(eq(decks.id, DECK_ID));
    expect(rows).toHaveLength(1);
    expect((await readDeck(DECK_ID)).title).toBe("은혜로다 (수정)");
  });

  it("본문의 userId를 믿지 않고 세션 소유자로 강제한다", async () => {
    await upsertDeck(db, ownerId, makeDeck(strangerId));
    expect((await readDeck(DECK_ID)).userId).toBe(ownerId);
  });

  it("남의 덱은 덮어쓰지 못한다", async () => {
    await upsertDeck(db, ownerId, makeDeck(ownerId));

    expect(
      await upsertDeck(db, strangerId, makeDeck(strangerId, { title: "탈취" })),
    ).toBeNull();
    expect((await readDeck(DECK_ID)).title).toBe("은혜로다");
  });

  it("저장된 덱을 돌려준다", async () => {
    const saved = await upsertDeck(db, ownerId, makeDeck(ownerId));
    expect(saved?.id).toBe(DECK_ID);
    expect(saved?.userId).toBe(ownerId);
    expect(saved?.origin).toBe("user");
  });

  describe("서버 소유 공유 필드 (M5)", () => {
    it("새 덱은 클라이언트가 무엇을 보내든 비공개·0회·루트로 저장된다", async () => {
      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, {
          visibility: "public",
          forkCount: 999,
          origin: "catalog",
          forkedFrom: "c0000000-0000-4000-8000-000000000099",
          forkedFromAuthorName: "사칭",
          publishedAt: "2026-09-22T00:00:00.000Z",
        }),
      );
      expect(saved).toMatchObject({
        visibility: "private",
        forkCount: 0,
        origin: "user",
        forkedFrom: null,
        forkedFromAuthorName: null,
        publishedAt: null,
        takedownAt: null,
      });
    });

    it("기존 덱을 갱신해도 서버 값이 유지된다", async () => {
      await upsertDeck(db, ownerId, makeDeck(ownerId));
      const publishedAt = new Date("2026-09-22T00:00:00.000Z");
      await db
        .update(decks)
        .set({
          visibility: "public",
          forkCount: 3,
          origin: "fork",
          forkedFrom: "c0000000-0000-4000-8000-000000000099",
          forkedFromAuthorName: "원작자",
          publishedAt,
        })
        .where(eq(decks.id, DECK_ID));

      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, {
          title: "제목만 바꿈",
          visibility: "private",
          forkCount: 999,
          origin: "user",
          forkedFrom: null,
          publishedAt: null,
        }),
      );
      expect(saved).toMatchObject({
        title: "제목만 바꿈",
        visibility: "public",
        forkCount: 3,
        origin: "fork",
        forkedFrom: "c0000000-0000-4000-8000-000000000099",
        forkedFromAuthorName: "원작자",
        publishedAt: publishedAt.toISOString(),
      });
    });

    it("보관함 경로로 세트 복제본을 만들 수 없다", async () => {
      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, {
          scope: "presentation",
          presentationId: "10000000-0000-4000-8000-000000000001",
        }),
      );
      expect(saved?.scope).toBe("library");
      expect(saved?.presentationId).toBeNull();
    });

    it("기여 여부는 클라이언트가 정한다", async () => {
      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, { contributeToCatalog: true }),
      );
      expect(saved?.contributeToCatalog).toBe(true);
    });

    it("서버가 붙인 카탈로그 연결을 클라이언트의 null이 끊지 않고, 모르는 id는 떨군다", async () => {
      const catalogId = "d0000000-0000-4000-8000-000000000001";
      await db.insert(lyricsCatalog).values({
        id: catalogId,
        title: "은혜로다",
        artist: "예수전도단",
        titleNorm: "은혜로다",
        artistNorm: "예수전도단",
        lyricsCanonical: "시작됐네",
      });
      await upsertDeck(db, ownerId, makeDeck(ownerId, { catalogId }));
      expect(
        (await upsertDeck(db, ownerId, makeDeck(ownerId, { catalogId: null })))
          ?.catalogId,
      ).toBe(catalogId);

      await db.delete(decks);
      expect(
        (
          await upsertDeck(
            db,
            ownerId,
            makeDeck(ownerId, {
              catalogId: "d0000000-0000-4000-8000-00000000dead",
            }),
          )
        )?.catalogId,
      ).toBeNull();
    });
  });

  it("삭제는 소유자에게만 허용된다", async () => {
    await upsertDeck(db, ownerId, makeDeck(ownerId));

    expect(await deleteDeckScoped(db, DECK_ID, strangerId)).toBe(false);
    expect(
      await db.select().from(decks).where(eq(decks.id, DECK_ID)),
    ).toHaveLength(1);

    expect(await deleteDeckScoped(db, DECK_ID, ownerId)).toBe(true);
    expect(
      await db.select().from(decks).where(eq(decks.id, DECK_ID)),
    ).toHaveLength(0);
  });

  it("없는 덱 삭제는 false를 돌린다", async () => {
    expect(await deleteDeckScoped(db, DECK_ID, ownerId)).toBe(false);
  });
});
