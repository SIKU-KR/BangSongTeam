import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { ProjectionMediaGate } from "./ProjectionMediaGate";
import type { ProjectionMediaReadiness } from "./useProjectionMediaReady";

const MB = 1024 * 1024;

function readiness(
  overrides: Partial<ProjectionMediaReadiness> = {},
): ProjectionMediaReadiness {
  return {
    status: "downloading",
    failure: null,
    retrying: false,
    readyCount: 1,
    totalCount: 2,
    receivedBytes: 300 * MB,
    totalBytes: 600 * MB,
    retry: vi.fn(),
    ...overrides,
  };
}

function renderGate(state: ProjectionMediaReadiness): { onStart: () => void } {
  const onStart = vi.fn();
  render(<ProjectionMediaGate readiness={state} onStartWithSaved={onStart} />);
  return { onStart };
}

describe("ProjectionMediaGate", () => {
  it("받는 중에는 개수와 용량을 보여 주고 저장된 배경으로 시작할 수 있다", () => {
    const { onStart } = renderGate(readiness());

    expect(screen.getByText(BACKGROUND_COPY.prepare.title)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(
      screen.getByText(BACKGROUND_COPY.prepare.count(1, 2)),
    ).toBeInTheDocument();
    const start = screen.getByTestId("projection-media-start-saved");
    expect(start).toHaveTextContent(BACKGROUND_COPY.prepare.startWithSaved);
    expect(start).toHaveAttribute("title", BACKGROUND_COPY.prepare.savedHint);

    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("저장할 수 없는 브라우저에는 진행 대신 인터넷으로 재생한다고 알리고 송출 시작만 둔다", () => {
    const { onStart } = renderGate(
      readiness({
        status: "failed",
        failure: "unsupported",
        readyCount: 0,
        receivedBytes: 0,
      }),
    );

    expect(
      screen.getByText(BACKGROUND_COPY.prepare.unsupportedTitle),
    ).toBeInTheDocument();
    expect(screen.queryByText(BACKGROUND_COPY.prepare.title)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      BACKGROUND_COPY.prepare.failed.unsupported,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(BACKGROUND_COPY.prepare.count(0, 2))).toBeNull();
    expect(screen.queryByTestId("projection-media-retry")).toBeNull();
    const start = screen.getByTestId("projection-media-start-saved");
    expect(start).toHaveTextContent(BACKGROUND_COPY.prepare.start);
    expect(start).not.toHaveAttribute("title");

    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("받지 못했으면 다시 시도할 수 있다", () => {
    const state = readiness({ status: "failed", failure: "network" });
    renderGate(state);

    expect(screen.getByRole("alert")).toHaveTextContent(
      BACKGROUND_COPY.prepare.failed.network,
    );
    fireEvent.click(screen.getByTestId("projection-media-retry"));
    expect(state.retry).toHaveBeenCalledTimes(1);
  });
});
