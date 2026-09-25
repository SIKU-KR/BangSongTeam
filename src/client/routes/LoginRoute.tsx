import React, { useEffect, useId, useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#components/ui/card";
import { Field, FieldDescription, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { Separator } from "#components/ui/separator";
import type { AuthConfigResponse } from "#shared";
import {
  SOCIAL_PROVIDERS,
  signInWithProvider,
  signInAsDeveloper,
  fetchAuthConfig,
  type SocialProvider,
} from "../lib/auth";
import { EmailLoginForm } from "../features/auth/EmailLoginForm";

const PROVIDER_BUTTON_CLASS: Record<SocialProvider, string> = {
  kakao: "bg-kakao text-kakao-foreground hover:bg-kakao/90",
  naver: "bg-naver text-naver-foreground hover:bg-naver/90",
};

/** 로그인 화면 라우트 */
export function LoginRoute(): React.JSX.Element {
  const [config, setConfig] = useState<AuthConfigResponse | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devEmail, setDevEmail] = useState("");
  const devEmailId = useId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchAuthConfig();
        if (!cancelled) setConfig(next);
      } catch {
        if (!cancelled) {
          setConfig({
            providers: SOCIAL_PROVIDERS.map((p) => p.id),
            devLogin: false,
            emailLogin: false,
          });
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

  const handleDevSignIn = async (): Promise<void> => {
    setPending("dev");
    setError(null);
    try {
      await signInAsDeveloper(devEmail.trim() || undefined);
    } catch {
      setError("개발자 로그인에 실패했습니다.");
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
          <CardTitle className="text-2xl">Worship Studio</CardTitle>
          <CardDescription>
            로그인하면 만든 세트가 계정에 저장되어, 교회 PC와 집 PC 어디서든
            같은 세트를 열 수 있습니다.
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
                    <Button
                      key={provider.id}
                      size="lg"
                      disabled={pending !== null}
                      onClick={() => void handleSignIn(provider.id)}
                      className={PROVIDER_BUTTON_CLASS[provider.id]}
                    >
                      {pending === provider.id ? "이동 중…" : provider.label}
                    </Button>
                  ))}
                </div>
              )}

              {config.emailLogin && (
                <>
                  {visibleProviders.length > 0 && <Separator />}
                  <div data-testid="email-login">
                    <EmailLoginForm />
                  </div>
                </>
              )}

              {config.devLogin && (
                <>
                  {(visibleProviders.length > 0 || config.emailLogin) && (
                    <Separator />
                  )}
                  <Field data-testid="dev-login">
                    <FieldLabel htmlFor={devEmailId}>
                      개발자 계정 이메일
                    </FieldLabel>
                    <Input
                      id={devEmailId}
                      type="email"
                      value={devEmail}
                      onChange={(event) => setDevEmail(event.target.value)}
                      placeholder="dev@worship.local"
                    />
                    <FieldDescription>
                      <Badge variant="outline">개발용</Badge> 비워 두면 기본
                      계정으로 로그인합니다. 이 기기(localhost)에서만
                      동작합니다.
                    </FieldDescription>
                    <Button
                      size="lg"
                      disabled={pending !== null}
                      onClick={() => void handleDevSignIn()}
                    >
                      {pending === "dev" ? "로그인 중…" : "개발자 로그인"}
                    </Button>
                  </Field>
                </>
              )}

              {visibleProviders.length === 0 &&
                !config.emailLogin &&
                !config.devLogin && (
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

        <CardFooter className="justify-center text-xs text-muted-foreground">
          데스크톱 Chrome에 최적화되어 있습니다
        </CardFooter>
      </Card>
    </div>
  );
}

export default LoginRoute;
