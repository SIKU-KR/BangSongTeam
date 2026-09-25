import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { count, eq, inArray } from "drizzle-orm";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  type Deck,
  type PresentationDocument,
} from "#shared";
import {
  createD1Client,
  decks,
  decksFts,
  presentationItems,
  presentations,
  user,
} from "#db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import { clearTables } from "../test/db";
import {
  insertUserBackgroundRow,
  resetBackgrounds,
  serviceBackgroundId,
} from "../test/backgrounds";

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
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
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

describe("동기화 라우트 교차 사용자 격리", () => {
  beforeEach(async () => {
    const db = createD1Client(env.DB);
    await clearTables(presentationItems, decks, presentations);
    await db.delete(user).where(inArray(user.id, [USER_A, USER_B]));

    await db.insert(user).values([
      { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
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
      { method: "DELETE" },
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

  it("세트 복제본은 공개로 보내도 비공개로 저장되고 검색 인덱스에 들어가지 않는다", async () => {
    const doc = makeDoc(USER_A);
    doc.items[0].deck = makeDeck(USER_A, {
      visibility: "public",
      forkCount: 999,
      publishedAt: "2026-09-22T00:00:00.000Z",
    });
    expect(
      (await app.request(`/api/presentations/${DOC_ID}`, json(doc), env))
        .status,
    ).toBe(200);

    const db = createD1Client(env.DB);
    const row = await db
      .select({
        visibility: decks.visibility,
        forkCount: decks.forkCount,
        publishedAt: decks.publishedAt,
      })
      .from(decks)
      .where(eq(decks.id, DECK_ID))
      .get();
    expect(row).toEqual({
      visibility: "private",
      forkCount: 0,
      publishedAt: null,
    });

    const indexed = await db
      .select({ n: count() })
      .from(decksFts)
      .where(eq(decksFts.deckId, DECK_ID))
      .get();
    expect(indexed?.n).toBe(0);
  });

  it("보관함 PUT으로는 공개·가져간 횟수를 바꿀 수 없다", async () => {
    const libraryDeck = makeDeck(USER_A, {
      id: LIB_DECK_ID,
      scope: "library",
      presentationId: null,
      visibility: "public",
      forkCount: 999,
    });
    await app.request(`/api/decks/${LIB_DECK_ID}`, json(libraryDeck), env);

    const row = await createD1Client(env.DB)
      .select({ visibility: decks.visibility, forkCount: decks.forkCount })
      .from(decks)
      .where(eq(decks.id, LIB_DECK_ID))
      .get();
    expect(row).toEqual({ visibility: "private", forkCount: 0 });
  });

  it("본문의 userId를 믿지 않는다", async () => {
    await app.request(
      `/api/presentations/${DOC_ID}`,
      json(makeDoc(USER_B)),
      env,
    );

    currentUser = USER_B;
    const bBody = (await (
      await app.request("/api/presentations", {}, env)
    ).json()) as { presentations: PresentationDocument[] };
    expect(bBody.presentations).toHaveLength(0);

    currentUser = USER_A;
    const aBody = (await (
      await app.request("/api/presentations", {}, env)
    ).json()) as { presentations: PresentationDocument[] };
    expect(aBody.presentations).toHaveLength(1);
    expect(aBody.presentations[0].userId).toBe(USER_A);
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
              visibility: "private",
              forkedFrom: null,
              forkCount: 0,
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
    const OTHERS_BACKGROUND = "othr00000000000000001";
    let serviceIds: string[] = [];

    beforeEach(async () => {
      serviceIds = await resetBackgrounds(5);
      await insertUserBackgroundRow(USER_B, OTHERS_BACKGROUND);
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

    it("예전 사용자 업로드 id는 세트에 걸리지 않는다", async () => {
      const doc = makeDoc(USER_A);
      doc.items[0].deck.backgroundId = OTHERS_BACKGROUND;

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
    });
  });
});
