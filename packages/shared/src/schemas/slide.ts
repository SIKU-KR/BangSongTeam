import { z } from "zod";
import { createSlideId } from "../utils/id";

/**
 * 슬라이드 1장 데이터 (경량화 ID 및 최대 4줄 제약)
 */
export const SlideSchema = z.object({
  id: z.string().min(1).default(createSlideId),
  order: z.number().int().nonnegative(),
  lines: z.array(z.string().max(80)).max(4), // 슬라이드당 최대 4줄 제약 (PRD 4.2)
});
export type Slide = z.infer<typeof SlideSchema>;
