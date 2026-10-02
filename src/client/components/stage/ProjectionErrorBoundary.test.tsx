import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectionErrorBoundary } from "./ProjectionErrorBoundary";

function Stage({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
  if (shouldThrow) throw new Error("render failed");
  return <div data-testid="stage">가사</div>;
}

describe("ProjectionErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("그리기 오류가 나면 검은 화면만 보인다", () => {
    render(
      <ProjectionErrorBoundary resetKey="0:0">
        <Stage shouldThrow />
      </ProjectionErrorBoundary>,
    );

    expect(screen.getByTestId("projection-error-fallback")).toHaveClass(
      "bg-black",
    );
    expect(screen.queryByTestId("stage")).toBeNull();
  });

  it("위치가 바뀌면 다시 그려 본다", () => {
    const { rerender } = render(
      <ProjectionErrorBoundary resetKey="0:0">
        <Stage shouldThrow />
      </ProjectionErrorBoundary>,
    );

    rerender(
      <ProjectionErrorBoundary resetKey="0:1">
        <Stage shouldThrow={false} />
      </ProjectionErrorBoundary>,
    );

    expect(screen.getByTestId("stage")).toBeInTheDocument();
    expect(screen.queryByTestId("projection-error-fallback")).toBeNull();
  });

  it("위치가 그대로면 오류 화면을 유지한다", () => {
    const { rerender } = render(
      <ProjectionErrorBoundary resetKey="0:0">
        <Stage shouldThrow />
      </ProjectionErrorBoundary>,
    );

    rerender(
      <ProjectionErrorBoundary resetKey="0:0">
        <Stage shouldThrow={false} />
      </ProjectionErrorBoundary>,
    );

    expect(screen.getByTestId("projection-error-fallback")).toBeInTheDocument();
  });
});
