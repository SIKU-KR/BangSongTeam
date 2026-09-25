import React from "react";
import { useLocation } from "react-router-dom";
import { Button } from "#components/ui/button";
import {
  useServiceWorkerState,
  applyServiceWorkerUpdate,
} from "../../pwa/registerServiceWorker";

/**
 * 새 버전 적용 안내 배너.
 *
 * 갱신을 자동으로 적용하지 않는 이유가 이 컴포넌트의 존재 이유다. 배포가 나간
 * 순간 창이 새로고침되면 예배가 끊기므로, 적용 시점을 사용자가 고르게 한다.
 * 송출 경로(`/present/*`)에서는 어떤 경우에도 렌더하지 않는다 — 청중 화면에
 * 배너가 뜨는 것 자체가 사고다.
 */
export function AppUpdateBanner(): React.JSX.Element | null {
  const { pathname } = useLocation();
  const { needRefresh } = useServiceWorkerState();

  if (!needRefresh) return null;
  if (pathname.startsWith("/present/")) return null;

  return (
    <div
      role="status"
      data-testid="app-update-banner"
      className="flex w-full shrink-0 items-center gap-2.5 bg-primary px-4 py-2 text-xs font-medium text-primary-foreground sm:text-sm"
    >
      <span className="flex-1">
        새 버전이 준비되었습니다. 예배 송출 중이 아닐 때 적용해 주세요.
      </span>
      <Button
        variant="secondary"
        size="sm"
        data-testid="app-update-apply-btn"
        onClick={() => {
          void applyServiceWorkerUpdate();
        }}
      >
        지금 적용
      </Button>
    </div>
  );
}
