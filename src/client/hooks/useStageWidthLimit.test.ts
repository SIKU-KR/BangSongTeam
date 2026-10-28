import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { installFakeResizeObserver } from "../test/fakeResizeObserver";
import { stageWidthLimit, useStageWidthLimit } from "./useStageWidthLimit";

function layoutArea(clientHeight: number, verticalPadding = 0) {
  let height = clientHeight;
  const area = document.createElement("div");
  Object.defineProperty(area, "clientHeight", { get: () => height });
  area.style.paddingTop = `${verticalPadding}px`;
  area.style.paddingBottom = `${verticalPadding}px`;
  return {
    area,
    resizeTo: (next: number) => {
      height = next;
    },
  };
}

describe("stageWidthLimit", () => {
  it("높이에 16:9로 맞는 가장 넓은 폭을 돌려준다", () => {
    expect(stageWidthLimit(1080)).toBe(1920);
    expect(stageWidthLimit(360)).toBe(640);
    expect(stageWidthLimit(180)).toBe(320);
  });

  it("가로로 돌린 폰처럼 낮은 영역에서는 폭 640px보다 훨씬 좁다", () => {
    expect(stageWidthLimit(165)).toBeCloseTo(293.33, 2);
  });
});

describe("useStageWidthLimit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("영역이 없으면 한계를 두지 않는다", () => {
    installFakeResizeObserver();

    const { result } = renderHook(() => useStageWidthLimit(null));

    expect(result.current).toBeNull();
  });

  it("영역의 안쪽 높이(위아래 여백을 뺀)에 맞는 폭을 첫 그림부터 돌려준다", () => {
    installFakeResizeObserver();
    const { area } = layoutArea(196, 8);

    const { result } = renderHook(() => useStageWidthLimit(area));

    expect(result.current).toBeCloseTo((196 - 16) * (16 / 9), 5);
  });

  it("아직 자리가 잡히지 않은 영역(높이 0)에는 한계를 두지 않는다", () => {
    installFakeResizeObserver();
    const { area } = layoutArea(0, 8);

    const { result } = renderHook(() => useStageWidthLimit(area));

    expect(result.current).toBeNull();
  });

  it("영역 크기가 바뀌었다는 알림을 받으면 다시 잰다", () => {
    const resize = installFakeResizeObserver();
    const { area, resizeTo } = layoutArea(180);
    const { result } = renderHook(() => useStageWidthLimit(area));
    expect(result.current).toBe(320);

    resizeTo(540);
    act(() => resize.notify());

    expect(result.current).toBe(960);
  });

  it("높이가 그대로이면 다시 그리지 않는다", () => {
    const resize = installFakeResizeObserver();
    const { area } = layoutArea(180);
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useStageWidthLimit(area);
    });
    const before = renders;

    act(() => resize.notify());

    expect(renders).toBe(before);
  });

  it("영역을 관찰하다 떼면 관찰을 멈춘다", () => {
    const resize = installFakeResizeObserver();
    const { area } = layoutArea(180);
    const { unmount } = renderHook(() => useStageWidthLimit(area));
    expect(resize.observed()).toEqual([area]);

    unmount();

    expect(resize.observed()).toEqual([]);
  });

  it("영역이 바뀌면 새 영역을 잰다", () => {
    const resize = installFakeResizeObserver();
    const first = layoutArea(180);
    const second = layoutArea(360);
    const { result, rerender } = renderHook(
      ({ area }) => useStageWidthLimit(area),
      { initialProps: { area: first.area } },
    );
    expect(result.current).toBe(320);

    rerender({ area: second.area });

    expect(result.current).toBe(640);
    expect(resize.observed()).toEqual([second.area]);
  });

  it("ResizeObserver가 없는 환경에서도 처음 잰 값을 쓴다", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { area } = layoutArea(180);

    const { result } = renderHook(() => useStageWidthLimit(area));

    expect(result.current).toBe(320);
  });
});
