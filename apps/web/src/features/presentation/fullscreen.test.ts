import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  enterFullscreen,
  exitFullscreen,
  launchPresentation,
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
    it("should enter fullscreen and navigate to target path", async () => {
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

      await launchPresentation(navigateMock);

      expect(requestFullscreenMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith("/present/fullscreen");
    });
  });
});
