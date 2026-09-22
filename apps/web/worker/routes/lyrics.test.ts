import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "@repo/shared";
import {
  createD1Client,
  upsertDeck,
  contributeLyrics,
  user,
  lyricsCatalog,
  lyricsVersions,
} from "@repo/db";
import type { AppEnv } from "../types";
import { createRequireAuth, type SessionReader } from "../middleware/auth";

/**
 * 덱 저장 시 가사 기여 경로 검증.
 *
 * 프로덕션 핸들러와 같은 흐름에 세션 리더만 주입한다.
 */
const USER_A = "aaaaaaaa-1111-4000-8000-000000000001";
const USER_B = "bbbbbbbb-1111-4000-8000-000000000002";
const DECK_A = "c0000000-1111-4000-8000-000000000001";
const DECK_B = "c0000000-1111-4000-8000-000000000002";

let currentUser: string = USER_A;
/** 기여 단계에서 터지는 상황을 흉내 낸다 */
let failContribution = false;

const fakeSession: SessionReader = async () => ({ userId: currentUser });

const app = new Hono<AppEnv>().put(
  "/api/decks/:id",
  createRequireAuth(fakeSession),
  zValidator("json", DeckSchema),
  async (c) => {
    const userId = c.get("userId") as string;
    const deck = c.req.valid("json");
    const db = createD1Client(c.env.DB);

    const saved = await upsertDeck(db, userId, deck);
    if (!saved) return c.json({ error: "forbidden" }, 403);

    let contributed = false;
    if (c.req.query("contribute") === "true" && deck.lyricsRaw.trim()) {
      try {
        if (failContribution) throw new Error("catalog down");
        await contributeLyrics(db, {
          userId,
          deckId: deck.id,
          title: deck.title,
          artist: deck.artist,
          lyrics: deck.lyricsRaw,
        });
        contributed = true;
      } catch {
        // 덱 저장은 되돌리지 않는다
      }
    }

    return c.json({ ok: true as const, contributed }, 200);
  },
);

function makeDeck(id: string, userId: string, lyrics = "시작됐네"): Deck {
  return DeckSchema.parse({
    id,
    userId,
    catalogId: null,
    scope: "library",
    presentationId: null,
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: lyrics,
    slides: [{ id: "s1", order: 0, lines: [lyrics] }],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

function put(deck: Deck, contribute: boolean) {
  return app.request(
    `/api/decks/${deck.id}${contribute ? "?contribute=true" : ""}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(deck),
    },
    env,
  );
}

describe("덱 저장 시 가사 기여", () => {
  beforeEach(async () => {
    const db = createD1Client(env.DB);
    await env.DB.exec("DELETE FROM lyrics_versions");
    await env.DB.exec("DELETE FROM lyrics_catalog");
    await env.DB.exec("DELETE FROM decks");
    await env.DB.exec(
      `DELETE FROM user WHERE id IN ('${USER_A}', '${USER_B}')`,
    );
    await db.insert(user).values([
      { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
    currentUser = USER_A;
    failContribution = false;
  });

  it("contribute=true면 카탈로그에 루트 버전을 남긴다", async () => {
    const res = await put(makeDeck(DECK_A, USER_A), true);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, contributed: true });

    const db = createD1Client(env.DB);
    expect(await db.select().from(lyricsVersions)).toHaveLength(1);
  });

  it("플래그가 없으면 카탈로그를 건드리지 않는다", async () => {
    // 기여는 선택이다 (PRD 4.8).
    const res = await put(makeDeck(DECK_A, USER_A), false);

    expect(await res.json()).toMatchObject({ contributed: false });
    const db = createD1Client(env.DB);
    expect(await db.select().from(lyricsCatalog)).toHaveLength(0);
  });

  it("두 사용자가 같은 곡을 올리면 루트 버전이 2개가 된다", async () => {
    await put(makeDeck(DECK_A, USER_A, "A가 적은 가사"), true);

    currentUser = USER_B;
    await put(makeDeck(DECK_B, USER_B, "B가 적은 가사"), true);

    const db = createD1Client(env.DB);
    const catalogs = await db.select().from(lyricsCatalog);
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0].versionCount).toBe(2);
  });

  it("기여가 실패해도 덱 저장은 성공한다", async () => {
    // 공용 카탈로그는 부가 기능이다. 여기서 500을 내면 사용자는 자기 곡이
    // 저장되지 않았다고 이해한다.
    failContribution = true;

    const deck = makeDeck(DECK_A, USER_A);
    const res = await put(deck, true);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, contributed: false });

    // drizzle-orm은 apps/web의 직접 의존성이 아니므로 원시 D1로 확인한다.
    const saved = await env.DB.prepare("SELECT id FROM decks WHERE id = ?")
      .bind(deck.id)
      .all();
    expect(saved.results).toHaveLength(1);
  });

  it("가사가 비어 있으면 기여하지 않는다", async () => {
    const res = await put(makeDeck(DECK_A, USER_A, "   "), true);

    expect(await res.json()).toMatchObject({ contributed: false });
  });
});
