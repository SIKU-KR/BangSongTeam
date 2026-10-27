import React from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "#components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#components/ui/empty";
import { SHELL_COPY } from "#copy/shell";

/**
 * 화면을 그리지 못했을 때 보이는 새로고침 안내. 라우트 오류 경계(`RouteErrorBoundary`)와 루트
 * 레이아웃이 깨졌을 때의 `src/app/global-error.tsx`가 함께 쓴다. 테마·세션 같은 앱 상태에 기대지
 * 않아야 루트가 깨져도 그릴 수 있다.
 */
export function RouteErrorScreen(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Empty data-testid="route-error">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RefreshCwIcon />
          </EmptyMedia>
          <EmptyTitle>{SHELL_COPY.routeError.title}</EmptyTitle>
          <EmptyDescription>
            {SHELL_COPY.routeError.description}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => window.location.reload()}>
            {SHELL_COPY.routeError.reload}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
