import { createAuthClient } from "better-auth/react";
import type { SocialProvider } from "#shared";
import { AUTH_COPY } from "#copy/auth";

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
  { id: "kakao", label: AUTH_COPY.providers.kakao },
  { id: "naver", label: AUTH_COPY.providers.naver },
  { id: "google", label: AUTH_COPY.providers.google },
];

const FALLBACK_SOCIAL_PROVIDERS: readonly SocialProvider[] = ["google"];

/**
 * 로그인 화면에 그릴 소셜 로그인. 서버가 켜 둔 로그인(`GET /api/auth-config`)을 알면 그것만 보인다.
 * id·secret을 채우지 않은 프로바이더는 서버가 등록하지 않아 누르면 늘 실패하기 때문이다.
 *
 * 아직 모르면(받는 중, 오프라인, 서버 오류) 운영에서 늘 켜 두는 Google만 보인다. 서버 목록을
 * 기다리며 로그인 화면을 비우지 않고, 꺼 둔 카카오·네이버를 눌러 보게 하지도 않는다.
 */
export function visibleSocialProviders(
  configured: readonly SocialProvider[] | undefined,
): typeof SOCIAL_PROVIDERS {
  const shown = configured ?? FALLBACK_SOCIAL_PROVIDERS;
  return SOCIAL_PROVIDERS.filter((provider) => shown.includes(provider.id));
}
