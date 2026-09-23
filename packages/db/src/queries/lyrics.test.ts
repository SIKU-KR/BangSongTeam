import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "@repo/shared";
import { user, lyricsCatalog, lyricsVersions, decks } from "../schema";
import { contributeLyrics, shouldContribute } from "./lyrics";

describe("가사 카탈로그 기여", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  const userA = "00000000-0000-4000-8000-000000000001";
  const userB = "00000000-0000-4000-8000-000000000002";

  beforeEach(async () => {
    db = createTestDb().db;
    await db.insert(user).values([
      { id: userA, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: userB, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
  });

  it("첫 기여는 카탈로그를 만들고 정본이 된다", async () => {
    const result = await contributeLyrics(db, {
      userId: userA,
      deckId: "deck-1",
      title: "은혜로다",
      artist: "예수전도단",
      lyrics: "시작됐네",
    });

    expect(result.versionCount).toBe(1);

    const [catalog] = await db
      .select()
      .from(lyricsCatalog)
      .where(eq(lyricsCatalog.id, result.catalogId));
    expect(catalog.lyricsCanonical).toBe("시작됐네");
    expect(catalog.status).toBe("single");
  });

  it("다른 사용자가 같은 곡을 올리면 루트 버전이 2개가 된다", async () => {
    // 이것이 M5 AI 정규화의 실행 조건(루트 버전 2개 이상)이다.
    const first = await contributeLyrics(db, {
      userId: userA,
      deckId: "deck-1",
      title: "은혜로다",
      artist: "예수전도단",
      lyrics: "시작됐네",
    });
    const second = await contributeLyrics(db, {
      userId: userB,
      deckId: "deck-2",
      title: "은혜로다",
      artist: "예수전도단",
      lyrics: "시작됐네 우리 주님의",
    });

    expect(second.catalogId).toBe(first.catalogId);
    expect(second.versionCount).toBe(2);
  });

  it("띄어쓰기·문장부호만 다르면 같은 카탈로그로 모인다", async () => {
    const first = await contributeLyrics(db, {
      userId: userA,
      deckId: "deck-1",
      title: "주 품에",
      artist: "어노인팅",
      lyrics: "가사",
    });
    const second = await contributeLyrics(db, {
      userId: userB,
      deckId: "deck-2",
      title: "주품에!",
      artist: "어 노인팅",
      lyrics: "가사",
    });

    expect(second.catalogId).toBe(first.catalogId);
  });

  it("제목에 단어가 더 붙으면 다른 카탈로그다", () => {
    // '시선'과 '시선 (Live)'를 한 곡으로 합치면 운영자가 의도적으로 나눈
    // 편곡 버전까지 뭉뚱그려진다. 부호·공백만 무시하고 단어는 존중한다.
    return (async () => {
      const first = await contributeLyrics(db, {
        userId: userA,
        deckId: "deck-1",
        title: "시선",
        artist: "어노인팅",
        lyrics: "가사",
      });
      const second = await contributeLyrics(db, {
        userId: userB,
        deckId: "deck-2",
        title: "시선 (Live)",
        artist: "어노인팅",
        lyrics: "가사",
      });

      expect(second.catalogId).not.toBe(first.catalogId);
    })();
  });

  it("같은 사용자가 여러 번 올려도 버전은 하나다 (1인 1표)", async () => {
    await contributeLyrics(db, {
      userId: userA,
      deckId: "deck-1",
      title: "소원",
      artist: "한웅재",
      lyrics: "첫 번째",
    });
    const again = await contributeLyrics(db, {
      userId: userA,
      deckId: "deck-1",
      title: "소원",
      artist: "한웅재",
      lyrics: "고친 가사",
    });

    expect(again.versionCount).toBe(1);

    const versions = await db
      .select()
      .from(lyricsVersions)
      .where(eq(lyricsVersions.catalogId, again.catalogId));
    expect(versions).toHaveLength(1);
    expect(versions[0].lyrics).toBe("고친 가사");
  });

  it("잠긴 카탈로그의 정본은 건드리지 않는다", async () => {
    // 운영자가 검수해 잠근 가사는 자동 갱신 대상에서 제외된다 (PRD 4.8).
    const first = await contributeLyrics(db, {
      userId: userA,
      deckId: "deck-1",
      title: "주 품에",
      artist: "마커스",
      lyrics: "검수된 가사",
    });
    await db
      .update(lyricsCatalog)
      .set({ status: "locked" })
      .where(eq(lyricsCatalog.id, first.catalogId));

    const second = await contributeLyrics(db, {
      userId: userB,
      deckId: "deck-2",
      title: "주 품에",
      artist: "마커스",
      lyrics: "다른 사람이 올린 가사",
    });

    expect(second.locked).toBe(true);
    const [catalog] = await db
      .select()
      .from(lyricsCatalog)
      .where(eq(lyricsCatalog.id, first.catalogId));
    expect(catalog.lyricsCanonical).toBe("검수된 가사");
    expect(catalog.status).toBe("locked");
    // 버전 수는 그래도 센다
    expect(catalog.versionCount).toBe(2);
  });

  it("서로 다른 곡은 다른 카탈로그가 된다", async () => {
    const a = await contributeLyrics(db, {
      userId: userA,
      deckId: "deck-1",
      title: "은혜로다",
      artist: "예수전도단",
      lyrics: "가사 1",
    });
    const b = await contributeLyrics(db, {
      userId: userA,
      deckId: "deck-2",
      title: "소원",
      artist: "한웅재",
      lyrics: "가사 2",
    });

    expect(a.catalogId).not.toBe(b.catalogId);
  });

  describe("M5 확장", () => {
    const base = {
      userId: userA,
      deckId: "deck-1",
      title: "은혜로다",
      artist: "예수전도단",
      lyrics: "시작됐네",
    };

    it("버전이 새로 생기거나 가사가 바뀌었을 때만 changed다", async () => {
      expect((await contributeLyrics(db, base)).changed).toBe(true);
      expect((await contributeLyrics(db, base)).changed).toBe(false);
      expect(
        (await contributeLyrics(db, { ...base, lyrics: "고친 가사" })).changed,
      ).toBe(true);
    });

    it("등록 1명인 곡은 등록자가 고친 가사를 대표 가사로 따라간다", async () => {
      const { catalogId } = await contributeLyrics(db, base);
      await contributeLyrics(db, { ...base, lyrics: "고친 가사" });
      const [catalog] = await db
        .select()
        .from(lyricsCatalog)
        .where(eq(lyricsCatalog.id, catalogId));
      expect(catalog.lyricsCanonical).toBe("고친 가사");
      expect(catalog.canonicalSource).toBe("user");
    });

    it("사용자가 고른 후보 카탈로그로 묶는다 (아티스트 표기가 달라도)", async () => {
      const first = await contributeLyrics(db, base);
      const second = await contributeLyrics(db, {
        ...base,
        userId: userB,
        deckId: "deck-2",
        artist: "YWAM",
        preferredCatalogId: first.catalogId,
      });
      expect(second.catalogId).toBe(first.catalogId);
      expect(second.versionCount).toBe(2);
    });

    it("제목이 다른 곡을 후보로 골라도 그 곡으로는 묶지 않는다", async () => {
      const other = await contributeLyrics(db, {
        ...base,
        title: "소원",
        artist: "한웅재",
      });
      const mine = await contributeLyrics(db, {
        ...base,
        userId: userB,
        deckId: "deck-2",
        preferredCatalogId: other.catalogId,
      });
      expect(mine.catalogId).not.toBe(other.catalogId);
    });

    it("존재하지 않는 후보 id는 무시하고 정규화 키로 찾는다", async () => {
      const first = await contributeLyrics(db, base);
      const second = await contributeLyrics(db, {
        ...base,
        userId: userB,
        deckId: "deck-2",
        preferredCatalogId: "d0000000-0000-4000-8000-00000000dead",
      });
      expect(second.catalogId).toBe(first.catalogId);
    });

    it("덱의 제목이 바뀌어 다른 곡이 되면 옛 곡에서 표를 거둔다", async () => {
      const old = await contributeLyrics(db, base);
      await contributeLyrics(db, { ...base, userId: userB, deckId: "deck-2" });

      const moved = await contributeLyrics(db, {
        ...base,
        title: "은혜로다 (Live)",
      });
      expect(moved.catalogId).not.toBe(old.catalogId);

      const [oldCatalog] = await db
        .select()
        .from(lyricsCatalog)
        .where(eq(lyricsCatalog.id, old.catalogId));
      expect(oldCatalog.versionCount).toBe(1);
      const versions = await db
        .select()
        .from(lyricsVersions)
        .where(eq(lyricsVersions.catalogId, old.catalogId));
      expect(versions.map((v) => v.userId)).toEqual([userB]);
    });

    it("덱에 카탈로그 연결을 되써 준다 (소유자 범위)", async () => {
      const deckId = "c0000000-0000-4000-8000-000000000001";
      await db.insert(decks).values({
        id: deckId,
        userId: userA,
        title: "은혜로다",
        lyricsRaw: "시작됐네",
        slides: "[]",
        style: "{}",
      });
      const { catalogId } = await contributeLyrics(db, { ...base, deckId });
      const [row] = await db.select().from(decks).where(eq(decks.id, deckId));
      expect(row.catalogId).toBe(catalogId);
    });
  });
});

describe("shouldContribute (루트 버전 판정)", () => {
  function deck(overrides: Partial<Deck> = {}): Deck {
    return DeckSchema.parse({
      id: "c0000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000001",
      scope: "library",
      title: "은혜로다",
      lyricsRaw: "시작됐네",
      slides: [],
      backgroundId: null,
      style: DEFAULT_DECK_STYLE,
      origin: "user",
      contributeToCatalog: true,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-21T00:00:00.000Z",
      ...overrides,
    });
  }

  it("직접 등록한 보관함 곡이 기여를 켰으면 루트다", () => {
    expect(shouldContribute(deck())).toBe(true);
    expect(shouldContribute(deck({ origin: undefined }))).toBe(true);
  });

  it("포크본·대표 가사로 만든 덱·세트 복제본·기여 끔·빈 가사는 루트가 아니다", () => {
    expect(shouldContribute(deck({ origin: "fork" }))).toBe(false);
    expect(shouldContribute(deck({ origin: "catalog" }))).toBe(false);
    expect(shouldContribute(deck({ scope: "presentation" }))).toBe(false);
    expect(shouldContribute(deck({ contributeToCatalog: false }))).toBe(false);
    expect(shouldContribute(deck({ contributeToCatalog: undefined }))).toBe(
      false,
    );
    expect(shouldContribute(deck({ lyricsRaw: "  \n " }))).toBe(false);
  });
});
