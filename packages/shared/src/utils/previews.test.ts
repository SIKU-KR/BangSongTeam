import { describe, it, expect } from "vitest";
import { firstSlidePreview, twoLinesPreview } from "./previews";

describe("firstSlidePreview", () => {
  it("returns the lines of the slide with the lowest order", () => {
    expect(
      firstSlidePreview([
        { id: "b", order: 1, lines: ["둘째"] },
        { id: "a", order: 0, lines: ["첫 줄", "둘째 줄"] },
      ]),
    ).toEqual(["첫 줄", "둘째 줄"]);
  });

  it("returns an empty list for a deck without slides", () => {
    expect(firstSlidePreview([])).toEqual([]);
  });
});

describe("twoLinesPreview", () => {
  it("skips blank lines and trims whitespace", () => {
    expect(twoLinesPreview("\n  첫 줄 \n\n　둘째 줄\n셋째 줄")).toEqual([
      "첫 줄",
      "둘째 줄",
    ]);
  });

  it("never returns more than two lines", () => {
    expect(twoLinesPreview("a\nb\nc\nd")).toHaveLength(2);
    expect(twoLinesPreview("")).toEqual([]);
  });
});
