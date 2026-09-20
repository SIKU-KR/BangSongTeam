import { describe, it, expect } from "vitest";
import {
  CreateDeckRequestSchema,
  UpdateDeckRequestSchema,
  CreateSetlistRequestSchema,
  UpdateSetlistItemsRequestSchema,
  SearchCatalogQuerySchema,
  SearchCatalogResponseSchema,
} from "./api";

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
    expect(parsed.contributeToCatalog).toBe(true);
  });

  it("validates UpdateDeckRequestSchema as partial", () => {
    const partial = {
      title: "새로운 제목",
    };
    const parsed = UpdateDeckRequestSchema.parse(partial);
    expect(parsed.title).toBe("새로운 제목");
    expect(parsed.lyricsRaw).toBeUndefined();
  });

  it("validates CreateSetlistRequestSchema", () => {
    const valid = {
      title: "주일 찬양 콘티",
      serviceDate: "2026-09-27",
    };
    expect(CreateSetlistRequestSchema.parse(valid)).toEqual(valid);
  });

  it("validates UpdateSetlistItemsRequestSchema", () => {
    const valid = {
      items: [
        { deckId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", order: 0 },
        { deckId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22", order: 1 },
      ],
    };
    expect(UpdateSetlistItemsRequestSchema.parse(valid)).toEqual(valid);
  });

  it("validates SearchCatalogQuerySchema and coerces limit", () => {
    const parsed = SearchCatalogQuerySchema.parse({
      q: "은혜",
      limit: "15",
    });
    expect(parsed.q).toBe("은혜");
    expect(parsed.limit).toBe(15);
  });

  it("validates SearchCatalogResponseSchema", () => {
    const response = {
      decks: [
        {
          id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          title: "은혜로다",
          artist: "예수전도단",
          forkCount: 42,
          backgroundId: null,
          posterUrl: null,
          firstSlidePreview: ["시작됐네 우리 주님의 능력이"],
        },
      ],
      catalogLyrics: [
        {
          id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
          title: "은혜로다",
          artist: "예수전도단",
          versionCount: 3,
          status: "normalized" as const,
          twoLinesPreview: [
            "시작됐네 우리 주님의 능력이",
            "나의 삶을 다스리시네",
          ],
        },
      ],
    };
    expect(SearchCatalogResponseSchema.parse(response)).toEqual(response);
  });
});
