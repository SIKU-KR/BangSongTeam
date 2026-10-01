import { describe, it, expect } from "vitest";
import { DEFAULT_BACKGROUND_COLOR } from "../constants";
import { resolveBackdropColor } from "./deckBackground";

describe("resolveBackdropColor (배경 단색)", () => {
  it("영상·이미지 배경이 없으면 곡의 단색을 깐다", () => {
    expect(resolveBackdropColor("#123456", false)).toBe("#123456");
  });

  it("단색을 고르지 않은 곡은 기본 검정을 깐다", () => {
    expect(resolveBackdropColor(undefined, false)).toBe(
      DEFAULT_BACKGROUND_COLOR,
    );
    expect(resolveBackdropColor(undefined, true)).toBe(
      DEFAULT_BACKGROUND_COLOR,
    );
  });

  it("영상·이미지 배경이 있으면 곡의 단색 대신 기본 검정을 깐다", () => {
    expect(resolveBackdropColor("#123456", true)).toBe(
      DEFAULT_BACKGROUND_COLOR,
    );
  });
});
