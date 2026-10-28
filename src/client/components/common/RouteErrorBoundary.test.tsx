import React, { Suspense } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { SHELL_COPY } from "#copy/shell";

const originalLocation = Object.getOwnPropertyDescriptor(window, "location");

function stubLocation(pathname: string): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname, reload },
  });
  return reload;
}

function FailedChunk(): React.JSX.Element {
  throw new TypeError("Failed to fetch dynamically imported module");
}

function staleChunk(): React.LazyExoticComponent<() => React.JSX.Element> {
  return React.lazy(() =>
    Promise.reject(
      Object.assign(
        new Error("Failed to load chunk /_next/static/chunks/x.js"),
        { name: "ChunkLoadError" },
      ),
    ),
  );
}

function renderLazy(
  Lazy: React.LazyExoticComponent<() => React.JSX.Element>,
): void {
  render(
    <RouteErrorBoundary>
      <Suspense fallback={null}>
        <Lazy />
      </Suspense>
    </RouteErrorBoundary>,
  );
}

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    if (originalLocation) {
      Object.defineProperty(window, "location", originalLocation);
    }
  });

  it("라우트 청크를 받지 못하면 빈 화면 대신 새로고침 안내를 보여 준다", () => {
    const reload = stubLocation("/editor/p1");
    render(
      <RouteErrorBoundary>
        <FailedChunk />
      </RouteErrorBoundary>,
    );

    expect(screen.getByTestId("route-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: SHELL_COPY.routeError.reload }),
    ).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("배포로 지워진 옛 청크를 받지 못하면 새 버전으로 한 번 새로고침한다", async () => {
    const reload = stubLocation("/editor/p1");

    renderLazy(staleChunk());

    expect(await screen.findByTestId("route-error")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("송출 화면에서는 옛 청크를 받지 못해도 새로고침하지 않고 안내만 보인다", async () => {
    const reload = stubLocation("/present/p1/fullscreen");

    renderLazy(staleChunk());

    expect(await screen.findByTestId("route-error")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
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
