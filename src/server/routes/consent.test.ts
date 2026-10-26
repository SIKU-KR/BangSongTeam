import { describe, it, expect, beforeEach } from "vitest";
import { env } from "../test/env";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  SearchCatalogResponseSchema,
  type Deck,
  type ShareSettings,
} from "#shared";
import { presentationMembersCol } from "#db";
import { clearDb, seedDocs, userDoc } from "../../db/test/fixtures";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

const USER_A = "aaaaaaaa00000000000c1";
const USER_B = "bbbbbbbb00000000000c2";

let currentUser: string | null = USER_A;
const fakeSession: SessionReader = async () =>
  currentUser ? { userId: currentUser } : null;

const app = createApp({ readSession: fakeSession });

const AGREE_ALL = { ageOver14: true, terms: true, privacy: true };

async function agree(body: unknown): Promise<Response> {
  return await app.request(
    "/api/consent",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function status(): Promise<{ agreedAt: string | null }> {
  const res = await app.request("/api/consent", {}, env);
  expect(res.status).toBe(200);
  return (await res.json()) as { agreedAt: string | null };
}

describe("/api/consent", () => {
  beforeEach(async () => {
    currentUser = USER_A;
    await clearDb(env.DB);
    const now = new Date();
    await seedDocs(env.DB, {
      users: [
        { id: USER_A, name: "A", createdAt: now, updatedAt: now },
        { id: USER_B, name: "B", createdAt: now, updatedAt: now },
      ].map((row) => userDoc(row)),
    });
  });

  it("로그인하지 않으면 401", async () => {
    currentUser = null;
    expect((await app.request("/api/consent", {}, env)).status).toBe(401);
    expect((await agree(AGREE_ALL)).status).toBe(401);
  });

  it("동의 전에는 null이고, 동의하면 시각이 기록된다", async () => {
    expect(await status()).toEqual({ agreedAt: null });

    const res = await agree(AGREE_ALL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agreedAt: string };
    expect(Date.parse(body.agreedAt)).not.toBeNaN();

    expect(await status()).toEqual(body);
  });

  it.each([
    { ...AGREE_ALL, ageOver14: false },
    { ...AGREE_ALL, terms: false },
    { ageOver14: true, terms: true },
  ])("필수 항목이 하나라도 빠지면 400: %o", async (body) => {
    expect((await agree(body)).status).toBe(400);
    expect(await status()).toEqual({ agreedAt: null });
  });

  it("다른 사용자의 동의 상태에 영향을 주지 않는다", async () => {
    await agree(AGREE_ALL);
    currentUser = USER_B;
    expect(await status()).toEqual({ agreedAt: null });
  });
});

const A_DECK = "c0000000000000000c0a1";
const B_DECK = "c0000000000000000c0b1";
const A_SET = "10000000000000000c0a1";
const B_SET = "10000000000000000c0b1";

function emptySet(id: string, userId: string) {
  return PresentationDocumentSchema.parse({
    id,
    userId,
    title: "주일 예배",
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

function libraryDeck(id: string, userId: string): Deck {
  return DeckSchema.parse({
    id,
    userId,
    scope: "library",
    title: "동의 확인 곡",
    lyricsRaw: "시작됐네",
    slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

async function call(
  userId: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  currentUser = userId;
  return await app.request(
    path,
    {
      method,
      headers: {
        "sec-fetch-site": "same-origin",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

const PUBLISH = { visibility: "public", acceptedCopyrightNotice: true };

async function listedIds(): Promise<string[]> {
  const res = await call(null, "GET", "/api/catalog/search?q=동의");
  return SearchCatalogResponseSchema.parse(await res.json()).decks.map(
    (deck) => deck.id,
  );
}

describe("가입 동의 전에 막는 일", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
    const now = new Date();
    await seedDocs(env.DB, {
      users: [
        userDoc({ id: USER_A, name: "A", createdAt: now, updatedAt: now }),
        userDoc({
          id: USER_B,
          name: "B",
          termsAgreedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      ],
    });
    for (const [id, userId] of [
      [A_DECK, USER_A],
      [B_DECK, USER_B],
    ] as const) {
      expect(
        (await call(userId, "PUT", `/api/decks/${id}`, libraryDeck(id, userId)))
          .status,
      ).toBe(200);
    }
    expect(
      (await call(USER_B, "PATCH", `/api/decks/${B_DECK}/visibility`, PUBLISH))
        .status,
    ).toBe(200);
  });

  it("동의 전에는 곡을 공개하지 못하고, 동의하면 공개한다", async () => {
    const refused = await call(
      USER_A,
      "PATCH",
      `/api/decks/${A_DECK}/visibility`,
      PUBLISH,
    );

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: API_ERRORS.consentRequired,
    });
    expect(await listedIds()).toEqual([B_DECK]);

    expect((await call(USER_A, "POST", "/api/consent", AGREE_ALL)).status).toBe(
      200,
    );
    expect(
      (await call(USER_A, "PATCH", `/api/decks/${A_DECK}/visibility`, PUBLISH))
        .status,
    ).toBe(200);
    expect((await listedIds()).sort()).toEqual([A_DECK, B_DECK].sort());
  });

  it("동의 전에도 공개를 거두거나 보관함을 동기화하는 일은 막지 않는다", async () => {
    expect(
      (
        await call(USER_A, "PATCH", `/api/decks/${A_DECK}/visibility`, {
          visibility: "private",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          USER_A,
          "PUT",
          `/api/decks/${A_DECK}`,
          libraryDeck(A_DECK, USER_A),
        )
      ).status,
    ).toBe(200);
  });

  it("동의 전에는 공유 라이브러리 곡을 가져오거나 신고하지 못한다", async () => {
    const report = {
      targetType: "deck",
      targetId: B_DECK,
      reason: "copyright",
    };

    for (const res of [
      await call(USER_A, "POST", `/api/decks/${B_DECK}/fork`),
      await call(USER_A, "POST", "/api/reports", report),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: API_ERRORS.consentRequired });
    }

    await call(USER_A, "POST", "/api/consent", AGREE_ALL);
    expect(
      (await call(USER_A, "POST", `/api/decks/${B_DECK}/fork`)).status,
    ).toBe(200);
    expect((await call(USER_A, "POST", "/api/reports", report)).status).toBe(
      201,
    );
  });

  it("동의 전에는 링크 공유를 켜지 못하고, 끄는 일은 막지 않는다", async () => {
    expect(
      (
        await call(
          USER_A,
          "PUT",
          `/api/presentations/${A_SET}`,
          emptySet(A_SET, USER_A),
        )
      ).status,
    ).toBe(200);
    const share = (access: string): Promise<Response> =>
      call(USER_A, "PUT", `/api/presentations/${A_SET}/share`, { access });

    const refused = await share("view");

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: API_ERRORS.consentRequired });
    const settings = await call(
      USER_A,
      "GET",
      `/api/presentations/${A_SET}/share`,
    );
    expect(await settings.json()).toEqual({ access: "off", token: null });
    expect((await share("off")).status).toBe(200);

    await call(USER_A, "POST", "/api/consent", AGREE_ALL);
    const shared = await share("view");
    expect(shared.status).toBe(200);
    expect(((await shared.json()) as ShareSettings).access).toBe("view");
  });

  it("동의 전에는 공유 링크로 참여하지 못한다", async () => {
    await call(
      USER_B,
      "PUT",
      `/api/presentations/${B_SET}`,
      emptySet(B_SET, USER_B),
    );
    const { token } = (await (
      await call(USER_B, "PUT", `/api/presentations/${B_SET}/share`, {
        access: "view",
      })
    ).json()) as ShareSettings;

    const refused = await call(USER_A, "POST", `/api/share/${token}/join`);

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: API_ERRORS.consentRequired });
    const members = await presentationMembersCol(env.DB)
      .where("presentationId", "==", B_SET)
      .get();
    expect(members.empty).toBe(true);

    await call(USER_A, "POST", "/api/consent", AGREE_ALL);
    expect(
      (await call(USER_A, "POST", `/api/share/${token}/join`)).status,
    ).toBe(200);
  });
});
