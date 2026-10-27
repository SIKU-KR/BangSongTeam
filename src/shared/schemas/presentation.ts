import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema } from "./deck";

/** 프레젠테이션 제목 최대 길이. 서버 스키마와 클라이언트 입력 제한이 모두 이 값을 따른다. */
export const MAX_PRESENTATION_TITLE_LENGTH = 100;

/** 저장 요청이 프레젠테이션 하나에 담을 수 있는 곡 수 */
export const MAX_PRESENTATION_SONGS = 200;

/**
 * 프레젠테이션 하나에 담긴 곡 글의 저장 상한(바이트). 곡마다 제목·아티스트·원작자 이름·가사·
 * 슬라이드를 JSON으로 쓴 크기(서버의 `songTextBytes`)를 더해 센다.
 *
 * 바뀐 곡만 보내는 저장을 거듭하면 요청 본문 상한(2 MiB)과 상관없이 프레젠테이션을 키울 수
 * 있어, 링크로 공유한 프레젠테이션을 로그인 없이 볼 때 서버가 읽고 보내는 양을 이 상한으로
 * 묶는다. 요청 본문 상한보다 곡 200개의 나머지 필드(id·시각·스타일, 곡마다 1.2 KB 남짓)만큼
 * 작게 두어, 서버가 받은 프레젠테이션은 언제나 한 번에 통째로 다시 보낼 수 있다(409 뒤 모든
 * 곡 다시 보내기, 사본 만들기, 이전 버전의 PUT).
 */
export const MAX_PRESENTATION_TEXT_BYTES = 1.75 * 1024 * 1024;

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
