import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { App } from "./App";
import {
  resetPresentationStore,
  SEED_PRESENTATION_IDS,
} from "./features/presentation";
import { closeOfflineDB, OFFLINE_DB_NAME } from "./lib/storage";
import {
  signInAsTestUser,
  signOutForTests,
  seedPresentationsIntoStorage,
} from "./test/sessionFixture";

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

    // 로그인이 편집의 전제 조건이므로 라우트 테스트는 세션부터 만든다.
    // 부팅 시 샘플을 자동 생성하지 않으니 데이터도 직접 심는다.
    signInAsTestUser();
    await seedPresentationsIntoStorage();
  });

  afterEach(() => {
    signOutForTests();
    closeOfflineDB();
  });

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
    renderAt("/editor/999999999999999999999");

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

  it("미로그인이면 어떤 경로로 들어와도 로그인 화면만 보인다", async () => {
    signOutForTests();

    renderAt("/presentations");

    expect(
      await screen.findByRole("button", { name: /카카오로 시작하기/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-card")).not.toBeInTheDocument();
  });

  it("미로그인이면 송출 경로도 막는다", async () => {
    signOutForTests();

    renderAt(`/present/${DOC_ID}/fullscreen`);

    expect(
      await screen.findByRole("button", { name: /카카오로 시작하기/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("fullscreen-present-route"),
    ).not.toBeInTheDocument();
  });

  it("다른 계정으로 로그인하면 남의 세트가 보이지 않는다", async () => {
    // 한 브라우저를 여러 사람이 쓸 수 있다. 로컬 저장본은 남겨 두되
    // 세션 사용자의 문서만 싣는다.
    signInAsTestUser("999999999999999999999");

    renderAt("/presentations");

    expect(await screen.findByText("Worship Studio")).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-card")).not.toBeInTheDocument();
  });

  it("게이트를 통과한 뒤 로그인해도 스토어를 싣는다", async () => {
    // 부팅 시점에는 미인증이었다가 나중에 로그인하는 경로(개발자 로그인,
    // OAuth 콜백 복귀). 부트스트랩을 부팅 때 한 번만 돌리면 방금 로그인한
    // 사용자는 새로고침 전까지 서버에 아무것도 올라가지 않는다.
    signOutForTests();
    renderAt("/presentations");

    await screen.findByRole("button", { name: /카카오로 시작하기/ });

    await act(async () => {
      signInAsTestUser();
      await Promise.resolve();
    });

    expect(await screen.findByTestId("presentation-card")).toBeInTheDocument();
  });
});
