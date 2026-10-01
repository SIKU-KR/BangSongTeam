import React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import "@fontsource/google-sans/latin-500.css";
import type { SocialProvider } from "../../lib/auth";
import googleGUrl from "./brand/google-g.svg";
import kakaoSymbolUrl from "./brand/kakao-symbol.svg";
import naverLogoUrl from "./brand/naver-logo.svg";

const socialLoginButtonVariants = cva(
  "inline-flex h-12 w-full items-center justify-center rounded-brand border whitespace-nowrap outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-busy:opacity-100",
  {
    variants: {
      provider: {
        kakao:
          "gap-2 border-transparent bg-kakao px-4 font-system text-kakao-label font-normal text-kakao-foreground",
        naver:
          "gap-2 border-transparent bg-naver px-4 text-base font-medium text-naver-foreground",
        google:
          "gap-2.5 border-google-border bg-google px-3 font-google text-sm/5 font-medium text-google-foreground hover:bg-google-hover",
      },
    },
  },
);

const BRAND_MARKS: Record<SocialProvider, { src: string; className: string }> =
  {
    kakao: { src: kakaoSymbolUrl, className: "h-3.25 shrink-0" },
    naver: { src: naverLogoUrl, className: "size-4 shrink-0" },
    google: { src: googleGUrl, className: "size-5 shrink-0" },
  };

interface SocialLoginButtonProps extends Omit<
  ButtonPrimitive.Props,
  "className" | "children"
> {
  provider: SocialProvider;
  label: string;
  /** 이 버튼으로 로그인 이동 중이다. 레이블과 심볼은 바꾸지 않는다 */
  pending?: boolean;
}

/**
 * 카카오 로그인 디자인 가이드, 네이버 로그인 버튼 사용 가이드, Sign in with Google
 * Branding Guidelines를 따르는 소셜 로그인 버튼.
 * 색·심볼·글꼴·레이블은 브랜드 규정값이라 앱 테마에 맞춰 바꾸지 않는다. Google만 가이드의
 * 다크 테마로 바뀌고, 카카오·네이버는 지정색을 벗어나지 않도록 hover 때도 색을 유지한다.
 * 한 버튼만 두드러지면 안 되므로 높이(48px)와 모서리(12px)를 같게 두고, 심볼과 레이블은
 * 세 가이드가 모두 허용하는 가운데 정렬로 둔다.
 */
export function SocialLoginButton({
  provider,
  label,
  pending = false,
  ...props
}: SocialLoginButtonProps): React.JSX.Element {
  const mark = BRAND_MARKS[provider];
  return (
    <ButtonPrimitive
      aria-busy={pending || undefined}
      className={socialLoginButtonVariants({ provider })}
      {...props}
    >
      <img alt="" src={mark.src} className={mark.className} />
      <span className="truncate">{label}</span>
    </ButtonPrimitive>
  );
}
