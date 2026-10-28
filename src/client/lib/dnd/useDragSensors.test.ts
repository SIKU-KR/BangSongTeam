import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MouseSensor } from "@dnd-kit/core";
import { LongPressDragSensor } from "./longPressDragSensor";
import { useDragSensors } from "./useDragSensors";

const MOUSE = {
  sensor: MouseSensor,
  options: { activationConstraint: { distance: 5 } },
};
const TOUCH = {
  sensor: LongPressDragSensor,
  options: { delay: 250, tolerance: 5, distance: 10 },
};

describe("useDragSensors", () => {
  it("마우스는 5px 움직이면 끌고, 터치는 꾹 누른 뒤 움직여야 끈다", () => {
    const { result } = renderHook(() => useDragSensors());

    expect(result.current).toEqual([MOUSE, TOUCH]);
  });

  it("터치를 끄면 마우스 센서만 둔다", () => {
    const { result } = renderHook(() => useDragSensors({ touch: false }));

    expect(result.current).toEqual([MOUSE]);
  });

  it("터치를 켜고 끄는 대로 센서를 바꾼다", () => {
    const { result, rerender } = renderHook(
      ({ touch }) => useDragSensors({ touch }),
      { initialProps: { touch: true } },
    );

    rerender({ touch: false });
    expect(result.current).toEqual([MOUSE]);

    rerender({ touch: true });
    expect(result.current).toEqual([MOUSE, TOUCH]);
  });

  it("다시 그려도 같은 센서를 돌려준다 (옵션이 바뀌면 모든 행이 다시 그려진다)", () => {
    const { result, rerender } = renderHook(() => useDragSensors());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it("터치를 끈 센서도 다시 그려도 같다", () => {
    const { result, rerender } = renderHook(() =>
      useDragSensors({ touch: false }),
    );
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
