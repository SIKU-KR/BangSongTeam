import React, { useState } from "react";
import {
  SOCIAL_PROVIDERS,
  signInWithProvider,
  type SocialProvider,
} from "../lib/auth";

/**
 * 로그인 화면.
 *
 * 로그인은 편집의 전제 조건이다 (2026-09-22 결정). 미인증 상태에서는
 * 어떤 경로로 들어와도 이 화면만 보인다.
 */
export function LoginRoute(): React.JSX.Element {
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (provider: SocialProvider): Promise<void> => {
    setPending(provider);
    setError(null);
    try {
      await signInWithProvider(provider);
    } catch {
      // 로그인 창으로 넘어가지 못한 경우 (네트워크·설정 문제)
      setError("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setPending(null);
    }
  };

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

          <div className="space-y-2.5">
            {SOCIAL_PROVIDERS.map((provider) => (
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
