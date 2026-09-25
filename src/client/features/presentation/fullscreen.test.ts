import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  enterFullscreen,
  exitFullscreen,
  launchPresentation,
  resolvePresentReturnPath,
} from "./fullscreen";

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
      expect(navigateMock).toHaveBeenCalledWith(
        "/present/pres-123/fullscreen",
        {
          state: { returnTo: "/editor/pres-123" },
        },
      );
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
  });

  describe("resolvePresentReturnPath", () => {
    it("state의 앱 내부 경로를 그대로 돌려준다", () => {
      expect(resolvePresentReturnPath({ returnTo: "/editor/abc" })).toBe(
        "/editor/abc",
      );
      expect(
        resolvePresentReturnPath({ returnTo: "/presentations/folders/f1" }),
      ).toBe("/presentations/folders/f1");
    });

    it.each([
      null,
      undefined,
      "/editor/abc",
      {},
      { returnTo: 42 },
      { returnTo: "" },
      { returnTo: "editor/abc" },
      { returnTo: "//evil.example" },
      { returnTo: "https://evil.example" },
    ])("복귀 경로가 없거나 잘못되면 드라이브로 돌아간다 (%j)", (state) => {
      expect(resolvePresentReturnPath(state)).toBe("/presentations");
    });
  });
});
