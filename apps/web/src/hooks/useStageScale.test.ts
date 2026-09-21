import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { calculateStageScale, useStageScale } from "./useStageScale";

describe("useStageScale and calculateStageScale", () => {
  describe("calculateStageScale", () => {
    it("should calculate exact 1:1 scale for 1920x1080 resolution", () => {
      const result = calculateStageScale(1920, 1080);
      expect(result.scale).toBe(1);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(0);
      expect(result.stageWidth).toBe(1920);
      expect(result.stageHeight).toBe(1080);
    });

    it("should calculate 2/3 (0.6667) scale for 1280x720 16:9 resolution", () => {
      const result = calculateStageScale(1280, 720);
      expect(result.scale).toBeCloseTo(1280 / 1920, 5);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(0);
    });

    it("should calculate 4/3 (1.3333) scale for 2560x1440 16:9 resolution", () => {
      const result = calculateStageScale(2560, 1440);
      expect(result.scale).toBeCloseTo(2560 / 1920, 5);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(0);
    });

    it("should center with pillarbox (translateX > 0) when width is wider than 16:9", () => {
      // 2000x1080 is wider than 1920x1080
      const result = calculateStageScale(2000, 1080);
      expect(result.scale).toBe(1);
      expect(result.translateX).toBe(40); // (2000 - 1920) / 2
      expect(result.translateY).toBe(0);
    });

    it("should center with letterbox (translateY > 0) when height is taller than 16:9", () => {
      // 1920x1200 is taller than 1920x1080
      const result = calculateStageScale(1920, 1200);
      expect(result.scale).toBe(1);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(60); // (1200 - 1080) / 2
    });

    it("should handle 0 or negative dimensions gracefully", () => {
      const result = calculateStageScale(0, 0);
      expect(result.scale).toBe(1);
      expect(result.translateX).toBe(0);
      expect(result.translateY).toBe(0);
    });
  });

  describe("useStageScale hook", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    beforeEach(() => {
      window.innerWidth = 1920;
      window.innerHeight = 1080;
    });

    afterEach(() => {
      window.innerWidth = originalInnerWidth;
      window.innerHeight = originalInnerHeight;
      vi.restoreAllMocks();
    });

    it("should return initial stage scale based on window dimensions", () => {
      const { result } = renderHook(() => useStageScale());
      expect(result.current.scale).toBe(1);
      expect(result.current.translateX).toBe(0);
      expect(result.current.translateY).toBe(0);
    });

    it("should update scale when window resize event fires", () => {
      const { result } = renderHook(() => useStageScale());

      act(() => {
        window.innerWidth = 1280;
        window.innerHeight = 720;
        window.dispatchEvent(new Event("resize"));
      });

      expect(result.current.scale).toBeCloseTo(1280 / 1920, 5);
      expect(result.current.translateX).toBe(0);
      expect(result.current.translateY).toBe(0);
    });

    it("should accept custom container dimensions override", () => {
      const { result } = renderHook(() =>
        useStageScale({ width: 960, height: 540 }),
      );

      expect(result.current.scale).toBe(0.5);
      expect(result.current.translateX).toBe(0);
      expect(result.current.translateY).toBe(0);
    });
  });
});
