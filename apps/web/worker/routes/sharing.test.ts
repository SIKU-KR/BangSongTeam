import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  SearchCatalogResponseSchema,
  type Deck,
  type SearchCatalogResponse,
} from "@repo/shared";
import { createD1Client, user } from "@repo/db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

/**
 * 공유 라이브러리 경로 통합 검증 (M5-3).
 *
 * 실제 라우트(`createApp`)에 세션 리더만 주입한다. D1에는 RLS가 없으므로
 * "남의 비공개 곡은 어떤 경로로도 보이지 않는다"를 라우트 레벨에서 고정한다.
 */
const A = "aaaaaaaa3000000000001";
const B = "bbbbbbbb3000000000002";
const PUB = "c00000003000000000001";
const PRIV = "c00000003000000000002";
const SET_ID = "100000003000000000001";
const CLONE = "c00000003000000000003";

let currentUser: string | null = A;
const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;
const app = createApp({ readSession: fakeSession });

function deck(id: string, overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id,
    userId: A,
    scope: "library",
    presentationId: null,
    title: "은혜로다 주의 은혜",
    artist: "예수전도단",
    lyricsRaw:
      "시작됐네 우리 주님의 능력이\n나의 삶을 다스리시네\n\n둘째 슬라이드",
    slides: [
      {
        id: "s1",
        order: 0,
        lines: ["시작됐네 우리 주님의 능력이", "나의 삶을 다스리시네"],
      },
      { id: "s2", order: 1, lines: ["둘째 슬라이드"] },
    ],
    backgroundId: null,
    style: { ...DEFAULT_DECK_STYLE, overlayOpacity: 70 },
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function request(method: string, path: string, body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
  );
}

async function search(q: string): Promise<SearchCatalogResponse> {
  const res = await request(
    "GET",
    `/api/catalog/search?q=${encodeURIComponent(q)}`,
  );
  expect(res.status).toBe(200);
  return SearchCatalogResponseSchema.parse(await res.json());
}

const publish = (id: string) =>
  request("PATCH", `/api/decks/${id}/visibility`, {
    visibility: "public",
    acceptedCopyrightNotice: true,
  });

describe("공유 라이브러리 API", () => {
  beforeEach(async () => {
    for (const table of [
      "reports",
      "presentation_items",
      "decks",
      "presentations",
    ]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec(`DELETE FROM user WHERE id IN ('${A}', '${B}')`);
    await createD1Client(env.DB)
      .insert(user)
      .values([
        { id: A, name: "김찬양", createdAt: new Date(), updatedAt: new Date() },
        { id: B, name: "이예배", createdAt: new Date(), updatedAt: new Date() },
      ]);

    currentUser = A;
    await request("PUT", `/api/decks/${PUB}`, deck(PUB));
    await request(
      "PUT",
      `/api/decks/${PRIV}`,
      deck(PRIV, { title: "은혜 비공개 곡" }),
    );
  });

  describe("공개 전환", () => {
    it("requires the copyright notice consent as literal true", async () => {
      const res = await request("PATCH", `/api/decks/${PUB}/visibility`, {
        visibility: "public",
        acceptedCopyrightNotice: false,
      });
      expect(res.status).toBe(400);
      expect((await search("은혜로다")).decks).toHaveLength(0);
    });

    it("publishes the owner's deck and returns the server deck", async () => {
      const res = await publish(PUB);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deck: Deck };
      expect(body.deck.visibility).toBe("public");
      expect(body.deck.publishedAt).not.toBeNull();
    });

    it("hides someone else's deck behind 404", async () => {
      currentUser = B;
      expect((await publish(PUB)).status).toBe(404);
    });

    it("refuses to republish a taken-down deck", async () => {
      await env.DB.prepare(
        "UPDATE decks SET takedown_at = unixepoch() WHERE id = ?",
      )
        .bind(PUB)
        .run();
      expect((await publish(PUB)).status).toBe(409);
    });

    it("requires a session", async () => {
      currentUser = null;
      expect((await publish(PUB)).status).toBe(401);
    });
  });

  describe("검색·상세·가져오기 (PRD 8 M5 완료 기준 a의 서버 경로)", () => {
    beforeEach(async () => {
      await publish(PUB);
    });

    it("finds public decks anonymously but returns previews only", async () => {
      currentUser = null;
      const res = await request("GET", "/api/catalog/search?q=은혜로다");
      expect(res.headers.get("cache-control")).toContain("max-age=30");

      const body = (await res.json()) as Record<string, unknown[]>;
      const [card] = body.decks as Record<string, unknown>[];
      expect(card).toMatchObject({
        id: PUB,
        authorName: "김찬양",
        firstSlidePreview: [
          "시작됐네 우리 주님의 능력이",
          "나의 삶을 다스리시네",
        ],
        slideCount: 2,
      });
      // 공개 경로로 전문과 소유자 id가 새지 않는다
      expect(card).not.toHaveProperty("lyricsRaw");
      expect(card).not.toHaveProperty("slides");
      expect(card).not.toHaveProperty("userId");
    });

    it("never exposes private decks, presentation clones or taken-down decks", async () => {
      // 세트 복제본을 공개로 실어 보낸다 (M5-1 누출 경로)
      const doc = PresentationDocumentSchema.parse({
        id: SET_ID,
        userId: A,
        title: "주일 예배",
        serviceDate: "2026-09-27",
        items: [
          {
            id: "300000003000000000001",
            presentationId: SET_ID,
            deckId: CLONE,
            order: 0,
            deck: deck(CLONE, {
              scope: "presentation",
              presentationId: SET_ID,
              title: "은혜 세트 복제본",
              visibility: "public",
            }),
          },
        ],
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      });
      expect(
        (await request("PUT", `/api/presentations/${SET_ID}`, doc)).status,
      ).toBe(200);

      for (const q of ["은혜", "은혜로다", ""]) {
        const ids = (await search(q)).decks.map((d) => d.id);
        expect(ids).toEqual([PUB]);
      }

      currentUser = B;
      for (const id of [PRIV, CLONE]) {
        expect((await request("GET", `/api/catalog/decks/${id}`)).status).toBe(
          404,
        );
        expect((await request("POST", `/api/decks/${id}/fork`)).status).toBe(
          404,
        );
      }

      await env.DB.prepare(
        "UPDATE decks SET takedown_at = unixepoch() WHERE id = ?",
      )
        .bind(PUB)
        .run();
      expect((await search("은혜로다")).decks).toHaveLength(0);
      expect((await request("GET", `/api/catalog/decks/${PUB}`)).status).toBe(
        404,
      );
    });

    it("gives the full deck to signed-in users only", async () => {
      currentUser = null;
      expect((await request("GET", `/api/catalog/decks/${PUB}`)).status).toBe(
        401,
      );

      currentUser = B;
      const res = await request("GET", `/api/catalog/decks/${PUB}`);
      expect(res.status).toBe(200);
      const { deck: detail } = (await res.json()) as {
        deck: Record<string, unknown>;
      };
      expect(detail.lyricsRaw).toContain("둘째 슬라이드");
      expect(detail).not.toHaveProperty("userId");
    });

    it("forks into B's library as a private copy with attribution, counting once", async () => {
      currentUser = B;
      const first = await request("POST", `/api/decks/${PUB}/fork`);
      expect(first.status).toBe(200);
      const body = (await first.json()) as {
        deck: Deck;
        alreadyOwned: boolean;
      };
      expect(body.alreadyOwned).toBe(false);
      expect(body.deck).toMatchObject({
        userId: B,
        visibility: "private",
        forkedFrom: PUB,
        forkedFromAuthorName: "김찬양",
        origin: "fork",
      });
      // 슬라이드·스타일을 수정 없이 그대로 가져온다 (송출 동일성)
      expect(body.deck.slides.map((s) => s.lines)).toEqual([
        ["시작됐네 우리 주님의 능력이", "나의 삶을 다스리시네"],
        ["둘째 슬라이드"],
      ]);
      expect(body.deck.style.overlayOpacity).toBe(70);

      const again = (await (
        await request("POST", `/api/decks/${PUB}/fork`)
      ).json()) as {
        deck: Deck;
        alreadyOwned: boolean;
      };
      expect(again.alreadyOwned).toBe(true);
      expect(again.deck.id).toBe(body.deck.id);

      const [card] = (await search("은혜로다")).decks;
      expect(card.forkCount).toBe(1);

      const mine = (await (await request("GET", "/api/decks")).json()) as {
        decks: Deck[];
      };
      expect(mine.decks.map((d) => d.id)).toEqual([body.deck.id]);
    });

    it("keeps B's fork when A unpublishes", async () => {
      currentUser = B;
      const { deck: fork } = (await (
        await request("POST", `/api/decks/${PUB}/fork`)
      ).json()) as {
        deck: Deck;
      };
      currentUser = A;
      await request("PATCH", `/api/decks/${PUB}/visibility`, {
        visibility: "private",
      });

      currentUser = B;
      const mine = (await (await request("GET", "/api/decks")).json()) as {
        decks: Deck[];
      };
      expect(mine.decks.map((d) => d.id)).toEqual([fork.id]);
    });

    it("B cannot change A's deck through the sync PUT either", async () => {
      currentUser = B;
      const res = await request(
        "PUT",
        `/api/decks/${PUB}`,
        deck(PUB, { userId: B, title: "탈취" }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("신고", () => {
    it("accepts a report on a public deck and rejects duplicates", async () => {
      await publish(PUB);
      currentUser = B;
      const body = {
        targetType: "deck",
        targetId: PUB,
        reason: "lyrics_error",
      };
      expect((await request("POST", "/api/reports", body)).status).toBe(201);
      expect((await request("POST", "/api/reports", body)).status).toBe(409);
    });

    it("does not confirm the existence of private decks", async () => {
      currentUser = B;
      expect(
        (
          await request("POST", "/api/reports", {
            targetType: "deck",
            targetId: PRIV,
            reason: "copyright",
          })
        ).status,
      ).toBe(404);
    });

    it("validates the payload with the shared schema", async () => {
      currentUser = B;
      expect(
        (
          await request("POST", "/api/reports", {
            targetType: "deck",
            targetId: PUB,
            reason: "spam",
          })
        ).status,
      ).toBe(400);
    });
  });
});
