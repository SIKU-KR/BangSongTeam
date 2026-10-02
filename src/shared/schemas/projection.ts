import { z } from "zod";

/** 프레젠테이션 안의 곡·슬라이드 위치. 편집기 선택과 송출 화면이 같이 쓴다 */
export const ProjectionPositionSchema = z.object({
  songIndex: z.number().int().nonnegative(),
  slideIndex: z.number().int().nonnegative(),
});
export type ProjectionPosition = z.infer<typeof ProjectionPositionSchema>;

/**
 * 곡 id로 고정한 송출 위치. 동기화나 공유 프레젠테이션 새로고침이 문서를 통째로 바꾸면
 * 인덱스만으로는 다른 곡을 가리키게 되므로 보던 곡의 id를 함께 들고 다닌다.
 * 슬라이드 id는 파싱할 때마다 새로 생길 수 있어 곡 id(`item.id`)에만 고정한다.
 */
export const AnchoredPositionSchema = ProjectionPositionSchema.extend({
  itemId: z.string().nullable(),
});
export type AnchoredPosition = z.infer<typeof AnchoredPositionSchema>;

/**
 * 새로고침 뒤 송출을 이어 가는 데 필요한 화면 상태. 같은 탭의 sessionStorage에서 읽으므로
 * 깨졌거나 옛 형식인 값은 이 스키마로 걸러 낸다.
 */
export const ProjectionResumeSchema = AnchoredPositionSchema.extend({
  hasStarted: z.boolean(),
  isBlackout: z.boolean(),
  isLyricsHidden: z.boolean(),
});
export type ProjectionResume = z.infer<typeof ProjectionResumeSchema>;
