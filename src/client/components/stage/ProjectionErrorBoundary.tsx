import React from "react";

interface ProjectionErrorBoundaryProps {
  /** 바뀌면 오류 상태를 풀고 다시 그린다. 송출 위치를 넘겨 다음 넘김에 회복되게 한다 */
  resetKey: string;
  children: React.ReactNode;
}

interface ProjectionErrorBoundaryState {
  failed: boolean;
  resetKey: string;
}

/**
 * 송출 스테이지에서 그리기 오류가 나도 청중 화면에는 검은 화면만 보이게 한다.
 * 앱 전체의 `RouteErrorBoundary`까지 올라가면 밝은 안내 카드와 새로고침 버튼이 프로젝터에
 * 뜨고, 새로고침은 전체화면을 풀어 버린다. 오류 상태는 `resetKey`가 바뀔 때 풀리므로
 * 운영자가 다음 슬라이드로 넘기면 다시 그려 본다. `key`를 바꾸지 않는 것은 정상일 때
 * 슬라이드마다 배경 영상이 다시 마운트되지 않게 하기 위해서다.
 */
export class ProjectionErrorBoundary extends React.Component<
  ProjectionErrorBoundaryProps,
  ProjectionErrorBoundaryState
> {
  state: ProjectionErrorBoundaryState = {
    failed: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(): Partial<ProjectionErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ProjectionErrorBoundaryProps,
    state: ProjectionErrorBoundaryState,
  ): Partial<ProjectionErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { failed: false, resetKey: props.resetKey };
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        data-testid="projection-error-fallback"
        className="absolute inset-0 bg-black"
      />
    );
  }
}
