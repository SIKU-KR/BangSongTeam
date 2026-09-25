import { describe, it, expect } from "vitest";
import {
  sanitizeLyricLine,
  splitLyricsIntoSlides,
  mergeSlidesToLyrics,
  splitLinesAtCursor,
  mergeSlideLines,
} from "./lyrics";

describe("Lyric Processing Utilities", () => {
  describe("sanitizeLyricLine", () => {
    it("trims regular whitespace", () => {
      expect(sanitizeLyricLine("  은혜로다 주의 은혜   ")).toBe(
        "은혜로다 주의 은혜",
      );
    });

    it("trims unicode special whitespace (full-width space, non-breaking space)", () => {
      const input = "\u3000\u00A0 주의 사랑이 목마름 채우고 \u3000 ";
      expect(sanitizeLyricLine(input)).toBe("주의 사랑이 목마름 채우고");
    });

    it("returns empty string for pure whitespace line", () => {
      expect(sanitizeLyricLine("  \t \u3000 ")).toBe("");
    });
  });

  describe("splitLyricsIntoSlides", () => {
    it("splits lyrics by blank lines into slides when each block <= 4 lines", () => {
      const rawText = `
시작됐네 우리 주님의 능력이
나의 삶을 다스리시네

주의 사랑이 온 땅을 덮고
주의 은혜가 내 맘을 채우네
`;
      const slides = splitLyricsIntoSlides(rawText);
      expect(slides).toHaveLength(2);
      expect(slides[0].order).toBe(0);
      expect(slides[0].lines).toEqual([
        "시작됐네 우리 주님의 능력이",
        "나의 삶을 다스리시네",
      ]);
      expect(slides[0].id).toMatch(/^s_/);

      expect(slides[1].order).toBe(1);
      expect(slides[1].lines).toEqual([
        "주의 사랑이 온 땅을 덮고",
        "주의 은혜가 내 맘을 채우네",
      ]);
      expect(slides[1].id).toMatch(/^s_/);
    });

    it("merges multiple consecutive empty lines between blocks", () => {
      const rawText = `1절 1줄
1절 2줄



2절 1줄
2절 2줄`;
      const slides = splitLyricsIntoSlides(rawText);
      expect(slides).toHaveLength(2);
      expect(slides[0].order).toBe(0);
      expect(slides[1].order).toBe(1);
    });

    it("keeps a 4-line block as a single slide (4 lines is allowed)", () => {
      const rawText = `1줄
2줄
3줄
4줄`;
      const slides = splitLyricsIntoSlides(rawText);
      expect(slides).toHaveLength(1);
      expect(slides[0].lines).toHaveLength(4);
    });

    it("auto-splits blocks exceeding 4 lines into 2-line slides", () => {
      const fiveLines = `1줄
2줄
3줄
4줄
5줄`;
      const slides5 = splitLyricsIntoSlides(fiveLines);
      expect(slides5).toHaveLength(3);
      expect(slides5[0].lines).toEqual(["1줄", "2줄"]);
      expect(slides5[0].order).toBe(0);
      expect(slides5[1].lines).toEqual(["3줄", "4줄"]);
      expect(slides5[1].order).toBe(1);
      expect(slides5[2].lines).toEqual(["5줄"]);
      expect(slides5[2].order).toBe(2);

      const sixLines = `1줄\n2줄\n3줄\n4줄\n5줄\n6줄`;
      const slides6 = splitLyricsIntoSlides(sixLines);
      expect(slides6).toHaveLength(3);
      expect(slides6[0].lines).toEqual(["1줄", "2줄"]);
      expect(slides6[1].lines).toEqual(["3줄", "4줄"]);
      expect(slides6[2].lines).toEqual(["5줄", "6줄"]);

      const eightLines = `L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8`;
      const slides8 = splitLyricsIntoSlides(eightLines);
      expect(slides8).toHaveLength(4);
      expect(slides8.map((s) => s.lines.length)).toEqual([2, 2, 2, 2]);
    });

    it("handles mixed blocks: normal blocks and over-4-line blocks", () => {
      const mixed = `
정상 1줄
정상 2줄

긴블록 1줄
긴블록 2줄
긴블록 3줄
긴블록 4줄
긴블록 5줄

마지막 1줄
`;
      const slides = splitLyricsIntoSlides(mixed);
      expect(slides).toHaveLength(5);
      expect(slides.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
      expect(slides[0].lines).toEqual(["정상 1줄", "정상 2줄"]);
      expect(slides[1].lines).toEqual(["긴블록 1줄", "긴블록 2줄"]);
      expect(slides[2].lines).toEqual(["긴블록 3줄", "긴블록 4줄"]);
      expect(slides[3].lines).toEqual(["긴블록 5줄"]);
      expect(slides[4].lines).toEqual(["마지막 1줄"]);
    });

    it("returns empty array for empty or whitespace-only text", () => {
      expect(splitLyricsIntoSlides("")).toEqual([]);
      expect(splitLyricsIntoSlides("   \n\n\t  \n  ")).toEqual([]);
    });

    it("generates unique IDs for each slide", () => {
      const rawText = `L1\nL2\n\nL3\nL4\n\nL5\nL6`;
      const slides = splitLyricsIntoSlides(rawText);
      const ids = new Set(slides.map((s) => s.id));
      expect(ids.size).toBe(slides.length);
    });
  });

  describe("mergeSlidesToLyrics", () => {
    it("merges slides into raw lyrics text with blank line separation", () => {
      const slides = [
        {
          id: "s_1",
          order: 0,
          lines: ["1절 첫째줄", "1절 둘째줄"],
        },
        {
          id: "s_2",
          order: 1,
          lines: ["2절 첫째줄", "2절 둘째줄"],
        },
      ];
      const merged = mergeSlidesToLyrics(slides);
      expect(merged).toBe("1절 첫째줄\n1절 둘째줄\n\n2절 첫째줄\n2절 둘째줄");
    });

    it("handles empty slides array", () => {
      expect(mergeSlidesToLyrics([])).toBe("");
    });

    it("respects slide order even if input array is out of order", () => {
      const slides = [
        { id: "s_2", order: 1, lines: ["2절"] },
        { id: "s_1", order: 0, lines: ["1절"] },
      ];
      expect(mergeSlidesToLyrics(slides)).toBe("1절\n\n2절");
    });
  });

  describe("splitLinesAtCursor", () => {
    const lines = ["첫째 줄", "둘째 줄", "셋째 줄"];

    it("줄 경계의 커서에서 앞뒤 줄로 나눈다", () => {
      const offset = "첫째 줄\n".length;
      expect(splitLinesAtCursor(lines, offset)).toEqual([
        ["첫째 줄"],
        ["둘째 줄", "셋째 줄"],
      ]);
    });

    it("줄 끝의 커서는 그 줄까지를 앞 슬라이드에 둔다", () => {
      const offset = "첫째 줄\n둘째 줄".length;
      expect(splitLinesAtCursor(lines, offset)).toEqual([
        ["첫째 줄", "둘째 줄"],
        ["셋째 줄"],
      ]);
    });

    it("줄 중간의 커서는 그 줄을 쪼개고 경계의 공백을 지운다", () => {
      const offset = "첫째 줄\n둘째".length;
      expect(splitLinesAtCursor(lines, offset)).toEqual([
        ["첫째 줄", "둘째"],
        ["줄", "셋째 줄"],
      ]);
    });

    it("경계에 생긴 빈 줄을 버린다", () => {
      const withBlank = ["첫째 줄", "", "\u3000", "둘째 줄"];
      const offset = "첫째 줄\n\n".length;
      expect(splitLinesAtCursor(withBlank, offset)).toEqual([
        ["첫째 줄"],
        ["둘째 줄"],
      ]);
    });

    it("커서가 맨 앞·맨 끝이거나 한쪽에 공백만 남으면 null", () => {
      const text = lines.join("\n");
      expect(splitLinesAtCursor(lines, 0)).toBeNull();
      expect(splitLinesAtCursor(lines, text.length)).toBeNull();
      expect(
        splitLinesAtCursor(["  가사", "  "], "  가사\n ".length),
      ).toBeNull();
      expect(splitLinesAtCursor(["  가사"], 1)).toBeNull();
    });
  });

  describe("mergeSlideLines", () => {
    it("두 슬라이드의 줄을 순서대로 이어 붙인다", () => {
      expect(mergeSlideLines(["가", "나"], ["다", "라"])).toEqual([
        "가",
        "나",
        "다",
        "라",
      ]);
    });

    it("합친 줄이 4줄을 넘으면 null", () => {
      expect(mergeSlideLines(["가", "나", "다"], ["라", "마"])).toBeNull();
    });
  });
});
