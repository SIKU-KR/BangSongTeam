import { describe, it, expect } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  EmailSignUpRequestSchema,
  SearchCatalogQuerySchema,
  SearchCatalogResponseSchema,
  PresentationChangesRequestSchema,
  PresentationDocumentRequestSchema,
  PresentationDocumentSchema,
  clampSearchQuery,
} from "./api";
import { DeckStyleSchema } from "./style";
import { PresentationSchema } from "./presentation";
import { toPresentationChanges } from "../utils/presentationChanges";

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
  });

  it("긴 검색어는 거절하지 않고 앞 50자로 자른다", () => {
    expect(SearchCatalogQuerySchema.parse({ q: "가".repeat(61) }).q).toBe(
      "가".repeat(50),
    );
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
          official: false,
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

    it("기준 판(baseUpdatedAt)은 저장 요청 스키마와 클라이언트 모델·문서 스키마가 모두 지닌다", () => {
      const changes = toPresentationChanges(
        PresentationDocumentSchema.parse(document),
      );

      for (const baseUpdatedAt of ["2026-09-22T00:00:00.000Z", null]) {
        expect(
          PresentationDocumentRequestSchema.parse({
            ...document,
            baseUpdatedAt,
          }).baseUpdatedAt,
        ).toBe(baseUpdatedAt);
        expect(
          PresentationChangesRequestSchema.parse({ ...changes, baseUpdatedAt })
            .baseUpdatedAt,
        ).toBe(baseUpdatedAt);
        expect(
          PresentationDocumentSchema.parse({ ...document, baseUpdatedAt })
            .baseUpdatedAt,
        ).toBe(baseUpdatedAt);
        expect(
          PresentationSchema.parse({ ...document, baseUpdatedAt })
            .baseUpdatedAt,
        ).toBe(baseUpdatedAt);
        expect(
          toPresentationChanges(
            PresentationDocumentSchema.parse({ ...document, baseUpdatedAt }),
          ).baseUpdatedAt,
        ).toBe(baseUpdatedAt);
      }
      expect(
        PresentationChangesRequestSchema.parse(changes),
      ).not.toHaveProperty("baseUpdatedAt");
      expect(PresentationSchema.parse(document)).not.toHaveProperty(
        "baseUpdatedAt",
      );
      expect(
        PresentationChangesRequestSchema.safeParse({
          ...changes,
          baseUpdatedAt: "어제",
        }).success,
      ).toBe(false);
    });
  });
});

describe("clampSearchQuery", () => {
  it("앞뒤 공백을 떼고 50자까지만 남긴다", () => {
    expect(clampSearchQuery("  은혜  ")).toBe("은혜");
    expect(clampSearchQuery(`${"가".repeat(49)} 나다`)).toBe("가".repeat(49));
  });

  it("50자 경계에 걸친 이모지는 반쪽으로 자르지 않고 뺀다", () => {
    const clamped = clampSearchQuery(`${"가".repeat(49)}🙏🙏`);

    expect(clamped).toBe("가".repeat(49));
    expect(() => encodeURIComponent(clamped)).not.toThrow();
  });
});

describe("EmailSignUpRequestSchema", () => {
  const acceptsEmail = (email: string): boolean =>
    EmailSignUpRequestSchema.safeParse({
      name: "찬양팀",
      email,
      password: "password-1234",
    }).success;
  const emailOfLength = (length: number): string =>
    `${"a".repeat(length - "@example.com".length)}@example.com`;

  it("메일 주소가 가질 수 있는 가장 긴 길이까지만 받는다", () => {
    expect(acceptsEmail(emailOfLength(EMAIL_MAX_LENGTH))).toBe(true);
    expect(acceptsEmail(emailOfLength(EMAIL_MAX_LENGTH + 1))).toBe(false);
  });

  it("짝 없는 서로게이트가 든 주소는 받지 않는다", () => {
    expect(acceptsEmail(`a${String.fromCharCode(0xd800)}b@example.com`)).toBe(
      false,
    );
  });
});
