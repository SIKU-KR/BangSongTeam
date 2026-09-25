import React from "react";
import { useLocation } from "react-router-dom";
import { RefreshCwIcon } from "lucide-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "#components/ui/alert";
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
    <Alert
      role="status"
      data-testid="app-update-banner"
      className="shrink-0 rounded-none border-x-0 border-t-0"
    >
      <RefreshCwIcon />
      <AlertTitle>새 버전이 준비되었습니다</AlertTitle>
      <AlertDescription>예배 송출 중이 아닐 때 적용해 주세요.</AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          data-testid="app-update-apply-btn"
          onClick={() => {
            void applyServiceWorkerUpdate();
          }}
        >
          지금 적용
        </Button>
      </AlertAction>
    </Alert>
  );
}
