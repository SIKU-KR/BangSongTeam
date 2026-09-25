import { describe, it, expect, beforeEach } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  PresentationDocumentSchema,
  SearchCatalogResponseSchema,
  type Deck,
  type PresentationDocument,
} from "#shared";
import {
  createD1Client,
  decks,
  presentationItems,
  presentations,
  reports,
  user,
} from "#db";
import { inArray } from "drizzle-orm";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import { clearTables } from "../test/db";

const A = "aaaaaaaa6000000000001";
const B = "bbbbbbbb6000000000002";
const A_DECK = "c0000000600000000000a";
const B_DECK = "c0000000600000000000b";
const B_SET = "10000000600000000000b";

let currentUser = A;
const readSession: SessionReader = async () => ({ userId: currentUser });
const app = createApp({ readSession });

async function call(method: string, path: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await app.request(
    path,
    {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const A_LYRICS = [
  "시작됐네 우리 주님의 능력이",
  "나의 삶을 다스리시네",
  "",
  "주의 은혜 아래 나 거하며",
  "주의 사랑 안에 살리",
].join("\n");

function librarySong(
  id: string,
  userId: string,
  lyrics: string,
  overrides: Partial<Deck> = {},
): Deck {
  const blocks = lyrics.split("\n\n");
  return DeckSchema.parse({
    id,
    userId,
    scope: "library",
    title: "은혜로다",
    artist: "예수전도단",
    lyricsRaw: lyrics,
    slides: blocks.map((block, order) => ({
      id: `s${order}`,
      order,
      lines: block.split("\n"),
    })),
    backgroundId: null,
    style: { ...DEFAULT_DECK_STYLE, overlayOpacity: 65, fontSizeVw: 5.1 },
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

describe("2계정 공유 라이브러리 E2E", () => {
  beforeEach(async () => {
    await clearTables(reports, presentationItems, decks, presentations);
    await createD1Client(env.DB)
      .delete(user)
      .where(inArray(user.id, [A, B]));
    await createD1Client(env.DB)
      .insert(user)
      .values([
        {
          id: A,
          name: "A교회 찬양팀",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: B,
          name: "B교회 미디어",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    currentUser = A;
  });

  it("(a) B가 A의 공개 덱을 검색·가져와 세트에 담으면 원본 그대로 돌아온다", async () => {
    const original = librarySong(A_DECK, A, A_LYRICS);
    expect((await call("PUT", `/api/decks/${A_DECK}`, original)).status).toBe(
      200,
    );
    expect(
      (
        await call("PATCH", `/api/decks/${A_DECK}/visibility`, {
          visibility: "public",
          acceptedCopyrightNotice: true,
        })
      ).status,
    ).toBe(200);

    currentUser = B;
    const search = SearchCatalogResponseSchema.parse(
      await (await call("GET", "/api/catalog/search?q=은혜로다")).json(),
    );
    expect(search.decks.map((d) => d.id)).toEqual([A_DECK]);
    expect(search.decks[0].firstSlidePreview).toEqual([
      "시작됐네 우리 주님의 능력이",
      "나의 삶을 다스리시네",
    ]);

    expect((await call("GET", `/api/catalog/decks/${A_DECK}`)).status).toBe(
      200,
    );
    const forkRes = await call("POST", `/api/decks/${A_DECK}/fork`);
    const { deck: fork } = (await forkRes.json()) as { deck: Deck };
    expect(fork.forkedFromAuthorName).toBe("A교회 찬양팀");

    const clone: Deck = {
      ...fork,
      id: "c000000060000000000c1",
      scope: "presentation",
      presentationId: B_SET,
      forkedFrom: fork.id,
      visibility: "private",
      forkCount: 0,
    };
    const doc: PresentationDocument = PresentationDocumentSchema.parse({
      id: B_SET,
      userId: B,
      title: "B교회 주일 예배",
      serviceDate: "2026-09-27",
      items: [
        {
          id: "300000006000000000001",
          presentationId: B_SET,
          deckId: clone.id,
          order: 0,
          deck: clone,
        },
      ],
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    });
    expect((await call("PUT", `/api/presentations/${B_SET}`, doc)).status).toBe(
      200,
    );

    const { presentations } = (await (
      await call("GET", "/api/presentations")
    ).json()) as {
      presentations: PresentationDocument[];
    };
    const song = presentations[0].items[0].deck;
    expect(song.slides.map((s) => s.lines)).toEqual(
      original.slides.map((s) => s.lines),
    );
    expect(song.style).toEqual(original.style);
    expect(song.visibility).toBe("private");
    expect(song.forkedFromAuthorName).toBe("A교회 찬양팀");

    const after = SearchCatalogResponseSchema.parse(
      await (await call("GET", "/api/catalog/search?q=은혜로다")).json(),
    );
    expect(after.decks[0].forkCount).toBe(1);
  });

  it("(b) 같은 곡을 두 계정이 공개하면 둘 다 보이고 가져간 횟수순으로 정렬된다", async () => {
    const publish = async (id: string, deck: Deck) => {
      expect((await call("PUT", `/api/decks/${id}`, deck)).status).toBe(200);
      expect(
        (
          await call("PATCH", `/api/decks/${id}/visibility`, {
            visibility: "public",
            acceptedCopyrightNotice: true,
          })
        ).status,
      ).toBe(200);
    };
    const searchIds = async () =>
      SearchCatalogResponseSchema.parse(
        await (await call("GET", "/api/catalog/search?q=은혜로다")).json(),
      ).decks.map((d) => d.id);

    await publish(A_DECK, librarySong(A_DECK, A, A_LYRICS));
    currentUser = B;
    await publish(
      B_DECK,
      librarySong(B_DECK, B, A_LYRICS.replace("은혜 아래", "은혜아래"), {
        updatedAt: "2026-09-22T00:00:00.000Z",
      }),
    );

    expect(await searchIds()).toEqual([B_DECK, A_DECK]);

    expect((await call("POST", `/api/decks/${A_DECK}/fork`)).status).toBe(200);
    expect(await searchIds()).toEqual([A_DECK, B_DECK]);
  });
});
