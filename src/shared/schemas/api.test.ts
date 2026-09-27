import { describe, it, expect } from "vitest";
import {
  CreateDeckRequestSchema,
  UpdateDeckRequestSchema,
  CreatePresentationRequestSchema,
  UpdatePresentationItemsRequestSchema,
  SearchCatalogQuerySchema,
  SearchCatalogResponseSchema,
  PresentationDocumentSchema,
  PresentationListResponseSchema,
  DeckListResponseSchema,
  ApiErrorSchema,
} from "./api";
import { DeckStyleSchema } from "./style";
import { PresentationSchema } from "./presentation";

describe("API Schemas", () => {
  it("validates CreateDeckRequestSchema with default values", () => {
    const valid = {
      title: "꽃들도",
      lyricsRaw: "이곳에 생명 샘 솟아나",
      slides: [{ order: 0, lines: ["이곳에 생명 샘 솟아나"] }],
      style: {},
    };
    const parsed = CreateDeckRequestSchema.parse(valid);
    expect(parsed.artist).toBe("");
    expect(parsed.visibility).toBe("private");
  });

  it("validates UpdateDeckRequestSchema as partial", () => {
    const partial = {
      title: "새로운 제목",
    };
    const parsed = UpdateDeckRequestSchema.parse(partial);
    expect(parsed.title).toBe("새로운 제목");
    expect(parsed.lyricsRaw).toBeUndefined();
  });

  it("validates CreatePresentationRequestSchema", () => {
    const valid = {
      title: "주일 찬양 프레젠테이션",
      serviceDate: "2026-09-27",
    };
    expect(CreatePresentationRequestSchema.parse(valid)).toEqual(valid);
  });

  it("validates UpdatePresentationItemsRequestSchema", () => {
    const valid = {
      items: [
        { deckId: "a0eebc9996bb9bd380a11", order: 0 },
        { deckId: "b0eebc9996bb9bd380a22", order: 1 },
      ],
    };
    expect(UpdatePresentationItemsRequestSchema.parse(valid)).toEqual(valid);
  });

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

    it("목록 응답 봉투를 검증한다", () => {
      const listed = { presentations: [document] };
      expect(PresentationListResponseSchema.parse(listed)).toEqual(listed);
      expect(DeckListResponseSchema.parse({ decks: [deck] })).toEqual({
        decks: [deck],
      });
    });

    it("오류 본문을 검증한다", () => {
      expect(ApiErrorSchema.parse({ error: "로그인이 필요합니다" })).toEqual({
        error: "로그인이 필요합니다",
      });
      expect(ApiErrorSchema.safeParse({}).success).toBe(false);
    });
  });
});
