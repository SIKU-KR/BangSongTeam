import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { App } from "./App";
import {
  resetPresentationStore,
  SEED_PRESENTATION_IDS,
} from "./features/presentation";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App Route Integration", () => {
  beforeEach(() => {
    // 멀티 문서 스토어는 모듈 전역이므로 테스트 간 격리가 필요하다
    resetPresentationStore();
  });

  it("should render the landing placeholder at '/'", () => {
    renderAt("/");

    expect(screen.getByTestId("landing-route")).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-card")).not.toBeInTheDocument();
  });

  it("should render the dashboard at '/presentations'", () => {
    renderAt("/presentations");

    expect(screen.getByText("Worship Studio")).toBeInTheDocument();
    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
  });

  it("should redirect '/lyrics' to '/presentations'", () => {
    renderAt("/lyrics");

    expect(screen.getByText("Worship Studio")).toBeInTheDocument();
    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
  });

  it("should render the background library at '/backgrounds'", () => {
    renderAt("/backgrounds");

    expect(screen.getByText("내가 등록한 배경")).toBeInTheDocument();
    expect(screen.getByText("유저가 등록한 배경")).toBeInTheDocument();
  });

  it("should render FullscreenPresentRoute at '/present/:presentationId/fullscreen'", () => {
    renderAt(`/present/${DOC_ID}/fullscreen`);

    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();
    expect(screen.getByText("시작됐네 우리 주님의 능력이")).toBeInTheDocument();
  });

  it("should render EditorRoute at '/editor/:presentationId'", () => {
    renderAt(`/editor/${DOC_ID}`);

    expect(screen.getByTestId("editor-route")).toBeInTheDocument();
    expect(screen.getByTestId("editor-stage-canvas")).toBeInTheDocument();
  });

  it("should redirect an unknown presentationId to /presentations", () => {
    renderAt("/editor/99999999-9999-4999-8999-999999999999");

    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
  });

  it("should redirect an unknown path to /presentations", () => {
    renderAt("/definitely-not-a-route");

    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
  });

  it("should redirect the legacy '/editor' path (no id) to /presentations", () => {
    renderAt("/editor");

    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
  });
});
