import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "@repo/shared";
import { createD1Client, user, lyricsCatalog, lyricsVersions } from "@repo/db";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

/**
 * 덱 저장 시 가사 기여 경로 검증 (M5-2: 덱 플래그 + 서버 판정).
 *
 * 실제 라우트(`createApp`)에 세션 리더만 주입한다.
 */
const USER_A = "aaaaaaaa-1111-4000-8000-000000000001";
const USER_B = "bbbbbbbb-1111-4000-8000-000000000002";
const DECK_A = "c0000000-1111-4000-8000-000000000001";
const DECK_B = "c0000000-1111-4000-8000-000000000002";

let currentUser: string = USER_A;
const fakeSession: SessionReader = async () => ({ userId: currentUser });
const app = createApp({ readSession: fakeSession });

function makeDeck(
  id: string,
  userId: string,
  lyrics = "시작됐네",
  overrides: Partial<Deck> = {},
): Deck {
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
    contributeToCatalog: true,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function put(deck: Deck) {
  return app.request(
    `/api/decks/${deck.id}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(deck),
    },
    env,
  );
}

type PutBody = { ok: true; deck: Deck; contributed: boolean };

describe("덱 저장 시 가사 기여", () => {
  beforeEach(async () => {
    const db = createD1Client(env.DB);
    await env.DB.exec("DROP TRIGGER IF EXISTS test_fail_versions");
    await env.DB.exec("DELETE FROM lyrics_versions");
    await env.DB.exec("DELETE FROM decks");
    await env.DB.exec("DELETE FROM lyrics_catalog");
    await env.DB.exec(
      `DELETE FROM user WHERE id IN ('${USER_A}', '${USER_B}')`,
    );
    await db.insert(user).values([
      { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
    currentUser = USER_A;
  });

  it("기여를 켠 보관함 곡은 카탈로그에 루트 버전을 남기고 덱을 카탈로그에 묶는다", async () => {
    const res = await put(makeDeck(DECK_A, USER_A));

    expect(res.status).toBe(200);
    const body = (await res.json()) as PutBody;
    expect(body).toMatchObject({ ok: true, contributed: true });

    const db = createD1Client(env.DB);
    const versions = await db.select().from(lyricsVersions);
    expect(versions).toHaveLength(1);
    expect(body.deck.catalogId).toBe(versions[0].catalogId);

    const row = await env.DB.prepare(
      "SELECT catalog_id FROM decks WHERE id = ?",
    )
      .bind(DECK_A)
      .first<{ catalog_id: string }>();
    expect(row?.catalog_id).toBe(versions[0].catalogId);
  });

  it("기여를 끄면 카탈로그를 건드리지 않는다", async () => {
    // 기여는 선택이다 (PRD 4.8).
    const res = await put(
      makeDeck(DECK_A, USER_A, "시작됐네", { contributeToCatalog: false }),
    );

    expect(await res.json()).toMatchObject({ contributed: false });
    const db = createD1Client(env.DB);
    expect(await db.select().from(lyricsCatalog)).toHaveLength(0);
  });

  it("옛 쿼리 플래그(?contribute=true)는 더 이상 기여 조건이 아니다", async () => {
    const deck = makeDeck(DECK_A, USER_A, "시작됐네", {
      contributeToCatalog: false,
    });
    const res = await app.request(
      `/api/decks/${deck.id}?contribute=true`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(deck),
      },
      env,
    );
    expect(await res.json()).toMatchObject({ contributed: false });
  });

  it("포크본은 origin을 'user'로 속여 보내도 기여하지 않는다", async () => {
    // 첫 저장으로 행을 만든 뒤 서버가 포크본으로 표시한 상황 (가져오기 경로가 하는 일)
    await put(
      makeDeck(DECK_A, USER_A, "원본 가사", { contributeToCatalog: false }),
    );
    await env.DB.prepare("UPDATE decks SET origin = 'fork' WHERE id = ?")
      .bind(DECK_A)
      .run();

    const res = await put(
      makeDeck(DECK_A, USER_A, "포크에서 고친 가사", { origin: "user" }),
    );
    const body = (await res.json()) as PutBody;
    expect(body.contributed).toBe(false);
    expect(body.deck.origin).toBe("fork");

    const db = createD1Client(env.DB);
    expect(await db.select().from(lyricsVersions)).toHaveLength(0);
  });

  it("두 사용자가 같은 곡을 올리면 루트 버전이 2개가 된다", async () => {
    await put(makeDeck(DECK_A, USER_A, "A가 적은 가사"));

    currentUser = USER_B;
    await put(makeDeck(DECK_B, USER_B, "B가 적은 가사"));

    const db = createD1Client(env.DB);
    const catalogs = await db.select().from(lyricsCatalog);
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0].versionCount).toBe(2);
  });

  it("기여가 실패해도 덱 저장은 성공한다", async () => {
    // 공용 카탈로그는 부가 기능이다. 여기서 500을 내면 사용자는 자기 곡이
    // 저장되지 않았다고 이해한다. 버전 insert를 트리거로 막아 실패를 만든다.
    await env.DB.exec(
      "CREATE TRIGGER test_fail_versions BEFORE INSERT ON lyrics_versions BEGIN SELECT RAISE(ABORT, 'catalog down'); END;",
    );

    const deck = makeDeck(DECK_A, USER_A);
    const res = await put(deck);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, contributed: false });

    const saved = await env.DB.prepare("SELECT id FROM decks WHERE id = ?")
      .bind(deck.id)
      .all();
    expect(saved.results).toHaveLength(1);
  });

  it("가사가 비어 있으면 기여하지 않는다", async () => {
    const res = await put(makeDeck(DECK_A, USER_A, "   "));

    expect(await res.json()).toMatchObject({ contributed: false });
  });
});
