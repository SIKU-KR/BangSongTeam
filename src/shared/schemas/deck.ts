import { z } from "zod";
import { IdSchema } from "./id";
import { SlideSchema, SlideWriteSchema } from "./slide";
import { DeckStyleSchema } from "./style";

/** 곡 제목 최대 길이. 서버 스키마와 클라이언트 입력 제한이 모두 이 값을 따른다. */
export const MAX_DECK_TITLE_LENGTH = 100;

/** 곡 아티스트 최대 길이. 서버 스키마와 클라이언트 입력 제한이 모두 이 값을 따른다. */
export const MAX_DECK_ARTIST_LENGTH = 100;

/** 가져온 곡에 남기는 원작자 이름(`forkedFromAuthorName`) 최대 길이 */
export const MAX_FORKED_FROM_AUTHOR_NAME_LENGTH = 100;

/**
 * 저장 요청이 곡 하나에 담을 수 있는 가사 길이(코드 포인트). 공유 라이브러리에서 가장 긴 곡
 * (약 1,600자)의 30배쯤이라 실제 곡은 걸리지 않는다.
 */
export const MAX_WRITE_LYRICS_LENGTH = 50_000;

/** 저장 요청이 곡 하나에 담을 수 있는 슬라이드 수. 가장 긴 곡(43장)의 10배가 넘는다 */
export const MAX_WRITE_SLIDES = 500;

export const DeckVisibilitySchema = z.enum(["private", "public"]);
export type DeckVisibility = z.infer<typeof DeckVisibilitySchema>;

/**
 * 덱 스코프: 라이브러리 마스터 덱 vs 프레젠테이션 복제 전용 덱
 */
export const DeckScopeSchema = z.enum(["library", "presentation"]);
export type DeckScope = z.infer<typeof DeckScopeSchema>;

/**
 * 덱이 처음 어떻게 생겼는지.
 *
 * - `user`: 사용자가 직접 붙여넣어 만든 곡
 * - `fork`: 공유 라이브러리의 공개 덱을 가져온 것
 *
 * 서버가 insert 시점에 한 번 정하고 이후 바꾸지 않는다.
 */
export const DeckOriginSchema = z.enum(["user", "fork"]);
export type DeckOrigin = z.infer<typeof DeckOriginSchema>;

/**
 * 가사 라이브러리(MVP에서 제거)의 대표 가사로 만든 옛 덱은 `origin: 'catalog'`로
 * 로컬 IndexedDB에 남아 있을 수 있다. 사용자가 만든 곡과 같게 읽는다.
 */
const LegacyDeckOriginSchema = z.preprocess(
  (value) => (value === "catalog" ? "user" : value),
  DeckOriginSchema,
);

export const DeckSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  scope: DeckScopeSchema.default("library"),
  presentationId: IdSchema.nullable().optional(),
  title: z.string().min(1).max(MAX_DECK_TITLE_LENGTH),
  artist: z.string().max(MAX_DECK_ARTIST_LENGTH).default(""),
  lyricsRaw: z.string(),
  slides: z.array(SlideSchema),
  backgroundId: IdSchema.nullable(),
  style: DeckStyleSchema,
  visibility: DeckVisibilitySchema.default("private"),
  forkedFrom: IdSchema.nullable().optional(),
  forkCount: z.number().int().nonnegative().default(0),

  origin: LegacyDeckOriginSchema.optional(),
  forkedFromAuthorName: z
    .string()
    .max(MAX_FORKED_FROM_AUTHOR_NAME_LENGTH)
    .nullable()
    .optional(),
  publishedAt: z.iso.datetime().nullable().optional(),
  takedownAt: z.iso.datetime().nullable().optional(),

  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Deck = z.infer<typeof DeckSchema>;

/**
 * 저장 요청 본문의 곡(`PUT /api/decks/:id`, 프레젠테이션 저장에 담긴 곡). `DeckSchema`에 가사
 * 길이·슬라이드 수·슬라이드 id 길이 상한을 더한다.
 *
 * 서버가 쓰기 요청을 검사할 때만 쓴다. `DeckSchema`는 IndexedDB 저장본과 서버 응답도 읽으므로,
 * 거기에 한도를 두면 이미 저장된 긴 곡과 그 곡이 든 프레젠테이션을 통째로 읽지 못한다. 한도는
 * 실제 곡이 걸리지 않게 넉넉히 두고, 곡 하나가 차지하는 크기를 묶어 대부분의 곡이 Firestore 문서
 * 한도(1 MiB)에 닿기 전에 무엇을 줄일지 알려 준다. 한도 안인데도 문서 한도를 넘는 곡은 저장
 * 라우트가 Firestore 오류를 413으로 바꿔 답한다.
 */
export const DeckWriteSchema = DeckSchema.extend({
  lyricsRaw: z.string().max(MAX_WRITE_LYRICS_LENGTH),
  slides: z.array(SlideWriteSchema).max(MAX_WRITE_SLIDES),
});

/**
 * 내 보관함 곡 전체 목록(`GET /api/decks`)과 이 계정에서 지운 곡 id.
 *
 * 곡 삭제 기록을 남기기 전의 서버는 `deletedIds`를 보내지 않는다. 없으면 지운 곡이 없는
 * 것으로 읽는다.
 */
export const DeckListResponseSchema = z.object({
  decks: z.array(DeckSchema),
  deletedIds: z.array(IdSchema).optional(),
});
export type DeckListResponse = z.infer<typeof DeckListResponseSchema>;
