import React, { useEffect, useState } from "react";
import {
  SOCIAL_PROVIDERS,
  signInWithProvider,
  signInAsDeveloper,
  fetchAuthConfig,
  type SocialProvider,
} from "../lib/auth";

interface AuthConfig {
  providers: SocialProvider[];
  devLogin: boolean;
}

/** 로그인 화면 라우트 */
export function LoginRoute(): React.JSX.Element {
  const [config, setConfig] = useState<AuthConfig | null>(null);
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
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            Worship Studio
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            예배 찬양 슬라이드를 만들고 송출합니다
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
          <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-5 leading-relaxed">
            로그인하면 만든 세트가 계정에 저장되어, 교회 PC와 집 PC 어디서든
            같은 세트를 열 수 있습니다.
          </p>

          {config === null ? (
            <p
              data-testid="login-loading"
              className="text-xs text-zinc-500 py-3 text-center"
            >
              로그인 수단을 확인하는 중…
            </p>
          ) : (
            <>
              {visibleProviders.length > 0 && (
                <div className="space-y-2.5">
                  {visibleProviders.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void handleSignIn(provider.id)}
                      className={`w-full py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${provider.className}`}
                    >
                      {pending === provider.id ? "이동 중…" : provider.label}
                    </button>
                  ))}
                </div>
              )}

              {config.devLogin && (
                <div
                  data-testid="dev-login"
                  className={
                    visibleProviders.length > 0
                      ? "mt-5 pt-5 border-t border-dashed border-zinc-300 dark:border-zinc-700"
                      : ""
                  }
                >
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                      개발용
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      이 기기(localhost)에서만 동작합니다
                    </span>
                  </div>

                  <input
                    type="email"
                    value={devEmail}
                    onChange={(event) => setDevEmail(event.target.value)}
                    placeholder="dev@worship.local (비워 두면 기본 계정)"
                    aria-label="개발자 계정 이메일"
                    className="w-full mb-2 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                  />

                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void handleDevSignIn()}
                    className="w-full py-3 rounded-xl text-sm font-bold bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {pending === "dev" ? "로그인 중…" : "개발자 로그인"}
                  </button>
                </div>
              )}

              {visibleProviders.length === 0 && !config.devLogin && (
                <p
                  role="alert"
                  className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed"
                >
                  사용 가능한 로그인 수단이 없습니다. 소셜 로그인 자격증명이
                  설정되지 않았습니다.
                </p>
              )}
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 text-xs text-red-600 dark:text-red-400"
            >
              {error}
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500 dark:text-zinc-500">
          데스크톱 Chrome에 최적화되어 있습니다
        </p>
      </div>
    </div>
  );
}

export default LoginRoute;
