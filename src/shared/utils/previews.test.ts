import { describe, it, expect } from "vitest";
import { firstSlidePreview } from "./previews";

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
