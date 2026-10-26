import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Query } from "@google-cloud/firestore";
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

async function seedMany(db: Db, decks: DeckDoc[]): Promise<void> {
  for (let start = 0; start < decks.length; start += 250) {
    await seedDocs(db, { decks: decks.slice(start, start + 250) });
  }
}

async function documentsReadBy(run: () => Promise<unknown>): Promise<number> {
  const get = Query.prototype.get;
  let read = 0;
  const spy = vi
    .spyOn(Query.prototype, "get")
    .mockImplementation(async function (this: Query) {
      const snapshot = await get.call(this);
      read += snapshot.size;
      return snapshot;
    });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return read;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("planSearch", () => {
  it("browses by popularity for an empty query", () => {
    expect(planSearch("")).toEqual({ kind: "browse" });
    expect(planSearch("   ")).toEqual({ kind: "browse" });
  });

  it("returns nothing when only symbols remain", () => {
    expect(planSearch("%%")).toEqual({ kind: "nothing" });
    expect(planSearch('"*"')).toEqual({ kind: "nothing" });
    expect(planSearch("ㅏ ㅓ")).toEqual({ kind: "nothing" });
  });

  it("두 글자 묶음은 가장 긴 낱말의 앞 두 글자부터, 낱말마다 번갈아 고른다", () => {
    expect(planSearch("주 은혜로")).toEqual({
      kind: "search",
      tokens: ["주", "은혜로"],
      grams: ["은혜", "혜로"],
    });
    expect(planSearch("사랑 은혜로")).toMatchObject({
      grams: ["은혜", "사랑", "혜로"],
    });
  });

  it("두 글자 묶음은 6개까지만 고른다", () => {
    expect(
      planSearch("주 하나님 지으신 모든 세계 내 마음 속에 그리어 볼 때"),
    ).toMatchObject({
      grams: ["하나", "지으", "그리", "모든", "세계", "마음"],
    });
  });

  it("소문자로 비교하고, 한 글자 낱말뿐이면 묶음 없이 찾는다", () => {
    expect(planSearch("Grace")).toEqual({
      kind: "search",
      tokens: ["grace"],
      grams: ["gr", "ra", "ac", "ce"],
    });
    expect(planSearch("주 빛")).toEqual({
      kind: "search",
      tokens: ["주", "빛"],
      grams: [],
    });
  });

  it("초성만으로 된 낱말은 두 글자 묶음을 고를 때 뺀다", () => {
    expect(planSearch("ㅈㄴ 사랑")).toEqual({
      kind: "search",
      tokens: ["ㅈㄴ", "사랑"],
      grams: ["사랑"],
    });
    expect(planSearch("ㅈㄴㅇ")).toEqual({
      kind: "search",
      tokens: ["ㅈㄴㅇ"],
      grams: [],
    });
  });

  it("조합 중인 끝 자모는 떼고 찾는다", () => {
    expect(planSearch("주님ㅇ")).toEqual({
      kind: "search",
      tokens: ["주님"],
      grams: ["주님"],
    });
    expect(planSearch("은혜 사ㄹ")).toMatchObject({ tokens: ["은혜", "사"] });
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

  it("흔한 두 글자 묶음의 후보가 상한을 넘어도 드문 묶음으로 골라 찾는다", async () => {
    await seedMany(
      db,
      Array.from({ length: 1000 }, (_, n) =>
        publicDeck({
          id: `lord${n}`,
          title: `주님 ${n}`,
          forkCount: 1,
          updatedAt: new Date(1000 + n),
        }),
      ),
    );
    await seedDocs(db, {
      decks: [publicDeck({ id: "target", title: "주님의 거룩한 이름" })],
    });

    expect(ids(await searchPublicDecks(db, "주님의 거룩한"))).toEqual([
      "target",
    ]);
  });

  it("후보 수를 세지 못하면 가장 긴 낱말의 첫 두 글자로 찾고 실패를 알린다", async () => {
    const failure = new Error("index not ready");
    const aggregateQuery: { get: () => Promise<unknown> } =
      Object.getPrototypeOf(decksCol(db).count());
    vi.spyOn(aggregateQuery, "get").mockRejectedValue(failure);
    const onCountError = vi.fn();

    expect(
      ids(await searchPublicDecks(db, "은혜로운 사랑", 20, { onCountError })),
    ).toEqual(["s1"]);
    expect(onCountError).toHaveBeenCalledTimes(1);
    expect(onCountError).toHaveBeenCalledWith(failure);
  });

  it("초성만 친 낱말은 제목·아티스트의 초성으로도 찾는다", async () => {
    await seedDocs(db, {
      decks: [
        publicDeck({ id: "p1", title: "주님의 사랑", forkCount: 5 }),
        publicDeck({ id: "p2", title: "주님 비공개", visibility: "private" }),
      ],
    });

    expect(ids(await searchPublicDecks(db, "ㅈㄴ"))).toEqual(["p1"]);
    expect(ids(await searchPublicDecks(db, "ㅈㄴㅇㅅㄹ"))).toEqual(["p1"]);
    expect(ids(await searchPublicDecks(db, "ㅈㄴ 사랑"))).toEqual(["p1"]);
    expect(ids(await searchPublicDecks(db, "ㅇㄴㅇㅌ"))).toEqual(["s1"]);
  });

  it("초성은 가사에서 찾지 않는다", async () => {
    expect(await searchPublicDecks(db, "ㅂㅍㅅㅅ")).toEqual([]);
  });

  it("조합 중인 끝 자모를 떼고 찾아 입력하는 동안에도 결과가 이어진다", async () => {
    await seedDocs(db, {
      decks: [publicDeck({ id: "p1", title: "주님의 사랑", forkCount: 5 })],
    });

    expect(ids(await searchPublicDecks(db, "주님ㅇ"))).toEqual(["p1"]);
    expect(ids(await searchPublicDecks(db, "은혜로ㅇ"))).toEqual(["s2", "s1"]);
  });

  describe("읽는 곡 문서 수", () => {
    beforeEach(async () => {
      await seedMany(
        db,
        Array.from({ length: 400 }, (_, n) =>
          publicDeck({
            id: `grace${n}`,
            title: `은혜 ${n}`,
            forkCount: 100 + n,
          }),
        ),
      );
    });

    it("두 글자 묶음으로 고른 후보도 300곡까지만 확인한다", async () => {
      let found: unknown;
      const read = await documentsReadBy(async () => {
        found = await searchPublicDecks(db, "은혜 ㅋ");
      });

      expect(found).toEqual([]);
      expect(read).toBeLessThanOrEqual(300);
    });

    it("두 글자 묶음이 없는 검색은 인기순 100곡만 확인한다", async () => {
      for (const query of ["z", "ㅈ", "주 빛"]) {
        expect(
          await documentsReadBy(() => searchPublicDecks(db, query)),
        ).toBeLessThanOrEqual(100);
      }
    });

    it("어느 곡에도 없는 두 글자 묶음이 있으면 곡 문서를 읽지 않는다", async () => {
      for (const query of ["은혜ꙮ", "은혜 zq", "은혜qqq"]) {
        let found: unknown;
        const read = await documentsReadBy(async () => {
          found = await searchPublicDecks(db, query);
        });

        expect(found).toEqual([]);
        expect(read).toBe(0);
      }
    });
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
