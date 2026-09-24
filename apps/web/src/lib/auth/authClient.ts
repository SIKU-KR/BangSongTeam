import { createAuthClient } from "better-auth/react";

/** Better Auth 클라이언트 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export type SocialProvider = "kakao" | "naver";

/** 지원 소셜 로그인 제공자 목록 */
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
