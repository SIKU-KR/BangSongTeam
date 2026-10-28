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
 *
 * 설명은 기본으로 인터넷 연결을 확인하라고 한다. 라우트 경계가 잡는 오류는 대개 화면 코드를 받지
 * 못한 것이기 때문이다. 루트가 깨진 것은 연결이 아니라 앱이나 저장소 문제라서 `global-error`는 까닭을
 * 짚지 않는 설명(`SHELL_COPY.rootError`)을 넘긴다.
 */
export function RouteErrorScreen({
  description = SHELL_COPY.routeError.description,
}: {
  description?: string;
}): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Empty data-testid="route-error">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RefreshCwIcon />
          </EmptyMedia>
          <EmptyTitle>{SHELL_COPY.routeError.title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
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
