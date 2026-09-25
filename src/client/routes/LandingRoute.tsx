import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "#components/ui/button";

/** 랜딩 페이지 플레이스홀더 라우트 */
export function LandingRoute(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div
      data-testid="landing-route"
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background"
    >
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        Worship Studio
      </h1>
      <p className="text-sm text-muted-foreground">
        랜딩 페이지 준비 중입니다.
      </p>
      <Button
        size="lg"
        data-testid="landing-enter-btn"
        onClick={() => navigate("/presentations")}
        className="mt-2"
      >
        내 프레젠테이션으로 이동
      </Button>
    </div>
  );
}
