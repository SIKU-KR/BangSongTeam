import { z } from "zod";
import { IdSchema } from "./id";
import { DeckSchema } from "./deck";

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
 * 고르는 데 쓴다.
 */
export const PresentationAccessSchema = z.object({
  ownerName: z.string(),
  memberId: IdSchema,
});
export type PresentationAccess = z.infer<typeof PresentationAccessSchema>;

export const PresentationSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  title: z.string().min(1).max(100),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(PresentationItemSchema).default([]),

  folderId: IdSchema.nullable().optional(),
  trashedAt: z.string().datetime().nullable().optional(),

  access: PresentationAccessSchema.optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Presentation = z.infer<typeof PresentationSchema>;
