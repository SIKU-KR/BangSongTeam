import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MouseSensor, PointerSensor } from "@dnd-kit/core";
import { LongPressDragSensor } from "../../lib/dnd/longPressDragSensor";
import { useDragSensors } from "../../lib/dnd/useDragSensors";
import { useSlidePaneDrag } from "./useSlidePaneDrag";

function renderDrag(
  options: Partial<Parameters<typeof useSlidePaneDrag>[0]> = {},
) {
  return renderHook(() =>
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
}

function sensorsOf(
  options: Partial<Parameters<typeof useSlidePaneDrag>[0]> = {},
): unknown[] {
  return (renderDrag(options).result.current.dndContextProps.sensors ?? []).map(
    ({ sensor }) => sensor,
  );
}

describe("useSlidePaneDrag 센서", () => {
  it("마우스는 움직이면 바로, 터치는 꾹 누른 채 움직여야 끌기를 시작한다", () => {
    expect(sensorsOf()).toEqual([MouseSensor, LongPressDragSensor]);
  });

  it("터치로 쓸어 스크롤할 때 끌기가 시작되지 않도록 포인터 센서를 두지 않는다", () => {
    expect(sensorsOf()).not.toContain(PointerSensor);
    expect(sensorsOf({ mouseOnly: true })).not.toContain(PointerSensor);
  });

  it("마우스는 지금처럼 5px 움직이면 끌기를 시작한다", () => {
    const [mouse] = renderDrag().result.current.dndContextProps.sensors ?? [];

    expect(mouse?.options).toEqual({ activationConstraint: { distance: 5 } });
  });

  it("드라이브 목록과 같은 마우스·터치 규칙을 쓴다", () => {
    const drive = renderHook(() => useDragSensors()).result.current;

    expect(renderDrag().result.current.dndContextProps.sensors).toEqual(drive);
  });

  it("폰 폭 시트는 마우스로만 끈다", () => {
    expect(sensorsOf({ mouseOnly: true })).toEqual([MouseSensor]);
  });

  it("보기 전용이면 어떤 센서도 두지 않는다", () => {
    expect(sensorsOf({ isReadOnly: true })).toEqual([]);
    expect(sensorsOf({ isReadOnly: true, mouseOnly: true })).toEqual([]);
  });

  it("다시 그려도 같은 센서를 돌려준다 (옵션이 바뀌면 모든 썸네일이 다시 그려진다)", () => {
    const { result, rerender } = renderDrag();
    const first = result.current.dndContextProps.sensors;

    rerender();

    expect(result.current.dndContextProps.sensors).toBe(first);
  });
});
