import { z } from "zod";
import { createSlideId } from "../utils/id";

/** 슬라이드 한 장에 담을 수 있는 최대 가사 줄 수 (PRD 4.2). */
export const MAX_SLIDE_LINES = 4;

/**
 * 슬라이드 1장 데이터 (경량화 ID 및 최대 4줄 제약)
 */
export const SlideSchema = z.object({
  id: z.string().min(1).default(createSlideId),
  order: z.number().int().nonnegative(),
  lines: z.array(z.string().max(80)).max(MAX_SLIDE_LINES),
});
export type Slide = z.infer<typeof SlideSchema>;
