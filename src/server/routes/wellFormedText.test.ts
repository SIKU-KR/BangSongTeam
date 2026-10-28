import { describe, it, expect, beforeEach } from "vitest";
import { env } from "../test/env";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  toPresentationChanges,
  type Deck,
  type Folder,
  type PresentationDocument,
  type Slide,
} from "#shared";
import { decksCol, foldersCol, presentationsCol } from "#db";
import { clearDb, seedDocs, userDoc } from "../../db/test/fixtures";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";

const USER = "aaaaaaaa0000000000051";
const DOC_ID = "1000000000000000000ee";
const ITEM_ID = "4000000000000000000ee";
const SONG_ID = "d000000000000000000ee";
const LIBRARY_SONG_ID = "c000000000000000000ee";
const FOLDER_ID = "f000000000000000000ee";

const HIGH = "\uD83D";
const LOW = "\uDE00";
const REPLACEMENT = "\uFFFD";
const EDITED_AT = "2026-09-22T00:00:00.000Z";

const fakeSession: SessionReader = async () => ({ userId: USER });
const app = createApp({ readSession: fakeSession });

const BROKEN_SONG_TEXT = {
  title: `은혜${HIGH}로다`,
  artist: `${LOW}예수전도단`,
  lyricsRaw: `시작됐네 😀${HIGH}`,
  slides: [{ id: "s1", order: 0, lines: [`시작됐네 😀${HIGH}`] }],
};

const STORED_SONG_TEXT = {
  title: `은혜${REPLACEMENT}로다`,
  artist: `${REPLACEMENT}예수전도단`,
  lyricsRaw: `시작됐네 😀${REPLACEMENT}`,
  lines: [`시작됐네 😀${REPLACEMENT}`],
};

function song(overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id: SONG_ID,
    userId: USER,
    scope: "presentation",
    presentationId: DOC_ID,
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: "시작됐네",
    slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function presentation(
  deck: Deck,
  overrides: Partial<PresentationDocument> = {},
): PresentationDocument {
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId: USER,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: [
      {
        id: ITEM_ID,
        presentationId: DOC_ID,
        deckId: deck.id,
        order: 0,
        deck,
      },
    ],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function brokenPresentation(): PresentationDocument {
  return presentation(song({ ...BROKEN_SONG_TEXT, updatedAt: EDITED_AT }), {
    title: `주일${HIGH} 예배`,
    updatedAt: EDITED_AT,
  });
}

async function send(
  method: "PUT" | "PATCH",
  path: string,
  body: unknown,
): Promise<Response> {
  return await app.request(
    path,
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function storedSongText(id: string): Promise<Record<string, unknown>> {
  const stored = (await decksCol(env.DB).doc(id).get()).data();
  return {
    title: stored?.title,
    artist: stored?.artist,
    lyricsRaw: stored?.lyricsRaw,
    lines: (JSON.parse(stored?.slides ?? "[]") as Slide[])[0]?.lines,
  };
}

async function storedPresentationTitle(): Promise<string | undefined> {
  return (await presentationsCol(env.DB).doc(DOC_ID).get()).data()?.title;
}

describe("짝을 잃은 서로게이트가 든 저장", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
    await seedDocs(env.DB, {
      users: [userDoc({ id: USER, name: "인도자", termsAgreedAt: new Date() })],
    });
  });

  it("이전 클라이언트의 프레젠테이션 변경분 저장(PATCH)도 200이고 반쪽 자리를 U+FFFD로 저장한다", async () => {
    const created = await send(
      "PUT",
      `/api/presentations/${DOC_ID}`,
      presentation(song()),
    );
    expect(created.status).toBe(200);

    const res = await send(
      "PATCH",
      `/api/presentations/${DOC_ID}`,
      toPresentationChanges(brokenPresentation()),
    );

    expect(res.status).toBe(200);
    expect(await storedPresentationTitle()).toBe(`주일${REPLACEMENT} 예배`);
    expect(await storedSongText(SONG_ID)).toEqual(STORED_SONG_TEXT);
  });

  it("이전 클라이언트의 프레젠테이션 문서 전체 저장(PUT)도 200이고 반쪽 자리를 U+FFFD로 저장한다", async () => {
    const res = await send(
      "PUT",
      `/api/presentations/${DOC_ID}`,
      brokenPresentation(),
    );

    expect(res.status).toBe(200);
    expect(await storedPresentationTitle()).toBe(`주일${REPLACEMENT} 예배`);
    expect(await storedSongText(SONG_ID)).toEqual(STORED_SONG_TEXT);
  });

  it("이전 클라이언트의 보관함 곡 저장(PUT /api/decks)도 200이고 U+FFFD로 저장한 곡을 돌려준다", async () => {
    const res = await send(
      "PUT",
      `/api/decks/${LIBRARY_SONG_ID}`,
      song({
        ...BROKEN_SONG_TEXT,
        id: LIBRARY_SONG_ID,
        scope: "library",
        presentationId: null,
      }),
    );

    expect(res.status).toBe(200);
    const { deck } = (await res.json()) as { deck: Deck };
    expect({
      title: deck.title,
      artist: deck.artist,
      lyricsRaw: deck.lyricsRaw,
      lines: deck.slides[0]?.lines,
    }).toEqual(STORED_SONG_TEXT);
    expect(await storedSongText(LIBRARY_SONG_ID)).toEqual(STORED_SONG_TEXT);
  });

  it("이전 클라이언트의 폴더 저장(PUT /api/folders)도 200이고 이름의 반쪽 자리를 U+FFFD로 저장한다", async () => {
    const folder: Folder = {
      id: FOLDER_ID,
      userId: USER,
      parentId: null,
      name: `2026 주일${HIGH}`,
      trashedAt: null,
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    };

    const res = await send("PUT", `/api/folders/${FOLDER_ID}`, folder);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { folder: Folder }).folder.name).toBe(
      `2026 주일${REPLACEMENT}`,
    );
    expect((await foldersCol(env.DB).doc(FOLDER_ID).get()).data()?.name).toBe(
      `2026 주일${REPLACEMENT}`,
    );
  });
});
