import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema, DeckWriteSchema } from "./deck";
import {
  MAX_PRESENTATION_SONGS,
  PresentationSchema,
  PresentationItemSchema,
} from "./presentation";
import { PublicDeckSummarySchema } from "./library";

/** 공유 라이브러리 검색어 길이 상한. 이전 서버의 `max(50)`처럼 UTF-16 코드 단위로 센다 */
export const MAX_SEARCH_QUERY_LENGTH = 50;

/**
 * 검색어의 앞뒤 공백을 떼고 앞 `MAX_SEARCH_QUERY_LENGTH`자만 남긴다.
 *
 * 가사 몇 줄을 붙여 넣은 검색어를 거절하면 곡 선택 창이 연결 실패로 보여 준다. 그래서 서버는
 * 거절하지 않고 자르고, 클라이언트도 보내기 전에 잘라 50자를 넘으면 400으로 답하던 이전 서버와
 * 섞여 배포되는 동안에도 검색이 된다. 이모지 같은 서로게이트 쌍은 반쪽으로 자르지 않는다.
 * 반쪽만 남으면 `encodeURIComponent`가 예외를 던진다.
 */
export function clampSearchQuery(query: string): string {
  let clamped = "";
  for (const char of query.trim()) {
    if (clamped.length + char.length > MAX_SEARCH_QUERY_LENGTH) break;
    clamped += char;
  }
  return clamped.trimEnd();
}

export const SearchCatalogQuerySchema = z.object({
  q: z.string().transform(clampSearchQuery).default(""),
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

/**
 * 프레젠테이션 문서 전체 저장 본문(`PUT /api/presentations/:id`). `PresentationDocumentSchema`에
 * 곡 수 상한과 곡마다의 쓰기 한도(`DeckWriteSchema`)를 더한다.
 *
 * 서버가 쓰기 요청을 검사할 때만 쓴다. 문서 스키마는 IndexedDB 저장본과 조회 응답도 읽으므로
 * 한도를 두지 않는다.
 */
export const PresentationDocumentRequestSchema =
  PresentationDocumentSchema.extend({
    items: z
      .array(PresentationItemSchema.extend({ deck: DeckWriteSchema }))
      .max(MAX_PRESENTATION_SONGS),
  });

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
 *
 * 서버가 쓰기 요청을 검사하는 스키마라 곡 수 상한과 곡마다의 쓰기 한도(`DeckWriteSchema`)를
 * 둔다. 클라이언트는 이 모양의 타입만 쓰고 이 스키마로 저장본을 읽지 않는다.
 */
export const PresentationChangesSchema = PresentationSchema.omit({
  items: true,
}).extend({
  items: z.array(PresentationChangeItemSchema).max(MAX_PRESENTATION_SONGS),
  decks: z.array(DeckWriteSchema).max(MAX_PRESENTATION_SONGS),
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
  agreedAt: z.iso.datetime().nullable(),
});
export type ConsentStatusResponse = z.infer<typeof ConsentStatusResponseSchema>;

/** 필수 항목만 있어 모두 `true`여야 동의로 기록한다 */
export const AgreeConsentRequestSchema = z.object({
  ageOver14: z.literal(true),
  terms: z.literal(true),
  privacy: z.literal(true),
});
export type AgreeConsentRequest = z.infer<typeof AgreeConsentRequestSchema>;

/** 비밀번호 길이 범위. 서버(Better Auth)와 가입 폼이 같은 값을 쓴다 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const USER_NAME_MAX_LENGTH = 50;

/**
 * 이메일 가입 폼 입력. 서버의 Better Auth는 이메일·비밀번호만 검사하고 이름 길이는 보지
 * 않아, 서버에서는 인증 훅(`server/lib/auth.ts`)이 이름을 다듬어(50자, 보이는 글자가 없으면
 * 기본 이름) 저장한다
 */
export const EmailSignUpRequestSchema = z.object({
  name: z.string().trim().min(1).max(USER_NAME_MAX_LENGTH),
  email: z.email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type EmailSignUpRequest = z.infer<typeof EmailSignUpRequestSchema>;
