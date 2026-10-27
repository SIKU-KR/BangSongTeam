import { describe, it, expect, beforeEach } from "vitest";
import {
  FALLBACK_USER_NAME,
  ForkDeckResponseSchema,
  OFFICIAL_LIBRARY_NAME,
  OFFICIAL_LIBRARY_USER_ID,
  SearchCatalogResponseSchema,
} from "#shared";
import type { Db } from "../client";
import {
  COLLECTIONS,
  decksCol,
  userQuotaDocId,
  userQuotasCol,
  type DeckDoc,
  type UserDoc,
} from "../collections";
import {
  createTestDb,
  deckDoc,
  instrumentTransactions,
  presentationDoc,
  seedDocs,
  seedUserQuota,
  userDoc,
} from "../test/fixtures";
import { deleteDeckScoped } from "./decks";
import { DAILY_USER_LIMITS, quotaDay } from "./limits";
import { searchPublicDecks } from "./search";
import {
  forkPublicDeck,
  getPublicDeckDetail,
  setDeckVisibility,
  toPublicDeckSummary,
} from "./sharing";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const DECK = "c00000000000000000001";
const DAY = new Date("2026-10-27T05:00:00.000Z");
const NEXT_DAY = new Date("2026-10-28T05:00:00.000Z");

const SLIDES = JSON.stringify([
  { id: "s2", order: 1, lines: ["둘째 슬라이드"] },
  { id: "s1", order: 0, lines: ["첫 줄", "둘째 줄"] },
]);

function row(overrides: Partial<DeckDoc> = {}): DeckDoc {
  return deckDoc({
    id: DECK,
    userId: A,
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: "첫 줄\n둘째 줄\n\n둘째 슬라이드",
    slides: SLIDES,
    ...overrides,
  });
}

describe("공유 쿼리 헬퍼", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: A, name: "김찬양" }),
        userDoc({ id: B, name: "이예배" }),
      ],
    });
  });

  async function readRow(id: string): Promise<DeckDoc> {
    const r = (await decksCol(db).doc(id).get()).data();
    if (!r) throw new Error(`no deck ${id}`);
    return r;
  }

  async function counted(
    userId: string,
    action: keyof typeof DAILY_USER_LIMITS,
  ): Promise<number> {
    const quota = (
      await userQuotasCol(db)
        .doc(userQuotaDocId(userId, quotaDay(DAY)))
        .get()
    ).data();
    return quota?.[action] ?? 0;
  }

  async function ban(userId: string, name: string): Promise<void> {
    await seedDocs(db, {
      users: [userDoc({ id: userId, name, bannedAt: new Date() })],
    });
  }

  describe("toPublicDeckSummary", () => {
    it("keeps only the first slide and never the owner id", async () => {
      const summary = toPublicDeckSummary({
        ...row({ visibility: "public" }),
        authorName: "김찬양",
      });
      expect(summary.firstSlidePreview).toEqual(["첫 줄", "둘째 줄"]);
      expect(summary.slideCount).toBe(2);
      expect(summary.authorName).toBe("김찬양");
      expect(summary).not.toHaveProperty("userId");
      expect(summary).not.toHaveProperty("lyricsRaw");
    });

    it("공식 라이브러리 계정이 올린 곡만 공식 곡으로 표시한다", () => {
      const official = toPublicDeckSummary({
        ...row({ userId: OFFICIAL_LIBRARY_USER_ID, visibility: "public" }),
        authorName: OFFICIAL_LIBRARY_NAME,
      });
      const lookalike = toPublicDeckSummary({
        ...row({ visibility: "public" }),
        authorName: OFFICIAL_LIBRARY_NAME,
      });

      expect(official.official).toBe(true);
      expect(lookalike.official).toBe(false);
      expect(lookalike.authorName).toBe(official.authorName);
    });

    it("원작자 필드가 저장돼 있지 않아도 키를 null로 채운다", () => {
      const { forkedFromAuthorName, ...stored } = row({ visibility: "public" });
      void forkedFromAuthorName;

      const summary = toPublicDeckSummary({
        ...(stored as DeckDoc),
        authorName: "김찬양",
      });

      expect(summary).toHaveProperty("forkedFromAuthorName", null);
    });
  });

  describe("저장된 이름·곡이 스키마 한도를 벗어날 때", () => {
    const AUTHORS = [
      "0000000000000000000o1",
      "0000000000000000000o2",
      "0000000000000000000o3",
      "0000000000000000000o4",
    ] as const;

    async function seedOddAuthors(): Promise<void> {
      const [zero, object, long, nameless] = AUTHORS;
      await seedDocs(db, {
        users: [
          { ...userDoc({ id: zero }), name: 0 as unknown as string },
          { ...userDoc({ id: object }), name: { x: 1 } as unknown as string },
          userDoc({ id: long, name: "a".repeat(200) }),
        ],
        decks: AUTHORS.map((userId, n) =>
          row({
            id: `c0000000000000000000${n}`,
            userId,
            visibility: "public",
            title: "가".repeat(153),
            artist: "나".repeat(150),
            forkedFromAuthorName: "x".repeat(150),
            forkCount: -1,
          }),
        ),
      });
      const { name, ...withoutName } = userDoc({ id: nameless });
      void name;
      await db
        .collection(COLLECTIONS.users)
        .doc(nameless)
        .set(withoutName as Omit<UserDoc, "name">);
    }

    it("이름이 문자열이 아니거나 길거나 없는 작성자의 곡도 검색 응답 스키마를 통과한다", async () => {
      await seedOddAuthors();

      const decks = await searchPublicDecks(db, "");
      const parsed = SearchCatalogResponseSchema.parse({ decks });

      expect(parsed.decks).toHaveLength(AUTHORS.length);
      expect(parsed.decks.map((deck) => deck.authorName).sort()).toEqual(
        [
          FALLBACK_USER_NAME.default,
          FALLBACK_USER_NAME.default,
          FALLBACK_USER_NAME.default,
          "a".repeat(50),
        ].sort(),
      );
      for (const deck of parsed.decks) {
        expect(deck.title).toHaveLength(100);
        expect(deck.artist).toHaveLength(100);
        expect(deck.forkedFromAuthorName).toHaveLength(100);
        expect(deck.forkCount).toBe(0);
      }
    });

    it("공개 덱 상세도 작성자 이름을 표시 이름으로 다듬는다", async () => {
      await seedOddAuthors();

      const detail = await getPublicDeckDetail(db, "c00000000000000000000");

      expect(detail?.authorName).toBe(FALLBACK_USER_NAME.default);
    });

    it("긴 제목의 곡을 긴 이름의 작성자에게서 가져와도 응답과 저장값이 한도 안이다", async () => {
      await seedDocs(db, {
        users: [userDoc({ id: A, name: "김".repeat(150) })],
        decks: [row({ visibility: "public", title: "가".repeat(153) })],
      });

      const result = await forkPublicDeck(db, B, DECK);
      if (result.status !== "ok") throw new Error("fork failed");

      expect(
        ForkDeckResponseSchema.safeParse({
          deck: result.deck,
          alreadyOwned: result.alreadyOwned,
        }).success,
      ).toBe(true);
      const stored = await readRow(result.deck.id);
      expect(stored.title).toHaveLength(100);
      expect(stored.forkedFromAuthorName?.length).toBeLessThanOrEqual(50);
      expect(stored.listed).toBe(false);
      expect((await readRow(DECK)).forkCount).toBe(1);
    });
  });

  describe("setDeckVisibility", () => {
    beforeEach(async () => {
      await seedDocs(db, { decks: [row()] });
    });

    it("publishes my library deck and records the consent time", async () => {
      const result = await setDeckVisibility(db, A, DECK, "public");
      expect(result.status).toBe("ok");
      const saved = await readRow(DECK);
      expect(saved.visibility).toBe("public");
      expect(saved.publishedAt).toBeInstanceOf(Date);
      expect(saved.listed).toBe(true);
      expect(saved.searchGrams).toContain("은혜");
    });

    it("goes back to private", async () => {
      await setDeckVisibility(db, A, DECK, "public");
      await setDeckVisibility(db, A, DECK, "private");
      expect(await readRow(DECK)).toMatchObject({
        visibility: "private",
        listed: false,
        searchGrams: [],
      });
    });

    it("treats someone else's deck as not found", async () => {
      expect((await setDeckVisibility(db, B, DECK, "public")).status).toBe(
        "not_found",
      );
      expect((await readRow(DECK)).visibility).toBe("private");
    });

    it("refuses presentation clones, taken-down decks and empty decks", async () => {
      await seedDocs(db, {
        presentations: [presentationDoc({ id: "p1", userId: A })],
        decks: [
          row({ id: "clone", presentationId: "p1", itemId: "i1", position: 0 }),
          row({ id: "down", takedownAt: new Date() }),
          row({ id: "empty", slides: "[]" }),
        ],
      });
      expect((await setDeckVisibility(db, A, "clone", "public")).status).toBe(
        "not_library",
      );
      expect((await setDeckVisibility(db, A, "down", "public")).status).toBe(
        "taken_down",
      );
      expect((await setDeckVisibility(db, A, "empty", "public")).status).toBe(
        "empty",
      );
      expect((await setDeckVisibility(db, A, "down", "private")).status).toBe(
        "ok",
      );
    });

    it("내가 지운 곡은 문서가 다시 생겨 있어도 공개 여부를 바꾸지 않는다", async () => {
      expect(await deleteDeckScoped(db, DECK, A)).toBe(true);
      const instrument = instrumentTransactions(db);
      try {
        expect(await setDeckVisibility(db, A, DECK, "public")).toEqual({
          status: "deleted",
        });
        expect((await decksCol(db).doc(DECK).get()).exists).toBe(false);

        await seedDocs(db, { decks: [row()] });
        expect(await setDeckVisibility(db, A, DECK, "public")).toEqual({
          status: "deleted",
        });
        expect(await setDeckVisibility(db, A, DECK, "private")).toEqual({
          status: "deleted",
        });
      } finally {
        instrument.restore();
      }

      expect(instrument.max()).toBe(0);
      expect(await readRow(DECK)).toMatchObject({
        visibility: "private",
        publishedAt: null,
        listed: false,
      });
      expect(await getPublicDeckDetail(db, DECK)).toBeNull();
    });

    it("운영자가 제한한 계정은 공개하지 못하지만 비공개로는 돌릴 수 있다", async () => {
      await seedDocs(db, {
        decks: [row({ id: "pub", visibility: "public" })],
      });
      await ban(A, "김찬양");

      expect((await setDeckVisibility(db, A, DECK, "public")).status).toBe(
        "banned",
      );
      expect(await readRow(DECK)).toMatchObject({
        visibility: "private",
        listed: false,
      });
      expect((await setDeckVisibility(db, A, "pub", "private")).status).toBe(
        "ok",
      );
    });

    it("제한 필드가 생기기 전의 사용자 문서는 제한되지 않은 것으로 읽는다", async () => {
      const { bannedAt, ...legacy } = userDoc({ id: A, name: "김찬양" });
      void bannedAt;
      await db.collection(COLLECTIONS.users).doc(A).set(legacy);

      expect((await setDeckVisibility(db, A, DECK, "public")).status).toBe(
        "ok",
      );
    });

    it("하루 공개 한도만큼만 비공개 곡을 공개하고, 다음 날 다시 공개할 수 있다", async () => {
      const ids = Array.from(
        { length: DAILY_USER_LIMITS.publish + 1 },
        (_, n) => `c0000000000000000${String(n).padStart(4, "0")}`,
      );
      await seedDocs(db, { decks: ids.map((id) => row({ id })) });

      const statuses: string[] = [];
      for (const id of ids) {
        statuses.push(
          (await setDeckVisibility(db, A, id, "public", DAY)).status,
        );
      }

      expect(statuses.slice(0, -1).every((status) => status === "ok")).toBe(
        true,
      );
      expect(statuses.at(-1)).toBe("rate_limited");
      const [first] = ids;
      const last = ids.at(-1) as string;
      expect((await readRow(last)).listed).toBe(false);
      expect(
        (await setDeckVisibility(db, A, first, "public", DAY)).status,
      ).toBe("ok");
      expect(
        (await setDeckVisibility(db, A, first, "private", DAY)).status,
      ).toBe("ok");
      expect(await counted(A, "publish")).toBe(DAILY_USER_LIMITS.publish);
      expect(
        (await setDeckVisibility(db, A, last, "public", NEXT_DAY)).status,
      ).toBe("ok");
    });

    it("공개하지 못한 곡은 공개 한도를 쓰지 않는다", async () => {
      await seedDocs(db, { decks: [row({ id: "empty", slides: "[]" })] });

      expect(
        (await setDeckVisibility(db, A, "empty", "public", DAY)).status,
      ).toBe("empty");
      expect(await counted(A, "publish")).toBe(0);
    });
  });

  describe("getPublicDeckDetail", () => {
    it("returns full lyrics for public decks only", async () => {
      await seedDocs(db, { decks: [row()] });
      expect(await getPublicDeckDetail(db, DECK)).toBeNull();

      await setDeckVisibility(db, A, DECK, "public");
      const detail = await getPublicDeckDetail(db, DECK);
      expect(detail?.lyricsRaw).toContain("둘째 슬라이드");
      expect(detail?.slides).toHaveLength(2);
      expect(detail?.authorName).toBe("김찬양");
    });
  });

  describe("forkPublicDeck", () => {
    beforeEach(async () => {
      await seedDocs(db, { decks: [row({ visibility: "public" })] });
    });

    it("creates a private fork in my library and bumps the fork count once", async () => {
      const result = await forkPublicDeck(db, B, DECK);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.alreadyOwned).toBe(false);
      expect(result.deck).toMatchObject({
        userId: B,
        scope: "library",
        visibility: "private",
        forkedFrom: DECK,
        forkedFromAuthorName: "김찬양",
        forkCount: 0,
        origin: "fork",
        title: "은혜로다",
      });
      expect(result.deck.id).not.toBe(DECK);
      expect(result.deck.slides).toHaveLength(2);
      expect((await readRow(DECK)).forkCount).toBe(1);
    });

    it("동시에 가져와도 포크는 하나만 생기고 한 번만 센다", async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => forkPublicDeck(db, B, DECK)),
      );
      const ids = new Set(
        results.map((r) => (r.status === "ok" ? r.deck.id : null)),
      );
      expect(ids.size).toBe(1);
      expect((await readRow(DECK)).forkCount).toBe(1);
    });

    it("is idempotent: a second fork returns the first and does not count again", async () => {
      const first = await forkPublicDeck(db, B, DECK);
      const second = await forkPublicDeck(db, B, DECK);
      if (first.status !== "ok" || second.status !== "ok") throw new Error();
      expect(second.alreadyOwned).toBe(true);
      expect(second.deck.id).toBe(first.deck.id);
      expect((await readRow(DECK)).forkCount).toBe(1);
    });

    it("returns my own deck instead of forking it", async () => {
      const result = await forkPublicDeck(db, A, DECK);
      if (result.status !== "ok") throw new Error();
      expect(result.alreadyOwned).toBe(true);
      expect(result.deck.id).toBe(DECK);
      expect((await readRow(DECK)).forkCount).toBe(0);
    });

    it("cannot fork private, taken-down or unknown decks", async () => {
      await seedDocs(db, {
        decks: [
          row({ id: "priv" }),
          row({ id: "down", visibility: "public", takedownAt: new Date() }),
        ],
      });
      for (const id of ["priv", "down", "nope"]) {
        expect((await forkPublicDeck(db, B, id)).status).toBe("not_found");
      }
    });

    it("keeps the fork and its credit when the original is deleted", async () => {
      const result = await forkPublicDeck(db, B, DECK);
      if (result.status !== "ok") throw new Error();
      expect(await deleteDeckScoped(db, DECK, A)).toBe(true);
      expect(await readRow(result.deck.id)).toMatchObject({
        forkedFrom: null,
        forkedFromAuthorName: "김찬양",
      });
    });

    it("운영자가 제한한 계정은 새로 가져오지 못하지만 이미 가져온 곡은 돌려받는다", async () => {
      const first = await forkPublicDeck(db, B, DECK);
      if (first.status !== "ok") throw new Error(first.status);
      await seedDocs(db, {
        decks: [row({ id: "other", visibility: "public" })],
      });
      await ban(B, "이예배");

      expect(await forkPublicDeck(db, B, DECK)).toMatchObject({
        status: "ok",
        alreadyOwned: true,
        deck: { id: first.deck.id },
      });
      expect((await forkPublicDeck(db, B, "other")).status).toBe("banned");
      expect((await readRow("other")).forkCount).toBe(0);
      expect(
        (await decksCol(db).where("userId", "==", B).get()).docs,
      ).toHaveLength(1);
    });

    it("새로 가져올 때만 하루 한도를 쓰고, 다 쓰면 다음 날까지 새로 가져오지 못한다", async () => {
      await seedDocs(db, {
        decks: [row({ id: "other", visibility: "public" })],
      });
      await forkPublicDeck(db, B, DECK, DAY);
      await forkPublicDeck(db, B, DECK, DAY);
      expect(await counted(B, "fork")).toBe(1);

      await seedUserQuota(db, B, DAY, { fork: DAILY_USER_LIMITS.fork });
      expect((await forkPublicDeck(db, B, "other", DAY)).status).toBe(
        "rate_limited",
      );
      expect((await readRow("other")).forkCount).toBe(0);
      expect((await forkPublicDeck(db, B, DECK, DAY)).status).toBe("ok");
      expect((await forkPublicDeck(db, B, "other", NEXT_DAY)).status).toBe(
        "ok",
      );
    });

    it("counts current forks: deleting a fork lowers the count", async () => {
      const result = await forkPublicDeck(db, B, DECK);
      if (result.status !== "ok") throw new Error();
      expect((await readRow(DECK)).forkCount).toBe(1);

      expect(await deleteDeckScoped(db, result.deck.id, B)).toBe(true);
      expect((await readRow(DECK)).forkCount).toBe(0);

      const again = await forkPublicDeck(db, B, DECK);
      expect(again.status === "ok" && again.alreadyOwned).toBe(false);
      expect((await readRow(DECK)).forkCount).toBe(1);
    });
  });
});
