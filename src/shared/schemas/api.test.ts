import { describe, it, expect } from "vitest";
import {
  SearchCatalogQuerySchema,
  SearchCatalogResponseSchema,
  PresentationDocumentSchema,
} from "./api";
import { DeckStyleSchema } from "./style";
import { PresentationSchema } from "./presentation";

describe("API Schemas", () => {
  it("validates SearchCatalogQuerySchema and coerces limit", () => {
    const parsed = SearchCatalogQuerySchema.parse({
      q: " 은혜 ",
      limit: "15",
    });
    expect(parsed.q).toBe("은혜");
    expect(parsed.limit).toBe(15);
  });

  it("allows an empty query for browsing by popularity", () => {
    expect(SearchCatalogQuerySchema.parse({}).q).toBe("");
    expect(SearchCatalogQuerySchema.parse({ q: "" }).limit).toBe(20);
    expect(() =>
      SearchCatalogQuerySchema.parse({ q: "가".repeat(51) }),
    ).toThrow();
  });

  it("validates SearchCatalogResponseSchema", () => {
    const response = {
      decks: [
        {
          id: "a0eebc9996bb9bd380a11",
          title: "은혜로다",
          artist: "예수전도단",
          authorName: "김찬양",
          forkedFromAuthorName: null,
          forkCount: 42,
          backgroundId: null,
          firstSlidePreview: ["시작됐네 우리 주님의 능력이"],
          slideCount: 6,
          updatedAt: "2026-09-23T00:00:00.000Z",
        },
      ],
    };
    expect(SearchCatalogResponseSchema.parse(response)).toEqual(response);
  });

  it("does not leak full lyrics or owner ids through the public search shape", () => {
    const parsed = SearchCatalogResponseSchema.parse({
      decks: [
        {
          id: "a0eebc9996bb9bd380a11",
          title: "은혜로다",
          artist: "",
          authorName: "김찬양",
          forkedFromAuthorName: null,
          forkCount: 0,
          backgroundId: null,
          firstSlidePreview: [],
          slideCount: 0,
          updatedAt: "2026-09-23T00:00:00.000Z",
          userId: "00000000x000000000001",
          lyricsRaw: "전문",
        },
      ],
    });
    expect(parsed.decks[0]).not.toHaveProperty("userId");
    expect(parsed.decks[0]).not.toHaveProperty("lyricsRaw");
  });
  describe("동기화 문서 계약", () => {
    const deck = {
      id: "c00000000000000000001",
      userId: "00000000x000000000001",
      scope: "presentation" as const,
      presentationId: "100000000000000000001",
      title: "은혜로다",
      artist: "예수전도단",
      lyricsRaw: "시작됐네",
      slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
      backgroundId: "mJIToShuKOc3FsbZIihi6",
      style: DeckStyleSchema.parse({}),
      visibility: "private" as const,
      forkedFrom: null,
      forkCount: 0,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    };

    const document = {
      id: "100000000000000000001",
      userId: "00000000x000000000001",
      title: "주일 1부 예배",
      serviceDate: "2026-09-27",
      items: [
        {
          id: "300000000000000000001",
          presentationId: "100000000000000000001",
          deckId: deck.id,
          order: 0,
          deck,
        },
      ],
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    };

    it("덱이 임베드된 문서를 통과시킨다", () => {
      expect(PresentationDocumentSchema.parse(document)).toEqual(document);
    });

    it("덱이 빠진 항목은 거부한다", () => {
      const withoutDeck = {
        ...document,
        items: [{ ...document.items[0], deck: undefined }],
      };
      expect(PresentationDocumentSchema.safeParse(withoutDeck).success).toBe(
        false,
      );
      expect(PresentationSchema.safeParse(withoutDeck).success).toBe(true);
    });
  });
});
