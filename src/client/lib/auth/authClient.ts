import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export type SocialProvider = "kakao" | "naver";

export const SOCIAL_PROVIDERS: Array<{
  id: SocialProvider;
  label: string;
}> = [
  { id: "kakao", label: "카카오로 시작하기" },
  { id: "naver", label: "네이버로 시작하기" },
];
