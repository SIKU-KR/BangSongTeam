import { describe, it, expect } from "vitest";
import {
  sanitizeLyricLine,
  splitLyricsIntoSlides,
  splitLinesAtCursor,
  mergeSlideLines,
  fitLinesToSlides,
  fitSlidesToLimits,
  exceedsSlideLimits,
  middleSplitOffset,
} from "./lyrics";
import {
  MAX_SLIDE_LINE_LENGTH,
  MAX_SLIDE_LINES,
  SlideSchema,
} from "../schemas/slide";

const LONG_VERSE =
  "걱정 근심 많은 자를 성령감화 하시며 복과 은혜 사랑 받아 평안하게 하소서 첨과 끝이 되신 주님 항상 인도 하셔서 마귀 유혹 받는 것을 속히 끊게 하소서";

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

    it("80자를 넘는 줄을 던지지 않고 여러 줄로 감싼다", () => {
      const slides = splitLyricsIntoSlides(`${LONG_VERSE}\n${LONG_VERSE}`);
      expect(slides).toHaveLength(1);
      expect(slides[0].lines).toHaveLength(4);
    });

    it("generates unique IDs for each slide", () => {
      const rawText = `L1\nL2\n\nL3\nL4\n\nL5\nL6`;
      const slides = splitLyricsIntoSlides(rawText);
      const ids = new Set(slides.map((s) => s.id));
      expect(ids.size).toBe(slides.length);
    });
  });

  describe("fitLinesToSlides", () => {
    it("제한 안의 줄은 그대로 한 묶음으로 둔다", () => {
      expect(fitLinesToSlides(["1줄", "2줄"])).toEqual([["1줄", "2줄"]]);
      expect(fitLinesToSlides([])).toEqual([[]]);
    });

    it("긴 줄은 공백에서 고르게 끊는다", () => {
      expect(LONG_VERSE.length).toBeGreaterThan(MAX_SLIDE_LINE_LENGTH);
      const [lines] = fitLinesToSlides([LONG_VERSE]);
      expect(lines).toHaveLength(2);
      expect(lines.join(" ")).toBe(LONG_VERSE);
      expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThan(10);
    });

    it("공백 없는 긴 줄은 글자 수로 자른다", () => {
      const [lines] = fitLinesToSlides(["가".repeat(170)]);
      expect(lines.map((line) => line.length)).toEqual([80, 80, 10]);
    });

    it("감싼 뒤 4줄을 넘으면 2줄씩 나눈다", () => {
      const chunks = fitLinesToSlides([LONG_VERSE, LONG_VERSE, LONG_VERSE]);
      expect(chunks.map((lines) => lines.length)).toEqual([2, 2, 2]);
    });

    it("한 줄에서 나온 조각을 다른 슬라이드로 흩지 않는다", () => {
      const chunks = fitLinesToSlides(["짧은 절", LONG_VERSE, LONG_VERSE]);
      expect(chunks.map((lines) => lines.length)).toEqual([1, 2, 2]);
      expect(chunks[1].join(" ")).toBe(LONG_VERSE);
      expect(chunks[2].join(" ")).toBe(LONG_VERSE);
    });
  });

  describe("fitSlidesToLimits", () => {
    it("제한을 넘는 슬라이드를 나누고 뒷장에 이어지는 id를 붙인다", () => {
      const slides = fitSlidesToLimits([
        { id: "s_b", order: 1, lines: ["끝"] },
        { id: "s_a", order: 0, lines: [LONG_VERSE, LONG_VERSE, LONG_VERSE] },
      ]);
      expect(slides.map((s) => [s.id, s.order])).toEqual([
        ["s_a", 0],
        ["s_a_2", 1],
        ["s_a_3", 2],
        ["s_b", 3],
      ]);
      for (const slide of slides) {
        expect(SlideSchema.safeParse(slide).success).toBe(true);
      }
    });

    it("제한 안의 슬라이드는 그대로 둔다", () => {
      const slides = [
        { id: "s_1", order: 0, lines: ["1절"] },
        { id: "s_2", order: 1, lines: ["2절"] },
      ];
      expect(fitSlidesToLimits(slides)).toEqual(slides);
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

  describe("exceedsSlideLimits", () => {
    const full = Array.from({ length: MAX_SLIDE_LINES }, (_, i) => `줄 ${i}`);

    it("최대 줄 수를 넘겨 줄이 늘어나면 true", () => {
      expect(exceedsSlideLimits([...full, "새 줄"], full)).toBe(true);
    });

    it("이미 최대 줄 수를 넘긴 슬라이드에서 줄이 늘지 않으면 false", () => {
      const over = [...full, "넘친 줄"];
      expect(exceedsSlideLimits(over, over)).toBe(false);
      expect(exceedsSlideLimits(full, over)).toBe(false);
    });

    it("한 줄이라도 최대 길이를 넘으면 true", () => {
      expect(
        exceedsSlideLimits(["가".repeat(MAX_SLIDE_LINE_LENGTH + 1)], []),
      ).toBe(true);
      expect(exceedsSlideLimits(["가".repeat(MAX_SLIDE_LINE_LENGTH)], [])).toBe(
        false,
      );
    });
  });

  describe("middleSplitOffset", () => {
    it("줄 수의 절반 뒤 위치를 준다", () => {
      const lines = ["첫째", "둘째", "셋째", "넷째"];
      expect(middleSplitOffset(lines)).toBe("첫째\n둘째".length);
      expect(splitLinesAtCursor(lines, middleSplitOffset(lines))).toEqual([
        ["첫째", "둘째"],
        ["셋째", "넷째"],
      ]);
    });

    it("홀수 줄이면 앞쪽에 한 줄을 더 둔다", () => {
      expect(middleSplitOffset(["가", "나", "다"])).toBe("가\n나".length);
    });

    it("줄이 없으면 0", () => {
      expect(middleSplitOffset([])).toBe(0);
    });
  });
});
