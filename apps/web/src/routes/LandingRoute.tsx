import React from "react";
import { useNavigate } from "react-router-dom";

/**
 * `/` 랜딩 페이지 — Canva 스타일 랜딩이 들어올 자리.
 * 현재는 대시보드 진입 동선만 제공하는 플레이스홀더다.
 */
export function LandingRoute(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div
      data-testid="landing-route"
      className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
    >
      <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
        Worship Studio
      </h1>
      <p className="text-sm text-zinc-500">랜딩 페이지 준비 중입니다.</p>
      <button
        type="button"
        data-testid="landing-enter-btn"
        onClick={() => navigate("/presentations")}
        className="mt-2 py-2.5 px-5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs shadow-sm hover:shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
      >
        내 프레젠테이션으로 이동
      </button>
    </div>
  );
}
