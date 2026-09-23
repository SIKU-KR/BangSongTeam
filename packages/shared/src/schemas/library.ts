import { z } from "zod";
import { DeckSchema } from "./deck";
import { SlideSchema } from "./slide";
import { DeckStyleSchema } from "./style";
import { CatalogCanonicalSourceSchema, CatalogStatusSchema } from "./catalog";

// ============================================================================
// 공유 라이브러리·가사 라이브러리 API 계약 (M5, PRD 4.7·4.8)
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
  id: z.string().uuid(),
  title: z.string(),
  artist: z.string(),
  /** 공개한 사람의 표시 이름 */
  authorName: z.string(),
  /** 이 덱 자체가 포크본이면 그 원작자 */
  forkedFromAuthorName: z.string().nullable(),
  forkCount: z.number().int().nonnegative(),
  backgroundId: z.string().uuid().nullable(),
  catalogId: z.string().uuid().nullable(),
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

/** 가사 라이브러리 검색 결과 행. 첫 2줄만 공개한다 (PRD 4.8 노출 범위) */
export const CatalogLyricSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  artist: z.string(),
  /** 루트 버전 수 = 서로 다른 등록자 수 */
  versionCount: z.number().int().nonnegative(),
  status: CatalogStatusSchema,
  canonicalSource: CatalogCanonicalSourceSchema,
  normalizedAt: z.string().datetime().nullable(),
  twoLinesPreview: z.array(z.string()),
});
export type CatalogLyricSummary = z.infer<typeof CatalogLyricSummarySchema>;

/** 곡 등록 시 '이 곡이 맞나요?' 후보 조회 (PRD 4.8 곡 식별) */
export const CatalogCandidatesQuerySchema = z.object({
  title: z.string().trim().min(1).max(100),
  artist: z.string().trim().max(100).default(""),
});
export type CatalogCandidatesQuery = z.infer<
  typeof CatalogCandidatesQuerySchema
>;

export const CatalogCandidateSchema = CatalogLyricSummarySchema.extend({
  /** 제목·아티스트 정규화 키가 모두 같다 (그대로 두면 이 곡에 묶인다) */
  exact: z.boolean(),
});
export type CatalogCandidate = z.infer<typeof CatalogCandidateSchema>;

export const CatalogCandidatesResponseSchema = z.object({
  candidates: z.array(CatalogCandidateSchema),
});
export type CatalogCandidatesResponse = z.infer<
  typeof CatalogCandidatesResponseSchema
>;

/** 가사 라이브러리의 대표 가사로 내 보관함에 새 곡을 만든 결과 */
export const ImportCatalogResponseSchema = z.object({
  deck: DeckSchema,
  alreadyOwned: z.boolean(),
});
export type ImportCatalogResponse = z.infer<typeof ImportCatalogResponseSchema>;

// ---------------------------------------------------------------------------
// 신고 (PRD 4.7 신고, 9장 게시 중단 절차)
// ---------------------------------------------------------------------------

/**
 * - `lyrics_error`: 가사 오류
 * - `inappropriate`: 부적절한 콘텐츠
 * - `copyright`: 저작권자 게시 중단 요청
 * - `correction`: 포크본 사용자의 교정 제안 (PRD 4.8 — 자동 접수 대신 수동으로 받는다)
 */
export const ReportReasonSchema = z.enum([
  "lyrics_error",
  "inappropriate",
  "copyright",
  "correction",
]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const ReportTargetTypeSchema = z.enum(["deck", "catalog"]);
export type ReportTargetType = z.infer<typeof ReportTargetTypeSchema>;

export const CreateReportRequestSchema = z.object({
  targetType: ReportTargetTypeSchema,
  targetId: z.string().uuid(),
  reason: ReportReasonSchema,
  details: z.string().trim().max(500).optional(),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

export const CreateReportResponseSchema = z.object({
  id: z.string().uuid(),
});
export type CreateReportResponse = z.infer<typeof CreateReportResponseSchema>;
