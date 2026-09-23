import { describe, it, expect } from "vitest";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "@repo/shared";
import { mergeLibraryDecks, withServerFields } from "./mergeLibraryDecks";

const USER = "00000000-0000-4000-8000-000000000001";

function deck(id: string, overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id,
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

const A = "c0000000-0000-4000-8000-00000000000a";
const B = "c0000000-0000-4000-8000-00000000000b";

describe("mergeLibraryDecks", () => {
  it("keeps local-only decks and schedules them for upload", () => {
    const { decks, needsPush } = mergeLibraryDecks([deck(A)], []);
    expect(decks.map((d) => d.id)).toEqual([A]);
    expect(needsPush).toEqual([A]);
  });

  it("adopts server-only decks (another device)", () => {
    const { decks, needsPush } = mergeLibraryDecks([], [deck(B)]);
    expect(decks.map((d) => d.id)).toEqual([B]);
    expect(needsPush).toEqual([]);
  });

  it("uses the server copy when it is as new or newer", () => {
    const { decks, needsPush } = mergeLibraryDecks(
      [deck(A, { title: "로컬" })],
      [deck(A, { title: "서버", updatedAt: "2026-09-22T00:00:00.000Z" })],
    );
    expect(decks[0].title).toBe("서버");
    expect(needsPush).toEqual([]);
  });

  it("keeps newer local content but always takes server-owned sharing fields", () => {
    const { decks, needsPush } = mergeLibraryDecks(
      [
        deck(A, {
          title: "로컬에서 고침",
          updatedAt: "2026-09-23T00:00:00.000Z",
          visibility: "private",
          forkCount: 0,
          origin: "user",
          catalogId: null,
        }),
      ],
      [
        deck(A, {
          title: "서버 제목",
          visibility: "public",
          forkCount: 4,
          origin: "fork",
          forkedFrom: B,
          forkedFromAuthorName: "원작자",
          publishedAt: "2026-09-22T00:00:00.000Z",
          catalogId: "d0000000-0000-4000-8000-000000000001",
        }),
      ],
    );
    expect(decks[0]).toMatchObject({
      title: "로컬에서 고침",
      visibility: "public",
      forkCount: 4,
      origin: "fork",
      forkedFrom: B,
      forkedFromAuthorName: "원작자",
      publishedAt: "2026-09-22T00:00:00.000Z",
      catalogId: "d0000000-0000-4000-8000-000000000001",
    });
    expect(needsPush).toEqual([A]);
  });

  it("sorts by most recently updated", () => {
    const { decks } = mergeLibraryDecks(
      [deck(A, { updatedAt: "2026-09-20T00:00:00.000Z" })],
      [deck(B, { updatedAt: "2026-09-25T00:00:00.000Z" })],
    );
    expect(decks.map((d) => d.id)).toEqual([B, A]);
  });
});

describe("withServerFields", () => {
  it("does not drop a local catalog link when the server has none yet", () => {
    const local = deck(A, {
      catalogId: "d0000000-0000-4000-8000-000000000001",
    });
    expect(withServerFields(local, deck(A)).catalogId).toBe(
      "d0000000-0000-4000-8000-000000000001",
    );
  });
});
