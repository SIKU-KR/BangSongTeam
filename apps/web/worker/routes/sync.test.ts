import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  type Deck,
  type PresentationDocument,
} from "@repo/shared";
import { createD1Client } from "@repo/db";
import { user, backgrounds } from "@repo/db";
import { INITIAL_BACKGROUNDS } from "@repo/shared";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

/**
 * 동기화 라우트의 교차 사용자 격리 검증.
 *
 * D1에는 Postgres식 RLS가 없다. 모든 방어가 쿼리 헬퍼의 userId 조건 하나에
 * 달려 있으므로, "A가 저장한 것을 B가 못 읽고 못 고치고 못 지운다"를
 * 라우트 레벨에서 고정해 둔다.
 *
 * 실제 세션 발급(OAuth 왕복)은 여기서 재현할 수 없으므로 세션 리더만
 * 주입하고(`createApp({ readSession })`), 그 아래는 프로덕션 라우트를 그대로 쓴다.
 */

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";

let currentUser: string | null = USER_A;

const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;

const DOC_ID = "10000000-0000-4000-8000-0000000000aa";
const DECK_ID = "c0000000-0000-4000-8000-0000000000aa";
const LIB_DECK_ID = "c0000000-0000-4000-8000-0000000000bb";

function makeDeck(userId: string, overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id: DECK_ID,
    userId,
    catalogId: null,
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
        id: "30000000-0000-4000-8000-0000000000aa",
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

/** 실제 라우트에 가짜 세션만 끼운 앱 */
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
    // 테스트 간 상태가 남지 않게 정리한다 (isolatedStorage: false).
    await env.DB.exec("DELETE FROM presentation_items");
    await env.DB.exec("DELETE FROM decks");
    await env.DB.exec("DELETE FROM presentations");
    await env.DB.exec(
      `DELETE FROM user WHERE id IN ('${USER_A}', '${USER_B}')`,
    );

    await db.insert(user).values([
      { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
    // 배경은 더 이상 여기서 시드하지 않는다. `0002_seed_backgrounds.sql`
    // 마이그레이션이 채우므로, 시드하지 않고도 통과하는 것 자체가 회귀 방지선이다
    // (그 마이그레이션이 없던 시절 운영 D1의 backgrounds가 비어 있어
    //  decks.background_id 외래키 위반으로 동기화가 500으로 죽었다).
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

  it("세트 복제본은 공개로 보내도 비공개로 저장되고 검색 인덱스에 들어가지 않는다 (M5-1)", async () => {
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

    const row = await env.DB.prepare(
      "SELECT visibility, fork_count, published_at FROM decks WHERE id = ?",
    )
      .bind(DECK_ID)
      .first<{
        visibility: string;
        fork_count: number;
        published_at: number | null;
      }>();
    expect(row).toEqual({
      visibility: "private",
      fork_count: 0,
      published_at: null,
    });

    const indexed = await env.DB.prepare(
      "SELECT count(*) AS n FROM decks_fts WHERE deck_id = ?",
    )
      .bind(DECK_ID)
      .first<{ n: number }>();
    expect(indexed?.n).toBe(0);
  });

  it("보관함 PUT으로는 공개·가져간 횟수를 바꿀 수 없다 (M5-1)", async () => {
    const libraryDeck = makeDeck(USER_A, {
      id: LIB_DECK_ID,
      scope: "library",
      presentationId: null,
      visibility: "public",
      forkCount: 999,
    });
    await app.request(`/api/decks/${LIB_DECK_ID}`, json(libraryDeck), env);

    const row = await env.DB.prepare(
      "SELECT visibility, fork_count FROM decks WHERE id = ?",
    )
      .bind(LIB_DECK_ID)
      .first<{ visibility: string; fork_count: number }>();
    expect(row).toEqual({ visibility: "private", fork_count: 0 });
  });

  it("본문의 userId를 믿지 않는다", async () => {
    // A 세션으로 B 소유라고 주장하는 문서를 밀어 넣어도 A 것이 된다.
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
  describe("2-기기 왕복 (M3-B 완료 기준)", () => {
    /** 5곡짜리 실제 예배 세트 */
    function makeServiceSet(userId: string): PresentationDocument {
      const titles = [
        "시간을 뚫고",
        "은혜로다",
        "주 품에",
        "소원",
        "밤이나 낮이나",
      ];
      const presentationId = "10000000-0000-4000-8000-0000000000bb";

      return PresentationDocumentSchema.parse({
        id: presentationId,
        userId,
        title: "주일 1·2부 연합예배",
        serviceDate: "2026-09-27",
        items: titles.map((title, index) => {
          const deckId = `c0000000-0000-4000-8000-00000000c${index}0${index}`;
          return {
            id: `30000000-0000-4000-8000-00000000c${index}0${index}`,
            presentationId,
            deckId,
            order: index,
            deck: {
              id: deckId,
              userId,
              catalogId: null,
              scope: "presentation",
              presentationId,
              title,
              artist: "테스트",
              lyricsRaw: `${title} 1절\n\n${title} 2절`,
              slides: [
                { id: `s_${index}_1`, order: 0, lines: [`${title} 1절`] },
                { id: `s_${index}_2`, order: 1, lines: [`${title} 2절`] },
              ],
              backgroundId: `b0000000-0000-0000-0000-00000000000${index + 1}`,
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
      // M3-B 완료 기준: '다른 PC에서 로그인해 같은 세트를 그대로 송출'.
      // 여기서는 서버 왕복까지 고정하고, 실제 2대 PC 확인은 사람이 한다.
      const original = makeServiceSet(USER_A);

      const put = await app.request(
        `/api/presentations/${original.id}`,
        json(original),
        env,
      );
      expect(put.status).toBe(200);

      // B 기기 = 같은 계정, 로컬 저장소가 빈 상태에서 받아 오는 것과 같다
      const res = await app.request("/api/presentations", {}, env);
      const { presentations } = (await res.json()) as {
        presentations: PresentationDocument[];
      };

      expect(presentations).toHaveLength(1);
      const restored = presentations[0];

      expect(restored.title).toBe("주일 1·2부 연합예배");
      expect(restored.serviceDate).toBe("2026-09-27");
      expect(restored.items).toHaveLength(5);

      // 곡 순서
      expect(restored.items.map((item) => item.deck.title)).toEqual(
        original.items.map((item) => item.deck.title),
      );
      // 곡별 스타일
      expect(
        restored.items.map((item) => item.deck.style.overlayOpacity),
      ).toEqual(original.items.map((item) => item.deck.style.overlayOpacity));
      // 곡별 배경
      expect(restored.items.map((item) => item.deck.backgroundId)).toEqual(
        original.items.map((item) => item.deck.backgroundId),
      );
      // 송출에 필요한 슬라이드 내용
      expect(restored.items[0].deck.slides[0].lines).toEqual([
        "시간을 뚫고 1절",
      ]);
      // 클라이언트가 만든 id가 보존되어야 동기화가 중복 생성이 되지 않는다
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

      // 1번과 5번 곡을 맞바꾼다
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
      // 곡 수가 늘어나면 안 된다 (교체지 추가가 아니다)
      expect(presentations[0].items).toHaveLength(5);
    });
  });

  /**
   * 배경 외래키 회귀.
   *
   * `decks.background_id`는 `backgrounds`를 참조하고 D1은 외래키를 기본으로 강제한다.
   * 운영 D1에 배경 10건을 넣는 경로가 아예 없어서, 곡에 배경이 붙는 순간
   * `db.batch()` 전체가 롤백되고 동기화가 500으로 죽었다. 로컬 저장은 멀쩡했기 때문에
   * 편집·송출은 되는데 기기 간 동기화만 조용히 실패하는 상태였다.
   */
  describe("배경 외래키 (동기화 500 회귀)", () => {
    it("사전 주입 배경은 마이그레이션으로 이미 들어가 있다", async () => {
      const db = createD1Client(env.DB);
      const rows = await db.select({ id: backgrounds.id }).from(backgrounds);

      expect(rows).toHaveLength(INITIAL_BACKGROUNDS.length);
      // 클라이언트가 실제로 찍는 id가 서버에 있어야 한다.
      expect(rows.map((row) => row.id)).toContain(INITIAL_BACKGROUNDS[0].id);
    });

    it("배경이 붙은 세트를 저장해도 500이 나지 않는다", async () => {
      const doc = makeDoc(USER_A);
      doc.items[0].deck.backgroundId = INITIAL_BACKGROUNDS[0].id;

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
        INITIAL_BACKGROUNDS[0].id,
      );
    });

    it("서버가 모르는 배경 id는 세트를 날리는 대신 '배경 없음'으로 낮춘다", async () => {
      const unknown = "b9999999-9999-4999-8999-999999999999";
      const doc = makeDoc(USER_A);
      doc.items[0].deck.backgroundId = unknown;

      const put = await app.request(
        `/api/presentations/${DOC_ID}`,
        json(doc),
        env,
      );

      // 배경 하나 때문에 가사까지 통째로 잃으면 안 된다.
      expect(put.status).toBe(200);

      const res = await app.request("/api/presentations", {}, env);
      const body = (await res.json()) as {
        presentations: PresentationDocument[];
      };
      expect(body.presentations[0].items[0].deck.backgroundId).toBeNull();
      // 작업물(가사·스타일)은 그대로 살아 있어야 한다.
      expect(body.presentations[0].items[0].deck.slides[0].lines).toEqual([
        "시작됐네",
      ]);
      expect(body.presentations[0].items[0].deck.style.overlayOpacity).toBe(65);
    });

    it("곡마다 배경이 다른 5곡 세트도 그대로 저장된다", async () => {
      const doc = makeDoc(USER_A);
      doc.items = INITIAL_BACKGROUNDS.slice(0, 5).map((background, index) => ({
        id: `30000000-0000-4000-8000-00000000000${index + 1}`,
        presentationId: DOC_ID,
        deckId: `c0000000-0000-4000-8000-00000000000${index + 1}`,
        order: index,
        deck: makeDeck(USER_A, {
          id: `c0000000-0000-4000-8000-00000000000${index + 1}`,
          title: `${index + 1}번째 곡`,
          backgroundId: background.id,
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
      ).toEqual(INITIAL_BACKGROUNDS.slice(0, 5).map((bg) => bg.id));
    });
  });
});
