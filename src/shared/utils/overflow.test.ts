import { describe, it, expect } from "vitest";
import type { DeckStyle, Slide } from "../schemas";
import { DEFAULT_DECK_STYLE } from "../constants";
import {
  analyzeDeckOverflow,
  estimateTextWidth,
  type TextWidthMeasurer,
} from "./overflow";

const oneEmPerChar: TextWidthMeasurer = (text, fontSizePx) =>
  [...text].length * fontSizePx;

function slidesOf(...lineGroups: string[][]): Slide[] {
  return lineGroups.map((lines, order) => ({ id: `s${order}`, order, lines }));
}

function styleWith(overrides: Partial<DeckStyle>): DeckStyle {
  return { ...DEFAULT_DECK_STYLE, ...overrides };
}

describe("estimateTextWidth", () => {
  it("한글 한 글자를 영문 소문자보다 약 1.8배 넓게 어림한다", () => {
    const hangul = estimateTextWidth("가나다", 100);
    const latin = estimateTextWidth("abc", 100);

    expect(hangul / latin).toBeGreaterThan(1.7);
    expect(hangul / latin).toBeLessThan(2.0);
  });

  it("글자 크기에 비례한다", () => {
    expect(estimateTextWidth("주 은혜", 200)).toBeCloseTo(
      estimateTextWidth("주 은혜", 100) * 2,
    );
  });
});

describe("analyzeDeckOverflow", () => {
  it("박스 폭 안에 들어오는 줄은 경고하지 않는다", () => {
    const result = analyzeDeckOverflow(
      slidesOf(["주의 은혜", "나를 붙드네"], ["할렐루야"]),
      DEFAULT_DECK_STYLE,
      oneEmPerChar,
    );

    expect(result.slides).toEqual([
      { wraps: false, visualLineCount: 2 },
      { wraps: false, visualLineCount: 1 },
    ]);
    expect(result.exceedsStage).toBe(false);
  });

  it("한 줄이 박스 폭을 넘으면 그 슬라이드만 줄바꿈 경고를 켠다", () => {
    const style = styleWith({ fontSizeVw: 10 });
    const result = analyzeDeckOverflow(
      slidesOf(["가나다라"], ["가나다라마 바사아자차"]),
      style,
      oneEmPerChar,
    );

    expect(result.slides[0]).toEqual({ wraps: false, visualLineCount: 1 });
    expect(result.slides[1]).toEqual({ wraps: true, visualLineCount: 2 });
  });

  it("공백 없이 긴 줄은 쪼개지 못하므로 한 줄로 세되 경고한다", () => {
    const style = styleWith({ fontSizeVw: 10 });
    const result = analyzeDeckOverflow(
      slidesOf(["가나다라마바사아자차"]),
      style,
      oneEmPerChar,
    );

    expect(result.slides[0]).toEqual({ wraps: true, visualLineCount: 1 });
  });

  it("박스 폭을 넓히면 같은 줄도 경고가 사라진다", () => {
    const lines = [["가나다라 바사아"]];
    const narrow = analyzeDeckOverflow(
      slidesOf(...lines),
      styleWith({
        fontSizeVw: 10,
        position: { ...DEFAULT_DECK_STYLE.position, widthPercent: 40 },
      }),
      oneEmPerChar,
    );
    const wide = analyzeDeckOverflow(
      slidesOf(...lines),
      styleWith({
        fontSizeVw: 10,
        position: { ...DEFAULT_DECK_STYLE.position, widthPercent: 90 },
      }),
      oneEmPerChar,
    );

    expect(narrow.slides[0].wraps).toBe(true);
    expect(wide.slides[0].wraps).toBe(false);
  });

  it("빈 줄은 높이를 차지하지 않는다", () => {
    const result = analyzeDeckOverflow(
      slidesOf(["주의 은혜", "", "할렐루야"]),
      DEFAULT_DECK_STYLE,
      oneEmPerChar,
    );

    expect(result.slides[0].visualLineCount).toBe(2);
  });

  it("줄바꿈까지 반영해 가장 긴 슬라이드를 고른다", () => {
    const style = styleWith({ fontSizeVw: 10 });
    const result = analyzeDeckOverflow(
      slidesOf(
        ["가", "나", "다"],
        ["가나다라마 바사아자차", "가나다라마 바사아"],
      ),
      style,
      oneEmPerChar,
    );

    expect(result.tallestSlideIndex).toBe(1);
    expect(result.slides[1].visualLineCount).toBe(4);
  });

  it("슬라이드가 없으면 곡 경고도 없다", () => {
    const result = analyzeDeckOverflow([], DEFAULT_DECK_STYLE, oneEmPerChar);

    expect(result.tallestSlideIndex).toBeNull();
    expect(result.exceedsStage).toBe(false);
  });

  it("가장 긴 슬라이드가 화면 안전 여백을 넘으면 곡 경고를 켠다", () => {
    const style = styleWith({ fontSizeVw: 10 });

    expect(
      analyzeDeckOverflow(slidesOf(["가", "나", "다"]), style, oneEmPerChar)
        .exceedsStage,
    ).toBe(false);
    expect(
      analyzeDeckOverflow(
        slidesOf(["가"], ["가", "나", "다", "라"]),
        style,
        oneEmPerChar,
      ).exceedsStage,
    ).toBe(true);
  });

  it("자동 줄바꿈으로 늘어난 줄도 화면 높이 계산에 넣는다", () => {
    const style = styleWith({ fontSizeVw: 10 });
    const result = analyzeDeckOverflow(
      slidesOf(["가나다라마 바사아자차", "가나다라마 바사아자차"]),
      style,
      oneEmPerChar,
    );

    expect(result.exceedsStage).toBe(true);
  });

  it("박스는 기준점에서 자라므로 같은 높이라도 앵커에 따라 넘침이 달라진다", () => {
    const slides = slidesOf(["가", "나", "다"]);
    const at20 = (anchor: DeckStyle["position"]["anchor"]) =>
      styleWith({
        fontSizeVw: 10,
        position: { anchor, xPercent: 50, yPercent: 20, widthPercent: 80 },
      });

    expect(
      analyzeDeckOverflow(slides, at20("top-center"), oneEmPerChar)
        .exceedsStage,
    ).toBe(false);
    expect(
      analyzeDeckOverflow(slides, at20("bottom-center"), oneEmPerChar)
        .exceedsStage,
    ).toBe(true);
    expect(
      analyzeDeckOverflow(slides, at20("middle-center"), oneEmPerChar)
        .exceedsStage,
    ).toBe(true);
  });

  it("측정기를 넘기지 않으면 글자 폭 어림값으로 계산한다", () => {
    const result = analyzeDeckOverflow(
      slidesOf(["주의 은혜가 나를 붙드시니 두려움 없이 주님만 바라보네"]),
      DEFAULT_DECK_STYLE,
    );

    expect(result.slides[0].wraps).toBe(true);
  });
});
