import { useState } from "react";
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DndContextProps,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  collideBySameDragType,
  dropTargetOf,
  reorderedSongIndex,
  type PaneDragData,
  type PaneDropTarget,
} from "./slidePaneDnd";

const NO_SENSORS: [] = [];
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };

interface SlidePaneDrag {
  dndContextProps: Pick<
    DndContextProps,
    | "sensors"
    | "collisionDetection"
    | "onDragStart"
    | "onDragMove"
    | "onDragEnd"
    | "onDragCancel"
  >;
  dragging: PaneDragData | null;
  dropTarget: PaneDropTarget | null;
}

/**
 * 썸네일 창의 슬라이드·곡 끌기 상태.
 *
 * 선택되지 않은 슬라이드를 끌기 시작하면 그 장만 먼저 고른다. 클릭과 끌기를 가르려고
 * 5px 넘게 움직여야 끌기가 시작되고, 보기 전용이면 센서를 빼 끌기를 막는다.
 */
export function useSlidePaneDrag({
  isReadOnly,
  isSelected,
  onPickSlide,
  onDropSlides,
  onReorderSong,
  onDragBegin,
}: {
  isReadOnly: boolean;
  isSelected: (songIndex: number, slideId: string) => boolean;
  onPickSlide: (songIndex: number, slideIndex: number) => void;
  onDropSlides: (insertBefore: number) => void;
  onReorderSong: (fromIndex: number, toIndex: number) => void;
  onDragBegin: () => void;
}): SlidePaneDrag {
  const [dragging, setDragging] = useState<PaneDragData | null>(null);
  const [dropTarget, setDropTarget] = useState<PaneDropTarget | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const handleDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current as PaneDragData | undefined;
    if (!data) return;
    if (data.type === "slide" && !isSelected(data.songIndex, data.slideId)) {
      onPickSlide(data.songIndex, data.slideIndex);
    }
    onDragBegin();
    setDragging(data);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const target = dropTargetOf(event);
    setDragging(null);
    setDropTarget(null);
    if (!target || !dragging) return;
    if (target.type === "slide") {
      onDropSlides(target.index);
    } else if (dragging.type === "song") {
      const from = dragging.songIndex;
      const to = reorderedSongIndex(from, target.index);
      if (to !== from) onReorderSong(from, to);
    }
  };

  return {
    dndContextProps: {
      sensors: isReadOnly ? NO_SENSORS : sensors,
      collisionDetection: collideBySameDragType,
      onDragStart: handleDragStart,
      onDragMove: (event) => setDropTarget(dropTargetOf(event)),
      onDragEnd: handleDragEnd,
      onDragCancel: () => {
        setDragging(null);
        setDropTarget(null);
      },
    },
    dragging,
    dropTarget,
  };
}
