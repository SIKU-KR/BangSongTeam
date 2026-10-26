import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { decksCol, type DeckDoc } from "../collections";
import {
  createTestDb,
  deckDoc,
  presentationDoc,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import { deleteDeckScoped, upsertDeck } from "./decks";
import { toSharedDeck } from "./mappers";
import { setDeckVisibility } from "./sharing";
import { planSearch, searchPublicDecks } from "./search";

const USER_A = "00000000x000000000001";
const USER_B = "00000000x000000000002";

function publicDeck(overrides: Partial<DeckDoc> & { id: string }): DeckDoc {
  return deckDoc({
    userId: USER_A,
    title: "제목",
    visibility: "public",
    slides: JSON.stringify([{ id: "s", order: 0, lines: ["가사"] }]),
    ...overrides,
  });
}

describe("planSearch", () => {
  it("browses by popularity for an empty query", () => {
    expect(planSearch("")).toEqual({ kind: "browse" });
    expect(planSearch("   ")).toEqual({ kind: "browse" });
  });

  it("returns nothing when only symbols remain", () => {
    expect(planSearch("%%")).toEqual({ kind: "nothing" });
    expect(planSearch('"*"')).toEqual({ kind: "nothing" });
  });

  it("고를 두 글자 묶음은 가장 긴 낱말의 앞 두 글자다", () => {
    expect(planSearch("주 은혜로")).toEqual({
      kind: "search",
      tokens: ["주", "은혜로"],
      gram: "은혜",
    });
  });

  it("소문자로 비교하고, 한 글자 낱말뿐이면 묶음 없이 찾는다", () => {
    expect(planSearch("Grace")).toEqual({
      kind: "search",
      tokens: ["grace"],
      gram: "gr",
    });
    expect(planSearch("주 빛")).toEqual({
      kind: "search",
      tokens: ["주", "빛"],
      gram: null,
    });
  });
});

describe("searchPublicDecks", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: USER_A, name: "김찬양" }),
        userDoc({ id: USER_B, name: "이예배" }),
      ],
      presentations: [presentationDoc({ id: "p1", userId: USER_A })],
      decks: [
        publicDeck({
          id: "s1",
          title: "은혜로운 주의 사랑",
          artist: "어노인팅",
          forkCount: 10,
        }),
        publicDeck({
          id: "s2",
          title: "주의 은혜로",
          artist: "마커스",
          forkCount: 50,
          userId: USER_B,
        }),
        publicDeck({
          id: "s3",
          title: "은혜 비공개곡",
          visibility: "private",
          forkCount: 99,
        }),
        publicDeck({
          id: "s4",
          title: "꽃들도",
          artist: "JWorship",
          forkCount: 20,
          lyricsRaw: "이 곳에 오셔서 은혜를 베푸소서",
        }),
        publicDeck({
          id: "s5",
          title: "은혜 세트 복제본",
          visibility: "private",
          presentationId: "p1",
          itemId: "i5",
          position: 0,
        }),
        publicDeck({
          id: "s6",
          title: "은혜 게시 중단",
          visibility: "private",
          forkCount: 70,
          takedownAt: new Date(),
        }),
      ],
    });
  });

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("finds a phrase inside a title", async () => {
    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual(["s1"]);
  });

  it("finds short tokens too, sorted by fork count", async () => {
    expect(ids(await searchPublicDecks(db, "은혜"))).toEqual([
      "s2",
      "s4",
      "s1",
    ]);
    expect(ids(await searchPublicDecks(db, "주"))).toEqual(["s2", "s1"]);
  });

  it("searches lyrics as well as title and artist", async () => {
    expect(ids(await searchPublicDecks(db, "베푸소서"))).toEqual(["s4"]);
  });

  it("ANDs every token", async () => {
    expect(ids(await searchPublicDecks(db, "주의 마커스"))).toEqual(["s2"]);
    expect(ids(await searchPublicDecks(db, "사랑 마커스"))).toEqual([]);
  });

  it("ignores letter case", async () => {
    expect(ids(await searchPublicDecks(db, "jworship"))).toEqual(["s4"]);
    expect(ids(await searchPublicDecks(db, "WORSHIP"))).toEqual(["s4"]);
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

  it("비공개 곡·사본·게시 중단 곡의 가사는 색인에 남기지 않는다", async () => {
    for (const id of ["s3", "s5", "s6"]) {
      expect((await decksCol(db).doc(id).get()).data()).toMatchObject({
        listed: false,
        searchGrams: [],
      });
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

  it("treats wildcard and query syntax as literals", async () => {
    expect(await searchPublicDecks(db, "%")).toEqual([]);
    expect(await searchPublicDecks(db, "_")).toEqual([]);
    expect(await searchPublicDecks(db, '" OR 1=1 --')).toEqual([]);
    expect(ids(await searchPublicDecks(db, "은혜* (")).sort()).toEqual([
      "s1",
      "s2",
      "s4",
    ]);
  });

  it("follows visibility, content changes and deletion", async () => {
    await setDeckVisibility(db, USER_A, "s1", "private");
    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual([]);

    await setDeckVisibility(db, USER_A, "s1", "public");
    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual(["s1"]);

    const stored = (await decksCol(db).doc("s1").get()).data() as DeckDoc;
    await upsertDeck(db, USER_A, {
      ...toSharedDeck(stored),
      title: "새 제목입니다",
    });
    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual([]);
    expect(ids(await searchPublicDecks(db, "새 제목입니다"))).toEqual(["s1"]);

    await deleteDeckScoped(db, "s1", USER_A);
    expect(ids(await searchPublicDecks(db, "새 제목입니다"))).toEqual([]);
  });

  it("후보가 한 페이지를 넘어도 이어 읽어 맞는 곡을 찾는다", async () => {
    await seedDocs(db, {
      decks: Array.from({ length: 150 }, (_, n) =>
        publicDeck({
          id: `noise${n}`,
          title: `은혜 ${n}`,
          forkCount: 1000 + n,
        }),
      ),
    });

    expect(ids(await searchPublicDecks(db, "은혜로운"))).toEqual(["s1"]);
    expect(await searchPublicDecks(db, "은혜", 160)).toHaveLength(153);
  });

  it("builds the card from the lowest-order slide", async () => {
    await decksCol(db)
      .doc("s1")
      .update({
        slides: JSON.stringify([
          { id: "b", order: 1, lines: ["둘째"] },
          { id: "a", order: 0, lines: ["첫째 줄", "첫째 둘째 줄"] },
          { id: "c", order: 2, lines: ["셋째"] },
        ]),
      });

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

  it("길이 제한을 넘는 첫 슬라이드도 나눠서 미리보기를 만든다", async () => {
    const verse = `${"주 하나님 크신 사랑 ".repeat(8)}찬양하리`;
    await decksCol(db)
      .doc("s1")
      .update({
        slides: JSON.stringify([
          { id: "a", order: 0, lines: [verse, verse, verse] },
        ]),
      });

    const [card] = await searchPublicDecks(db, "은혜로운");

    expect(card.firstSlidePreview).toHaveLength(2);
    expect(card.firstSlidePreview.join(" ")).toBe(verse);
  });

  it("returns an empty preview for empty or malformed slides", async () => {
    await decksCol(db).doc("s2").update({ slides: "[]" });
    const [card] = await searchPublicDecks(db, "마커스");
    expect(card.firstSlidePreview).toEqual([]);
    expect(card.slideCount).toBe(0);

    await decksCol(db).doc("s2").update({ slides: "not json" });
    const [broken] = await searchPublicDecks(db, "마커스");
    expect(broken.firstSlidePreview).toEqual([]);
    expect(broken.slideCount).toBe(0);
  });
});
