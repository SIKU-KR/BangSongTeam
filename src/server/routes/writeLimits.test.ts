import { describe, it, expect, beforeEach } from "vitest";
import { env } from "../test/env";
import {
  API_ERRORS,
  DEFAULT_DECK_STYLE,
  DeckSchema,
  MAX_PRESENTATION_SONGS,
  MAX_PRESENTATION_TEXT_BYTES,
  MAX_PRESENTATION_TITLE_LENGTH,
  MAX_SLIDE_ID_LENGTH,
  MAX_WRITE_LYRICS_LENGTH,
  MAX_WRITE_SLIDES,
  NOONNU_SUPPORTED_FONT_NAMES,
  PresentationDocumentSchema,
  toPresentationChanges,
  type Deck,
  type PresentationChanges,
  type PresentationDocument,
  type ShareSettings,
  type Slide,
} from "#shared";
import { decksCol, presentationsCol, songTextBytes, type DeckDoc } from "#db";
import {
  clearDb,
  deckDoc,
  presentationDoc,
  seedDocs,
  userDoc,
} from "../../db/test/fixtures";
import { createApp } from "../index";
import type { SessionReader } from "../middleware/auth";
import {
  DECK_BODY_MAX_BYTES,
  PRESENTATION_BODY_MAX_BYTES,
} from "../middleware/bodyLimit";

const USER = "aaaaaaaa0000000000031";
const DOC_ID = "1000000000000000000dd";
const LIB_DECK_ID = "c000000000000000000dd";
const OTHER_ID = "e000000000000000000dd";

const fakeSession: SessionReader = async () => ({ userId: USER });
const app = createApp({ readSession: fakeSession });
const anonymousApp = createApp({ readSession: async () => null });

const deckId = (n: number) => `d0${String(n).padStart(19, "0")}`;
const itemId = (n: number) => `i0${String(n).padStart(19, "0")}`;

function slidesOf(count: number, line = "가"): Slide[] {
  return Array.from({ length: count }, (_, order) => ({
    id: `s${order}`,
    order,
    lines: [line, line, line, line],
  }));
}

function song(n: number, overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id: deckId(n),
    userId: USER,
    scope: "presentation",
    presentationId: DOC_ID,
    title: `곡 ${n}`,
    artist: "",
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

function heavySong(n: number): Deck {
  return song(n, {
    lyricsRaw: "가".repeat(MAX_WRITE_LYRICS_LENGTH),
    slides: slidesOf(MAX_WRITE_SLIDES, "가".repeat(80)),
  });
}

function controlCharacterSong(n: number): Deck {
  return song(n, { lyricsRaw: "\u0001".repeat(MAX_WRITE_LYRICS_LENGTH) });
}

const widestFontName = NOONNU_SUPPORTED_FONT_NAMES.reduce((widest, name) =>
  Buffer.byteLength(name) > Buffer.byteLength(widest) ? name : widest,
);

function widestFixedFieldsSong(n: number): Deck {
  const third = 100 / 3;
  return song(n, {
    lyricsRaw: "",
    slides: [],
    backgroundId: OTHER_ID,
    forkedFrom: OTHER_ID,
    forkCount: Number.MAX_SAFE_INTEGER,
    origin: "fork",
    forkedFromAuthorName: null,
    publishedAt: "2026-09-21T00:00:00.000Z",
    takedownAt: "2026-09-21T00:00:00.000Z",
    style: {
      overlayOpacity: third,
      overlayColor: "#FFFFFF",
      backgroundColor: "#FFFFFF",
      textBackdrop: {
        enabled: false,
        opacity: third,
        paddingPercent: third,
        radiusPercent: third,
      },
      fontFamily: widestFontName,
      fontSizeVw: 10 / 3,
      fontColor: "#FFFFFF",
      textAlign: "center",
      lineHeight: 4 / 3,
      textShadowLevel: "medium",
      position: {
        anchor: "bottom-center",
        xPercent: third,
        yPercent: third,
        widthPercent: third,
      },
    },
  });
}

function presentation(
  decks: Deck[],
  overrides: Partial<PresentationDocument> = {},
): PresentationDocument {
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId: USER,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: decks.map((deck, order) => ({
      id: itemId(order),
      presentationId: DOC_ID,
      deckId: deck.id,
      order,
      deck,
    })),
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

function onlyDecks(
  doc: PresentationDocument,
  sentIds: readonly string[],
): PresentationChanges {
  return toPresentationChanges(doc, (deck) => sentIds.includes(deck.id));
}

function textBytes(deck: Deck): number {
  return songTextBytes({
    ...deck,
    forkedFromAuthorName: deck.forkedFromAuthorName ?? null,
    slides: JSON.stringify(deck.slides),
  });
}

function storedCopy(deck: Deck, position: number): DeckDoc {
  return deckDoc({
    id: deck.id,
    userId: USER,
    presentationId: DOC_ID,
    itemId: itemId(position),
    position,
    title: deck.title,
    lyricsRaw: deck.lyricsRaw,
    slides: JSON.stringify(deck.slides),
    style: JSON.stringify(deck.style),
  });
}

function send(method: "PUT" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const savePresentation = (method: "PUT" | "PATCH", body: unknown) =>
  app.request(`/api/presentations/${DOC_ID}`, send(method, body), env);

const saveLibraryDeck = (deck: Deck) =>
  app.request(`/api/decks/${deck.id}`, send("PUT", deck), env);

async function storedDeckIds(): Promise<string[]> {
  const snapshot = await decksCol(env.DB)
    .where("presentationId", "==", DOC_ID)
    .get();
  return snapshot.docs.map((doc) => doc.id).sort();
}

async function growUntilRefused(
  next: (n: number) => Deck,
): Promise<{ songs: Deck[]; refusal: Response }> {
  const songs: Deck[] = [];
  for (let n = 0; n < 64; n += 1) {
    const added = next(n);
    const res = await savePresentation(
      "PATCH",
      onlyDecks(presentation([...songs, added]), [added.id]),
    );
    if (res.status !== 200) return { songs, refusal: res };
    songs.push(added);
  }
  throw new Error("곡 글 저장 상한에 닿지 않았어요");
}

describe("저장 본문의 쓰기 한도", () => {
  beforeEach(async () => {
    await clearDb(env.DB);
    await seedDocs(env.DB, {
      users: [userDoc({ id: USER, name: "인도자", termsAgreedAt: new Date() })],
    });
  });

  it("가사가 한도를 넘는 곡이 든 프레젠테이션은 PUT·PATCH 모두 그 곡을 짚어 413으로 답하고 아무것도 쓰지 않는다", async () => {
    const doc = presentation([
      song(0),
      song(1, {
        title: "긴 곡",
        lyricsRaw: "가".repeat(MAX_WRITE_LYRICS_LENGTH + 1),
      }),
    ]);

    for (const [method, body] of [
      ["PUT", doc],
      ["PATCH", toPresentationChanges(doc)],
    ] as const) {
      const res = await savePresentation(method, body);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        error: API_ERRORS.presentation.songTooLarge("긴 곡"),
      });
    }
    expect((await presentationsCol(env.DB).doc(DOC_ID).get()).exists).toBe(
      false,
    );
    expect(await storedDeckIds()).toEqual([]);
  });

  it("슬라이드 수가 한도를 넘는 곡도 그 곡을 짚어 413으로 답한다", async () => {
    const doc = presentation([
      song(0, {
        title: "슬라이드 많은 곡",
        slides: slidesOf(MAX_WRITE_SLIDES + 1),
      }),
    ]);

    const res = await savePresentation("PATCH", toPresentationChanges(doc));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: API_ERRORS.presentation.songTooLarge("슬라이드 많은 곡"),
    });
  });

  it("곡 수가 한도를 넘는 프레젠테이션은 PUT·PATCH 모두 413이다", async () => {
    const doc = presentation(
      Array.from({ length: MAX_PRESENTATION_SONGS + 1 }, (_, n) => song(n)),
    );

    for (const [method, body] of [
      ["PUT", doc],
      ["PATCH", toPresentationChanges(doc)],
    ] as const) {
      const res = await savePresentation(method, body);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        error: API_ERRORS.presentation.tooLarge,
      });
    }
    expect((await presentationsCol(env.DB).doc(DOC_ID).get()).exists).toBe(
      false,
    );
  });

  it("한도에 꼭 맞는 곡과 곡 수는 그대로 저장된다", async () => {
    const fullSong = song(0, {
      title: "한도에 맞는 곡",
      lyricsRaw: "가".repeat(MAX_WRITE_LYRICS_LENGTH),
      slides: [
        ...slidesOf(MAX_WRITE_SLIDES - 1),
        {
          id: "s".repeat(MAX_SLIDE_ID_LENGTH),
          order: MAX_WRITE_SLIDES - 1,
          lines: ["가"],
        },
      ],
    });
    const doc = presentation([
      fullSong,
      ...Array.from({ length: MAX_PRESENTATION_SONGS - 1 }, (_, n) =>
        song(n + 1),
      ),
    ]);

    const res = await savePresentation("PATCH", toPresentationChanges(doc));

    expect(res.status).toBe(200);
    expect(await storedDeckIds()).toHaveLength(MAX_PRESENTATION_SONGS);
    const stored = (await decksCol(env.DB).doc(fullSong.id).get()).data();
    expect(stored?.lyricsRaw).toHaveLength(MAX_WRITE_LYRICS_LENGTH);
    expect((await savePresentation("PUT", doc)).status).toBe(200);
  });

  it("슬라이드 id가 너무 길거나 한도와 상관없는 값이 틀리면 지금처럼 400이다", async () => {
    const longSlideId = presentation([
      song(0, {
        slides: [
          { id: "s".repeat(MAX_SLIDE_ID_LENGTH + 1), order: 0, lines: ["가"] },
        ],
      }),
    ]);
    const longTitle = {
      ...toPresentationChanges(presentation([song(0)])),
      title: "가".repeat(101),
    };

    expect(
      (await savePresentation("PATCH", toPresentationChanges(longSlideId)))
        .status,
    ).toBe(400);
    expect((await savePresentation("PATCH", longTitle)).status).toBe(400);
  });

  it("가사 길이는 스키마처럼 코드 포인트로 세어, UTF-16 길이만 한도를 넘는 이모지 가사는 쓰기 한도로 보지 않는다", async () => {
    const emojiLyrics = "😀".repeat(MAX_WRITE_LYRICS_LENGTH);
    const withLongSlideId = presentation([
      song(0, {
        title: "이모지 곡",
        lyricsRaw: emojiLyrics,
        slides: [
          { id: "s".repeat(MAX_SLIDE_ID_LENGTH + 1), order: 0, lines: ["가"] },
        ],
      }),
    ]);
    const fits = presentation([
      song(0, { title: "이모지 곡", lyricsRaw: emojiLyrics }),
    ]);

    expect(
      (await savePresentation("PATCH", toPresentationChanges(withLongSlideId)))
        .status,
    ).toBe(400);
    expect(
      (await savePresentation("PATCH", toPresentationChanges(fits))).status,
    ).toBe(200);
  });

  it("보관함 곡도 가사·슬라이드 한도를 넘으면 413이고 한도에 꼭 맞으면 저장된다", async () => {
    const library = (overrides: Partial<Deck>) =>
      song(0, {
        id: LIB_DECK_ID,
        scope: "library",
        presentationId: null,
        ...overrides,
      });

    for (const deck of [
      library({ lyricsRaw: "가".repeat(MAX_WRITE_LYRICS_LENGTH + 1) }),
      library({ slides: slidesOf(MAX_WRITE_SLIDES + 1) }),
    ]) {
      const res = await saveLibraryDeck(deck);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: API_ERRORS.deck.tooLarge });
    }
    expect((await decksCol(env.DB).doc(LIB_DECK_ID).get()).exists).toBe(false);

    const fits = await saveLibraryDeck(
      library({
        lyricsRaw: "가".repeat(MAX_WRITE_LYRICS_LENGTH),
        slides: slidesOf(MAX_WRITE_SLIDES),
      }),
    );
    expect(fits.status).toBe(200);
  });

  it("곡 글 저장 상한에 곡마다의 고정 필드를 더해도 요청 본문 상한 안이라, 서버가 받은 프레젠테이션은 언제나 한 번에 다시 보낼 수 있다", () => {
    const doc = presentation(
      Array.from({ length: MAX_PRESENTATION_SONGS }, (_, n) =>
        widestFixedFieldsSong(n),
      ),
      {
        title: "\u0001".repeat(MAX_PRESENTATION_TITLE_LENGTH),
        folderId: OTHER_ID,
        trashedAt: "2026-09-22T00:00:00.000Z",
      },
    );
    const text = doc.items.reduce((sum, item) => sum + textBytes(item.deck), 0);

    for (const body of [doc, toPresentationChanges(doc)]) {
      const fixedBytes = Buffer.byteLength(JSON.stringify(body)) - text;
      expect(MAX_PRESENTATION_TEXT_BYTES + fixedBytes).toBeLessThanOrEqual(
        PRESENTATION_BODY_MAX_BYTES,
      );
    }
  });

  it("제어 문자 가사로 곡 글 저장 상한까지 키운 프레젠테이션도 통째로 다시 보낼 수 있고, 로그인 없이 보는 응답은 요청 본문 상한 안이다", async () => {
    const { songs, refusal } = await growUntilRefused(controlCharacterSong);

    expect(refusal.status).toBe(413);
    expect(await refusal.json()).toEqual({
      error: API_ERRORS.presentation.tooLarge,
    });
    expect(songs.length).toBeGreaterThan(1);

    const doc = presentation(songs);
    expect(
      (await savePresentation("PATCH", toPresentationChanges(doc))).status,
    ).toBe(200);
    expect((await savePresentation("PUT", doc)).status).toBe(200);

    const share = await app.request(
      `/api/presentations/${DOC_ID}/share`,
      send("PUT", { access: "view" }),
      env,
    );
    const { token } = (await share.json()) as ShareSettings;
    const view = await anonymousApp.request(`/api/share/${token}`, {}, env);

    expect(view.status).toBe(200);
    expect(Buffer.byteLength(await view.text())).toBeLessThan(
      PRESENTATION_BODY_MAX_BYTES,
    );
  });

  it("요청 본문 상한(2 MiB)을 넘는 프레젠테이션 저장은 읽기 전에 413이다", async () => {
    const doc = presentation([
      song(0, { lyricsRaw: "가".repeat(1024 * 1024) }),
    ]);

    const res = await savePresentation("PATCH", toPresentationChanges(doc));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: API_ERRORS.payloadTooLarge });
  });

  it("곡을 나눠 보내며 곡 글을 저장 상한 너머로 키우면 413이고 저장된 곡은 그대로다", async () => {
    const songs = [0, 1, 2, 3].map(heavySong);
    expect(textBytes(songs[0] as Deck) * 2).toBeLessThan(
      MAX_PRESENTATION_TEXT_BYTES,
    );
    expect(textBytes(songs[0] as Deck) * 4).toBeGreaterThan(
      MAX_PRESENTATION_TEXT_BYTES,
    );

    const firstTwo = presentation(songs.slice(0, 2));
    expect(
      (await savePresentation("PATCH", toPresentationChanges(firstTwo))).status,
    ).toBe(200);

    const all = presentation(songs);
    const grow = await savePresentation(
      "PATCH",
      onlyDecks(all, [deckId(2), deckId(3)]),
    );

    expect(grow.status).toBe(413);
    expect(await grow.json()).toEqual({
      error: API_ERRORS.presentation.tooLarge,
    });
    expect(await storedDeckIds()).toEqual([deckId(0), deckId(1)]);
  });

  it("이미 저장 상한을 넘은 프레젠테이션도 곡 글을 키우지 않는 저장은 받는다", async () => {
    const songs = [0, 1, 2, 3, 4, 5].map(heavySong);
    await seedDocs(env.DB, {
      presentations: [presentationDoc({ id: DOC_ID, userId: USER })],
      decks: songs.slice(0, 5).map(storedCopy),
    });
    const storedTitle = async () =>
      (await presentationsCol(env.DB).doc(DOC_ID).get()).data()?.title;

    const rename = await savePresentation("PATCH", {
      ...onlyDecks(presentation(songs.slice(0, 5)), []),
      title: "제목만 바꾼 예배",
    });
    expect(rename.status).toBe(200);
    expect(await storedTitle()).toBe("제목만 바꾼 예배");

    const remaining = songs.slice(0, 4);
    expect(
      remaining.reduce((sum, deck) => sum + textBytes(deck), 0),
    ).toBeGreaterThan(MAX_PRESENTATION_TEXT_BYTES);
    const shrink = await savePresentation(
      "PATCH",
      onlyDecks(presentation(remaining), []),
    );
    expect(shrink.status).toBe(200);
    expect(await storedDeckIds()).toEqual(remaining.map((deck) => deck.id));

    const grow = await savePresentation(
      "PATCH",
      onlyDecks(presentation([...remaining, songs[5] as Deck]), [deckId(5)]),
    );
    expect(grow.status).toBe(413);
    expect(await grow.json()).toEqual({
      error: API_ERRORS.presentation.tooLarge,
    });
    expect(await storedDeckIds()).toEqual(remaining.map((deck) => deck.id));
  });

  it("한도 안의 곡이라도 Firestore 문서 한도를 넘으면 그 곡을 짚어 413으로 답한다", async () => {
    const doc = presentation([
      song(0, {
        title: "제어 문자 곡",
        lyricsRaw: "가".repeat(MAX_WRITE_LYRICS_LENGTH),
        slides: slidesOf(MAX_WRITE_SLIDES, "\u0001".repeat(80)),
      }),
    ]);

    const res = await savePresentation("PATCH", toPresentationChanges(doc));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: API_ERRORS.presentation.songTooLarge("제어 문자 곡"),
    });
    expect((await presentationsCol(env.DB).doc(DOC_ID).get()).exists).toBe(
      false,
    );
  });

  it("한도 안의 보관함 곡이라도 Firestore 문서 한도를 넘을 만큼 크면 곡 저장 본문 상한에서 413이고 아무것도 쓰지 않는다", async () => {
    const deck = song(0, {
      id: LIB_DECK_ID,
      scope: "library",
      presentationId: null,
      title: "제어 문자 곡",
      lyricsRaw: "가".repeat(MAX_WRITE_LYRICS_LENGTH),
      slides: slidesOf(MAX_WRITE_SLIDES, "\u0001".repeat(80)),
    });
    expect(Buffer.byteLength(JSON.stringify(deck))).toBeGreaterThan(
      DECK_BODY_MAX_BYTES,
    );

    const res = await saveLibraryDeck(deck);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: API_ERRORS.payloadTooLarge });
    expect((await decksCol(env.DB).doc(LIB_DECK_ID).get()).exists).toBe(false);
  });
});
