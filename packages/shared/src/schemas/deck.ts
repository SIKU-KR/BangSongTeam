import { z } from "zod";
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
 * 덱이 처음 어떻게 생겼는지 (M5, PRD 4.8).
 *
 * - `user`: 사용자가 직접 붙여넣어 만든 곡. 가사 라이브러리의 '루트 버전'이 될 수 있다
 * - `fork`: 공유 라이브러리의 공개 덱을 가져온 것. 가사를 고쳐도 버전으로 세지 않는다
 * - `catalog`: 가사 라이브러리의 대표 가사로 만든 것. 역시 버전으로 세지 않는다
 *
 * 서버가 insert 시점에 한 번 정하고 이후 바꾸지 않는다. 클라이언트가 바꿀 수 있으면
 * 포크본을 루트로 둔갑시켜 다수결을 왜곡할 수 있다.
 */
export const DeckOriginSchema = z.enum(["user", "fork", "catalog"]);
export type DeckOrigin = z.infer<typeof DeckOriginSchema>;

export const DeckSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  catalogId: z.string().uuid().nullable().optional(),
  scope: DeckScopeSchema.default("library"), // 'library': 보관함 마스터, 'presentation': 프레젠테이션 전용 복제본
  presentationId: z.string().uuid().nullable().optional(), // scope='presentation'일 때 속한 프레젠테이션 ID
  title: z.string().min(1).max(100),
  artist: z.string().max(100).default(""),
  lyricsRaw: z.string(),
  slides: z.array(SlideSchema),
  backgroundId: z.string().uuid().nullable(),
  style: DeckStyleSchema,
  visibility: DeckVisibilitySchema.default("private"),
  forkedFrom: z.string().uuid().nullable().optional(), // 원본 덱 ID (Clone/Fork 출처 추적)
  forkCount: z.number().int().nonnegative().default(0),

  // ---- M5 공유 필드 ----
  // 모두 optional이다. `.default()`를 걸면 z.infer 출력 타입에서 필수가 되어
  // 기존 Deck 리터럴이 전부 깨진다. 없으면 '해당 없음'으로 읽는다.
  //
  // 아래 중 `contributeToCatalog`만 클라이언트가 정한다. 나머지는 서버 소유이며
  // 동기화 PUT으로는 바뀌지 않는다 (공개 전환·포크·게시 중단 전용 경로에서만).
  /** 가사 라이브러리 기여 여부 (PRD 4.8 '가사 라이브러리에 기여' 체크박스) */
  contributeToCatalog: z.boolean().optional(),
  origin: DeckOriginSchema.optional(),
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
