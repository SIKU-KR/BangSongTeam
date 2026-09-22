import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  type Deck,
  type PresentationDocument,
} from "@repo/shared";
import {
  createD1Client,
  getPresentationDocumentsByUserId,
  upsertPresentationDocument,
  deletePresentation,
  getMyLibraryDecks,
  upsertDeck,
  deleteDeckScoped,
  toSharedDeck,
} from "@repo/db";
import { user } from "@repo/db";
import type { AppEnv } from "../types";
import { createRequireAuth, type SessionReader } from "../middleware/auth";

/**
 * 동기화 라우트의 교차 사용자 격리 검증.
 *
 * D1에는 Postgres식 RLS가 없다. 모든 방어가 쿼리 헬퍼의 userId 조건 하나에
 * 달려 있으므로, "A가 저장한 것을 B가 못 읽고 못 고치고 못 지운다"를
 * 라우트 레벨에서 고정해 둔다.
 *
 * 실제 세션 발급(OAuth 왕복)은 여기서 재현할 수 없으므로 세션 리더만
 * 주입하고, 그 아래 경로는 프로덕션과 동일한 라우트 구현을 그대로 쓴다.
 */

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";

let currentUser: string | null = USER_A;

const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;

/** 프로덕션 라우트와 같은 핸들러에 가짜 세션만 끼운 앱 */
function buildApp() {
  const requireAuth = createRequireAuth(fakeSession);

  const presentations = new Hono<AppEnv>()
    .use("*", requireAuth)
    .get("/", async (c) => {
      const db = createD1Client(c.env.DB);
      return c.json(
        {
          presentations: await getPresentationDocumentsByUserId(
            db,
            c.get("userId") as string,
          ),
        },
        200,
      );
    })
    .put("/:id", zValidator("json", PresentationDocumentSchema), async (c) => {
      const db = createD1Client(c.env.DB);
      const saved = await upsertPresentationDocument(
        db,
        c.get("userId") as string,
        c.req.valid("json"),
      );
      return saved
        ? c.json({ ok: true as const }, 200)
        : c.json({ error: "forbidden" }, 403);
    })
    .delete("/:id", async (c) => {
      const db = createD1Client(c.env.DB);
      const removed = await deletePresentation(
        db,
        c.req.param("id"),
        c.get("userId") as string,
      );
      return removed
        ? c.json({ ok: true as const }, 200)
        : c.json({ error: "not found" }, 404);
    });

  const decksApi = new Hono<AppEnv>()
    .use("*", requireAuth)
    .get("/", async (c) => {
      const db = createD1Client(c.env.DB);
      const rows = await getMyLibraryDecks(db, c.get("userId") as string);
      return c.json({ decks: rows.map(toSharedDeck) }, 200);
    })
    .put("/:id", zValidator("json", DeckSchema), async (c) => {
      const db = createD1Client(c.env.DB);
      const saved = await upsertDeck(
        db,
        c.get("userId") as string,
        c.req.valid("json"),
      );
      return saved
        ? c.json({ ok: true as const }, 200)
        : c.json({ error: "forbidden" }, 403);
    })
    .delete("/:id", async (c) => {
      const db = createD1Client(c.env.DB);
      const removed = await deleteDeckScoped(
        db,
        c.req.param("id"),
        c.get("userId") as string,
      );
      return removed
        ? c.json({ ok: true as const }, 200)
        : c.json({ error: "not found" }, 404);
    });

  return new Hono<AppEnv>()
    .route("/api/presentations", presentations)
    .route("/api/decks", decksApi);
}

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

const app = buildApp();

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
});
