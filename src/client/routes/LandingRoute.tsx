import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "#components/ui/button";
import { SHELL_COPY } from "#copy/shell";
import { APP_NAME, APP_TAGLINE } from "#shared";

/** 랜딩 페이지 플레이스홀더 라우트 */
export function LandingRoute(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div
      data-testid="landing-route"
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background"
    >
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
        {APP_NAME}
      </h1>
      <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
      <Button
        size="lg"
        data-testid="landing-enter-btn"
        onClick={() => navigate("/presentations")}
        className="mt-2"
      >
        {SHELL_COPY.landingEnter}
      </Button>
    </div>
  );
}
