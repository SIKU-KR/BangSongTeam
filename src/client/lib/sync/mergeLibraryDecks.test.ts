import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "#shared";
import {
  hasSameDeckContent,
  hasSameServerFields,
  mergeLibraryDecks,
} from "./mergeLibraryDecks";

const USER = "00000000x000000000001";

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

const A = "c0000000000000000000a";
const B = "c0000000000000000000b";

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
    });
    expect(needsPush).toEqual([A]);
  });

  describe("기기 시계보다 앞선 로컬 시각", () => {
    const NOW = "2026-09-25T00:00:00.000Z";

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(NOW));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("기기 시계 + 10분보다 늦은 로컬 곡은 서버 사본에 지고 올리지 않는다", () => {
      const { decks, needsPush } = mergeLibraryDecks(
        [deck(A, { title: "미래", updatedAt: "2026-09-25T00:10:00.001Z" })],
        [deck(A, { title: "서버" })],
      );

      expect(decks.map((d) => d.title)).toEqual(["서버"]);
      expect(needsPush).toEqual([]);
    });

    it("기기 시계 + 10분까지의 더 새 로컬 곡은 그대로 이기고 올린다", () => {
      const { decks, needsPush } = mergeLibraryDecks(
        [deck(A, { title: "로컬", updatedAt: "2026-09-25T00:10:00.000Z" })],
        [deck(A, { title: "서버" })],
      );

      expect(decks.map((d) => d.title)).toEqual(["로컬"]);
      expect(needsPush).toEqual([A]);
    });
  });

  it("sorts by most recently updated", () => {
    const { decks } = mergeLibraryDecks(
      [deck(A, { updatedAt: "2026-09-20T00:00:00.000Z" })],
      [deck(B, { updatedAt: "2026-09-25T00:00:00.000Z" })],
    );
    expect(decks.map((d) => d.id)).toEqual([B, A]);
  });

  it("지운 곡은 로컬에만 있어도 올리지 않고 지울 곡으로 돌려준다", () => {
    const result = mergeLibraryDecks([deck(A)], [], { deletedIds: [A] });

    expect(result).toEqual({ decks: [], needsPush: [], removedIds: [A] });
  });

  it("지운 곡은 로컬 사본이 더 새로워도 지운다", () => {
    const result = mergeLibraryDecks(
      [deck(A, { updatedAt: "2026-09-23T00:00:00.000Z" })],
      [deck(A)],
      { deletedIds: new Set([A]) },
    );

    expect(result).toEqual({ decks: [], needsPush: [], removedIds: [A] });
  });

  it("지운 곡은 서버 목록에 다시 있어도 받지 않는다", () => {
    const result = mergeLibraryDecks([], [deck(A), deck(B)], {
      deletedIds: [A],
    });

    expect(result.decks.map((d) => d.id)).toEqual([B]);
    expect(result.removedIds).toEqual([]);
  });

  it("지운 곡이 없으면 지울 곡도 없다", () => {
    expect(mergeLibraryDecks([deck(A)], [deck(B)]).removedIds).toEqual([]);
  });
});

describe("hasSameDeckContent", () => {
  it("시각과 서버가 정하는 필드만 다르면 같은 내용으로 본다", () => {
    expect(
      hasSameDeckContent(
        deck(A, { forkCount: 0 }),
        deck(A, {
          forkCount: 3,
          visibility: "public",
          createdAt: "2026-09-21T00:00:00.000Z",
          updatedAt: "2026-09-22T00:00:00.000Z",
        }),
      ),
    ).toBe(true);
  });

  it("제목·슬라이드·서식·배경이 하나라도 다르면 다른 내용으로 본다", () => {
    const base = deck(A);

    expect(hasSameDeckContent(base, deck(A, { title: "다른 제목" }))).toBe(
      false,
    );
    expect(
      hasSameDeckContent(
        base,
        deck(A, { slides: [{ id: "s1", order: 0, lines: ["바뀐 가사"] }] }),
      ),
    ).toBe(false);
    expect(
      hasSameDeckContent(
        base,
        deck(A, { style: { ...DEFAULT_DECK_STYLE, fontSizeVw: 9 } }),
      ),
    ).toBe(false);
    expect(hasSameDeckContent(base, deck(A, { backgroundId: B }))).toBe(false);
  });

  it("목록에 없는 필드도 견준다", () => {
    const withExtra = { ...deck(A), tempo: 72 } as Deck;

    expect(hasSameDeckContent(deck(A), withExtra)).toBe(false);
  });

  it("값이 없는 필드와 null은 같게 본다", () => {
    expect(
      hasSameDeckContent(
        deck(A, { presentationId: undefined }),
        deck(A, { presentationId: null }),
      ),
    ).toBe(true);
  });
});

describe("hasSameServerFields", () => {
  it("서버가 정하는 필드가 같으면 내용이 달라도 같다고 본다", () => {
    expect(
      hasSameServerFields(
        deck(A, { title: "로컬", forkCount: 2 }),
        deck(A, { title: "서버", forkCount: 2 }),
      ),
    ).toBe(true);
  });

  it("가져간 횟수가 다르면 다르다고 본다", () => {
    expect(
      hasSameServerFields(deck(A, { forkCount: 0 }), deck(A, { forkCount: 1 })),
    ).toBe(false);
  });

  it("값이 없는 필드와 null은 같게 본다", () => {
    expect(
      hasSameServerFields(
        deck(A, { publishedAt: undefined, forkedFrom: undefined }),
        deck(A, { publishedAt: null, forkedFrom: null }),
      ),
    ).toBe(true);
  });
});
