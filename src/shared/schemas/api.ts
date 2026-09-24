import { z } from "zod";
import { IdSchema } from "./id";
import { DeckStyleSchema } from "./style";
import { SlideSchema } from "./slide";
import { DeckSchema } from "./deck";
import { PresentationSchema, PresentationItemSchema } from "./presentation";
import { PublicDeckSummarySchema } from "./library";

export const CreateDeckRequestSchema = z.object({
  title: z.string().min(1).max(100),
  artist: z.string().max(100).default(""),
  lyricsRaw: z.string().min(1),
  slides: z.array(SlideSchema),
  backgroundId: IdSchema.nullable().optional(),
  style: DeckStyleSchema,
  visibility: z.enum(["private", "public"]).default("private"),
  forkedFrom: IdSchema.optional(),
});
export type CreateDeckRequest = z.infer<typeof CreateDeckRequestSchema>;

export const UpdateDeckRequestSchema = CreateDeckRequestSchema.partial();
export type UpdateDeckRequest = z.infer<typeof UpdateDeckRequestSchema>;

export const CreatePresentationRequestSchema = z.object({
  title: z.string().min(1).max(100),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreatePresentationRequest = z.infer<
  typeof CreatePresentationRequestSchema
>;

export const UpdatePresentationItemsRequestSchema = z.object({
  items: z.array(
    z.object({
      deckId: IdSchema,
      order: z.number().int().nonnegative(),
    }),
  ),
});
export type UpdatePresentationItemsRequest = z.infer<
  typeof UpdatePresentationItemsRequestSchema
>;

export const SearchCatalogQuerySchema = z.object({
  q: z.string().trim().max(50).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchCatalogQuery = z.infer<typeof SearchCatalogQuerySchema>;

export const SearchCatalogResponseSchema = z.object({
  decks: z.array(PublicDeckSummarySchema),
});
export type SearchCatalogResponse = z.infer<typeof SearchCatalogResponseSchema>;

/**
 * 완전히 하이드레이션된 프레젠테이션 문서.
 * PresentationSchema와 달리 items 내 deck 객체를 필수로 요구한다.
 */
export const PresentationDocumentSchema = PresentationSchema.extend({
  items: z.array(
    PresentationItemSchema.extend({
      deck: DeckSchema,
    }),
  ),
});
export type PresentationDocument = z.infer<typeof PresentationDocumentSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PresentationListResponseSchema = z.object({
  presentations: z.array(PresentationDocumentSchema),
});
export type PresentationListResponse = z.infer<
  typeof PresentationListResponseSchema
>;

export const DeckListResponseSchema = z.object({
  decks: z.array(DeckSchema),
});
export type DeckListResponse = z.infer<typeof DeckListResponseSchema>;

export const DevLoginRequestSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).max(50).optional(),
});
export type DevLoginRequest = z.infer<typeof DevLoginRequestSchema>;

export const AuthConfigResponseSchema = z.object({
  providers: z.array(z.enum(["kakao", "naver"])),
  devLogin: z.boolean(),
});
export type AuthConfigResponse = z.infer<typeof AuthConfigResponseSchema>;
