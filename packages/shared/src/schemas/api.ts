import { z } from "zod";
import { DeckStyleSchema } from "./style";
import { SlideSchema } from "./slide";
import { DeckSchema } from "./deck";
import { PresentationSchema, PresentationItemSchema } from "./presentation";
import { CatalogLyricSummarySchema, PublicDeckSummarySchema } from "./library";

// 1. 덱 생성 요청
export const CreateDeckRequestSchema = z.object({
  title: z.string().min(1).max(100),
  artist: z.string().max(100).default(""),
  lyricsRaw: z.string().min(1),
  slides: z.array(SlideSchema),
  backgroundId: z.string().uuid().nullable().optional(),
  style: DeckStyleSchema,
  visibility: z.enum(["private", "public"]).default("private"),
  catalogId: z.string().uuid().nullable().optional(),
  contributeToCatalog: z.boolean().default(true), // 가사 라이브러리 기여 여부
  forkedFrom: z.string().uuid().optional(), // Clone 시 원본 덱 ID
});
export type CreateDeckRequest = z.infer<typeof CreateDeckRequestSchema>;

// 2. 덱 수정 요청
export const UpdateDeckRequestSchema = CreateDeckRequestSchema.partial();
export type UpdateDeckRequest = z.infer<typeof UpdateDeckRequestSchema>;

// 3. 세트 생성 요청
export const CreatePresentationRequestSchema = z.object({
  title: z.string().min(1).max(100),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreatePresentationRequest = z.infer<
  typeof CreatePresentationRequestSchema
>;

// 4. 세트 항목 순서 및 곡 변경 요청
export const UpdatePresentationItemsRequestSchema = z.object({
  items: z.array(
    z.object({
      deckId: z.string().uuid(),
      order: z.number().int().nonnegative(),
    }),
  ),
});
export type UpdatePresentationItemsRequest = z.infer<
  typeof UpdatePresentationItemsRequestSchema
>;

// 5. 통합 검색 쿼리 및 응답 (M5)
//
// 로그인 없이 열리는 공개 경로다. 그래서 응답은 로그인 여부와 무관하게
// 미리보기(첫 슬라이드 / 첫 2줄)만 담는다. 전문은 로그인 후 상세 조회로만 준다.
export const SearchCatalogQuerySchema = z.object({
  /** 빈 문자열이면 가져간 횟수순 '둘러보기' */
  q: z.string().trim().max(50).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchCatalogQuery = z.infer<typeof SearchCatalogQuerySchema>;

export const SearchCatalogResponseSchema = z.object({
  decks: z.array(PublicDeckSummarySchema),
  catalogLyrics: z.array(CatalogLyricSummarySchema),
});
export type SearchCatalogResponse = z.infer<typeof SearchCatalogResponseSchema>;

// ============================================================================
// 동기화용 문서 계약 (M3-B)
//
// 로컬 IndexedDB는 덱을 임베드한 비정규화 문서 1건을 저장하고, D1은
// presentations / presentation_items / decks 3테이블로 정규화해 저장한다.
// 그 둘이 주고받는 모양이 아래 문서 스키마다.
// ============================================================================

/**
 * 완전히 하이드레이션된 프레젠테이션 문서.
 *
 * `PresentationSchema`의 `items[].deck`은 optional이라 '덱이 빠진 문서'도
 * 통과한다. 동기화 경로에서는 덱이 없으면 곡 없는 세트를 덮어쓰는 사고가
 * 나므로 여기서 필수로 좁힌다.
 */
export const PresentationDocumentSchema = PresentationSchema.extend({
  items: z.array(
    PresentationItemSchema.extend({
      deck: DeckSchema,
    }),
  ),
});
export type PresentationDocument = z.infer<typeof PresentationDocumentSchema>;

/** 오류 응답 본문 */
export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** 내 프레젠테이션 전체 목록 */
export const PresentationListResponseSchema = z.object({
  presentations: z.array(PresentationDocumentSchema),
});
export type PresentationListResponse = z.infer<
  typeof PresentationListResponseSchema
>;

/** 내 보관함 곡 전체 목록 */
export const DeckListResponseSchema = z.object({
  decks: z.array(DeckSchema),
});
export type DeckListResponse = z.infer<typeof DeckListResponseSchema>;

// ============================================================================
// 개발자 로그인 (OAuth 연결 전까지의 임시 경로, localhost 전용)
// ============================================================================

export const DevLoginRequestSchema = z.object({
  /** 계정을 바꿔 가며 교차 사용자 격리를 확인할 수 있게 한다 */
  email: z.string().email().optional(),
  name: z.string().min(1).max(50).optional(),
});
export type DevLoginRequest = z.infer<typeof DevLoginRequestSchema>;

/** 로그인 화면이 무엇을 그릴지 정하는 근거 */
export const AuthConfigResponseSchema = z.object({
  /** 실제로 자격증명이 설정된 소셜 프로바이더만 담는다 */
  providers: z.array(z.enum(["kakao", "naver"])),
  devLogin: z.boolean(),
});
export type AuthConfigResponse = z.infer<typeof AuthConfigResponseSchema>;
