import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "../test/env";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  FolderSchema,
  PresentationDocumentSchema,
  toPresentationChanges,
  type Deck,
  type PresentationDocument,
} from "#shared";
import { clearDb, seedDocs, userDoc } from "../../db/test/fixtures";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

const USER = "aaaaaaaa00000000000p1";
const DECK_ID = "c000000000000000000p1";
const SET_ID = "1000000000000000000p1";
const COPY_ID = "c000000000000000000p2";
const ITEM_ID = "3000000000000000000p1";
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

function presentationWithSong(
  copy: Partial<Deck> = {},
  overrides: Partial<PresentationDocument> = {},
): PresentationDocument {
  const deck = libraryDeck({
    id: COPY_ID,
    scope: "presentation",
    presentationId: SET_ID,
    ...copy,
  });
  return PresentationDocumentSchema.parse({
    ...emptyPresentation(SET_ID),
    items: [
      { id: ITEM_ID, presentationId: SET_ID, deckId: deck.id, order: 0, deck },
    ],
    ...overrides,
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

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await clearDb(env.DB);
  await seedDocs(env.DB, {
    users: [userDoc({ id: USER, name: "인도자", termsAgreedAt: new Date() })],
  });
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  const errorLines = errorLog.mock.calls.length;
  vi.restoreAllMocks();
  expect(errorLines).toBe(0);
});

describe("경로 id·공유 토큰 검사", () => {
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

describe("본문 id 검사", () => {
  async function savedPresentation(): Promise<PresentationDocument> {
    const res = await send("GET", `/api/presentations/${SET_ID}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { presentation: PresentationDocument })
      .presentation;
  }

  it("신고할 곡 id가 Firestore 예약 id면 없는 곡의 404다", async () => {
    const res = await send("POST", "/api/reports", {
      targetType: "deck",
      targetId: RESERVED,
      reason: "copyright",
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: API_ERRORS.report.targetNotFound,
    });
  });

  it("보관함 곡의 배경 id가 Firestore 예약 id면 배경 없이 저장한다", async () => {
    const res = await send(
      "PUT",
      `/api/decks/${DECK_ID}`,
      libraryDeck({ backgroundId: RESERVED }),
    );

    expect(res.status).toBe(200);
    const { deck } = (await res.json()) as { deck: Deck };
    expect(deck.backgroundId).toBeNull();
  });

  it("프레젠테이션이 가리키는 폴더·배경·원본 곡이 Firestore 예약 id면 없는 것으로 보고 저장한다", async () => {
    const res = await send(
      "PUT",
      `/api/presentations/${SET_ID}`,
      presentationWithSong(
        { backgroundId: RESERVED, forkedFrom: RESERVED },
        { folderId: RESERVED },
      ),
    );

    expect(res.status).toBe(200);
    const presentation = await savedPresentation();
    expect(presentation.folderId).toBeNull();
    expect(presentation.items[0]?.deck.backgroundId).toBeNull();
    expect(presentation.items[0]?.deck.forkedFrom).toBeNull();
  });

  it("문서 경로가 아닌 항목 id는 Firestore 예약 꼴이어도 그대로 저장한다", async () => {
    const document = presentationWithSong();
    const res = await send("PUT", `/api/presentations/${SET_ID}`, {
      ...document,
      items: document.items.map((item) => ({ ...item, id: RESERVED })),
    });

    expect(res.status).toBe(200);
    expect((await savedPresentation()).items[0]?.id).toBe(RESERVED);
  });

  it.each([
    ["PUT", presentationWithSong({ id: RESERVED })],
    ["PATCH", toPresentationChanges(presentationWithSong({ id: RESERVED }))],
  ])(
    "%s로 보낸 곡 id가 Firestore 예약 id면 저장하지 않고 400이다",
    async (method, body) => {
      const res = await send(method, `/api/presentations/${SET_ID}`, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: API_ERRORS.idMismatch });
      expect((await send("GET", `/api/presentations/${SET_ID}`)).status).toBe(
        404,
      );
    },
  );
});
