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
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../features/backgrounds/backgroundCatalog";
import {
  makeBackground,
  TEST_SERVICE_BACKGROUNDS,
  withBackgrounds,
} from "../test/backgroundFixture";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function renderPresent(
  path = `/present/${DOC_ID}/fullscreen`,
  state?: unknown,
) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route
          path="/present/:presentationId/fullscreen"
          element={<FullscreenPresentRoute />}
        />
        <Route
          path="/presentations"
          element={<div data-testid="presentations-stub" />}
        />
        <Route
          path="/presentations/folders/:folderId"
          element={<div data-testid="folder-stub" />}
        />
        <Route
          path="/editor/:presentationId"
          element={<div data-testid="editor-stub" />}
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
    resetBackgroundCatalogForTests();
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

  it("전체화면을 쓸 수 없는 브라우저에서도 창 안에서 송출하고 Esc로 돌아간다", async () => {
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");

    renderPresent(`/present/${DOC_ID}/fullscreen`, {
      returnTo: `/editor/${DOC_ID}`,
    });
    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();

    await act(async () => {
      dispatchKey("Escape");
    });

    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
  });

  describe("송출 종료 후 복귀", () => {
    beforeEach(() => {
      Object.defineProperty(document, "fullscreenElement", {
        value: document.createElement("div"),
        configurable: true,
      });
      Object.defineProperty(document, "exitFullscreen", {
        value: vi.fn().mockResolvedValue(undefined),
        configurable: true,
        writable: true,
      });
    });

    it("편집기에서 시작한 송출은 종료 버튼으로 편집기에 돌아간다", async () => {
      renderPresent(`/present/${DOC_ID}/fullscreen`, {
        returnTo: `/editor/${DOC_ID}`,
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
      });

      expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
    });

    it("편집기에서 시작한 송출은 Esc(전체화면 해제)로 편집기에 돌아간다", async () => {
      renderPresent(`/present/${DOC_ID}/fullscreen`, {
        returnTo: `/editor/${DOC_ID}`,
      });

      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
      });
      await act(async () => {
        document.dispatchEvent(new Event("fullscreenchange"));
      });

      expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
    });

    it("드라이브 폴더에서 시작한 송출은 그 폴더로 돌아간다", async () => {
      renderPresent(`/present/${DOC_ID}/fullscreen`, {
        returnTo: "/presentations/folders/f1",
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
      });

      expect(screen.getByTestId("folder-stub")).toBeInTheDocument();
    });

    it("출발 화면을 모르면(주소 직접 진입) 드라이브로 돌아간다", async () => {
      renderPresent();

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
      });

      expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
    });
  });

  it("should supply motion background video URL and preload next song video", () => {
    const [first, second] = TEST_SERVICE_BACKGROUNDS;
    setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS);
    __loadDocumentsForTests([
      withBackgrounds(SEED_PRESENTATIONS[0], [first.id, second.id]),
    ]);
    renderPresent();

    const videoSlotA = screen.getByTestId("video-slot-a");
    expect(videoSlotA).toHaveAttribute("src", first.mediaUrl);
    expect(videoSlotA).toHaveAttribute("poster", first.posterUrl);

    const preloadVideo = screen.getByTestId("video-preload");
    expect(preloadVideo).toHaveAttribute("src", second.mediaUrl);
  });

  it("이미지 배경 곡은 정지 이미지로 그리고, 앞 곡의 영상을 남기지 않는다", () => {
    const video = TEST_SERVICE_BACKGROUNDS[0];
    const image = makeBackground(8, {
      source: "user",
      kind: "image",
      mediaUrl: "/api/media/uploads/u/8.png",
      posterUrl: "/api/media/uploads/u/8.png",
    });
    setBackgroundCatalogForTests([video, image]);
    const presentation = withBackgrounds(SEED_PRESENTATIONS[0], [
      video.id,
      image.id,
      null,
    ]);
    __loadDocumentsForTests([presentation]);
    renderPresent();

    const firstSongSlides = presentation.items[0].deck?.slides.length ?? 0;
    act(() => {
      for (let i = 0; i < firstSongSlides; i += 1) dispatchKey("ArrowRight");
    });

    expect(screen.getByTestId("image-background-layer")).toHaveAttribute(
      "src",
      image.mediaUrl,
    );
    expect(screen.getByTestId("video-slot-a")).toHaveStyle({ opacity: "0" });
    expect(screen.getByTestId("video-slot-b")).toHaveStyle({ opacity: "0" });
  });

  it("카탈로그에 없는 배경(지워진 커스텀 배경)은 검은 배경으로 송출한다", () => {
    __loadDocumentsForTests([
      withBackgrounds(SEED_PRESENTATIONS[0], ["gone00000000000000001"]),
    ]);
    renderPresent();

    expect(screen.getByTestId("video-slot-a")).not.toHaveAttribute("src");
    expect(screen.queryByTestId("image-background-layer")).toBeNull();
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
