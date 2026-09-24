import React from "react";
import {
  __loadDocumentsForTests,
  SEED_PRESENTATIONS,
} from "../features/presentation";
import { signInAsTestUser } from "../test/sessionFixture";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FullscreenPresentRoute } from "./FullscreenPresentRoute";

import {
  resetPresentationStore,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function renderPresent(path = `/present/${DOC_ID}/fullscreen`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/present/:presentationId/fullscreen"
          element={<FullscreenPresentRoute />}
        />
        <Route
          path="/presentations"
          element={<div data-testid="presentations-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function dispatchKey(key: string, code?: string, shiftKey = false): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: code ?? key,
      shiftKey,
      bubbles: true,
    }),
  );
}

describe("FullscreenPresentRoute", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should render the first song's first slide lyrics without external network requests", () => {
    renderPresent();

    expect(screen.getByText("시작됐네 우리 주님의 능력이")).toBeInTheDocument();
    expect(
      screen.getByText("나의 삶을 다스리고 새롭게 하네"),
    ).toBeInTheDocument();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("should NOT display any numeric navigation buffer text on the audience stage", () => {
    const { container } = renderPresent();

    act(() => {
      dispatchKey("2", "Digit2");
      dispatchKey(".", "Period");
    });

    expect(screen.queryByTestId("nav-buffer-display")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("Buffer: 2.");
  });

  it("should advance to next slide and next song using arrow keys", () => {
    renderPresent();

    expect(screen.getByText("시작됐네 우리 주님의 능력이")).toBeInTheDocument();

    act(() => {
      dispatchKey("ArrowRight");
    });
    expect(screen.getByText("주의 사랑을 주의 선하심을")).toBeInTheDocument();

    act(() => {
      dispatchKey("ArrowRight");
    });
    act(() => {
      dispatchKey("ArrowRight");
    });
    act(() => {
      dispatchKey("ArrowRight");
    });
    expect(screen.getAllByText("은혜로다 주의 은혜").length).toBeGreaterThan(0);

    act(() => {
      dispatchKey("ArrowRight");
    });
    expect(screen.getByText("주 품에 품으소서")).toBeInTheDocument();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("should navigate backwards using ArrowLeft across song boundaries", () => {
    renderPresent();

    act(() => {
      dispatchKey("6", "Digit6");
      dispatchKey("Enter");
    });

    expect(screen.getByText("주 품에 품으소서")).toBeInTheDocument();

    act(() => {
      dispatchKey("ArrowLeft");
    });
    expect(screen.getAllByText("은혜로다 주의 은혜").length).toBeGreaterThan(0);
  });

  it("should toggle blackout on 'b' key press", () => {
    renderPresent();

    const overlay = screen.getByTestId("overlay-layer");
    expect(overlay).toHaveStyle({ opacity: 0.4 });

    act(() => {
      dispatchKey("b", "KeyB");
    });
    expect(overlay).toHaveStyle({ opacity: 1 });

    act(() => {
      dispatchKey("b", "KeyB");
    });
    expect(overlay).toHaveStyle({ opacity: 0.4 });
  });

  it("should toggle lyrics hide on 'h' key press", () => {
    renderPresent();

    const textLayer = screen.getByTestId("text-layer-container");
    expect(textLayer).toHaveStyle({ opacity: 1 });

    act(() => {
      dispatchKey("h", "KeyH");
    });
    expect(textLayer).toHaveStyle({ opacity: 0 });

    act(() => {
      dispatchKey("h", "KeyH");
    });
    expect(textLayer).toHaveStyle({ opacity: 1 });
  });

  it("should jump to a slide by its presentation-wide number via numeric keypad shortcuts", () => {
    renderPresent();

    act(() => {
      dispatchKey("1", "Digit1");
      dispatchKey("7", "Digit7");
      dispatchKey("Enter");
    });

    expect(
      screen.getByText("꽃들도 구름도 바람도 넓은 바다도"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("은혜의 주 은혜의 주 은혜의 주"),
    ).toBeInTheDocument();
  });

  it("should attempt auto-fullscreen on mount with navigationUI: 'hide' and contain zero windowed banners", async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: requestFullscreenMock,
      configurable: true,
      writable: true,
    });

    renderPresent();

    expect(requestFullscreenMock).toHaveBeenCalledWith(
      expect.objectContaining({ navigationUI: "hide" }),
    );

    expect(screen.queryByTestId("fullscreen-prompt-banner")).toBeNull();
    expect(screen.queryByTestId("fullscreen-toggle-btn")).toBeNull();
    expect(screen.getByTestId("exit-present-btn")).toBeInTheDocument();
  });

  it("should exit presentation and trigger exitFullscreen when exit button is clicked", async () => {
    const exitFullscreenMock = vi.fn().mockResolvedValue(undefined);
    const mockDiv = document.createElement("div");
    Object.defineProperty(document, "fullscreenElement", {
      value: mockDiv,
      configurable: true,
    });
    Object.defineProperty(document, "exitFullscreen", {
      value: exitFullscreenMock,
      configurable: true,
      writable: true,
    });

    renderPresent();

    const exitBtn = screen.getByTestId("exit-present-btn");
    await act(async () => {
      fireEvent.click(exitBtn);
    });

    expect(exitFullscreenMock).toHaveBeenCalled();
  });

  it("should automatically exit presentation when fullscreen is exited via fullscreenchange event (Esc)", async () => {
    const mockDiv = document.createElement("div");
    Object.defineProperty(document, "fullscreenElement", {
      value: mockDiv,
      configurable: true,
    });

    renderPresent();

    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
  });

  it("should supply motion background video URL and preload next song video", () => {
    renderPresent();

    const videoSlotA = screen.getByTestId("video-slot-a");
    expect(videoSlotA).toHaveAttribute(
      "src",
      "/api/media/loops/warm_light_flow.mp4",
    );

    const preloadVideo = screen.getByTestId("video-preload");
    expect(preloadVideo).toHaveAttribute(
      "src",
      "/api/media/loops/calm_lake_waves.mp4",
    );
  });

  it("존재하지 않는 presentationId 는 /presentations 로 리다이렉트된다", () => {
    renderPresent("/present/999999999999999999999/fullscreen");

    expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
    expect(
      screen.queryByTestId("fullscreen-present-route"),
    ).not.toBeInTheDocument();
  });

  it("URL의 문서를 송출한다 (활성 문서가 아니라)", () => {
    renderPresent(`/present/${SEED_PRESENTATION_IDS[1]}/fullscreen`);

    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();
    expect(
      screen.queryByText("시작됐네 우리 주님의 능력이"),
    ).not.toBeInTheDocument();
  });
});
