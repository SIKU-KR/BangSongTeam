import { createAuthClient } from "better-auth/react";

/**
 * Better Auth 클라이언트.
 *
 * Worker가 `/api/auth`에 마운트되어 있고 SPA와 같은 오리진이므로 baseURL을
 * 따로 주지 않는다 (CORS도 필요 없다).
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export type SocialProvider = "kakao" | "naver";

/** 지원 소셜 로그인 (PRD 4.6: MVP는 소셜만, 비밀번호 없음) */
export const SOCIAL_PROVIDERS: Array<{
  id: SocialProvider;
  label: string;
  className: string;
}> = [
  {
    id: "kakao",
    label: "카카오로 시작하기",
    className: "bg-[#FEE500] text-[#191600] hover:bg-[#FADA0A]",
  },
  {
    id: "naver",
    label: "네이버로 시작하기",
    className: "bg-[#03C75A] text-white hover:bg-[#02B350]",
  },
];
