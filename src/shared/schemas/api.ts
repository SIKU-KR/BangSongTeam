import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema, DeckWriteSchema } from "./deck";
import {
  MAX_PRESENTATION_SONGS,
  PresentationSchema,
  PresentationItemSchema,
} from "./presentation";

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
 * 프레젠테이션 목록 조회(`GET /api/presentations`)의 쿼리. `since`(ISO 시각)를 보내면 판(`updatedAt`)이
 * 그보다 늦은 프레젠테이션만 곡 사본을 담고, 나머지는 머리만 보낸다(`OmittedPresentationSchema`). 이
 * 값을 모르는 이전 클라이언트는 보내지 않으므로 언제나 모두 받는다.
 */
export const PresentationListQuerySchema = z.object({
  since: z.iso.datetime().optional(),
});

/**
 * 프레젠테이션 목록에서 곡 사본을 빼고 보낸 머리(`copiesOmitted`). 판이 `since`보다 늦지 않은
 * 프레젠테이션이다.
 *
 * 목록은 프레젠테이션마다 머리를 빠짐없이 보내, 받는 쪽은 영구 삭제·폴더 이동·휴지통 상태를 그대로
 * 맞춘다. 곡은 받는 쪽이 같은 판을 이미 가졌으면 그 판을 쓰고, 아니면 그 프레젠테이션을 따로 받는다
 * (`GET /api/presentations/:id`).
 *
 * `items`는 빈 배열이 아니라 `null`이다. 빈 배열이면 곡이 하나도 없는 프레젠테이션과 같아 보여, 이 표시를
 * 놓친 코드가 곡을 모두 뺀 판으로 받는다. `null`은 문서 스키마(`PresentationSchema`·
 * `PresentationDocumentSchema`)를 통과하지 못한다.
 */
export const OmittedPresentationSchema = PresentationSchema.omit({
  items: true,
  baseUpdatedAt: true,
}).extend({
  items: z.null(),
  copiesOmitted: z.literal(true),
});
export type OmittedPresentation = z.infer<typeof OmittedPresentationSchema>;

/** 프레젠테이션 목록의 한 줄: 곡 사본까지 담은 문서나 사본을 뺀 머리 */
export const PresentationListEntrySchema = z.union([
  PresentationDocumentSchema,
  OmittedPresentationSchema,
]);
export type PresentationListEntry = z.infer<typeof PresentationListEntrySchema>;

const BaseUpdatedAtSchema = z.iso.datetime().nullable().optional();

/**
 * 프레젠테이션 문서 전체 저장 본문(`PUT /api/presentations/:id`). `PresentationDocumentSchema`에
 * 곡 수 상한과 곡마다의 쓰기 한도(`DeckWriteSchema`)를 더한다. 기준 판(`baseUpdatedAt`)은
 * `PresentationChangesRequestSchema`와 같이 다룬다.
 *
 * 서버가 쓰기 요청을 검사할 때만 쓴다. 문서 스키마는 IndexedDB 저장본과 조회 응답도 읽으므로
 * 한도를 두지 않는다.
 */
export const PresentationDocumentRequestSchema =
  PresentationDocumentSchema.extend({
    items: z
      .array(PresentationItemSchema.extend({ deck: DeckWriteSchema }))
      .max(MAX_PRESENTATION_SONGS),
    baseUpdatedAt: BaseUpdatedAtSchema,
  });
export type PresentationDocumentRequest = z.infer<
  typeof PresentationDocumentRequestSchema
>;

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

/**
 * 변경분 저장 요청 본문(`PATCH /api/presentations/:id`). 기준 판 `baseUpdatedAt`은 보내는 판이
 * 바탕으로 삼은 서버 판(서버가 확정한 `updatedAt`)이다.
 *
 * - 문자열: 서버가 저장된 판과 견줘, 그사이 다른 곳에서 바꿨으면 쓰지 않고 412로 답한다.
 * - `null`: 서버가 확정한 적 없는 판(새 프레젠테이션·사본). 서버에 이미 있으면 412다.
 * - 없음: 이 필드를 모르는 이전 클라이언트. 견주지 않고 받는다.
 *
 * 저장 요청에만 싣고 서버는 돌려주지 않는다. 클라이언트는 모델(`PresentationSchema`)과 IndexedDB
 * 저장본에 두고 서버가 확정할 때마다 앞으로 옮긴다. 이 필드를 모르는 이전 버전의 탭은 저장본을 읽을 때
 * 버리고 다시 보내지 않는다. 앞으로 나아가지 않는 기준을 실어 보내면 첫 저장 뒤로 모두 412가 된다.
 */
export const PresentationChangesRequestSchema =
  PresentationChangesSchema.extend({ baseUpdatedAt: BaseUpdatedAtSchema });
export type PresentationChangesRequest = z.infer<
  typeof PresentationChangesRequestSchema
>;

/** 로그인 화면에 버튼이 나오는 순서이기도 하다 */
export const SocialProviderSchema = z.enum(["kakao", "naver", "google"]);
export type SocialProvider = z.infer<typeof SocialProviderSchema>;

/**
 * `GET /api/auth-config`: 이 서버에서 로그인을 시작할 수 있는 소셜 로그인. 서버에 id·secret이
 * 없는 프로바이더는 Better Auth에 등록되지 않아 로그인 시작이 404로 끝나므로, 로그인 화면은
 * 여기 없는 버튼을 감춘다.
 */
export const AuthConfigResponseSchema = z.object({
  providers: z.array(SocialProviderSchema),
});
export type AuthConfigResponse = z.infer<typeof AuthConfigResponseSchema>;

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

/**
 * better-auth `/sign-out`이 세션 쿠키를 지우며 돌려주는 본문. 서버는 세션이 없어도 이렇게 답한다.
 * 캡티브 포털·프록시가 보낸 200은 쿠키를 지우지 않으므로, 이 모양일 때만 로그아웃을 마친 것으로
 * 본다.
 */
export const AuthSignOutResponseSchema = z.object({
  success: z.literal(true),
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
 * 이메일 주소 길이 상한. 메일로 주고받을 수 있는 가장 긴 주소(RFC 5321)다. Firestore가
 * 쿼리에서 받는 값의 크기 한도(1,500바이트)보다 짧아, 서버가 이 길이 안의 주소로 사용자를
 * 찾을 때 쿼리가 거절되지 않는다.
 */
export const EMAIL_MAX_LENGTH = 254;

/**
 * 이메일 가입 폼 입력. 서버의 Better Auth는 이메일·비밀번호만 검사하고 이름 길이는 보지
 * 않아, 서버에서는 인증 훅(`server/lib/auth.ts`)이 이름을 다듬어(50자, 보이는 글자가 없으면
 * 기본 이름) 저장한다. 그 훅은 Better Auth가 본문을 검사하기 전에 돌아서, 이 스키마의 `email`을
 * 통과한 주소로만 Firestore를 읽는다.
 */
export const EmailSignUpRequestSchema = z.object({
  name: z.string().trim().min(1).max(USER_NAME_MAX_LENGTH),
  email: z.email().max(EMAIL_MAX_LENGTH),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type EmailSignUpRequest = z.infer<typeof EmailSignUpRequestSchema>;

/**
 * 같은 이메일의 가입이 아직 끝나지 않았을 수 있어 받지 않은 이메일 가입(409)의 오류 코드.
 *
 * 비밀번호를 저장하기 전에 실패한 가입은 비밀번호 없는 사용자를 남기고, 서버는 진행 중인 가입을
 * 지우지 않으려고 그 사용자를 잠시 뒤에야 치운다. 그 사이의 가입을 "이미 가입함"으로 답하면
 * 사용자는 들어갈 수 없는 계정으로 로그인하려 한다. 그래서 이 코드로 답하고 화면은 잠시 뒤
 * 다시 가입하게 안내한다.
 */
export const SIGN_UP_IN_PROGRESS = "SIGN_UP_IN_PROGRESS";

/**
 * IP 하나에서 받는 그날 이메일 가입 수를 다 썼을 때 가입 응답(429)에 싣는 `code`. 이 한도는 한국 시간
 * 0시에야 풀려 '잠시 후 다시'가 맞지 않으므로 다른 빈도 제한과 나눠 알린다. 상태 코드만 보는 옛
 * 클라이언트는 다른 429와 같게 다룬다.
 */
export const DAILY_SIGN_UP_LIMIT_CODE = "DAILY_SIGN_UP_LIMIT";
