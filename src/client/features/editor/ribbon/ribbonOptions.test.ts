import { describe, it, expect } from "vitest";
import { DEFAULT_DECK_STYLE } from "#shared";
import { ptToVw, stepFontSize, vwToPt } from "./ribbonOptions";

describe("글자 크기 pt 변환", () => {
  it("기본 크기 4.2vw는 40pt로 보인다", () => {
    expect(vwToPt(DEFAULT_DECK_STYLE.fontSizeVw)).toBe(40);
  });

  it("pt를 스키마 범위(2–10vw) 안의 vw로 바꾼다", () => {
    expect(ptToVw(60)).toBe(6.25);
    expect(ptToVw(96)).toBe(10);
    expect(ptToVw(200)).toBe(10);
    expect(ptToVw(5)).toBe(2);
  });

  it("목록의 다음·이전 칸으로 옮기고 끝에서는 멈춘다", () => {
    expect(vwToPt(stepFontSize(DEFAULT_DECK_STYLE.fontSizeVw, 1))).toBe(44);
    expect(vwToPt(stepFontSize(DEFAULT_DECK_STYLE.fontSizeVw, -1))).toBe(36);
    expect(vwToPt(stepFontSize(ptToVw(40), 1))).toBe(44);
    expect(vwToPt(stepFontSize(ptToVw(42), 1))).toBe(44);
    expect(stepFontSize(10, 1)).toBe(10);
    expect(vwToPt(stepFontSize(2, -1))).toBe(19);
  });
});
