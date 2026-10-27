import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  enterFullscreen,
  exitFullscreen,
  isProjecting,
  isProjectionPath,
  launchPresentation,
  loadPresentReturnPath,
  resolvePresentReturnPath,
} from "./fullscreen";
import { loadProjectionResume, saveProjectionResume } from "./projectionResume";

describe("fullscreen utilities", () => {
  const originalFullscreenElement = Object.getOwnPropertyDescriptor(
    document,
    "fullscreenElement",
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalFullscreenElement) {
      Object.defineProperty(
        document,
        "fullscreenElement",
        originalFullscreenElement,
      );
    }
  });

  describe("enterFullscreen", () => {
    it("should call requestFullscreen with navigationUI: 'hide'", async () => {
      const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
      });
      Object.defineProperty(document.documentElement, "requestFullscreen", {
        value: requestFullscreenMock,
        configurable: true,
        writable: true,
      });

      const result = await enterFullscreen();

      expect(result).toBe(true);
      expect(requestFullscreenMock).toHaveBeenCalledWith(
        expect.objectContaining({ navigationUI: "hide" }),
      );
    });

    it("should return true immediately if already in fullscreen", async () => {
      const mockElement = document.createElement("div");
      Object.defineProperty(document, "fullscreenElement", {
        value: mockElement,
        configurable: true,
      });
      const requestFullscreenMock = vi.fn();
      Object.defineProperty(document.documentElement, "requestFullscreen", {
        value: requestFullscreenMock,
        configurable: true,
      });

      const result = await enterFullscreen();

      expect(result).toBe(true);
      expect(requestFullscreenMock).not.toHaveBeenCalled();
    });

    it("should gracefully handle requestFullscreen rejection without throwing", async () => {
      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
      });
      const requestFullscreenMock = vi
        .fn()
        .mockRejectedValue(new Error("User gesture required"));
      Object.defineProperty(document.documentElement, "requestFullscreen", {
        value: requestFullscreenMock,
        configurable: true,
        writable: true,
      });

      const result = await enterFullscreen();

      expect(result).toBe(false);
    });
  });

  describe("exitFullscreen", () => {
    it("should call document.exitFullscreen when in fullscreen mode", async () => {
      const mockElement = document.createElement("div");
      Object.defineProperty(document, "fullscreenElement", {
        value: mockElement,
        configurable: true,
      });
      const exitFullscreenMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, "exitFullscreen", {
        value: exitFullscreenMock,
        configurable: true,
        writable: true,
      });

      const result = await exitFullscreen();

      expect(result).toBe(true);
      expect(exitFullscreenMock).toHaveBeenCalled();
    });

    it("should return true immediately if not in fullscreen mode", async () => {
      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
      });
      const exitFullscreenMock = vi.fn();
      Object.defineProperty(document, "exitFullscreen", {
        value: exitFullscreenMock,
        configurable: true,
      });

      const result = await exitFullscreen();

      expect(result).toBe(true);
      expect(exitFullscreenMock).not.toHaveBeenCalled();
    });
  });

  describe("launchPresentation", () => {
    it("should enter fullscreen and navigate to the presentation's fullscreen path", async () => {
      const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
      });
      Object.defineProperty(document.documentElement, "requestFullscreen", {
        value: requestFullscreenMock,
        configurable: true,
        writable: true,
      });
      const navigateMock = vi.fn();

      launchPresentation(navigateMock, "pres-123", "/editor/pres-123");

      expect(requestFullscreenMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith("/present/pres-123/fullscreen");
      expect(loadPresentReturnPath("pres-123")).toBe("/editor/pres-123");
    });

    it("should request fullscreen before navigating (user activation)", () => {
      const calls: string[] = [];
      Object.defineProperty(document, "fullscreenElement", {
        value: null,
        configurable: true,
      });
      Object.defineProperty(document.documentElement, "requestFullscreen", {
        value: vi.fn(() => {
          calls.push("fullscreen");
          return Promise.resolve();
        }),
        configurable: true,
        writable: true,
      });

      launchPresentation(
        () => calls.push("navigate"),
        "pres-456",
        "/presentations",
      );

      expect(calls).toEqual(["fullscreen", "navigate"]);
    });

    it("새로 시작하는 송출은 지난 송출의 이어 보기 상태를 버린다", () => {
      saveProjectionResume("pres-789", {
        songIndex: 2,
        slideIndex: 1,
        itemId: "item-3",
        hasStarted: true,
        isBlackout: true,
        isLyricsHidden: false,
      });

      launchPresentation(vi.fn(), "pres-789", "/presentations");

      expect(loadProjectionResume("pres-789")).toBeNull();
    });
  });

  describe("isProjectionPath", () => {
    it("송출 화면 주소만 송출로 본다", () => {
      expect(isProjectionPath("/present/abc/fullscreen")).toBe(true);
      expect(isProjectionPath("/present/abc/fullscreen/")).toBe(true);
    });

    it.each([
      "/presentations",
      "/editor/abc",
      "/present/abc",
      "/present//fullscreen",
      "/present/abc/fullscreen/extra",
    ])("다른 주소는 송출이 아니다 (%s)", (pathname) => {
      expect(isProjectionPath(pathname)).toBe(false);
    });
  });

  describe("isProjecting", () => {
    const startPath = window.location.pathname;

    afterEach(() => {
      window.history.pushState({}, "", startPath);
    });

    it("지금 주소가 송출 화면일 때만 송출 중으로 본다", () => {
      window.history.pushState({}, "", "/present/x/fullscreen");
      expect(isProjecting()).toBe(true);

      window.history.pushState({}, "", "/present/x");
      expect(isProjecting()).toBe(false);

      window.history.pushState({}, "", "/editor/x");
      expect(isProjecting()).toBe(false);
    });
  });

  describe("resolvePresentReturnPath", () => {
    it("앱 내부 경로를 그대로 돌려준다", () => {
      expect(resolvePresentReturnPath("/editor/abc")).toBe("/editor/abc");
      expect(resolvePresentReturnPath("/presentations/folders/f1")).toBe(
        "/presentations/folders/f1",
      );
    });

    it.each([
      null,
      undefined,
      42,
      "",
      "editor/abc",
      "//evil.example",
      "https://evil.example",
    ])("복귀 경로가 없거나 잘못되면 드라이브로 돌아간다 (%j)", (returnTo) => {
      expect(resolvePresentReturnPath(returnTo)).toBe("/presentations");
    });

    it("이 탭에서 시작한 송출이 아니면(주소 직접 진입) 드라이브로 돌아간다", () => {
      window.sessionStorage.clear();
      expect(loadPresentReturnPath("never-launched")).toBe("/presentations");
    });
  });
});
