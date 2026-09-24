import { MEDIA_URL_PREFIX } from "./projection";

/**
 * 배경 태그 선택지: 분위기(잔잔한·밝은·웅장한) × 주조색(따뜻한·차가운·어두운).
 * 업로드 폼과 라이브러리 필터가 같은 어휘를 쓰게 한다.
 */
export const BACKGROUND_TAGS = [
  "잔잔한",
  "밝은",
  "웅장한",
  "따뜻한",
  "차가운",
  "어두운",
] as const;

export const BACKGROUND_VIDEO_MIME_TYPES = ["video/mp4"] as const;
export const BACKGROUND_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type BackgroundVideoMimeType =
  (typeof BACKGROUND_VIDEO_MIME_TYPES)[number];
export type BackgroundImageMimeType =
  (typeof BACKGROUND_IMAGE_MIME_TYPES)[number];
export type BackgroundMimeType =
  BackgroundVideoMimeType | BackgroundImageMimeType;

/**
 * 관리자 배경 업로드 한도.
 *
 * 파일당 한도는 Worker가 요청 본문을 한 번에 받는 구조라 남겨 둔다. 클라이언트
 * 사전 검사와 Worker 검사가 같은 상수를 봐야 '브라우저는 통과, 서버는 거절' 같은
 * 어긋남이 없다. 권장 해상도 미만은 막지 않고 경고만 한다 (송출 시 확대되어
 * 흐려질 뿐이다).
 */
export const BACKGROUND_UPLOAD_LIMITS = {
  maxFileBytes: 30 * 1024 * 1024,
  maxPosterBytes: 2 * 1024 * 1024,
  maxTitleLength: 100,
  maxLicenseLength: 200,
  maxTags: 6,
  maxTagLength: 20,
  maxDurationSec: 3600,
  recommendedWidth: 1920,
  recommendedHeight: 1080,
} as const;

export function isBackgroundVideoMimeType(
  mime: string,
): mime is BackgroundVideoMimeType {
  return (BACKGROUND_VIDEO_MIME_TYPES as readonly string[]).includes(mime);
}

export function isBackgroundImageMimeType(
  mime: string,
): mime is BackgroundImageMimeType {
  return (BACKGROUND_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * R2 키를 동일 출처 미디어 프록시 URL로 바꾼다.
 * 커스텀 도메인 직통으로 되돌리게 되면 이 함수와 `MEDIA_URL_PREFIX`만 바뀐다.
 */
export function mediaUrlForKey(key: string): string {
  return `${MEDIA_URL_PREFIX}${key.replace(/^\/+/, "")}`;
}
