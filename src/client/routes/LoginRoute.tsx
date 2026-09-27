import React, { useEffect, useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import type { AuthConfigResponse } from "#shared";
import {
  SOCIAL_PROVIDERS,
  signInWithProvider,
  fetchAuthConfig,
  type SocialProvider,
} from "../lib/auth";
import { SocialLoginButton } from "../features/auth/SocialLoginButton";

const LEGAL_LINKS = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보 처리방침" },
];

export interface LoginRouteProps {
  /** 로그인이 필요한 까닭. 없으면 계정 저장 안내를 보여 준다 */
  description?: string;
  /** 로그인하지 않고 원래 화면으로 돌아간다 */
  onCancel?: () => void;
}

/** 로그인 화면 라우트 */
export function LoginRoute({
  description = "로그인하면 만든 세트가 계정에 저장되어, 교회 PC와 집 PC 어디서든 같은 세트를 열 수 있습니다.",
  onCancel,
}: LoginRouteProps = {}): React.JSX.Element {
  const [config, setConfig] = useState<AuthConfigResponse | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchAuthConfig();
        if (!cancelled) setConfig(next);
      } catch {
        if (!cancelled) {
          setConfig({ providers: SOCIAL_PROVIDERS.map((p) => p.id) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignIn = async (provider: SocialProvider): Promise<void> => {
    setPending(provider);
    setError(null);
    try {
      await signInWithProvider(provider);
    } catch {
      setError("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setPending(null);
    }
  };

  const visibleProviders = SOCIAL_PROVIDERS.filter((provider) =>
    config?.providers.includes(provider.id),
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">교회 방송팀 다모여!</CardTitle>
          <CardDescription data-testid="login-description">
            {description}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {config === null ? (
            <p
              data-testid="login-loading"
              className="text-center text-sm text-muted-foreground"
            >
              로그인 수단을 확인하는 중…
            </p>
          ) : (
            <>
              {visibleProviders.length > 0 && (
                <div className="flex flex-col gap-2">
                  {visibleProviders.map((provider) => (
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

              {visibleProviders.length === 0 && (
                <Alert>
                  <CircleAlertIcon />
                  <AlertDescription>
                    사용 가능한 로그인 수단이 없습니다. 소셜 로그인 자격증명이
                    설정되지 않았습니다.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {error && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
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
              로그인하지 않고 돌아가기
            </Button>
          )}
          데스크톱 Chrome에 최적화되어 있습니다
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
  );
}

export default LoginRoute;
