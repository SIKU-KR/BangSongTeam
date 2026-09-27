import { createAuthClient } from "better-auth/react";
import type { SocialProvider } from "#shared";

export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export type { SocialProvider };

/**
 * 로그인 화면에 보이는 순서와 버튼 레이블.
 * 레이블은 각 브랜드 가이드가 허용한 문구다. 카카오는 "카카오 로그인"과 "로그인"만 허용하고,
 * Google은 "Sign in with Google"의 한국어 표기를 쓴다.
 */
export const SOCIAL_PROVIDERS: Array<{
  id: SocialProvider;
  label: string;
}> = [
  { id: "kakao", label: "카카오 로그인" },
  { id: "naver", label: "네이버 로그인" },
  { id: "google", label: "Google 계정으로 로그인" },
];
