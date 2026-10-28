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

/** 저장 요청의 슬라이드 id 길이 상한. 앱이 만드는 id는 12자다(`createSlideId`) */
export const MAX_SLIDE_ID_LENGTH = 64;

/**
 * 저장 요청 본문의 슬라이드. `SlideSchema`에 id 길이 상한을 더한다.
 *
 * 쓰기 요청 검사에만 쓴다. `SlideSchema`는 IndexedDB 저장본과 서버 응답도 읽으므로 거기에
 * 한도를 두면 이미 저장된 곡을 읽지 못한다.
 */
export const SlideWriteSchema = SlideSchema.extend({
  id: z.string().min(1).max(MAX_SLIDE_ID_LENGTH).default(createSlideId),
});

/**
 * DB에 저장된 슬라이드. 줄 길이·줄 수 제한 없이 모양만 검사한다. 제한을 넘는
 * 슬라이드를 버리지 않고 `fitSlidesToLimits`로 나눠 읽기 위해 쓴다.
 */
export const StoredSlideSchema = SlideSchema.extend({
  lines: z.array(z.string()),
});
