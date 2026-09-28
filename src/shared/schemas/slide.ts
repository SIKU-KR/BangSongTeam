import { z } from "zod";
import { createSlideId } from "../utils/id";

/** 슬라이드 한 장에 담을 수 있는 최대 가사 줄 수 (PRD 4.2). */
export const MAX_SLIDE_LINES = 4;

/** 가사 한 줄의 최대 글자 수 */
export const MAX_SLIDE_LINE_LENGTH = 80;

/**
 * 슬라이드 1장 데이터 (경량화 ID 및 최대 4줄 제약)
 */
export const SlideSchema = z.object({
  id: z.string().min(1).default(createSlideId),
  order: z.number().int().nonnegative(),
  lines: z.array(z.string().max(MAX_SLIDE_LINE_LENGTH)).max(MAX_SLIDE_LINES),
});
export type Slide = z.infer<typeof SlideSchema>;

/**
 * DB에 저장된 슬라이드. 줄 길이·줄 수 제한 없이 모양만 검사한다. 제한을 넘는
 * 슬라이드를 버리지 않고 `fitSlidesToLimits`로 나눠 읽기 위해 쓴다.
 */
export const StoredSlideSchema = SlideSchema.extend({
  lines: z.array(z.string()),
});
