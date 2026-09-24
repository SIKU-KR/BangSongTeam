import React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Slide } from "@repo/shared";

export interface ReorderMove {
  from: number;
  to: number;
}

/**
 * dnd-kit의 active/over 아이디를 배열 인덱스 이동(from → to)으로 변환한다.
 * 이동이 없거나 아이디를 찾을 수 없으면 null.
 */
export function resolveReorder(
  ids: readonly string[],
  activeId: string,
  overId: string | null | undefined,
): ReorderMove | null {
  if (overId == null || activeId === overId) return null;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return null;
  return { from, to };
}

/**
 * 슬라이드의 정렬용 아이디. id가 비어 있는 슬라이드는 인덱스로 대체한다.
 */
export function slideSortableId(slide: Slide, index: number): string {
  return slide.id || `slide-${index}`;
}

export interface SortableListProps {
  ids: string[];
  onReorder: (from: number, to: number) => void;
  orientation?: "vertical" | "horizontal";
  children: React.ReactNode;
}

/**
 * 곡 목록 / 슬라이드 썸네일 창 공용 드래그 정렬 컨테이너.
 * - 5px 이동 후에만 드래그를 시작해 카드 클릭(선택)과 충돌하지 않는다
 * - 키보드(Space + 방향키) 정렬 지원
 */
export function SortableList({
  ids,
  onReorder,
  orientation = "vertical",
  children,
}: SortableListProps): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const move = resolveReorder(
      ids,
      String(active.id),
      over && String(over.id),
    );
    if (move) onReorder(move.from, move.to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={ids}
        strategy={
          orientation === "horizontal"
            ? horizontalListSortingStrategy
            : verticalListSortingStrategy
        }
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

export interface SortableItemProps extends Omit<
  React.ComponentPropsWithoutRef<"div">,
  "id"
> {
  sortableId: string;
}

/**
 * SortableList 내부의 드래그 가능한 카드. 나머지 div 속성은 그대로 전달한다.
 */
export function SortableItem({
  sortableId,
  style,
  className = "",
  children,
  ...rest
}: SortableItemProps): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId });

  return (
    <div
      {...rest}
      {...attributes}
      {...listeners}
      ref={setNodeRef}
      className={`${className} ${isDragging ? "z-30 opacity-70 shadow-lg" : ""}`}
      style={{
        ...style,
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: "none",
      }}
    >
      {children}
    </div>
  );
}
