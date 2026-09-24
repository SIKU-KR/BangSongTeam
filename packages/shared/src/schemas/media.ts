import { z } from "zod";
import { IdSchema } from "./id";

export const BackgroundMediaSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(100),
  r2Key: z.string(), // R2 내 파일 경로 (mp4)
  posterKey: z.string(), // 썸네일 경로 (webp)
  durationSec: z.number().positive(),
  license: z.string(),
  tags: z.array(z.string()), // ["잔잔한", "따뜻한"]
  cdnUrl: z.string().url(), // https://media.domain.com/loop_01.mp4
  posterUrl: z.string().url(),
});
export type BackgroundMedia = z.infer<typeof BackgroundMediaSchema>;

/**
 * GET /api/backgrounds 쿼리 파라미터
 * - q: 제목 검색어 (초성/자모 검색 지원, 빈 문자열은 필터 없음)
 * - tag: 태그 정확 일치
 * - limit: 최대 반환 개수 (1~100)
 */
export const BackgroundsQuerySchema = z.object({
  q: z.string().trim().max(50).optional(),
  tag: z.string().trim().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type BackgroundsQuery = z.infer<typeof BackgroundsQuerySchema>;
