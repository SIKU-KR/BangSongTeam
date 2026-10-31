import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "../test/env";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  FolderSchema,
  MAX_CLOCK_SKEW_MS,
  PresentationDocumentSchema,
  toPresentationChanges,
  type Deck,
  type PresentationDocument,
} from "#shared";
import {
  decksCol,
  driveTombstonesCol,
  presentationMembersCol,
  type Db,
} from "#db";
import {
  clearDb,
  deckDoc,
  instrumentTransactions,
  seedDocs,
  userDoc,
} from "../../db/test/fixtures";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import { resetBackgrounds, serviceBackgroundId } from "../test/backgrounds";

const USER_A = "aaaaaaaa0000000000001";
const USER_B = "bbbbbbbb0000000000002";

let currentUser: string | null = USER_A;

const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;

const DOC_ID = "1000000000000000000aa";
const DECK_ID = "c000000000000000000aa";
const LIB_DECK_ID = "c000000000000000000bb";

function makeDeck(userId: string, overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id: DECK_ID,
    userId,
    scope: "presentation",
    presentationId: DOC_ID,
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: "시작됐네",
    slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
    backgroundId: null,
    style: { ...DEFAULT_DECK_STYLE, overlayOpacity: 65 },
    forkedFrom: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function makeDoc(userId: string): PresentationDocument {
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: [
      {
        id: "3000000000000000000aa",
        presentationId: DOC_ID,
        deckId: DECK_ID,
        order: 0,
        deck: makeDeck(userId),
      },
    ],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

const app = createApp({ readSession: fakeSession });

function json(body: unknown) {
  return {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function patchJson(body: unknown) {
  return {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("동기화 라우트 교차 사용자 격리", () => {
  beforeEach(async () => {
    await clearDb(env.DB);

    await seedDocs(env.DB, {
      users: [
        { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
        { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
      ].map((row) => userDoc(row)),
    });
    currentUser = USER_A;
  });

  it("저장한 문서를 곡·스타일까지 그대로 되받는다", async () => {
    const put = await app.request(
      `/api/presentations/${DOC_ID}`,
      json(makeDoc(USER_A)),
      env,
    );
    expect(put.status).toBe(200);

    const res = await app.request("/api/presentations", {}, env);
    const body = (await res.json()) as {
      presentations: PresentationDocument[];
    };

    expect(body.presentations).toHaveLength(1);
    expect(body.presentations[0].title).toBe("주일 1부 예배");
    expect(body.presentations[0].items[0].deck.style.overlayOpacity).toBe(65);
    expect(body.presentations[0].items[0].deck.slides[0].lines).toEqual([
      "시작됐네",
    ]);
  });

  it("B의 목록에는 A의 문서가 보이지 않는다", async () => {
    await app.request(
      `/api/presentations/${DOC_ID}`,
      json(makeDoc(USER_A)),
      env,
    );

    currentUser = USER_B;
    const res = await app.request("/api/presentations", {}, env);
    const body = (await res.json()) as {
      presentations: PresentationDocument[];
    };

    expect(body.presentations).toHaveLength(0);
  });

  it("B는 A의 문서를 덮어쓰지 못한다", async () => {
    await app.request(
      `/api/presentations/${DOC_ID}`,
      json(makeDoc(USER_A)),
      env,
    );

    currentUser = USER_B;
    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      json(makeDoc(USER_B)),
      env,
    );
    expect(res.status).toBe(403);

    currentUser = USER_A;
    const check = await app.request("/api/presentations", {}, env);
    const body = (await check.json()) as {
      presentations: PresentationDocument[];
    };
    expect(body.presentations[0].title).toBe("주일 1부 예배");
  });

  it("B는 A의 문서를 지우지 못한다", async () => {
    await app.request(
      `/api/presentations/${DOC_ID}`,
      json(makeDoc(USER_A)),
      env,
    );

    currentUser = USER_B;
    const res = await app.request(
      `/api/presentations/${DOC_ID}`,
      { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } },
      env,
    );
    expect(res.status).toBe(404);

    currentUser = USER_A;
    const check = await app.request("/api/presentations", {}, env);
    const body = (await check.json()) as {
      presentations: PresentationDocument[];
    };
    expect(body.presentations).toHaveLength(1);
  });

  it("휴지통에 없는 프레젠테이션은 409로 거절하고, 휴지통에 넣은 뒤에는 지운다", async () => {
    const remove = () =>
      app.request(
        `/api/presentations/${DOC_ID}`,
        { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } },
        env,
      );
    const listIds = async () => {
      const res = await app.request("/api/presentations", {}, env);
      const body = (await res.json()) as {
        presentations: PresentationDocument[];
      };
      return body.presentations.map((presentation) => presentation.id);
    };
    await app.request(
      `/api/presentations/${DOC_ID}`,
      json(makeDoc(USER_A)),
      env,
    );

    const refused = await remove();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: API_ERRORS.trashChanged });
    expect(await listIds()).toEqual([DOC_ID]);

    await app.request(
      `/api/presentations/${DOC_ID}`,
      json({ ...makeDoc(USER_A), trashedAt: "2026-09-25T00:00:00.000Z" }),
      env,
    );
    const removed = await remove();
    expect(removed.status).toBe(200);
    expect(await listIds()).toEqual([]);
  });

  it("나눠 지우는 중에 휴지통에서 꺼내면 일부만 지운 채 409로 알린다", async () => {
    const trashed = {
      ...makeDoc(USER_A),
      trashedAt: "2026-09-25T00:00:00.000Z",
    };
    await app.request(`/api/presentations/${DOC_ID}`, json(trashed), env);
    await seedDocs(env.DB, {
      members: Array.from({ length: 600 }, (_, index) => ({
        presentationId: DOC_ID,
        userId: `m${String(index).padStart(20, "0")}`,
      })),
    });
    const instrument = instrumentTransactions(env.DB, {
      afterCall: {
        call: 1,
        run: async () => {
          const restore = await app.request(
            `/api/presentations/${DOC_ID}`,
            json({ ...makeDoc(USER_A), trashedAt: null }),
            env,
          );
          expect(restore.status).toBe(200);
        },
      },
    });

    let res: Response;
    try {
      res = await app.request(
        `/api/presentations/${DOC_ID}`,
        { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } },
        env,
      );
    } finally {
      instrument.restore();
    }

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: API_ERRORS.trashChangedPartly });
    const list = await app.request("/api/presentations", {}, env);
    const body = (await list.json()) as {
      presentations: PresentationDocument[];
    };
    expect(body.presentations.map((presentation) => presentation.id)).toEqual([
      DOC_ID,
    ]);
    expect(body.presentations[0].items).toHaveLength(1);
    const members = await presentationMembersCol(env.DB)
      .where("presentationId", "==", DOC_ID)
      .get();
    expect(members.size).toBeGreaterThan(0);
    expect(members.size).toBeLessThan(600);
  });

  it("미로그인은 모든 동기화 경로에서 401이다", async () => {
    currentUser = null;

    expect((await app.request("/api/presentations", {}, env)).status).toBe(401);
    expect((await app.request("/api/decks", {}, env)).status).toBe(401);
    expect(
      (
        await app.request(
          `/api/presentations/${DOC_ID}`,
          json(makeDoc(USER_A)),
          env,
        )
      ).status,
    ).toBe(401);
  });

  it("보관함 곡도 사용자별로 격리된다", async () => {
    const libraryDeck = makeDeck(USER_A, {
      id: LIB_DECK_ID,
      scope: "library",
      presentationId: null,
    });

    expect(
      (await app.request(`/api/decks/${LIB_DECK_ID}`, json(libraryDeck), env))
        .status,
    ).toBe(200);

    currentUser = USER_B;
    const bList = (await (await app.request("/api/decks", {}, env)).json()) as {
      decks: Deck[];
    };
    expect(bList.decks).toHaveLength(0);

    const hijack = await app.request(
      `/api/decks/${LIB_DECK_ID}`,
      json({ ...libraryDeck, userId: USER_B, title: "탈취" }),
      env,
    );
    expect(hijack.status).toBe(403);

    currentUser = USER_A;
    const aList = (await (await app.request("/api/decks", {}, env)).json()) as {
      decks: Deck[];
    };
    expect(aList.decks).toHaveLength(1);
    expect(aList.decks[0].title).toBe("은혜로다");
  });

  it("옛 클라이언트가 곡에 실어 보낸 공유 라이브러리 필드는 저장하지 않는다", async () => {
    const legacy = {
      visibility: "public",
      forkCount: 999,
      origin: "fork",
      publishedAt: "2026-09-22T00:00:00.000Z",
      takedownAt: null,
    };
    const doc = makeDoc(USER_A);
    doc.items[0].deck = { ...makeDeck(USER_A), ...legacy } as Deck;
    expect(
      (await app.request(`/api/presentations/${DOC_ID}`, json(doc), env))
        .status,
    ).toBe(200);
    const libraryDeck = {
      ...makeDeck(USER_A, {
        id: LIB_DECK_ID,
        scope: "library",
        presentationId: null,
      }),
      ...legacy,
    } as Deck;
    expect(
      (await app.request(`/api/decks/${LIB_DECK_ID}`, json(libraryDeck), env))
        .status,
    ).toBe(200);

    for (const id of [DECK_ID, LIB_DECK_ID]) {
      const row = (await decksCol(env.DB).doc(id).get()).data();
      for (const key of [...Object.keys(legacy), "listed", "searchGrams"]) {
        expect(row, id).not.toHaveProperty(key);
      }
    }
  });

  it("보관함 PUT으로는 가져온 곡 정보를 정하지 못한다", async () => {
    const libraryDeck = makeDeck(USER_A, {
      id: LIB_DECK_ID,
      scope: "library",
      presentationId: null,
      forkedFrom: DECK_ID,
      forkedFromAuthorName: "다른 사람",
    });
    await app.request(`/api/decks/${LIB_DECK_ID}`, json(libraryDeck), env);

    const row = (await decksCol(env.DB).doc(LIB_DECK_ID).get()).data();
    expect(row).toMatchObject({
      forkedFrom: null,
      forkedFromAuthorName: null,
    });
  });

  it("본문의 userId가 세션 사용자와 다르면 403으로 거절하고 어느 계정에도 만들지 않는다", async () => {
    const put = await app.request(
      `/api/presentations/${DOC_ID}`,
      json(makeDoc(USER_B)),
      env,
    );
    const patch = await app.request(
      `/api/presentations/${DOC_ID}`,
      patchJson({ ...toPresentationChanges(makeDoc(USER_A)), userId: USER_B }),
      env,
    );
    const deck = await app.request(
      `/api/decks/${LIB_DECK_ID}`,
      json(
        makeDeck(USER_B, {
          id: LIB_DECK_ID,
          scope: "library",
          presentationId: null,
        }),
      ),
      env,
    );

    expect([put.status, patch.status, deck.status]).toEqual([403, 403, 403]);
    for (const user of [USER_A, USER_B]) {
      currentUser = user;
      const presentations = (await (
        await app.request("/api/presentations", {}, env)
      ).json()) as { presentations: PresentationDocument[] };
      const decks = (await (
        await app.request("/api/decks", {}, env)
      ).json()) as {
        decks: Deck[];
      };
      expect(presentations.presentations).toHaveLength(0);
      expect(decks.decks).toHaveLength(0);
    }
  });

  describe("지운 보관함 곡", () => {
    const libraryDeck = (userId: string = USER_A): Deck =>
      makeDeck(userId, {
        id: LIB_DECK_ID,
        scope: "library",
        presentationId: null,
      });

    const putDeck = (deck: Deck) =>
      app.request(`/api/decks/${deck.id}`, json(deck), env);

    const deleteDeck = (id: string) =>
      app.request(
        `/api/decks/${id}`,
        { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } },
        env,
      );

    const listDecks = async (): Promise<{
      decks: Deck[];
      deletedIds: string[];
    }> => {
      const res = await app.request("/api/decks", {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as { decks: Deck[]; deletedIds: string[] };
    };

    const recreateByOldRevision = () =>
      seedDocs(env.DB, {
        decks: [deckDoc({ id: LIB_DECK_ID, userId: USER_A, title: "되살림" })],
      });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("지운 보관함 곡은 같은 사용자가 다시 올려도 410이고 목록에 돌아오지 않는다", async () => {
      await seedDocs(env.DB, {
        users: [userDoc({ id: USER_A, name: "A", termsAgreedAt: new Date() })],
      });
      expect((await putDeck(libraryDeck())).status).toBe(200);

      const removed = await deleteDeck(LIB_DECK_ID);
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({ ok: true });
      expect(await listDecks()).toEqual({
        decks: [],
        deletedIds: [LIB_DECK_ID],
      });

      const again = await putDeck(libraryDeck());
      expect(again.status).toBe(410);
      expect(await again.json()).toEqual({ error: API_ERRORS.deck.deleted });

      expect(await listDecks()).toEqual({
        decks: [],
        deletedIds: [LIB_DECK_ID],
      });
      expect((await decksCol(env.DB).doc(LIB_DECK_ID).get()).exists).toBe(
        false,
      );
    });

    it("남의 곡을 지우려 하면 404이고, 그 곡도 남의 지운 목록도 그대로다", async () => {
      expect((await putDeck(libraryDeck())).status).toBe(200);

      currentUser = USER_B;
      const res = await deleteDeck(LIB_DECK_ID);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: API_ERRORS.deck.notAccessible,
      });
      expect(await listDecks()).toEqual({ decks: [], deletedIds: [] });

      currentUser = USER_A;
      const mine = await listDecks();
      expect(mine.decks.map((deck) => deck.id)).toEqual([LIB_DECK_ID]);
      expect(mine.deletedIds).toEqual([]);
    });

    it("형식이 틀린 id를 지우면 404이고 기록을 남기지 않는다", async () => {
      for (const id of ["not-an-id", "__abcdefghijklmnopq__"]) {
        expect((await deleteDeck(id)).status).toBe(404);
      }
      expect((await driveTombstonesCol(env.DB).get()).empty).toBe(true);
    });

    it("올린 적 없는 곡을 지워도 200이고, 그 뒤에 도착한 저장은 410이다", async () => {
      const removed = await deleteDeck(LIB_DECK_ID);
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({ ok: true });

      const late = await putDeck(libraryDeck());
      expect(late.status).toBe(410);
      expect(await late.json()).toEqual({ error: API_ERRORS.deck.deleted });
      expect(await listDecks()).toEqual({
        decks: [],
        deletedIds: [LIB_DECK_ID],
      });
    });

    it("옛 리비전이 기록 옆에 다시 만든 곡은 목록에서 빼고 지운다", async () => {
      expect((await deleteDeck(LIB_DECK_ID)).status).toBe(200);
      await recreateByOldRevision();

      expect(await listDecks()).toEqual({
        decks: [],
        deletedIds: [LIB_DECK_ID],
      });
      expect((await decksCol(env.DB).doc(LIB_DECK_ID).get()).exists).toBe(
        false,
      );
    });

    it("다시 만든 곡을 지우지 못해도 목록은 그 곡을 빼고 답한다", async () => {
      expect((await deleteDeck(LIB_DECK_ID)).status).toBe(200);
      await recreateByOldRevision();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(env.DB, "runTransaction").mockRejectedValue(
        new Error("14 UNAVAILABLE: connection reset"),
      );

      expect(await listDecks()).toEqual({
        decks: [],
        deletedIds: [LIB_DECK_ID],
      });

      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
        severity: "ERROR",
        deckId: LIB_DECK_ID,
      });
      expect((await decksCol(env.DB).doc(LIB_DECK_ID).get()).exists).toBe(true);
    });
  });

  describe("보관함 곡의 시각과 빈 공개 곡", () => {
    const libraryDeck = (overrides: Partial<Deck> = {}): Deck =>
      makeDeck(USER_A, {
        id: LIB_DECK_ID,
        scope: "library",
        presentationId: null,
        ...overrides,
      });

    const putDeck = (deck: Deck) =>
      app.request(`/api/decks/${deck.id}`, json(deck), env);

    it("미래 시각은 서버 시계 + 5분까지로 줄여 저장하고 줄인 곡을 돌려준다", async () => {
      const before = Date.now();
      const res = await putDeck(
        libraryDeck({
          createdAt: "9999-12-31T00:00:00.000Z",
          updatedAt: "9999-12-31T00:00:00.000Z",
        }),
      );
      const after = Date.now();

      expect(res.status).toBe(200);
      const { deck } = (await res.json()) as { deck: Deck };
      const row = (await decksCol(env.DB).doc(LIB_DECK_ID).get()).data();
      for (const time of [
        Date.parse(deck.createdAt),
        Date.parse(deck.updatedAt),
        row?.createdAt.getTime() ?? 0,
        row?.updatedAt.getTime() ?? 0,
      ]) {
        expect(time).toBeGreaterThanOrEqual(before + MAX_CLOCK_SKEW_MS);
        expect(time).toBeLessThanOrEqual(after + MAX_CLOCK_SKEW_MS);
      }
    });

    it("늦게 도착한 옛 수정은 200과 저장된 새 곡으로 답한다", async () => {
      expect((await putDeck(libraryDeck())).status).toBe(200);
      const newer = await putDeck(
        libraryDeck({
          title: "새 제목",
          updatedAt: "2026-09-23T00:00:00.000Z",
        }),
      );
      const stored = (await newer.json()) as { ok: true; deck: Deck };

      const late = await putDeck(
        libraryDeck({
          title: "옛 제목",
          updatedAt: "2026-09-22T00:00:00.000Z",
        }),
      );

      expect(late.status).toBe(200);
      expect(await late.json()).toEqual(stored);
      expect(stored.deck.title).toBe("새 제목");
    });
  });

  describe("2-기기 왕복", () => {
    beforeEach(async () => {
      await resetBackgrounds(5);
    });

    function makeServiceSet(userId: string): PresentationDocument {
      const titles = [
        "시간을 뚫고",
        "은혜로다",
        "주 품에",
        "소원",
        "밤이나 낮이나",
      ];
      const presentationId = "1000000000000000000bb";

      return PresentationDocumentSchema.parse({
        id: presentationId,
        userId,
        title: "주일 1·2부 연합예배",
        serviceDate: "2026-09-27",
        items: titles.map((title, index) => {
          const deckId = `c0000000000000000c${index}0${index}`;
          return {
            id: `30000000000000000c${index}0${index}`,
            presentationId,
            deckId,
            order: index,
            deck: {
              id: deckId,
              userId,
              scope: "presentation",
              presentationId,
              title,
              artist: "테스트",
              lyricsRaw: `${title} 1절\n\n${title} 2절`,
              slides: [
                { id: `s_${index}_1`, order: 0, lines: [`${title} 1절`] },
                { id: `s_${index}_2`, order: 1, lines: [`${title} 2절`] },
              ],
              backgroundId: serviceBackgroundId(index + 1),
              style: {
                ...DEFAULT_DECK_STYLE,
                overlayOpacity: 40 + index * 5,
                fontSizeVw: 4 + index * 0.2,
              },
              forkedFrom: null,
              createdAt: "2026-09-20T00:00:00.000Z",
              updatedAt: "2026-09-21T00:00:00.000Z",
            },
          };
        }),
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      });
    }

    it("A 기기에서 만든 5곡 세트를 B 기기에서 그대로 받는다", async () => {
      const original = makeServiceSet(USER_A);

      const put = await app.request(
        `/api/presentations/${original.id}`,
        json(original),
        env,
      );
      expect(put.status).toBe(200);

      const res = await app.request("/api/presentations", {}, env);
      const { presentations } = (await res.json()) as {
        presentations: PresentationDocument[];
      };

      expect(presentations).toHaveLength(1);
      const restored = presentations[0];

      expect(restored.title).toBe("주일 1·2부 연합예배");
      expect(restored.serviceDate).toBe("2026-09-27");
      expect(restored.items).toHaveLength(5);

      expect(restored.items.map((item) => item.deck.title)).toEqual(
        original.items.map((item) => item.deck.title),
      );
      expect(
        restored.items.map((item) => item.deck.style.overlayOpacity),
      ).toEqual(original.items.map((item) => item.deck.style.overlayOpacity));
      expect(restored.items.map((item) => item.deck.backgroundId)).toEqual(
        original.items.map((item) => item.deck.backgroundId),
      );
      expect(restored.items[0].deck.slides[0].lines).toEqual([
        "시간을 뚫고 1절",
      ]);
      expect(restored.items.map((item) => item.deck.id)).toEqual(
        original.items.map((item) => item.deck.id),
      );
    });

    it("A 기기에서 곡 순서를 바꾸면 B 기기도 같은 순서를 받는다", async () => {
      const original = makeServiceSet(USER_A);
      await app.request(
        `/api/presentations/${original.id}`,
        json(original),
        env,
      );

      const reordered = {
        ...original,
        items: [...original.items]
          .reverse()
          .map((item, index) => ({ ...item, order: index })),
        updatedAt: "2026-09-22T00:00:00.000Z",
      };
      await app.request(
        `/api/presentations/${original.id}`,
        json(reordered),
        env,
      );

      const res = await app.request("/api/presentations", {}, env);
      const { presentations } = (await res.json()) as {
        presentations: PresentationDocument[];
      };

      expect(presentations[0].items.map((item) => item.deck.title)).toEqual([
        "밤이나 낮이나",
        "소원",
        "주 품에",
        "은혜로다",
        "시간을 뚫고",
      ]);
      expect(presentations[0].items).toHaveLength(5);
    });
  });

  describe("배경 외래키 (동기화 500 회귀)", () => {
    let serviceIds: string[] = [];

    beforeEach(async () => {
      serviceIds = await resetBackgrounds(5);
    });

    it("배경이 붙은 세트를 저장해도 500이 나지 않는다", async () => {
      const doc = makeDoc(USER_A);
      doc.items[0].deck.backgroundId = serviceIds[0];

      const put = await app.request(
        `/api/presentations/${DOC_ID}`,
        json(doc),
        env,
      );

      expect(put.status).toBe(200);

      const res = await app.request("/api/presentations", {}, env);
      const body = (await res.json()) as {
        presentations: PresentationDocument[];
      };
      expect(body.presentations[0].items[0].deck.backgroundId).toBe(
        serviceIds[0],
      );
    });

    it("서버가 모르는 배경 id는 세트를 날리는 대신 '배경 없음'으로 낮춘다", async () => {
      const unknown = "b99999999999999999999";
      const doc = makeDoc(USER_A);
      doc.items[0].deck.backgroundId = unknown;

      const put = await app.request(
        `/api/presentations/${DOC_ID}`,
        json(doc),
        env,
      );

      expect(put.status).toBe(200);

      const res = await app.request("/api/presentations", {}, env);
      const body = (await res.json()) as {
        presentations: PresentationDocument[];
      };
      expect(body.presentations[0].items[0].deck.backgroundId).toBeNull();
      expect(body.presentations[0].items[0].deck.slides[0].lines).toEqual([
        "시작됐네",
      ]);
      expect(body.presentations[0].items[0].deck.style.overlayOpacity).toBe(65);
    });

    it("저장된 사본을 모르는 배경으로 바꿔도 '배경 없음'으로 저장된다", async () => {
      const doc = makeDoc(USER_A);
      doc.items[0].deck.backgroundId = serviceIds[0];
      await app.request(`/api/presentations/${DOC_ID}`, json(doc), env);

      doc.items[0].deck.backgroundId = "b99999999999999999999";
      doc.items[0].deck.title = "수정한 곡";
      const put = await app.request(
        `/api/presentations/${DOC_ID}`,
        json(doc),
        env,
      );
      expect(put.status).toBe(200);

      const res = await app.request("/api/presentations", {}, env);
      const body = (await res.json()) as {
        presentations: PresentationDocument[];
      };
      expect(body.presentations[0].items[0].deck).toMatchObject({
        title: "수정한 곡",
        backgroundId: null,
      });
    });

    it("곡마다 배경이 다른 5곡 세트도 그대로 저장된다", async () => {
      const doc = makeDoc(USER_A);
      doc.items = serviceIds.map((backgroundId, index) => ({
        id: `30000000000000000000${index + 1}`,
        presentationId: DOC_ID,
        deckId: `c0000000000000000000${index + 1}`,
        order: index,
        deck: makeDeck(USER_A, {
          id: `c0000000000000000000${index + 1}`,
          title: `${index + 1}번째 곡`,
          backgroundId,
        }),
      }));

      const put = await app.request(
        `/api/presentations/${DOC_ID}`,
        json(doc),
        env,
      );
      expect(put.status).toBe(200);

      const res = await app.request("/api/presentations", {}, env);
      const body = (await res.json()) as {
        presentations: PresentationDocument[];
      };
      expect(
        body.presentations[0].items.map((item) => item.deck.backgroundId),
      ).toEqual(serviceIds);
    });
  });

  describe("동기화 라우트 멱등성 및 일시 오류", () => {
    beforeEach(async () => {
      await clearDb(env.DB);
      await seedDocs(env.DB, {
        users: [
          {
            id: USER_A,
            name: "A",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ].map((row) => userDoc(row)),
      });
      currentUser = USER_A;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("PUT /api/presentations/:id 를 같은 본문으로 두 번 보내도 결과가 같다", async () => {
      const doc = makeDoc(USER_A);
      const first = await app.request(
        `/api/presentations/${DOC_ID}`,
        json(doc),
        env,
      );
      expect(first.status).toBe(200);

      const second = await app.request(
        `/api/presentations/${DOC_ID}`,
        json(doc),
        env,
      );
      expect(second.status).toBe(200);

      const get = await app.request(`/api/presentations/${DOC_ID}`, {}, env);
      const body = (await get.json()) as { presentation: PresentationDocument };
      expect(body.presentation.id).toBe(DOC_ID);
      expect(body.presentation.title).toBe(doc.title);
    });

    it("PATCH /api/presentations/:id 를 같은 본문으로 두 번 보내도 결과가 같다", async () => {
      const doc = makeDoc(USER_A);
      const changes = toPresentationChanges(doc);

      const first = await app.request(
        `/api/presentations/${DOC_ID}`,
        patchJson(changes),
        env,
      );
      expect(first.status).toBe(200);

      const second = await app.request(
        `/api/presentations/${DOC_ID}`,
        patchJson(changes),
        env,
      );
      expect(second.status).toBe(200);

      const get = await app.request(`/api/presentations/${DOC_ID}`, {}, env);
      const body = (await get.json()) as { presentation: PresentationDocument };
      expect(body.presentation.id).toBe(DOC_ID);
      expect(body.presentation.title).toBe(doc.title);
    });

    it("PUT /api/decks/:id 를 같은 본문으로 두 번 보내도 결과가 같다", async () => {
      const libDeck = makeDeck(USER_A, {
        id: LIB_DECK_ID,
        scope: "library",
        presentationId: null,
      });
      const first = await app.request(
        `/api/decks/${LIB_DECK_ID}`,
        json(libDeck),
        env,
      );
      expect(first.status).toBe(200);
      const firstBody = await first.json();

      const second = await app.request(
        `/api/decks/${LIB_DECK_ID}`,
        json(libDeck),
        env,
      );
      expect(second.status).toBe(200);
      const secondBody = await second.json();

      expect(firstBody).toEqual(secondBody);
    });

    it("PUT /api/folders/:id 를 같은 본문으로 두 번 보내도 결과가 같다", async () => {
      const folderData = FolderSchema.parse({
        id: "f000000000000000000aa",
        userId: USER_A,
        parentId: null,
        name: "주일 찬양",
        trashedAt: null,
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-20T00:00:00.000Z",
      });

      const first = await app.request(
        `/api/folders/${folderData.id}`,
        json(folderData),
        env,
      );
      expect(first.status).toBe(200);
      const firstBody = await first.json();

      const second = await app.request(
        `/api/folders/${folderData.id}`,
        json(folderData),
        env,
      );
      expect(second.status).toBe(200);
      const secondBody = await second.json();

      expect(firstBody).toEqual(secondBody);
    });

    it("저장할 수 없을 만큼 큰 곡이 든 프레젠테이션 저장은 그 곡을 짚어 413으로 답하고 아무것도 쓰지 않는다", async () => {
      const base = toPresentationChanges(makeDoc(USER_A));
      const longDeck = makeDeck(USER_A, {
        id: "c000000000000000000ab",
        title: "긴 곡",
        lyricsRaw: "가".repeat(400_000),
      });
      const changes = {
        ...base,
        items: [
          ...base.items,
          { id: "3000000000000000000ab", deckId: longDeck.id, order: 1 },
        ],
        decks: [...base.decks, longDeck],
      };

      const res = await app.request(
        `/api/presentations/${DOC_ID}`,
        patchJson(changes),
        env,
      );

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        error: API_ERRORS.presentation.songTooLarge("긴 곡"),
      });
      const get = await app.request(`/api/presentations/${DOC_ID}`, {}, env);
      expect(get.status).toBe(404);
    });

    it("Firestore 문서 한도를 넘는 보관함 곡 저장은 413으로 답한다", async () => {
      const tooLargeEnv = {
        ...env,
        DB: new Proxy(env.DB, {
          get(target, prop) {
            if (prop === "runTransaction") {
              return async () => {
                throw Object.assign(
                  new Error(
                    `3 INVALID_ARGUMENT: Document 'decks/${LIB_DECK_ID}' cannot be written because its size (1,234,567 bytes) exceeds the maximum allowed size of 1,048,576 bytes.`,
                  ),
                  { code: 3 },
                );
              };
            }
            return Reflect.get(target, prop);
          },
        }) as Db,
      };

      const res = await app.request(
        `/api/decks/${LIB_DECK_ID}`,
        json(
          makeDeck(USER_A, {
            id: LIB_DECK_ID,
            scope: "library",
            presentationId: null,
          }),
        ),
        tooLargeEnv,
      );

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: API_ERRORS.deck.tooLarge });
      expect((await decksCol(env.DB).doc(LIB_DECK_ID).get()).exists).toBe(
        false,
      );
    });

    it("Firestore 일시 장애(트랜잭션 경합 등)가 이어지면 503의 Retry-After가 2초에 머물지 않고 늘어난다", async () => {
      vi.spyOn(Math, "random").mockReturnValue(1);
      const freshApp = createApp({ readSession: fakeSession });
      const brokenEnv = {
        ...env,
        DB: new Proxy(env.DB, {
          get(target, prop) {
            if (prop === "runTransaction") {
              return async () => {
                throw Object.assign(
                  new Error(
                    "10 ABORTED: Too much contention on these documents.",
                  ),
                  { code: 10 },
                );
              };
            }
            return Reflect.get(target, prop);
          },
        }) as Db,
      };

      const retryAfters: (string | null)[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await freshApp.request(
          `/api/presentations/${DOC_ID}`,
          json(makeDoc(USER_A)),
          brokenEnv,
        );
        expect(res.status).toBe(503);
        retryAfters.push(res.headers.get("Retry-After"));
      }

      expect(retryAfters).toEqual(["4", "8", "16"]);
    });
  });
});
