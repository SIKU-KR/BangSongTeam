import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema } from "./deck";
import { PresentationSchema, PresentationItemSchema } from "./presentation";
import { PublicDeckSummarySchema } from "./library";

export const SearchCatalogQuerySchema = z.object({
  q: z.string().trim().max(50).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

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

export const PresentationChangeItemSchema = z.object({
  id: IdSchema,
  deckId: IdSchema,
  order: z.number().int().nonnegative(),
});
export type PresentationChangeItem = z.infer<
  typeof PresentationChangeItemSchema
>;

/**
 * 세트 변경분 저장 본문 (`PATCH /api/presentations/:id`).
 *
 * 헤더와 항목 순서는 언제나 전부 보내고, 덱은 서버에 마지막으로 올린 뒤 바뀐 것만
 * 보낸다. 서버는 `items`에 없는 곡을 지우므로 문서 단위 전체 교체와 결과가 같다.
 * 항목이 가리키는 덱이 본문에도 서버에도 없으면 서버가 409로 거절하고,
 * 클라이언트는 모든 덱을 담아 다시 보낸다.
 */
export const PresentationChangesSchema = PresentationSchema.omit({
  items: true,
}).extend({
  items: z.array(PresentationChangeItemSchema),
  decks: z.array(DeckSchema),
});
export type PresentationChanges = z.infer<typeof PresentationChangesSchema>;

/** 로그인 화면에 버튼이 나오는 순서이기도 하다 */
export const SocialProviderSchema = z.enum(["kakao", "naver", "google"]);
export type SocialProvider = z.infer<typeof SocialProviderSchema>;

/**
 * better-auth `/get-session`이 세션이 있을 때 돌려주는 본문 중 앱이 쓰는 부분.
 * 캡티브 포털의 HTML처럼 이 모양이 아닌 200 응답은 "로그아웃됨"이 아니라
 * "서버에 닿지 못함"으로 다뤄야 해서 모양을 검사한다.
 */
export const AuthSessionResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    name: z.string().nullish(),
    image: z.string().nullish(),
  }),
  session: z.object({
    expiresAt: z.coerce.date(),
  }),
});

/** 동의를 마치지 않은 사용자는 `agreedAt`이 null이고, 앱이 동의 모달로 막는다 */
export const ConsentStatusResponseSchema = z.object({
  agreedAt: z.string().datetime().nullable(),
});
export type ConsentStatusResponse = z.infer<typeof ConsentStatusResponseSchema>;

/** 필수 항목만 있어 모두 `true`여야 동의로 기록한다 */
export const AgreeConsentRequestSchema = z.object({
  ageOver14: z.literal(true),
  terms: z.literal(true),
  privacy: z.literal(true),
});
export type AgreeConsentRequest = z.infer<typeof AgreeConsentRequestSchema>;
