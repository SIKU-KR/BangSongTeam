import { describe, it, expect } from "vitest";
import {
  SUPPORTED_FONTS,
  GRID_ANCHOR_TRANSFORMS,
  TEXT_SHADOW_PRESETS,
  DEFAULT_DECK_STYLE,
  PRESENTATION_SHORTCUTS,
} from "./index";
import { DeckStyleSchema } from "../schemas/style";

describe("Constants", () => {
  it("DEFAULT_DECK_STYLE conforms to DeckStyleSchema", () => {
    const parsed = DeckStyleSchema.parse(DEFAULT_DECK_STYLE);
    expect(parsed).toEqual(DEFAULT_DECK_STYLE);
  });

  it("covers all 9 grid presets with an anchor transform", () => {
    const presets = [
      "top-left",
      "top-center",
      "top-right",
      "middle-left",
      "middle-center",
      "middle-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ] as const;

    for (const preset of presets) {
      expect(GRID_ANCHOR_TRANSFORMS[preset]).toBeDefined();
    }
  });

  it("provides all 4 text shadow levels", () => {
    expect(TEXT_SHADOW_PRESETS.none).toBe("none");
    expect(TEXT_SHADOW_PRESETS.soft).toBeDefined();
    expect(TEXT_SHADOW_PRESETS.medium).toBeDefined();
    expect(TEXT_SHADOW_PRESETS.strong).toBeDefined();
  });

  it("provides supported font list matching schema enum", () => {
    expect(SUPPORTED_FONTS).toContain("Pretendard");
    expect(SUPPORTED_FONTS).toContain("Noto Sans KR");
    expect(SUPPORTED_FONTS).toContain("Nanum Myeongjo");
    expect(SUPPORTED_FONTS).toContain("Gmarket Sans");
    expect(SUPPORTED_FONTS).toContain("KoPubWorld Batang");
  });

  it("defines the navigation buffer timeout", () => {
    expect(PRESENTATION_SHORTCUTS.BUFFER_CLEAR_TIMEOUT_MS).toBe(3000);
  });
});
