export const APP_NAME = "방송팀 다모여";
export const APP_TAGLINE = "교회 방송팀을 위한 찬양 PPT";

/**
 * 공유 라이브러리의 공식 곡을 올린 계정(`OFFICIAL_LIBRARY_USER_ID`)의 이름. 다른 사람은 이
 * 이름을 쓸 수 없다(`server/lib/userNames.ts`).
 */
export const OFFICIAL_LIBRARY_NAME = "공식 찬양 라이브러리";

/** 소셜 계정이 이름을 주지 않았을 때 화면에 보일 이름 */
export const FALLBACK_USER_NAME = {
  default: "사용자",
  kakao: "카카오 사용자",
  naver: "네이버 사용자",
} as const;

export const UNTITLED_SONG = "(제목 없음)";
