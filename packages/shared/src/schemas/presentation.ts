import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema } from "./deck";

export const PresentationItemSchema = z.object({
  id: IdSchema,
  presentationId: IdSchema,
  deckId: IdSchema,
  order: z.number().int().nonnegative(),
  deck: DeckSchema.optional(), // Hydrated relation
});
export type PresentationItem = z.infer<typeof PresentationItemSchema>;

export const PresentationSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  title: z.string().min(1).max(100),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  items: z.array(PresentationItemSchema).default([]),

  // ---- 드라이브 (홈 폴더 트리·휴지통) ----
  // 둘 다 optional이다. 폴더 기능 이전의 IndexedDB 저장본과 구버전 PWA가 그대로
  // 통과해야 한다. `undefined`와 `null`은 모두 '루트, 휴지통 아님'으로 읽는다.
  //
  // 동기화 PUT에서 필드가 **아예 없으면** 서버는 기존 값을 유지한다 — 구버전
  // 클라이언트가 문서를 올렸다고 폴더 배치가 루트로 되돌아가면 안 된다.
  /** 속한 폴더. 없으면 '내 드라이브' 루트 */
  folderId: IdSchema.nullable().optional(),
  /** 휴지통으로 보낸 시각. 값이 있으면 휴지통에 있다 */
  trashedAt: z.string().datetime().nullable().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Presentation = z.infer<typeof PresentationSchema>;
