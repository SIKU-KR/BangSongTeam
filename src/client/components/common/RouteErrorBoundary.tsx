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

interface RouteErrorBoundaryState {
  failed: boolean;
}

/**
 * 나뉜 라우트 청크를 받지 못했을 때(네트워크 끊김, 배포 뒤 사라진 옛 청크) 빈 화면
 * 대신 안내를 보여 준다. 송출 중 새로고침은 예배를 끊으므로 자동으로 새로고침하지
 * 않고 사용자가 누르게 한다.
 */
export class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true };
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
            <EmptyTitle>화면을 불러오지 못했습니다</EmptyTitle>
            <EmptyDescription>
              네트워크 연결을 확인한 뒤 새로고침해 주세요.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => window.location.reload()}>새로고침</Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
}
