import React from "react";
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
import { SHELL_COPY } from "#copy/shell";

/**
 * 새 버전 적용 안내 배너.
 *
 * 갱신을 자동으로 적용하지 않는 이유가 이 컴포넌트의 존재 이유다. 배포가 나간
 * 순간 창이 새로고침되면 예배가 끊기므로, 적용 시점을 사용자가 고르게 한다.
 */
export function AppUpdateBanner(): React.JSX.Element | null {
  const { needRefresh } = useServiceWorkerState();

  if (!needRefresh) return null;

  return (
    <Alert
      role="status"
      data-testid="app-update-banner"
      className="shrink-0 rounded-none border-x-0 border-t-0"
    >
      <RefreshCwIcon />
      <AlertTitle>{SHELL_COPY.update.title}</AlertTitle>
      <AlertDescription>{SHELL_COPY.update.description}</AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          data-testid="app-update-apply-btn"
          onClick={() => {
            void applyServiceWorkerUpdate();
          }}
        >
          {SHELL_COPY.update.apply}
        </Button>
      </AlertAction>
    </Alert>
  );
}
