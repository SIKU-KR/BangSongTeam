import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema } from "./deck";
import { SlideSchema } from "./slide";
import { DeckStyleSchema } from "./style";

/**
 * 덱 공개 설정 변경.
 * 공개 설정 시 저작권 안내 동의(true)가 필수이다.
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
 * 가사 전문이 새지 않게 하는 저작권 보호 장치다.
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
 * 편집기 곡 추가 모달이 찬양 버전·구성을 확인할 수 있게 가사 전문을 준다.
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
