import { z } from "zod";
import { SlideSchema } from "./slide";
import { DeckStyleSchema } from "./style";

export const DeckVisibilitySchema = z.enum(["private", "public"]);
export type DeckVisibility = z.infer<typeof DeckVisibilitySchema>;

/**
 * 덱 스코프: 라이브러리 마스터 덱 vs 콘티 복제 전용 덱
 */
export const DeckScopeSchema = z.enum(["library", "setlist"]);
export type DeckScope = z.infer<typeof DeckScopeSchema>;

export const DeckSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  catalogId: z.string().uuid().nullable().optional(),
  scope: DeckScopeSchema.default("library"), // 'library': 보관함 마스터, 'setlist': 콘티 전용 복제본
  setlistId: z.string().uuid().nullable().optional(), // scope='setlist'일 때 속한 콘티 ID
  title: z.string().min(1).max(100),
  artist: z.string().max(100).default(""),
  lyricsRaw: z.string(),
  slides: z.array(SlideSchema),
  backgroundId: z.string().uuid().nullable(),
  style: DeckStyleSchema,
  visibility: DeckVisibilitySchema.default("private"),
  forkedFrom: z.string().uuid().nullable().optional(), // 원본 덱 ID (Clone/Fork 출처 추적)
  forkCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Deck = z.infer<typeof DeckSchema>;
