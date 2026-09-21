import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { FullscreenPresentRoute } from "./FullscreenPresentRoute";

import { resetActiveSetlist } from "../features/presentation";

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
    resetActiveSetlist();
    vi.spyOn(globalThis, "fetch");
  });


  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should render the first song's first slide lyrics without external network requests", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    // Song 1 (은혜로다) Slide 1 lyrics
    expect(screen.getByText("시작됐네 우리 주님의 능력이")).toBeInTheDocument();
    expect(screen.getByText("나의 삶을 다스리고 새롭게 하네")).toBeInTheDocument();

    // Zero-Fetch Invariant: in-memory mock data requires 0 network requests
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("should NOT display any numeric navigation buffer text on the audience stage", () => {
    const { container } = render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    // Type digits into the buffer
    act(() => {
      dispatchKey("2", "Digit2");
      dispatchKey(".", "Period");
    });

    // The audience view should not display buffer elements or text "2."
    expect(screen.queryByTestId("nav-buffer-display")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("Buffer: 2.");
  });

  it("should advance to next slide and next song using arrow keys", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    // Slide 1 of Song 1
    expect(screen.getByText("시작됐네 우리 주님의 능력이")).toBeInTheDocument();

    // Advance to Slide 2
    act(() => {
      dispatchKey("ArrowRight");
    });
    expect(screen.getByText("주의 사랑을 주의 선하심을")).toBeInTheDocument();

    // Advance through remaining slides of Song 1 (Song 1 has 5 slides)
    // Slide 3
    act(() => {
      dispatchKey("ArrowRight");
    });
    // Slide 4
    act(() => {
      dispatchKey("ArrowRight");
    });
    // Slide 5
    act(() => {
      dispatchKey("ArrowRight");
    });
    expect(screen.getAllByText("은혜로다 주의 은혜").length).toBeGreaterThan(0);

    // Advance across boundary to Song 2 Slide 1 (주 품에)
    act(() => {
      dispatchKey("ArrowRight");
    });
    expect(screen.getByText("주 품에 품으소서")).toBeInTheDocument();

    // Zero-Fetch Invariant
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("should navigate backwards using ArrowLeft across song boundaries", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    // Jump to Song 2 (주 품에) Slide 1: "2" then "." then "Enter"
    act(() => {
      dispatchKey("2", "Digit2");
      dispatchKey(".", "Period");
      dispatchKey("Enter");
    });

    expect(screen.getByText("주 품에 품으소서")).toBeInTheDocument();

    // Navigate back to Song 1's last slide
    act(() => {
      dispatchKey("ArrowLeft");
    });
    expect(screen.getAllByText("은혜로다 주의 은혜").length).toBeGreaterThan(0);
  });

  it("should toggle blackout on 'b' key press", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    const overlay = screen.getByTestId("overlay-layer");
    expect(overlay).toHaveStyle({ opacity: 0.4 });

    // Press 'b' to blackout
    act(() => {
      dispatchKey("b", "KeyB");
    });
    expect(overlay).toHaveStyle({ opacity: 1 });

    // Press 'b' again to restore
    act(() => {
      dispatchKey("b", "KeyB");
    });
    expect(overlay).toHaveStyle({ opacity: 0.4 });
  });

  it("should toggle lyrics hide on 'h' key press", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    const textLayer = screen.getByTestId("text-layer-container");
    expect(textLayer).toHaveStyle({ opacity: 1 });

    // Press 'h' to hide lyrics
    act(() => {
      dispatchKey("h", "KeyH");
    });
    expect(textLayer).toHaveStyle({ opacity: 0 });

    // Press 'h' again to show lyrics
    act(() => {
      dispatchKey("h", "KeyH");
    });
    expect(textLayer).toHaveStyle({ opacity: 1 });
  });

  it("should jump to specific song and slide via numeric keypad shortcuts", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    // Jump to Song 4, Slide 3 (꽃들도): "4.3 Enter"
    act(() => {
      dispatchKey("4", "Digit4");
      dispatchKey(".", "Period");
      dispatchKey("3", "Digit3");
      dispatchKey("Enter");
    });

    expect(screen.getByText("꽃들도 구름도 바람도 넓은 바다도")).toBeInTheDocument();
    expect(screen.getByText("은혜의 주 은혜의 주 은혜의 주")).toBeInTheDocument();
  });

  it("should trigger Fullscreen API when fullscreen button is clicked", async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: requestFullscreenMock,
      configurable: true,
      writable: true,
    });

    render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    const fullscreenBtn = screen.getByTestId("fullscreen-toggle-btn");
    await act(async () => {
      fireEvent.click(fullscreenBtn);
    });

    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it("should supply motion background video URL and preload next song video", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentRoute />
      </MemoryRouter>,
    );

    // Initial Song 1 (은혜로다) background should be warm_light_flow.mp4
    const videoSlotA = screen.getByTestId("video-slot-a");
    expect(videoSlotA).toHaveAttribute(
      "src",
      "/api/media/loops/warm_light_flow.mp4",
    );

    // Next Song 2 (주 품에) background should be preloaded as calm_lake_waves.mp4
    const preloadVideo = screen.getByTestId("video-preload");
    expect(preloadVideo).toHaveAttribute(
      "src",
      "/api/media/loops/calm_lake_waves.mp4",
    );
  });
});

