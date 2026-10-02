import React from "react";
import { signInAsTestUser } from "../test/sessionFixture";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BrowserRouter,
  MemoryRouter,
  Routes,
  Route,
  useNavigationType,
} from "react-router-dom";
import type { Presentation } from "#shared";
import { FullscreenPresentRoute } from "./FullscreenPresentRoute";

import {
  __loadDocumentsForTests,
  applyServerDocuments,
  removePresentationsLocally,
  resetPresentationStore,
} from "../features/presentation/presentationStore";
import { loadProjectionResume } from "../features/presentation/projectionResume";
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../features/backgrounds/backgroundCatalog";
import {
  makeBackground,
  TEST_SERVICE_BACKGROUNDS,
  withBackgrounds,
} from "../test/backgroundFixture";
import { resetFakeCacheStorage } from "../test/fakeCacheStorage";
import { __resetMediaCachingForTests } from "../lib/offline/mediaCache";
import { MEDIA_CACHE_NAME } from "#shared";
import {
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
} from "../test/presentationFixture";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function LandingStub({ testId }: { testId: string }): React.JSX.Element {
  return <div data-testid={testId} data-navigation={useNavigationType()} />;
}

function withItems(
  presentation: Presentation,
  items: Presentation["items"],
): Presentation[] {
  return [
    { ...presentation, items },
    ...SEED_PRESENTATIONS.filter((doc) => doc.id !== presentation.id),
  ];
}

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
          element={<LandingStub testId="presentations-stub" />}
        />
        <Route
          path="/presentations/folders/:folderId"
          element={<LandingStub testId="folder-stub" />}
        />
        <Route
          path="/editor/:presentationId"
          element={<LandingStub testId="editor-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function storeMedia(...urls: string[]): Promise<void> {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  for (const url of urls) await cache.put(url, new Response("media"));
}

function mockMediaFetch(status = 200): void {
  vi.mocked(globalThis.fetch).mockImplementation(
    async () =>
      new Response(status === 200 ? "media" : null, {
        status,
        headers: { "content-length": "5" },
      }),
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
    window.sessionStorage.clear();
    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });
    resetFakeCacheStorage();
    __resetMediaCachingForTests();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.spyOn(globalThis, "fetch");
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockReturnValue();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("글꼴이 준비될 때까지 첫 슬라이드 가사를 숨긴다", async () => {
    renderPresent();

    const textLayer = screen.getByTestId("text-layer-container");
    expect(textLayer).toHaveStyle({ opacity: 0 });

    await waitFor(() => expect(textLayer).toHaveStyle({ opacity: 1 }));
  });

  it("should toggle lyrics hide on 'h' key press", async () => {
    renderPresent();

    const textLayer = screen.getByTestId("text-layer-container");
    await waitFor(() => expect(textLayer).toHaveStyle({ opacity: 1 }));

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

  it("전체화면이 풀려도 송출과 위치를 이어 가고, 다음 키 입력에서 전체화면을 다시 요청한다", async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value: requestFullscreenMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "fullscreenElement", {
      value: document.createElement("div"),
      configurable: true,
    });

    renderPresent(`/present/${DOC_ID}/fullscreen`, {
      returnTo: `/editor/${DOC_ID}`,
    });
    act(() => dispatchKey("ArrowRight"));

    Object.defineProperty(document, "fullscreenElement", {
      value: null,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();
    expect(screen.getByText("주의 사랑을 주의 선하심을")).toBeInTheDocument();
    expect(requestFullscreenMock).not.toHaveBeenCalled();

    act(() => dispatchKey("ArrowRight"));

    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("은혜로다 주의 은혜").length).toBeGreaterThan(0);

    await act(async () => {
      dispatchKey("Escape");
    });

    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("editor-stub")).toBeInTheDocument();
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

    expect(await screen.findByTestId("editor-stub")).toBeInTheDocument();
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

      expect(await screen.findByTestId("editor-stub")).toBeInTheDocument();
    });

    it("편집기에서 시작한 송출은 Esc로 편집기에 돌아간다", async () => {
      renderPresent(`/present/${DOC_ID}/fullscreen`, {
        returnTo: `/editor/${DOC_ID}`,
      });

      await act(async () => {
        dispatchKey("Escape");
      });

      expect(await screen.findByTestId("editor-stub")).toBeInTheDocument();
    });

    it("종료는 한 번만 일어나고, 송출 주소를 history에 남기지 않는다", async () => {
      renderPresent(`/present/${DOC_ID}/fullscreen`, {
        returnTo: `/editor/${DOC_ID}`,
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
        dispatchKey("Escape");
      });

      const editor = await screen.findByTestId("editor-stub");
      expect(editor).toHaveAttribute("data-navigation", "REPLACE");
      expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    });

    it("드라이브 폴더에서 시작한 송출은 그 폴더로 돌아간다", async () => {
      renderPresent(`/present/${DOC_ID}/fullscreen`, {
        returnTo: "/presentations/folders/f1",
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
      });

      expect(await screen.findByTestId("folder-stub")).toBeInTheDocument();
    });

    it("출발 화면을 모르면(주소 직접 진입) 드라이브로 돌아간다", async () => {
      renderPresent();

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
      });

      expect(
        await screen.findByTestId("presentations-stub"),
      ).toBeInTheDocument();
    });
  });

  describe("뒤로 가기", () => {
    it("뒤로 가기를 해도 송출 화면과 위치가 그대로다", () => {
      renderPresent();
      act(() => dispatchKey("ArrowRight"));
      const pushState = vi.spyOn(window.history, "pushState");

      act(() => {
        window.history.replaceState(null, "");
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      });

      expect(pushState).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId("fullscreen-present-route"),
      ).toBeInTheDocument();
      expect(screen.getByText("주의 사랑을 주의 선하심을")).toBeInTheDocument();
    });

    it("송출 중에는 가로 스와이프 뒤로 가기를 막고, 끝나면 되돌린다", async () => {
      renderPresent();
      const root = document.documentElement;

      expect(root.style.overscrollBehaviorX).toBe("none");

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
      });
      await screen.findByTestId("presentations-stub");

      expect(root.style.overscrollBehaviorX).toBe("");
    });
  });

  describe("브라우저 history", () => {
    const EDITOR_PATH = `/editor/${DOC_ID}`;

    function renderInBrowser() {
      window.history.replaceState({ idx: 0, key: "start" }, "", EDITOR_PATH);
      window.history.pushState(
        { usr: { returnTo: EDITOR_PATH }, idx: 1, key: "present" },
        "",
        `/present/${DOC_ID}/fullscreen`,
      );
      return render(
        <BrowserRouter>
          <Routes>
            <Route
              path="/present/:presentationId/fullscreen"
              element={<FullscreenPresentRoute />}
            />
            <Route
              path="/editor/:presentationId"
              element={<LandingStub testId="editor-stub" />}
            />
          </Routes>
        </BrowserRouter>,
      );
    }

    function backAndWait(): Promise<void> {
      return act(
        () =>
          new Promise<void>((resolve) => {
            window.addEventListener("popstate", () => resolve(), {
              once: true,
            });
            window.history.back();
          }),
      );
    }

    it("뒤로 가기로 보초 항목을 걷어도 같은 송출 화면과 슬라이드가 그대로다", async () => {
      renderInBrowser();
      act(() => dispatchKey("ArrowRight"));
      const stage = screen.getByTestId("fullscreen-present-route");

      await backAndWait();

      expect(window.location.pathname).toBe(`/present/${DOC_ID}/fullscreen`);
      expect(screen.getByTestId("fullscreen-present-route")).toBe(stage);
      expect(screen.getByText("주의 사랑을 주의 선하심을")).toBeInTheDocument();
    });

    it("종료하면 출발 화면으로 가고, 뒤로 가기로 송출이 다시 열리지 않는다", async () => {
      renderInBrowser();

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
      });
      await screen.findByTestId("editor-stub");
      expect(window.location.pathname).toBe(EDITOR_PATH);

      await backAndWait();

      expect(window.location.pathname).not.toBe(
        `/present/${DOC_ID}/fullscreen`,
      );
      expect(
        screen.queryByTestId("fullscreen-present-route"),
      ).not.toBeInTheDocument();
    });
  });

  describe("새로고침 뒤 이어 보기", () => {
    it("다시 마운트되면 보던 위치·블랙아웃을 이어 간다", () => {
      const first = renderPresent();
      act(() => {
        dispatchKey("ArrowRight");
        dispatchKey("b", "KeyB");
      });
      first.unmount();

      renderPresent();

      expect(screen.getByText("주의 사랑을 주의 선하심을")).toBeInTheDocument();
      expect(screen.getByTestId("overlay-layer")).toHaveStyle({ opacity: 1 });
    });

    it("송출을 끝내면 저장한 위치를 지운다", async () => {
      renderPresent();
      act(() => dispatchKey("ArrowRight"));
      expect(loadProjectionResume(DOC_ID)).not.toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-present-btn"));
      });
      await screen.findByTestId("presentations-stub");

      expect(loadProjectionResume(DOC_ID)).toBeNull();
    });
  });

  describe("송출 중 데이터 변경", () => {
    it("곡 순서가 바뀌어도 보던 곡의 같은 슬라이드를 계속 띄운다", () => {
      renderPresent();
      act(() => {
        dispatchKey("6", "Digit6");
        dispatchKey("Enter");
      });
      expect(screen.getByText("주 품에 품으소서")).toBeInTheDocument();

      act(() => {
        applyServerDocuments(
          withItems(
            SEED_PRESENTATIONS[0],
            [...SEED_PRESENTATIONS[0].items].reverse(),
          ),
        );
      });

      expect(screen.getByText("주 품에 품으소서")).toBeInTheDocument();
    });

    it("넘기기 전에 곡 순서가 바뀌어도 첫 곡의 첫 슬라이드를 계속 띄운다", () => {
      renderPresent();
      expect(
        screen.getByText("시작됐네 우리 주님의 능력이"),
      ).toBeInTheDocument();

      act(() => {
        applyServerDocuments(
          withItems(
            SEED_PRESENTATIONS[0],
            [...SEED_PRESENTATIONS[0].items].reverse(),
          ),
        );
      });

      expect(
        screen.getByText("시작됐네 우리 주님의 능력이"),
      ).toBeInTheDocument();
    });

    it("보던 곡의 슬라이드가 줄면 남은 마지막 슬라이드를 띄운다", () => {
      renderPresent();
      act(() => {
        dispatchKey("5", "Digit5");
        dispatchKey("Enter");
      });

      const [firstSong, ...rest] = SEED_PRESENTATIONS[0].items;
      const deck = firstSong.deck;
      if (!deck) throw new Error("fixture song has no deck");
      act(() => {
        applyServerDocuments(
          withItems(SEED_PRESENTATIONS[0], [
            {
              ...firstSong,
              deck: { ...deck, slides: deck.slides.slice(0, 2) },
            },
            ...rest,
          ]),
        );
      });

      expect(screen.getByText("주의 사랑을 주의 선하심을")).toBeInTheDocument();
    });

    it("프레젠테이션이 사라져도 마지막으로 받은 내용으로 송출을 이어 간다", async () => {
      renderPresent();
      act(() => dispatchKey("ArrowRight"));

      await act(async () => {
        await removePresentationsLocally([DOC_ID]);
      });

      expect(
        screen.getByTestId("fullscreen-present-route"),
      ).toBeInTheDocument();
      expect(screen.getByText("주의 사랑을 주의 선하심을")).toBeInTheDocument();
    });
  });

  describe("커서와 종료 버튼", () => {
    function movePointer(x: number, y: number): void {
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: x, clientY: y }),
      );
    }

    it("마우스를 움직일 때만 커서와 종료 버튼을 보이고, 멈추면 숨긴다", () => {
      vi.useFakeTimers();
      renderPresent();
      const root = screen.getByTestId("fullscreen-present-route");
      const chip = screen.getByTestId("exit-present-chip");

      expect(root).toHaveClass("cursor-none");
      expect(chip).toHaveClass("opacity-0", "pointer-events-none");

      act(() => movePointer(10, 10));
      expect(root).not.toHaveClass("cursor-none");
      expect(chip).toHaveClass("opacity-100");

      act(() => vi.advanceTimersByTime(2500));
      expect(root).toHaveClass("cursor-none");
      expect(chip).toHaveClass("opacity-0");

      act(() => movePointer(10, 10));
      expect(root).toHaveClass("cursor-none");
    });

    it("오른쪽 클릭 메뉴를 띄우지 않는다", () => {
      renderPresent();

      const notPrevented = fireEvent.contextMenu(
        screen.getByTestId("fullscreen-present-route"),
      );

      expect(notPrevented).toBe(false);
    });
  });

  it("지금 곡 영상을 재생하고 다음 곡 영상은 쉬는 슬롯에 미리 싣는다", async () => {
    const [first, second] = TEST_SERVICE_BACKGROUNDS;
    setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS);
    __loadDocumentsForTests([
      withBackgrounds(SEED_PRESENTATIONS[0], [first.id, second.id]),
    ]);
    await storeMedia(first.mediaUrl, second.mediaUrl);
    renderPresent();

    const videoSlotA = await screen.findByTestId("video-slot-a");
    expect(videoSlotA).toHaveAttribute("src", first.mediaUrl);
    expect(videoSlotA).toHaveAttribute("poster", first.posterUrl);

    const videoSlotB = screen.getByTestId("video-slot-b");
    expect(videoSlotB).toHaveAttribute("src", second.mediaUrl);
    expect(videoSlotB).toHaveStyle({ opacity: "0" });
  });

  it("이미지 배경 곡은 정지 이미지로 그리고, 앞 곡의 영상을 남기지 않는다", async () => {
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
    await storeMedia(video.mediaUrl, image.mediaUrl);
    renderPresent();
    await screen.findByTestId("video-slot-a");

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

  describe("배경 영상 준비", () => {
    const [first, second] = TEST_SERVICE_BACKGROUNDS;

    beforeEach(() => {
      setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS);
      __loadDocumentsForTests([
        withBackgrounds(SEED_PRESENTATIONS[0], [first.id, second.id]),
      ]);
    });

    it("세트 영상을 모두 저장할 때까지 슬라이드를 띄우지 않고 넘기기도 막는다", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(globalThis.fetch).mockImplementation(async () => {
        await gate;
        return new Response("media", {
          status: 200,
          headers: { "content-length": "5" },
        });
      });
      renderPresent();

      expect(screen.getByTestId("projection-media-gate")).toBeInTheDocument();
      expect(screen.queryByText("시작됐네 우리 주님의 능력이")).toBeNull();
      expect(screen.getByTestId("fullscreen-present-route")).not.toHaveClass(
        "cursor-none",
      );
      expect(screen.getByTestId("exit-present-chip")).toHaveClass(
        "opacity-100",
      );
      act(() => dispatchKey("ArrowRight"));

      await act(async () => release());

      expect(
        await screen.findByText("시작됐네 우리 주님의 능력이"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("projection-media-gate")).toBeNull();
      expect(
        await caches
          .open(MEDIA_CACHE_NAME)
          .then((c) => c.match(first.mediaUrl)),
      ).toBeDefined();
    });

    it("이미 저장된 세트는 곧바로 시작한다", async () => {
      await storeMedia(first.mediaUrl, second.mediaUrl);
      renderPresent();

      expect(
        await screen.findByText("시작됐네 우리 주님의 능력이"),
      ).toBeInTheDocument();
    });

    it("오프라인이라 받을 수 없으면 저장된 배경으로 시작할 수 있다", async () => {
      await storeMedia(first.mediaUrl);
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      renderPresent();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "인터넷에 연결되지 않아",
      );
      expect(screen.getByText("1/2개")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("projection-media-start-saved"));

      expect(
        screen.getByText("시작됐네 우리 주님의 능력이"),
      ).toBeInTheDocument();
    });

    it("연결은 되는데 받지 못해도 다시 시도하거나 저장된 배경으로 시작할 수 있다", async () => {
      mockMediaFetch(500);
      renderPresent();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "배경 영상을 받지 못했어요",
      );
      expect(
        screen.getByTestId("projection-media-start-saved"),
      ).toBeInTheDocument();

      mockMediaFetch();
      fireEvent.click(screen.getByTestId("projection-media-retry"));

      expect(
        await screen.findByText("시작됐네 우리 주님의 능력이"),
      ).toBeInTheDocument();
    });
  });

  it("존재하지 않는 presentationId 는 /presentations 로 리다이렉트된다", () => {
    renderPresent("/present/999999999999999999999/fullscreen");

    expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
    expect(
      screen.queryByTestId("fullscreen-present-route"),
    ).not.toBeInTheDocument();
  });

  it("송출할 프레젠테이션이 없으면 전체화면을 풀고, 송출용 history 항목을 쌓지 않는다", async () => {
    const exitFullscreenMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "fullscreenElement", {
      value: document.createElement("div"),
      configurable: true,
    });
    Object.defineProperty(document, "exitFullscreen", {
      value: exitFullscreenMock,
      configurable: true,
      writable: true,
    });
    const pushState = vi.spyOn(window.history, "pushState");

    renderPresent("/present/999999999999999999999/fullscreen");

    expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
    await waitFor(() => expect(exitFullscreenMock).toHaveBeenCalled());
    expect(pushState).not.toHaveBeenCalled();
    expect(loadProjectionResume("999999999999999999999")).toBeNull();
  });

  it("URL의 문서를 송출한다 (활성 문서가 아니라)", () => {
    renderPresent(`/present/${SEED_PRESENTATION_IDS[1]}/fullscreen`);

    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();
    expect(
      screen.queryByText("시작됐네 우리 주님의 능력이"),
    ).not.toBeInTheDocument();
  });
});
