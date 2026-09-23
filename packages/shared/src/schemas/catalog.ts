import { z } from "zod";

export const CatalogStatusSchema = z.enum(["single", "normalized", "locked"]);
export type CatalogStatus = z.infer<typeof CatalogStatusSchema>;

/**
 * 대표 가사를 누가 만들었는지.
 *
 * - `user`: 등록 1명 — 그 사람의 원본이 그대로 대표 가사다
 * - `llm`: Workers AI 정규화 결과가 검증(§4.8)을 통과했다
 * - `popular_root`: 정규화가 실패했거나 검증에서 탈락해 최다 등록 버전을 썼다
 * - `operator`: 운영자가 직접 고치고 잠갔다
 */
export const CatalogCanonicalSourceSchema = z.enum([
  "user",
  "llm",
  "popular_root",
  "operator",
]);
export type CatalogCanonicalSource = z.infer<
  typeof CatalogCanonicalSourceSchema
>;

export const LyricCatalogSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(100),
  artist: z.string().max(100).default(""),
  titleNorm: z.string(),
  artistNorm: z.string(),
  lyricsCanonical: z.string(),
  versionCount: z.number().int().nonnegative().default(1),
  status: CatalogStatusSchema.default("single"),
  normalizedAt: z.string().datetime().nullable(),
});
export type LyricCatalog = z.infer<typeof LyricCatalogSchema>;
