import { MEDIA_URL_PREFIX } from "./projection";

/**
 * R2 키를 동일 출처 미디어 프록시 URL로 바꾼다.
 * 커스텀 도메인 직통으로 되돌리게 되면 이 함수와 `MEDIA_URL_PREFIX`만 바뀐다.
 */
export function mediaUrlForKey(key: string): string {
  return `${MEDIA_URL_PREFIX}${key.replace(/^\/+/, "")}`;
}
