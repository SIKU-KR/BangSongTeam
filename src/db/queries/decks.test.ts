import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { decksCol } from "../collections";
import { withDeckIndex } from "../deckIndex";
import {
  backgroundDoc,
  createTestDb,
  deckDoc,
  presentationDoc,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import { getMyLibraryDecks, upsertDeck, deleteDeckScoped } from "./decks";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "#shared";
import { toSharedDeck } from "./mappers";

describe("Scoped Deck Queries", () => {
  let db: Db;

  const userAId = "000000000000000000001";
  const userBId = "000000000000000000002";

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: userAId, name: "User A" }),
        userDoc({ id: userBId, name: "User B" }),
      ],
    });
  });

  describe("getMyLibraryDecks", () => {
    it("should return only library decks belonging to the user", async () => {
      await seedDocs(db, {
        presentations: [presentationDoc({ id: "p1", userId: userAId })],
        decks: [
          deckDoc({ id: "d1", userId: userAId, title: "User A Deck 1" }),
          deckDoc({
            id: "d2",
            userId: userAId,
            presentationId: "p1",
            itemId: "i2",
            position: 0,
          }),
          deckDoc({ id: "d3", userId: userBId, title: "User B Deck" }),
        ],
      });

      const userADecks = await getMyLibraryDecks(db, userAId);
      expect(userADecks).toHaveLength(1);
      expect(userADecks[0].id).toBe("d1");
      expect(userADecks[0].presentationId).toBeNull();
    });
  });
});

describe("덱 쓰기 헬퍼 (보관함 동기화)", () => {
  let db: Db;

  const ownerId = "00000000x000000000001";
  const strangerId = "00000000x000000000002";
  const DECK_ID = "c00000000000000000001";

  function makeDeck(userId: string, overrides: Partial<Deck> = {}): Deck {
    return DeckSchema.parse({
      id: DECK_ID,
      userId,
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
    const row = (await decksCol(db).doc(id).get()).data();
    if (!row) throw new Error(`no deck ${id}`);
    return toSharedDeck(row);
  }

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: ownerId, name: "주인" }),
        userDoc({ id: strangerId, name: "남" }),
      ],
    });
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

    const rows = await decksCol(db).where("userId", "==", ownerId).get();
    expect(rows.size).toBe(1);
    expect((await readDeck(DECK_ID)).title).toBe("은혜로다 (수정)");
  });

  it("본문의 userId가 세션 사용자와 다르면 쓰지 않는다", async () => {
    expect(await upsertDeck(db, ownerId, makeDeck(strangerId))).toBeNull();
    expect((await decksCol(db).doc(DECK_ID).get()).exists).toBe(false);
  });

  it("남의 덱은 덮어쓰지 못한다", async () => {
    await upsertDeck(db, ownerId, makeDeck(ownerId));

    expect(
      await upsertDeck(db, strangerId, makeDeck(strangerId, { title: "탈취" })),
    ).toBeNull();
    expect((await readDeck(DECK_ID)).title).toBe("은혜로다");
  });

  describe("모르는 배경", () => {
    const KNOWN = "svc000000000000000001";
    const UNKNOWN = "gone00000000000000001";

    beforeEach(async () => {
      await seedDocs(db, {
        backgrounds: [backgroundDoc({ id: KNOWN, title: "구름" })],
      });
    });

    it("있는 배경은 그대로 저장한다", async () => {
      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, { backgroundId: KNOWN }),
      );
      expect(saved?.backgroundId).toBe(KNOWN);
    });

    it("새 덱의 모르는 배경은 배경 없음으로 저장한다", async () => {
      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, { backgroundId: UNKNOWN }),
      );
      expect(saved?.title).toBe("은혜로다");
      expect(saved?.backgroundId).toBeNull();
    });

    it("기존 덱을 모르는 배경으로 갱신하면 배경 없음으로 저장한다", async () => {
      await upsertDeck(db, ownerId, makeDeck(ownerId, { backgroundId: KNOWN }));
      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, { title: "은혜로다 (수정)", backgroundId: UNKNOWN }),
      );
      expect(saved?.title).toBe("은혜로다 (수정)");
      expect(saved?.backgroundId).toBeNull();
    });
  });

  it("저장된 덱을 돌려준다", async () => {
    const saved = await upsertDeck(db, ownerId, makeDeck(ownerId));
    expect(saved?.id).toBe(DECK_ID);
    expect(saved?.userId).toBe(ownerId);
    expect(saved?.origin).toBe("user");
  });

  describe("서버 소유 공유 필드", () => {
    it("새 덱은 클라이언트가 무엇을 보내든 비공개·0회·직접 만든 곡으로 저장된다", async () => {
      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, {
          visibility: "public",
          forkCount: 999,
          origin: "fork",
          forkedFrom: "c00000000000000000099",
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
      await seedDocs(db, {
        decks: [deckDoc({ id: "c00000000000000000099", userId: strangerId })],
      });
      await upsertDeck(db, ownerId, makeDeck(ownerId));
      const publishedAt = new Date("2026-09-22T00:00:00.000Z");
      const stored = (await decksCol(db).doc(DECK_ID).get()).data()!;
      await decksCol(db)
        .doc(DECK_ID)
        .set(
          withDeckIndex({
            ...stored,
            visibility: "public",
            forkedFrom: "c00000000000000000099",
            forkedFromAuthorName: "원작자",
            publishedAt,
          }),
        );

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
        forkCount: 0,
        origin: "fork",
        forkedFrom: "c00000000000000000099",
        forkedFromAuthorName: "원작자",
        publishedAt: publishedAt.toISOString(),
      });
    });

    it("보관함 경로로 세트 복제본을 만들거나 고칠 수 없다", async () => {
      const saved = await upsertDeck(
        db,
        ownerId,
        makeDeck(ownerId, {
          scope: "presentation",
          presentationId: "100000000000000000001",
        }),
      );
      expect(saved?.scope).toBe("library");
      expect(saved?.presentationId).toBeNull();

      await seedDocs(db, {
        presentations: [
          presentationDoc({ id: "100000000000000000001", userId: ownerId }),
        ],
        decks: [
          deckDoc({
            id: "c00000000000000000002",
            userId: ownerId,
            presentationId: "100000000000000000001",
            itemId: "300000000000000000001",
            position: 0,
          }),
        ],
      });
      expect(
        await upsertDeck(
          db,
          ownerId,
          makeDeck(ownerId, { id: "c00000000000000000002" }),
        ),
      ).toBeNull();
      expect(await deleteDeckScoped(db, "c00000000000000000002", ownerId)).toBe(
        false,
      );
    });
  });

  it("삭제는 소유자에게만 허용된다", async () => {
    await upsertDeck(db, ownerId, makeDeck(ownerId));

    expect(await deleteDeckScoped(db, DECK_ID, strangerId)).toBe(false);
    expect((await decksCol(db).doc(DECK_ID).get()).exists).toBe(true);

    expect(await deleteDeckScoped(db, DECK_ID, ownerId)).toBe(true);
    expect((await decksCol(db).doc(DECK_ID).get()).exists).toBe(false);
  });

  it("없는 덱 삭제는 false를 돌린다", async () => {
    expect(await deleteDeckScoped(db, DECK_ID, ownerId)).toBe(false);
  });
});

describe("곡 삭제가 하던 외래키 정리", () => {
  let db: Db;
  const owner = "00000000x000000000001";
  const fan = "00000000x000000000002";

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [userDoc({ id: owner }), userDoc({ id: fan })],
      presentations: [presentationDoc({ id: "p1", userId: fan })],
      decks: [
        deckDoc({
          id: "src",
          userId: owner,
          visibility: "public",
          forkCount: 1,
        }),
        deckDoc({
          id: "fork",
          userId: fan,
          forkedFrom: "src",
          forkedFromAuthorName: "원작자",
        }),
        deckDoc({
          id: "copy",
          userId: fan,
          presentationId: "p1",
          itemId: "i1",
          position: 0,
          forkedFrom: "fork",
        }),
      ],
    });
  });

  it("가져온 곡을 지우면 원본의 가져간 횟수가 준다", async () => {
    expect(await deleteDeckScoped(db, "fork", fan)).toBe(true);
    expect((await decksCol(db).doc("src").get()).data()?.forkCount).toBe(0);
  });

  it("지운 곡을 가리키던 곡의 forkedFrom은 비우고 원작 표시는 남긴다", async () => {
    expect(await deleteDeckScoped(db, "src", owner)).toBe(true);
    expect((await decksCol(db).doc("fork").get()).data()).toMatchObject({
      forkedFrom: null,
      forkedFromAuthorName: "원작자",
    });

    expect(await deleteDeckScoped(db, "fork", fan)).toBe(true);
    expect(
      (await decksCol(db).doc("copy").get()).data()?.forkedFrom,
    ).toBeNull();
  });
});
