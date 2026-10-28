import { describe, it, expect, beforeEach } from "vitest";
import { env } from "../test/env";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  type Deck,
  type ShareSettings,
} from "#shared";
import { presentationMembersCol } from "#db";
import { clearDb, seedDocs, userDoc } from "../../db/test/fixtures";
import { createApp } from "../index";
import type { SessionReader } from "./auth";

const A = "aaaaaaaa00000000000o1";
const B = "bbbbbbbb00000000000o2";
const A_DECK = "c000000000000000000o1";
const A_SET = "1000000000000000000o1";

let currentUser = A;
const readSession: SessionReader = async () => ({ userId: currentUser });
const app = createApp({ readSession });

const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };
const FORGED = {
  origin: "https://evil.siku-labs.com",
  "sec-fetch-site": "same-site",
  "content-type": "application/x-www-form-urlencoded",
};

function call(
  userId: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  currentUser = userId;
  return app.request(
    path,
    {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

function libraryDeck(id: string, userId: string): Deck {
  return DeckSchema.parse({
    id,
    userId,
    scope: "library",
    title: "은혜로다",
    lyricsRaw: "시작됐네",
    slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

async function membersOfASet(): Promise<number> {
  const snapshot = await presentationMembersCol(env.DB)
    .where("presentationId", "==", A_SET)
    .get();
  return snapshot.size;
}

async function shareASet(): Promise<string> {
  const doc = PresentationDocumentSchema.parse({
    id: A_SET,
    userId: A,
    title: "주일 예배",
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
  expect(
    (await call(A, "PUT", `/api/presentations/${A_SET}`, SAME_ORIGIN, doc))
      .status,
  ).toBe(200);
  const res = await call(
    A,
    "PUT",
    `/api/presentations/${A_SET}/share`,
    SAME_ORIGIN,
    { access: "view" },
  );
  return ((await res.json()) as ShareSettings).token as string;
}

describe("다른 출처에서 보낸 쓰기 요청", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
    const agreedAt = new Date();
    await seedDocs(env.DB, {
      users: [
        userDoc({ id: A, name: "A", termsAgreedAt: agreedAt }),
        userDoc({ id: B, name: "B", termsAgreedAt: agreedAt }),
      ],
    });
  });

  it("출처 헤더가 하나도 없는 본문 없는 POST도 막는다", async () => {
    const token = await shareASet();

    const res = await call(B, "POST", `/api/share/${token}/join`, {});

    expect(res.status).toBe(403);
    expect(await membersOfASet()).toBe(0);
  });

  it.each([
    ["Sec-Fetch-Site가 same-origin", SAME_ORIGIN],
    ["Origin이 앱 주소(BETTER_AUTH_URL)", { origin: "http://localhost:5173" }],
  ])("%s면 받는다", async (_, headers) => {
    const token = await shareASet();

    const res = await call(B, "POST", `/api/share/${token}/join`, headers);

    expect(res.status).toBe(200);
    expect(await membersOfASet()).toBe(1);
  });

  it("폼으로 흉내 낼 수 없는 JSON 요청은 출처 헤더 없이도 받는다", async () => {
    const res = await call(
      A,
      "PUT",
      `/api/decks/${A_DECK}`,
      {},
      libraryDeck(A_DECK, A),
    );

    expect(res.status).toBe(200);
  });

  it("링크 재설정을 막고 토큰을 그대로 둔다", async () => {
    const token = await shareASet();

    const res = await call(
      A,
      "POST",
      `/api/presentations/${A_SET}/share/reset`,
      FORGED,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: API_ERRORS.idMismatch });
    const settings = (await (
      await call(A, "GET", `/api/presentations/${A_SET}/share`, SAME_ORIGIN)
    ).json()) as ShareSettings;
    expect(settings.token).toBe(token);
  });

  it("링크 참여를 막고 멤버로 기록하지 않는다", async () => {
    const token = await shareASet();

    const res = await call(B, "POST", `/api/share/${token}/join`, FORGED);

    expect(res.status).toBe(403);
    expect(await membersOfASet()).toBe(0);
  });
});
