import React from "react";
import { useNavigate } from "react-router-dom";

/** 랜딩 페이지 플레이스홀더 라우트 */
export function LandingRoute(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div
      data-testid="landing-route"
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        Worship Studio
      </h1>
      <p className="text-sm text-zinc-500">랜딩 페이지 준비 중입니다.</p>
      <button
        type="button"
        data-testid="landing-enter-btn"
        onClick={() => navigate("/presentations")}
        className="mt-2 cursor-pointer rounded-xl bg-linear-to-r from-emerald-600 via-teal-600 to-emerald-500 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:scale-[1.02] hover:from-emerald-500 hover:to-teal-400 hover:shadow-md active:scale-[0.98]"
      >
        내 프레젠테이션으로 이동
      </button>
    </div>
  );
}
