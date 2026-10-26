import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "../test/env";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  FolderSchema,
  PresentationDocumentSchema,
  type Deck,
} from "#shared";
import { clearDb, seedDocs, userDoc } from "../../db/test/fixtures";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

const USER = "aaaaaaaa00000000000p1";
const DECK_ID = "c000000000000000000p1";
const SLASHED = "a%2Fb";
const RESERVED = "__abcdefghijklmnopq__";
const LONG_TOKEN = "x".repeat(1600);

const readSession: SessionReader = async () => ({ userId: USER });
const app = createApp({ readSession });

function libraryDeck(overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id: DECK_ID,
    userId: USER,
    scope: "library",
    title: "은혜로다",
    lyricsRaw: "시작됐네",
    slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function emptyPresentation(id: string) {
  return PresentationDocumentSchema.parse({
    id,
    userId: USER,
    title: "주일 예배",
    serviceDate: "2026-09-27",
    items: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
}

function send(method: string, path: string, body?: unknown) {
  return app.request(
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

describe("경로 id·공유 토큰 검사", () => {
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await clearDb(env.DB);
    await seedDocs(env.DB, { users: [userDoc({ id: USER, name: "인도자" })] });
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    const errorLines = errorLog.mock.calls.length;
    vi.restoreAllMocks();
    expect(errorLines).toBe(0);
  });

  it.each([
    ["GET", `/api/catalog/decks/${SLASHED}`, API_ERRORS.deck.notPublished],
    ["GET", `/api/catalog/decks/${RESERVED}`, API_ERRORS.deck.notPublished],
    ["POST", `/api/decks/${SLASHED}/fork`, API_ERRORS.deck.notPublished],
    ["POST", `/api/decks/${RESERVED}/fork`, API_ERRORS.deck.notPublished],
    ["DELETE", `/api/decks/${SLASHED}`, API_ERRORS.deck.notAccessible],
    ["DELETE", `/api/decks/${RESERVED}`, API_ERRORS.deck.notAccessible],
    [
      "GET",
      `/api/presentations/${SLASHED}`,
      API_ERRORS.presentation.notAccessible,
    ],
    [
      "GET",
      `/api/presentations/${RESERVED}`,
      API_ERRORS.presentation.notAccessible,
    ],
    ["GET", "/api/presentations/..%2F", API_ERRORS.presentation.notAccessible],
    [
      "DELETE",
      `/api/presentations/${SLASHED}`,
      API_ERRORS.presentation.notAccessible,
    ],
    [
      "GET",
      `/api/presentations/${SLASHED}/share`,
      API_ERRORS.presentation.notAccessible,
    ],
    [
      "POST",
      `/api/presentations/${SLASHED}/share/reset`,
      API_ERRORS.presentation.notAccessible,
    ],
    ["DELETE", `/api/folders/${SLASHED}`, API_ERRORS.folder.notAccessible],
    ["GET", `/api/share/${LONG_TOKEN}`, API_ERRORS.share.linkUnavailable],
    ["POST", `/api/share/${LONG_TOKEN}/join`, API_ERRORS.share.linkUnavailable],
  ])(
    "%s %s는 저장소 오류 500이 아니라 없는 대상의 404다",
    async (method, path, error) => {
      const res = await send(method, path);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error });
    },
  );

  it.each([
    ["PATCH", `/api/decks/${RESERVED}/visibility`, { visibility: "private" }],
    ["PUT", `/api/presentations/${SLASHED}/share`, { access: "view" }],
  ])("%s %s도 본문이 맞아도 404다", async (method, path, body) => {
    const res = await send(method, path, body);

    expect(res.status).toBe(404);
  });

  it.each([
    ["/api/decks", libraryDeck({ id: RESERVED })],
    [
      "/api/folders",
      FolderSchema.parse({
        id: RESERVED,
        userId: USER,
        parentId: null,
        name: "폴더",
        trashedAt: null,
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      }),
    ],
    ["/api/presentations", emptyPresentation(RESERVED)],
  ])(
    "PUT %s/<Firestore 예약 id>는 저장을 시도하지 않고 400이다",
    async (base, body) => {
      const res = await send("PUT", `${base}/${RESERVED}`, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: API_ERRORS.idMismatch });
    },
  );

  it("Firestore가 담지 못하는 0000년 시각은 시각 0으로 저장한다", async () => {
    const res = await send(
      "PUT",
      `/api/decks/${DECK_ID}`,
      libraryDeck({ createdAt: "0000-01-01T00:00:00.000Z" }),
    );

    expect(res.status).toBe(200);
    const { deck } = (await res.json()) as { deck: Deck };
    expect(deck.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });
});
