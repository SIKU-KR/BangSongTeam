import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { App } from "./App";
import {
  resetPresentationStore,
  SEED_PRESENTATION_IDS,
} from "./features/presentation";
import { closeOfflineDB, OFFLINE_DB_NAME } from "./lib/storage";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App Route Integration", () => {
  beforeEach(async () => {
    // 멀티 문서 스토어는 모듈 전역이므로 테스트 간 격리가 필요하다
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    resetPresentationStore();
  });

  afterEach(closeOfflineDB);

  it("should render the landing placeholder at '/'", async () => {
    renderAt("/");

    expect(await screen.findByTestId("landing-route")).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-card")).not.toBeInTheDocument();
  });

  it("should render the dashboard at '/presentations'", async () => {
    renderAt("/presentations");

    expect(await screen.findByText("Worship Studio")).toBeInTheDocument();
    expect(await screen.findByTestId("presentation-card")).toBeInTheDocument();
  });

  it("should redirect '/lyrics' to '/presentations'", async () => {
    renderAt("/lyrics");

    expect(await screen.findByText("Worship Studio")).toBeInTheDocument();
    expect(await screen.findByTestId("presentation-card")).toBeInTheDocument();
  });

  it("should render the background library at '/backgrounds'", async () => {
    renderAt("/backgrounds");

    expect(await screen.findByText("내가 등록한 배경")).toBeInTheDocument();
    expect(await screen.findByText("유저가 등록한 배경")).toBeInTheDocument();
  });

  it("should render FullscreenPresentRoute at '/present/:presentationId/fullscreen'", async () => {
    renderAt(`/present/${DOC_ID}/fullscreen`);

    expect(
      await screen.findByTestId("fullscreen-present-route"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("시작됐네 우리 주님의 능력이"),
    ).toBeInTheDocument();
  });

  it("should render EditorRoute at '/editor/:presentationId'", async () => {
    renderAt(`/editor/${DOC_ID}`);

    expect(await screen.findByTestId("editor-route")).toBeInTheDocument();
    expect(
      await screen.findByTestId("editor-stage-canvas"),
    ).toBeInTheDocument();
  });

  it("should redirect an unknown presentationId to /presentations", async () => {
    renderAt("/editor/99999999-9999-4999-8999-999999999999");

    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
    expect(await screen.findByTestId("presentation-card")).toBeInTheDocument();
  });

  it("should redirect an unknown path to /presentations", async () => {
    renderAt("/definitely-not-a-route");

    expect(await screen.findByTestId("presentation-card")).toBeInTheDocument();
  });

  it("should redirect the legacy '/editor' path (no id) to /presentations", async () => {
    renderAt("/editor");

    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
    expect(await screen.findByTestId("presentation-card")).toBeInTheDocument();
  });
});
