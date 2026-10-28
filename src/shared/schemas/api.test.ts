import { describe, it, expect } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  EmailSignUpRequestSchema,
  OmittedPresentationSchema,
  PresentationListQuerySchema,
  PresentationChangesRequestSchema,
  PresentationDocumentRequestSchema,
  PresentationDocumentSchema,
} from "./api";
import { DeckStyleSchema } from "./style";
import { PresentationSchema } from "./presentation";
import { toPresentationChanges } from "../utils/presentationChanges";

describe("API Schemas", () => {
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
      forkedFrom: null,
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

    it("곡 사본을 뺀 머리는 어느 문서 스키마로 읽어도 곡이 없는 프레젠테이션이 되지 않는다", () => {
      const omitted = { ...document, items: null, copiesOmitted: true };

      expect(OmittedPresentationSchema.parse(omitted)).toEqual(omitted);
      expect(PresentationDocumentSchema.safeParse(omitted).success).toBe(false);
      expect(PresentationSchema.safeParse(omitted).success).toBe(false);
      expect(
        OmittedPresentationSchema.safeParse({ ...document, items: [] }).success,
      ).toBe(false);
    });

    it("목록 쿼리의 since는 ISO 시각만 받는다", () => {
      expect(PresentationListQuerySchema.parse({})).toEqual({});
      expect(
        PresentationListQuerySchema.parse({
          since: "2026-09-22T00:00:00.000Z",
        }),
      ).toEqual({ since: "2026-09-22T00:00:00.000Z" });
      for (const since of ["어제", "", "1727000000000"]) {
        expect(PresentationListQuerySchema.safeParse({ since }).success).toBe(
          false,
        );
      }
    });
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
