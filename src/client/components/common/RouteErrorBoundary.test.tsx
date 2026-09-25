import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

function FailedChunk(): React.JSX.Element {
  throw new TypeError("Failed to fetch dynamically imported module");
}

describe("RouteErrorBoundary", () => {
  it("라우트 청크를 받지 못하면 빈 화면 대신 새로고침 안내를 보여 준다", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <RouteErrorBoundary>
        <FailedChunk />
      </RouteErrorBoundary>,
    );

    expect(screen.getByTestId("route-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "새로고침" }),
    ).toBeInTheDocument();
  });

  it("문제가 없으면 자식을 그대로 그린다", () => {
    render(
      <RouteErrorBoundary>
        <p>편집기</p>
      </RouteErrorBoundary>,
    );

    expect(screen.getByText("편집기")).toBeInTheDocument();
    expect(screen.queryByTestId("route-error")).not.toBeInTheDocument();
  });
});
