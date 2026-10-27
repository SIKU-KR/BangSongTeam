import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema } from "./deck";

/** 프레젠테이션 제목 최대 길이. 서버 스키마와 클라이언트 입력 제한이 모두 이 값을 따른다. */
export const MAX_PRESENTATION_TITLE_LENGTH = 100;

/** 저장 요청이 프레젠테이션 하나에 담을 수 있는 곡 수 */
export const MAX_PRESENTATION_SONGS = 200;

/**
 * 프레젠테이션 하나에 담긴 곡 글(가사와 슬라이드 JSON)의 저장 상한(UTF-8 바이트).
 *
 * API 요청 본문 상한(2 MiB)과 같다. 본문은 곡 글보다 크므로, 한 번에 통째로 보낼 수 있는
 * 프레젠테이션은 언제나 이 상한 안이다. 바뀐 곡만 보내는 저장을 여러 번 해 이보다 키우는 것만
 * 막아, 링크로 공유한 프레젠테이션을 로그인 없이 한 번 볼 때 서버가 읽고 보내는 양을 묶는다.
 */
export const MAX_PRESENTATION_TEXT_BYTES = 2 * 1024 * 1024;

export const PresentationItemSchema = z.object({
  id: IdSchema,
  presentationId: IdSchema,
  deckId: IdSchema,
  order: z.number().int().nonnegative(),
  deck: DeckSchema.optional(),
});
export type PresentationItem = z.infer<typeof PresentationItemSchema>;

/**
 * 링크로 공유받은 세트에만 서버가 붙이는 정보. 이 필드가 있으면 보기 전용이다.
 *
 * 클라이언트가 보낸 값은 서버가 권한 판단에 쓰지 않는다. `memberId`는 받은
 * 사람의 id로, 한 브라우저를 여러 계정이 쓸 때 로컬 저장소에서 내 공유 세트만
 * 고르는 데 쓴다. 로그인하지 않고 링크로 보는 사람에게는 없다.
 */
export const PresentationAccessSchema = z.object({
  ownerName: z.string(),
  memberId: IdSchema.optional(),
});
export type PresentationAccess = z.infer<typeof PresentationAccessSchema>;

export const PresentationSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  title: z.string().min(1).max(MAX_PRESENTATION_TITLE_LENGTH),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(PresentationItemSchema).default([]),

  folderId: IdSchema.nullable().optional(),
  trashedAt: z.iso.datetime().nullable().optional(),

  access: PresentationAccessSchema.optional(),

  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Presentation = z.infer<typeof PresentationSchema>;
