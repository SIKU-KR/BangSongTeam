import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { App } from "./App";
import { resetPresentationStore } from "./features/presentation/presentationStore";
import { closeOfflineDB, OFFLINE_DB_NAME } from "./lib/storage/db";
import { __setSessionForTests } from "./lib/auth/sessionStore";
import { installFakeApi } from "./test/fakeApi";
import {
  signInAsTestUser,
  signOutForTests,
  seedPresentationsIntoStorage,
} from "./test/sessionFixture";
import { APP_NAME } from "#shared";
import { SHELL_COPY } from "#copy/shell";
import {
  SEED_PRESENTATION_IDS,
  SEED_PRESENTATIONS,
} from "./test/presentationFixture";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App Route Integration", () => {
  beforeEach(async () => {
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    resetPresentationStore();

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
    expect(screen.queryByTestId("presentation-row")).not.toBeInTheDocument();
  });

  it("should render the dashboard at '/presentations'", async () => {
    renderAt("/presentations");

    expect(await screen.findByText(APP_NAME)).toBeInTheDocument();
    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("should redirect '/lyrics' to '/presentations'", async () => {
    renderAt("/lyrics");

    expect(await screen.findByText(APP_NAME)).toBeInTheDocument();
    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("should render the background library at '/backgrounds'", async () => {
    renderAt("/backgrounds");

    expect(
      await screen.findByRole("heading", {
        name: SHELL_COPY.backgroundGallery,
      }),
    ).toBeInTheDocument();
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

  it("송출 주소에서는 부팅 화면을 검게 그린다", () => {
    renderAt(`/present/${DOC_ID}/fullscreen`);

    expect(screen.getByTestId("app-hydrating")).toHaveClass("bg-black");
    expect(screen.getByTestId("app-hydrating")).not.toHaveClass(
      "bg-background",
    );
  });

  it("다른 주소의 부팅 화면은 테마 배경을 쓴다", () => {
    renderAt("/presentations");

    expect(screen.getByTestId("app-hydrating")).toHaveClass("bg-background");
  });

  it("송출 중 세션이 끊겨도 송출 화면을 그대로 두고, 송출을 마치면 로그인 화면으로 간다", async () => {
    renderAt(`/present/${DOC_ID}/fullscreen`);
    const route = await screen.findByTestId("fullscreen-present-route");

    act(() => {
      __setSessionForTests(null);
    });

    expect(screen.getByTestId("fullscreen-present-route")).toBe(route);
    expect(
      screen.queryByRole("button", { name: /카카오 로그인/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exit-present-btn"));

    expect(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("fullscreen-present-route"),
    ).not.toBeInTheDocument();
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
    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("should redirect an unknown path to /presentations", async () => {
    renderAt("/definitely-not-a-route");

    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("should redirect the legacy '/editor' path (no id) to /presentations", async () => {
    renderAt("/editor");

    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });

  it("미로그인이면 어떤 경로로 들어와도 로그인 화면만 보인다", async () => {
    signOutForTests();

    renderAt("/presentations");

    expect(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-row")).not.toBeInTheDocument();
  });

  it("미로그인이어도 랜딩 페이지는 열리고, 진입 버튼은 로그인 화면으로 이어진다", async () => {
    signOutForTests();

    renderAt("/");

    expect(await screen.findByTestId("landing-route")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /카카오 로그인/ }),
    ).not.toBeInTheDocument();

    act(() => {
      screen.getByTestId("landing-enter-btn").click();
    });

    expect(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    ).toBeInTheDocument();
  });

  it("미로그인이면 링크로 연 세트가 아닌 송출 경로는 막는다", async () => {
    signOutForTests();

    renderAt(`/present/${DOC_ID}/fullscreen`);

    expect(
      await screen.findByRole("button", { name: /카카오 로그인/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("fullscreen-present-route"),
    ).not.toBeInTheDocument();
  });

  it("미로그인이어도 공유 링크는 보기 전용으로 열린다", async () => {
    signOutForTests();
    const api = installFakeApi({
      "GET /api/share/*": () => ({
        body: {
          document: {
            ...SEED_PRESENTATIONS[0],
            userId: "0000000000000000owner",
            access: { ownerName: "인도자" },
          },
        },
      }),
    });

    try {
      renderAt("/s/tok-first");

      expect(await screen.findByTestId("read-only-banner")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /카카오 로그인/ }),
      ).not.toBeInTheDocument();
    } finally {
      api.restore();
    }
  });

  it("다른 계정으로 로그인하면 남의 세트가 보이지 않는다", async () => {
    signInAsTestUser("999999999999999999999");

    renderAt("/presentations");

    expect(await screen.findByText(APP_NAME)).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-row")).not.toBeInTheDocument();
  });

  it("게이트를 통과한 뒤 로그인해도 스토어를 싣는다", async () => {
    signOutForTests();
    renderAt("/presentations");

    await screen.findByRole("button", { name: /카카오 로그인/ });

    await act(async () => {
      signInAsTestUser();
      await Promise.resolve();
    });

    expect(
      (await screen.findAllByTestId("presentation-row")).length,
    ).toBeGreaterThan(0);
  });
});
