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
  scope: DeckScopeSchema.default("library"),
  presentationId: IdSchema.nullable().optional(),
  title: z.string().min(1).max(100),
  artist: z.string().max(100).default(""),
  lyricsRaw: z.string(),
  slides: z.array(SlideSchema),
  backgroundId: IdSchema.nullable(),
  style: DeckStyleSchema,
  visibility: DeckVisibilitySchema.default("private"),
  forkedFrom: IdSchema.nullable().optional(),
  forkCount: z.number().int().nonnegative().default(0),

  origin: LegacyDeckOriginSchema.optional(),
  forkedFromAuthorName: z.string().max(100).nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  takedownAt: z.string().datetime().nullable().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Deck = z.infer<typeof DeckSchema>;
