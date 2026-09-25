import React, { useEffect, useState } from "react";
import { cn } from "cn";
import { Badge } from "#components/ui/badge";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
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
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Worship Studio</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            예배 찬양 슬라이드를 만들고 송출합니다
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
          <p className="mb-5 text-sm/relaxed">
            로그인하면 만든 세트가 계정에 저장되어, 교회 PC와 집 PC 어디서든
            같은 세트를 열 수 있습니다.
          </p>

          {config === null ? (
            <p
              data-testid="login-loading"
              className="py-3 text-center text-xs text-muted-foreground"
            >
              로그인 수단을 확인하는 중…
            </p>
          ) : (
            <>
              {visibleProviders.length > 0 && (
                <div className="space-y-2.5">
                  {visibleProviders.map((provider) => (
                    <Button
                      key={provider.id}
                      size="lg"
                      disabled={pending !== null}
                      onClick={() => void handleSignIn(provider.id)}
                      className={cn(
                        "h-11 w-full rounded-xl font-bold",
                        PROVIDER_BUTTON_CLASS[provider.id],
                      )}
                    >
                      {pending === provider.id ? "이동 중…" : provider.label}
                    </Button>
                  ))}
                </div>
              )}

              {config.emailLogin && (
                <div
                  data-testid="email-login"
                  className={
                    visibleProviders.length > 0 ? "mt-5 border-t pt-5" : ""
                  }
                >
                  <EmailLoginForm />
                </div>
              )}

              {config.devLogin && (
                <div
                  data-testid="dev-login"
                  className={
                    visibleProviders.length > 0 || config.emailLogin
                      ? "mt-5 border-t border-dashed pt-5"
                      : ""
                  }
                >
                  <div className="mb-2.5 flex items-center gap-2">
                    <Badge variant="outline" className="text-warning">
                      개발용
                    </Badge>
                    <span className="text-2xs text-muted-foreground">
                      이 기기(localhost)에서만 동작합니다
                    </span>
                  </div>

                  <Input
                    type="email"
                    value={devEmail}
                    onChange={(event) => setDevEmail(event.target.value)}
                    placeholder="dev@worship.local (비워 두면 기본 계정)"
                    aria-label="개발자 계정 이메일"
                    className="mb-2"
                  />

                  <Button
                    size="lg"
                    disabled={pending !== null}
                    onClick={() => void handleDevSignIn()}
                    className="h-11 w-full rounded-xl font-bold"
                  >
                    {pending === "dev" ? "로그인 중…" : "개발자 로그인"}
                  </Button>
                </div>
              )}

              {visibleProviders.length === 0 &&
                !config.emailLogin &&
                !config.devLogin && (
                  <p
                    role="alert"
                    className="text-xs/relaxed text-muted-foreground"
                  >
                    사용 가능한 로그인 수단이 없습니다. 소셜 로그인 자격증명이
                    설정되지 않았습니다.
                  </p>
                )}
            </>
          )}

          {error && (
            <p role="alert" className="mt-4 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          데스크톱 Chrome에 최적화되어 있습니다
        </p>
      </div>
    </div>
  );
}

export default LoginRoute;
