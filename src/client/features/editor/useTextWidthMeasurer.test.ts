import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { DEFAULT_DECK_STYLE, type Slide } from "#shared";
import {
  analyzeDeckOverflowCached,
  useTextWidthMeasurer,
} from "./useTextWidthMeasurer";

function slidesOf(lines: string[]): Slide[] {
  return lines.map((line, order) => ({
    id: `s-${order}`,
    order,
    lines: [line],
  }));
}

describe("useTextWidthMeasurer", () => {
  it("편집기의 여러 컴포넌트가 측정기 하나를 같이 쓴다", () => {
    const first = renderHook(() => useTextWidthMeasurer());
    const second = renderHook(() => useTextWidthMeasurer());
    expect(first.result.current).toBe(second.result.current);
  });
});

describe("analyzeDeckOverflowCached", () => {
  it("slides·style 참조가 같으면 다시 재지 않고 이전 결과를 돌려준다", () => {
    const measure = vi.fn((text: string, fontSizePx: number) => {
      return text.length * fontSizePx;
    });
    const deck = {
      slides: slidesOf(["가나다", "라마"]),
      style: DEFAULT_DECK_STYLE,
    };

    const first = analyzeDeckOverflowCached(deck, measure);
    const calls = measure.mock.calls.length;
    const second = analyzeDeckOverflowCached({ ...deck }, measure);

    expect(second).toBe(first);
    expect(measure).toHaveBeenCalledTimes(calls);
  });

  it("slides나 style이 바뀐 곡만 다시 분석한다", () => {
    const measure = vi.fn((text: string, fontSizePx: number) => {
      return text.length * fontSizePx;
    });
    const deck = { slides: slidesOf(["가나다"]), style: DEFAULT_DECK_STYLE };
    const first = analyzeDeckOverflowCached(deck, measure);

    const editedSlides = analyzeDeckOverflowCached(
      { ...deck, slides: slidesOf(["가나다라"]) },
      measure,
    );
    const restyled = analyzeDeckOverflowCached(
      { ...deck, style: { ...DEFAULT_DECK_STYLE, fontSizeVw: 10 } },
      measure,
    );

    expect(editedSlides).not.toBe(first);
    expect(restyled).not.toBe(first);
  });

  it("측정기가 바뀌면 같은 곡도 다시 분석한다", () => {
    const deck = { slides: slidesOf(["가나다"]), style: DEFAULT_DECK_STYLE };
    const first = analyzeDeckOverflowCached(deck, (text) => text.length);
    const second = analyzeDeckOverflowCached(deck, (text) => text.length);
    expect(second).not.toBe(first);
  });
});
