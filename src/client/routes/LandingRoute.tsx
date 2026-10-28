"use client";

import React, { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "#components/ui/button";
import { DRIVE_ROOT_PATH } from "../features/drive/drivePaths";
import { AUTH_ERROR_PARAM, useSession } from "../lib/auth";
import { SHELL_COPY } from "#copy/shell";
import { APP_NAME, APP_TAGLINE } from "#shared";

/**
 * 랜딩 페이지 플레이스홀더 라우트.
 *
 * 소셜 로그인이 도중에 실패하면 Better Auth가 `/?error=코드`로 돌려보내기도 한다. 로그인이 시작한
 * 주소를 알려 주지 못한 요청(옛 화면, 상태를 읽지 못한 콜백)이다. 랜딩에는 로그인 화면이 없어서
 * 이유를 안내할 수 없으므로, 로그인하지 않은 사람에게 로그인 화면이 열리는 드라이브 주소로
 * 코드만 넘긴다.
 *
 * 이미 로그인한 사람(예를 들어 다른 탭에서 로그인을 마친 사람)에게는 안내를 읽을 로그인 화면이
 * 없다. 코드를 드라이브 주소에 남기면 아무도 지우지 않아, 로그아웃해 새로고침한 로그인 화면이
 * 지난 실패를 안내하게 된다. 그래서 코드 없이 드라이브로만 보낸다.
 */
export function LandingRoute(): React.JSX.Element | null {
  const router = useRouter();
  const authError = useSearchParams().get(AUTH_ERROR_PARAM);
  const signedIn = useSession().status === "authenticated";

  useEffect(() => {
    if (!authError) return;
    if (signedIn) {
      router.replace(DRIVE_ROOT_PATH);
      return;
    }
    const params = new URLSearchParams({ [AUTH_ERROR_PARAM]: authError });
    router.replace(`${DRIVE_ROOT_PATH}?${params}`);
  }, [authError, signedIn, router]);

  if (authError) return null;

  return (
    <div
      data-testid="landing-route"
      className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-background"
    >
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        {APP_NAME}
      </h1>
      <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
      <Button
        size="lg"
        data-testid="landing-enter-btn"
        onClick={() => router.push("/presentations")}
        className="mt-2"
      >
        {SHELL_COPY.landingEnter}
      </Button>
    </div>
  );
}
