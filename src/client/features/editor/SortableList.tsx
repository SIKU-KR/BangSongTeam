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
import type { Slide } from "#shared";

export interface ReorderMove {
  from: number;
  to: number;
}

/** active/over 아이디를 배열 인덱스 이동으로 변환한다. */
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

/** 슬라이드의 정렬용 고유 아이디를 생성한다. */
export function slideSortableId(slide: Slide, index: number): string {
  return slide.id || `slide-${index}`;
}

export interface SortableListProps {
  ids: string[];
  onReorder: (from: number, to: number) => void;
  orientation?: "vertical" | "horizontal";
  children: React.ReactNode;
}

/** 드래그 앤 드롭 정렬 목록 컨테이너 컴포넌트. */
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

/** SortableList 내부의 드래그 가능한 카드 컴포넌트. */
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
