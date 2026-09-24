import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema } from "./deck";
import { SlideSchema } from "./slide";
import { DeckStyleSchema } from "./style";

// ============================================================================
// 공유 라이브러리 API 계약 (M5, PRD 4.7)
//
// 공개 경로로 나가는 구조는 DB 행이나 내부 Deck DTO를 그대로 쓰지 않는다.
// `userId`처럼 남에게 보일 이유가 없는 값이 새지 않도록 여기서 모양을 따로 정한다.
// ============================================================================

/**
 * 덱 공개 설정 변경.
 *
 * 공개로 돌릴 때는 저작권 안내 동의가 반드시 `true` 리터럴이어야 한다.
 * 불리언 필드로 두면 `false`를 보내도 스키마를 통과해 '동의 없이 공개'가
 * 가능해진다 (PRD 4.7, 9장 '공개 시 안내 동의').
 */
export const VisibilityUpdateRequestSchema = z.discriminatedUnion(
  "visibility",
  [
    z.object({
      visibility: z.literal("public"),
      acceptedCopyrightNotice: z.literal(true),
    }),
    z.object({
      visibility: z.literal("private"),
    }),
  ],
);
export type VisibilityUpdateRequest = z.infer<
  typeof VisibilityUpdateRequestSchema
>;

/** 덱 하나를 바꾼 뒤 서버가 확정한 덱을 돌려준다 */
export const DeckMutationResponseSchema = z.object({
  deck: DeckSchema,
});
export type DeckMutationResponse = z.infer<typeof DeckMutationResponseSchema>;

/**
 * 공개 덱 검색 결과 카드.
 *
 * 로그인 여부와 무관하게 첫 슬라이드만 담는다. 비로그인 공개 카탈로그에서
 * 가사 전문이 새지 않게 하는 저작권 보호 장치다 (TECH_SPEC §8.1).
 */
export const PublicDeckSummarySchema = z.object({
  id: IdSchema,
  title: z.string(),
  artist: z.string(),
  /** 공개한 사람의 표시 이름 */
  authorName: z.string(),
  /** 이 덱 자체가 포크본이면 그 원작자 */
  forkedFromAuthorName: z.string().nullable(),
  forkCount: z.number().int().nonnegative(),
  backgroundId: IdSchema.nullable(),
  firstSlidePreview: z.array(z.string()),
  slideCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type PublicDeckSummary = z.infer<typeof PublicDeckSummarySchema>;

/**
 * 공개 덱 상세 (로그인 필요).
 *
 * 편집기 곡 추가 모달이 찬양 버전·구성을 확인할 수 있게 가사 전문을 준다
 * (PRD 4.7 괄호 문단).
 */
export const PublicDeckDetailSchema = PublicDeckSummarySchema.extend({
  lyricsRaw: z.string(),
  slides: z.array(SlideSchema),
  style: DeckStyleSchema,
});
export type PublicDeckDetail = z.infer<typeof PublicDeckDetailSchema>;

/**
 * 공개 덱 가져오기(fork) 결과.
 *
 * `alreadyOwned`면 새 덱을 만들지 않고 내 보관함의 기존 덱(이전에 가져온 포크,
 * 또는 내가 공개한 원본 자신)을 돌려준 것이다. 가져간 횟수도 올리지 않는다.
 */
export const ForkDeckResponseSchema = z.object({
  deck: DeckSchema,
  alreadyOwned: z.boolean(),
});
export type ForkDeckResponse = z.infer<typeof ForkDeckResponseSchema>;

// ---------------------------------------------------------------------------
// 신고 (PRD 4.7 신고, 9장 게시 중단 절차)
// ---------------------------------------------------------------------------

/**
 * - `lyrics_error`: 가사 오류
 * - `inappropriate`: 부적절한 콘텐츠
 * - `copyright`: 저작권자 게시 중단 요청
 * - `correction`: 가져간 사용자의 교정 제안
 */
export const ReportReasonSchema = z.enum([
  "lyrics_error",
  "inappropriate",
  "copyright",
  "correction",
]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const ReportTargetTypeSchema = z.enum(["deck"]);
export type ReportTargetType = z.infer<typeof ReportTargetTypeSchema>;

export const CreateReportRequestSchema = z.object({
  targetType: ReportTargetTypeSchema,
  targetId: IdSchema,
  reason: ReportReasonSchema,
  details: z.string().trim().max(500).optional(),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

export const CreateReportResponseSchema = z.object({
  id: IdSchema,
});
export type CreateReportResponse = z.infer<typeof CreateReportResponseSchema>;
