import { DEFAULT_BACKGROUND_COLOR } from "../constants";

/**
 * 곡 배경 뒤에 깔 단색. 곡의 단색은 영상·이미지 배경이 없을 때만 쓰므로, 미디어가 있으면
 * 저장된 단색이 남아 있어도 기본 검정을 깐다. 단색을 고르지 않은 곡도 검정이다.
 */
export function resolveBackdropColor(
  backgroundColor: string | undefined,
  hasMedia: boolean,
): string {
  return hasMedia
    ? DEFAULT_BACKGROUND_COLOR
    : (backgroundColor ?? DEFAULT_BACKGROUND_COLOR);
}
