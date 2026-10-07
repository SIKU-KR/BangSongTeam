import { describe, expect, it } from "vitest";
import { STANDARD_COLORS, THEME_COLOR_ROWS } from "./paletteColors";

describe("PowerPoint 색 팔레트", () => {
  it("테마 색은 기본 한 줄과 변형 다섯 줄, 줄마다 10색이다", () => {
    expect(THEME_COLOR_ROWS).toHaveLength(6);
    for (const row of THEME_COLOR_ROWS) expect(row).toHaveLength(10);
    expect(STANDARD_COLORS).toHaveLength(10);
  });

  it("변형 색은 PowerPoint와 같은 값이다", () => {
    const blue = THEME_COLOR_ROWS.map((row) => row[4]?.value);
    expect(blue).toEqual([
      "#4472C4",
      "#DAE3F3",
      "#B4C7E7",
      "#8FAADC",
      "#2F5597",
      "#203864",
    ]);
    expect(THEME_COLOR_ROWS.map((row) => row[0]?.value)).toEqual([
      "#FFFFFF",
      "#F2F2F2",
      "#D9D9D9",
      "#BFBFBF",
      "#A6A6A6",
      "#808080",
    ]);
    expect(THEME_COLOR_ROWS[1][1].value).toBe("#808080");
  });

  it("모든 값은 #RRGGBB 대문자이고 칸마다 이름이 있다", () => {
    for (const color of [...THEME_COLOR_ROWS.flat(), ...STANDARD_COLORS]) {
      expect(color.value).toMatch(/^#[0-9A-F]{6}$/);
      expect(color.label).not.toBe("");
    }
    expect(THEME_COLOR_ROWS[1][4].label).toBe("파랑, 80% 더 밝게");
    expect(THEME_COLOR_ROWS[5][4].label).toBe("파랑, 50% 더 어둡게");
  });
});
