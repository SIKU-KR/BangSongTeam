import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { decksCol, type DeckDoc } from "../collections";
import { bigramsOf } from "../deckIndex";
import { searchPublicDecks } from "../queries/search";
import { createTestDb, deckDoc, seedDocs, userDoc } from "../test/fixtures";
import { reindexDecks } from "./searchIndex";

const OWNER = "00000000x000000000001";

function libraryDeck(overrides: Partial<DeckDoc> & { id: string }): DeckDoc {
  return deckDoc({ userId: OWNER, visibility: "public", ...overrides });
}

function indexedBeforeInitials(deck: DeckDoc): DeckDoc {
  return {
    ...deck,
    searchGrams: deck.listed
      ? [
          ...new Set(
            [deck.title, deck.artist, deck.lyricsRaw].flatMap(bigramsOf),
          ),
        ]
      : [],
  };
}

async function storedDeck(db: Db, id: string): Promise<DeckDoc | undefined> {
  return (await decksCol(db).doc(id).get()).data();
}

describe("reindexDecks", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, { users: [userDoc({ id: OWNER })] });
  });

  it("초성 색인 없이 저장된 공개 곡에 초성 묶음을 더해 초성으로 찾게 한다", async () => {
    const popular = Array.from({ length: 150 }, (_, n) =>
      libraryDeck({ id: `grace${n}`, title: `은혜 ${n}`, forkCount: 100 + n }),
    );
    const target = libraryDeck({
      id: "target",
      title: "주님의 사랑",
      updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    });
    await seedDocs(db, {
      decks: [...popular, target].map(indexedBeforeInitials),
    });
    expect(await searchPublicDecks(db, "ㅈㄴ")).toEqual([]);

    expect(await reindexDecks(db)).toEqual({ scanned: 151, updated: 151 });

    expect(
      (await searchPublicDecks(db, "ㅈㄴ")).map((deck) => deck.id),
    ).toEqual(["target"]);
    expect(await storedDeck(db, "target")).toEqual(target);
  });

  it("색인이 이미 맞는 곡은 다시 쓰지 않아 여러 번 돌려도 된다", async () => {
    await seedDocs(db, {
      decks: [
        libraryDeck({ id: "public", title: "주님의 사랑" }),
        libraryDeck({ id: "private", title: "비공개", visibility: "private" }),
      ],
    });

    expect(await reindexDecks(db)).toEqual({ scanned: 2, updated: 0 });
    expect(await reindexDecks(db)).toEqual({ scanned: 2, updated: 0 });
  });

  it("공개 범위가 지금 규칙과 어긋난 곡도 바로잡는다", async () => {
    const takenDown = libraryDeck({
      id: "taken-down",
      title: "주님의 사랑",
      takedownAt: new Date("2026-01-02T03:04:05.000Z"),
    });
    await seedDocs(db, {
      decks: [{ ...takenDown, listed: true, searchGrams: ["주님"] }],
    });

    expect(await reindexDecks(db)).toEqual({ scanned: 1, updated: 1 });
    expect(await storedDeck(db, "taken-down")).toMatchObject({
      listed: false,
      searchGrams: [],
    });
  });
});
