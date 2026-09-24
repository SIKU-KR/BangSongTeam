import { z } from "zod";
import { IdSchema } from "./id";
import { SlideSchema } from "./slide";
import { DeckStyleSchema } from "./style";

export const DeckVisibilitySchema = z.enum(["private", "public"]);
export type DeckVisibility = z.infer<typeof DeckVisibilitySchema>;

/**
 * 덱 스코프: 라이브러리 마스터 덱 vs 프레젠테이션 복제 전용 덱
 */
export const DeckScopeSchema = z.enum(["library", "presentation"]);
export type DeckScope = z.infer<typeof DeckScopeSchema>;

/**
 * 덱이 처음 어떻게 생겼는지 (M5, PRD 4.7).
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
  scope: DeckScopeSchema.default("library"), // 'library': 보관함 마스터, 'presentation': 프레젠테이션 전용 복제본
  presentationId: IdSchema.nullable().optional(), // scope='presentation'일 때 속한 프레젠테이션 ID
  title: z.string().min(1).max(100),
  artist: z.string().max(100).default(""),
  lyricsRaw: z.string(),
  slides: z.array(SlideSchema),
  backgroundId: IdSchema.nullable(),
  style: DeckStyleSchema,
  visibility: DeckVisibilitySchema.default("private"),
  forkedFrom: IdSchema.nullable().optional(), // 원본 덱 ID (Clone/Fork 출처 추적)
  forkCount: z.number().int().nonnegative().default(0),

  // ---- M5 공유 필드 ----
  // 모두 optional이다. `.default()`를 걸면 z.infer 출력 타입에서 필수가 되어
  // 기존 Deck 리터럴이 전부 깨진다. 없으면 '해당 없음'으로 읽는다.
  //
  // 모두 서버 소유이며 동기화 PUT으로는 바뀌지 않는다 (공개 전환·포크·게시 중단
  // 전용 경로에서만).
  origin: LegacyDeckOriginSchema.optional(),
  /** 포크 시점에 서버가 남긴 원작자 이름. 원본이 지워져도 '원작: X'를 보여 준다 */
  forkedFromAuthorName: z.string().max(100).nullable().optional(),
  /** 공개 전 저작권 안내에 동의하고 공개한 시각 */
  publishedAt: z.string().datetime().nullable().optional(),
  /** 운영자가 게시를 중단한 시각. 값이 있으면 다시 공개할 수 없다 */
  takedownAt: z.string().datetime().nullable().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Deck = z.infer<typeof DeckSchema>;
