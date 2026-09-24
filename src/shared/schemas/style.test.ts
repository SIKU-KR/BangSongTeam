import { describe, it, expect } from "vitest";
import {
  DeckStyleSchema,
  GridAnchorPresetSchema,
  TextBoxPositionSchema,
} from "./style";

describe("Style Schemas", () => {
  describe("GridAnchorPresetSchema", () => {
    it("accepts valid presets", () => {
      const validPresets = [
        "top-left",
        "top-center",
        "top-right",
        "middle-left",
        "middle-center",
        "middle-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
        "custom",
      ];
      for (const preset of validPresets) {
        expect(GridAnchorPresetSchema.parse(preset)).toBe(preset);
      }
    });

    it("rejects invalid presets", () => {
      expect(() => GridAnchorPresetSchema.parse("invalid")).toThrow();
      expect(() => GridAnchorPresetSchema.parse("top")).toThrow();
    });
  });

  describe("TextBoxPositionSchema", () => {
    it("provides default values", () => {
      const parsed = TextBoxPositionSchema.parse({});
      expect(parsed).toEqual({
        anchor: "middle-center",
        xPercent: 50,
        yPercent: 50,
        widthPercent: 80,
      });
    });

    it("validates ranges (5-95% for coords, 20-90% for width)", () => {
      expect(() => TextBoxPositionSchema.parse({ xPercent: 4 })).toThrow();
      expect(() => TextBoxPositionSchema.parse({ xPercent: 96 })).toThrow();
      expect(() => TextBoxPositionSchema.parse({ yPercent: 4 })).toThrow();
      expect(() => TextBoxPositionSchema.parse({ yPercent: 96 })).toThrow();
      expect(() => TextBoxPositionSchema.parse({ widthPercent: 19 })).toThrow();
      expect(() => TextBoxPositionSchema.parse({ widthPercent: 91 })).toThrow();

      const validCustom = {
        anchor: "custom" as const,
        xPercent: 5,
        yPercent: 95,
        widthPercent: 90,
      };
      expect(TextBoxPositionSchema.parse(validCustom)).toEqual(validCustom);
    });
  });

  describe("DeckStyleSchema", () => {
    it("returns exact defaults when parsing empty object", () => {
      const parsed = DeckStyleSchema.parse({});
      expect(parsed).toEqual({
        overlayOpacity: 40,
        overlayColor: "#000000",
        fontFamily: "Pretendard",
        fontSizeVw: 4.2,
        fontColor: "#FFFFFF",
        textAlign: "center",
        lineHeight: 1.4,
        textShadowLevel: "medium",
        position: {
          anchor: "middle-center",
          xPercent: 50,
          yPercent: 50,
          widthPercent: 80,
        },
      });
    });

    it("validates overlay opacity range 0-100", () => {
      expect(() => DeckStyleSchema.parse({ overlayOpacity: -1 })).toThrow();
      expect(() => DeckStyleSchema.parse({ overlayOpacity: 101 })).toThrow();
      expect(DeckStyleSchema.parse({ overlayOpacity: 0 }).overlayOpacity).toBe(
        0,
      );
      expect(
        DeckStyleSchema.parse({ overlayOpacity: 100 }).overlayOpacity,
      ).toBe(100);
    });

    it("validates color hex formats", () => {
      expect(() => DeckStyleSchema.parse({ overlayColor: "black" })).toThrow();
      expect(() =>
        DeckStyleSchema.parse({ fontColor: "rgb(0,0,0)" }),
      ).toThrow();
      expect(
        DeckStyleSchema.parse({ overlayColor: "#123456" }).overlayColor,
      ).toBe("#123456");
      expect(DeckStyleSchema.parse({ fontColor: "#fff" }).fontColor).toBe(
        "#fff",
      );
    });

    it("validates font family enum", () => {
      const allowed = [
        "Pretendard",
        "Noto Sans KR",
        "Nanum Myeongjo",
        "Gmarket Sans",
        "KoPubWorld Batang",
      ];
      for (const font of allowed) {
        expect(DeckStyleSchema.parse({ fontFamily: font }).fontFamily).toBe(
          font,
        );
      }
      expect(() => DeckStyleSchema.parse({ fontFamily: "Arial" })).toThrow();
    });

    it("validates fontSizeVw range 2-10", () => {
      expect(() => DeckStyleSchema.parse({ fontSizeVw: 1.9 })).toThrow();
      expect(() => DeckStyleSchema.parse({ fontSizeVw: 10.1 })).toThrow();
      expect(DeckStyleSchema.parse({ fontSizeVw: 2 }).fontSizeVw).toBe(2);
      expect(DeckStyleSchema.parse({ fontSizeVw: 10 }).fontSizeVw).toBe(10);
    });
  });
});
