import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MouseSensor } from "@dnd-kit/core";
import { LongPressDragSensor } from "./longPressDragSensor";
import { useDriveSensors } from "./useDriveSensors";

describe("useDriveSensors", () => {
  it("마우스는 5px 움직이면 끌고, 터치는 꾹 누른 뒤 움직여야 끈다", () => {
    const { result } = renderHook(() => useDriveSensors());

    expect(result.current).toEqual([
      {
        sensor: MouseSensor,
        options: { activationConstraint: { distance: 5 } },
      },
      {
        sensor: LongPressDragSensor,
        options: { delay: 250, tolerance: 5, distance: 10 },
      },
    ]);
  });

  it("다시 그려도 같은 센서를 돌려준다 (옵션이 바뀌면 모든 행이 다시 그려진다)", () => {
    const { result, rerender } = renderHook(() => useDriveSensors());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
