import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MouseSensor, PointerSensor } from "@dnd-kit/core";
import { useSlidePaneDrag } from "./useSlidePaneDrag";

function sensorsOf(
  options: Partial<Parameters<typeof useSlidePaneDrag>[0]> = {},
): unknown[] {
  const { result } = renderHook(() =>
    useSlidePaneDrag({
      isReadOnly: false,
      isSelected: () => false,
      onPickSlide: vi.fn(),
      onDropSlides: vi.fn(),
      onReorderSong: vi.fn(),
      onDragBegin: vi.fn(),
      ...options,
    }),
  );
  return (result.current.dndContextProps.sensors ?? []).map(
    ({ sensor }) => sensor,
  );
}

describe("useSlidePaneDrag 센서", () => {
  it("마우스·터치·펜 모두 포인터로 끈다", () => {
    expect(sensorsOf()).toEqual([PointerSensor]);
  });

  it("마우스 전용이면 터치로 쓸어 스크롤해도 끌기가 시작되지 않는다", () => {
    expect(sensorsOf({ mouseOnly: true })).toEqual([MouseSensor]);
  });

  it("보기 전용이면 어떤 센서도 두지 않는다", () => {
    expect(sensorsOf({ isReadOnly: true })).toEqual([]);
    expect(sensorsOf({ isReadOnly: true, mouseOnly: true })).toEqual([]);
  });
});
