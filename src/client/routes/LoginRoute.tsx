"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { Separator } from "#components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import {
  AUTH_ERROR_PARAM,
  callbackErrorMessage,
  signInWithProvider,
  SocialSignInError,
  visibleSocialProviders,
  withoutAuthError,
  type SocialProvider,
} from "../lib/auth";
import { useConfiguredSocialProviders } from "../lib/api/authConfigQueries";
import { detectInAppBrowser } from "../lib/browser/inAppBrowser";
import { EmailLoginForm } from "../features/auth/EmailLoginForm";
import { InAppBrowserNotice } from "../features/auth/InAppBrowserNotice";
import { SocialLoginButton } from "../features/auth/SocialLoginButton";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { AUTH_COPY, LEGAL_COPY } from "#copy/auth";
import { APP_NAME, DEV_USERS } from "#shared";

const LEGAL_LINKS = [
  { href: "/terms", label: LEGAL_COPY.terms },
  { href: "/privacy", label: LEGAL_COPY.privacy },
];

interface LoginRouteProps {
  /** 로그인이 필요한 까닭. 없으면 계정 저장 안내를 보여 준다 */
  description?: string;
  /** 로그인하지 않고 원래 화면으로 돌아간다 */
  onCancel?: () => void;
}

/**
 * 로그인 화면 라우트.
 *
 * - 위쪽에 저장 경고 배너를 둔다. 저장소가 다른 탭에 막혀 세션 캐시를 읽지 못한 부팅은 이 화면에서
 *   끝날 수 있어, 다른 탭을 닫으라는 안내가 여기서도 보여야 한다.
 * - 소셜 로그인은 서버가 켜 둔 것만 버튼으로 보인다. 서버 목록을 받기 전이거나 받지 못하면
 *   Google만 보여, 이메일 로그인과 함께 늘 쓸 수 있게 한다(`visibleSocialProviders`).
 * - 소셜 로그인이 도중에 실패해 이 주소로 돌아오면 주소의 `?error=코드`를 읽어 안내하고 주소에서
 *   지운다(`signInWithProvider`가 돌아올 주소를 알려 준다). 안내는 지운 뒤에도 남는다.
 * - 앱 안 브라우저(카카오톡 등)에서는 Google이 로그인을 막으므로 버튼 대신 다른 브라우저로 열라고
 *   안내한다. 이메일 로그인과 카카오·네이버 로그인은 앱 안에서도 된다.
 * - Google 화면에서 뒤로 가기로 돌아오면 브라우저가 이 화면을 로그인으로 이동하던 상태 그대로
 *   되살린다(`pageshow`의 `persisted`). 막아 둔 버튼을 풀지 않으면 이메일 로그인까지 막힌 채 남는다.
 * - 카드가 화면보다 길면(키보드가 올라온 폰, 가로로 돌린 폰) 이 화면이 스스로 스크롤한다. body가
 *   overflow-hidden이라 화면 높이만큼의 스크롤 영역(`h-dvh overflow-y-auto`)을 두지 않으면 잘린 아래쪽의
 *   입력란과 제출 버튼에 닿을 수 없다.
 */
export function LoginRoute({
  description = AUTH_COPY.defaultDescription,
  onCancel,
}: LoginRouteProps = {}): React.JSX.Element {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() =>
    callbackErrorMessage(searchParams.get(AUTH_ERROR_PARAM)),
  );
  const [inAppBrowser] = useState(() =>
    detectInAppBrowser(window.navigator.userAgent),
  );
  const configured = useConfiguredSocialProviders().data;

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const rest = withoutAuthError(search);
    if (rest !== search) {
      window.history.replaceState(null, "", `${pathname}${rest}${hash}`);
    }
  }, []);

  useEffect(() => {
    const restore = (event: PageTransitionEvent): void => {
      if (event.persisted) setPending(null);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  const handleSignIn = async (provider: SocialProvider): Promise<void> => {
    setPending(provider);
    setError(null);
    try {
      await signInWithProvider(provider);
    } catch (err) {
      setError(
        err instanceof SocialSignInError ? err.message : AUTH_COPY.signInFailed,
      );
      setPending(null);
    }
  };

  const providers = visibleSocialProviders(configured);
  const offersGoogle = providers.some((provider) => provider.id === "google");
  const googleBlockedBy = offersGoogle ? inAppBrowser : null;
  const buttons = googleBlockedBy
    ? providers.filter((provider) => provider.id !== "google")
    : providers;

  return (
    <div
      data-testid="login-route"
      className="flex h-dvh flex-col overflow-y-auto bg-muted/40"
    >
      <StorageWarningBanner />
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{APP_NAME}</CardTitle>
            <CardDescription data-testid="login-description">
              {description}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-5">
            {error && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {buttons.length > 0 && (
              <div className="flex flex-col gap-2">
                {buttons.map((provider) => (
                  <SocialLoginButton
                    key={provider.id}
                    provider={provider.id}
                    label={provider.label}
                    pending={pending === provider.id}
                    disabled={pending !== null}
                    onClick={() => void handleSignIn(provider.id)}
                  />
                ))}
              </div>
            )}

            {googleBlockedBy && (
              <InAppBrowserNotice browser={googleBlockedBy} />
            )}

            {(buttons.length > 0 || googleBlockedBy) && (
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  {AUTH_COPY.email.divider}
                </span>
                <Separator className="flex-1" />
              </div>
            )}

            <EmailLoginForm disabled={pending !== null} />

            {process.env.NODE_ENV !== "production" && (
              <div data-testid="dev-sign-in" className="flex flex-col gap-2">
                <p className="text-center text-xs text-muted-foreground">
                  {AUTH_COPY.dev.title}
                </p>
                {DEV_USERS.map((dev) => (
                  <Button
                    key={dev.id}
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a href={`/api/auth/dev/sign-in?userId=${dev.id}`} />
                    }
                  >
                    {AUTH_COPY.dev.signInAs(dev.name)}
                    {!dev.termsAgreed && AUTH_COPY.dev.consentPendingSuffix}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex-col gap-2 text-xs text-muted-foreground">
            {onCancel && (
              <Button
                variant="ghost"
                data-testid="login-cancel-btn"
                disabled={pending !== null}
                onClick={onCancel}
              >
                {AUTH_COPY.cancel}
              </Button>
            )}
            {AUTH_COPY.optimizedFor}
            <div className="flex gap-1">
              {LEGAL_LINKS.map((link) => (
                <Button
                  key={link.href}
                  variant="link"
                  size="xs"
                  nativeButton={false}
                  render={
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  {link.label}
                </Button>
              ))}
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
