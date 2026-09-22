import { z } from "zod";
import { DeckStyleSchema } from "./style";
import { SlideSchema } from "./slide";
import { DeckSchema } from "./deck";
import { PresentationSchema, PresentationItemSchema } from "./presentation";

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

// 5. 통합 검색 쿼리 및 응답
export const SearchCatalogQuerySchema = z.object({
  q: z.string().min(1).max(50),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchCatalogQuery = z.infer<typeof SearchCatalogQuerySchema>;

export const SearchCatalogResponseSchema = z.object({
  decks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      artist: z.string(),
      forkCount: z.number(),
      backgroundId: z.string().uuid().nullable(),
      posterUrl: z.string().nullable(),
      firstSlidePreview: z.array(z.string()), // 첫 슬라이드만 공개 (저작권 보호)
    }),
  ),
  catalogLyrics: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      artist: z.string(),
      versionCount: z.number(),
      status: z.enum(["single", "normalized", "locked"]),
      twoLinesPreview: z.array(z.string()), // 첫 2줄만 공개
    }),
  ),
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
