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
import {
  isChunkLoadError,
  reloadOnStaleChunk,
} from "../../pwa/registerServiceWorker";
import { SHELL_COPY } from "#copy/shell";

interface RouteErrorBoundaryState {
  failed: boolean;
}

/**
 * 나뉜 라우트 청크를 받지 못했을 때(네트워크 끊김, 배포 뒤 사라진 옛 청크) 빈 화면
 * 대신 안내를 보여 준다.
 *
 * 배포 뒤 사라진 옛 청크(`ChunkLoadError`)면 새 버전으로 새로고침한다(`reloadOnStaleChunk`).
 * 경계가 잡은 오류는 창의 `error`·`unhandledrejection` 이벤트로 가지 않아, 서비스 워커 등록이
 * 거는 자동 새로고침이 지연 로드 화면의 청크 오류를 보지 못한다. 송출 화면은 새로고침이 예배를
 * 끊으므로 `reloadOnStaleChunk`가 건너뛰고, 안내의 버튼을 사용자가 누르게 한다.
 */
export class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    if (isChunkLoadError(error)) reloadOnStaleChunk();
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
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
}
