import {
  closestCenter,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";

/** 썸네일 창에서 끌거나 놓는 대상. 슬라이드는 같은 곡 안, 곡은 곡끼리만 오간다 */
export type PaneDragData =
  | { type: "slide"; songIndex: number; slideIndex: number; slideId: string }
  | { type: "song"; songIndex: number };

/** 끄는 동안 가로선을 그릴 자리. `index`는 슬라이드면 곡 안 틈 번호, 곡이면 곡 사이 틈 번호다 */
export type PaneDropTarget =
  | { type: "slide"; songIndex: number; index: number }
  | { type: "song"; index: number };

/**
 * 끄는 대상과 같은 종류의 놓을 자리만 충돌 후보로 남긴다. 곡마다 서식이 달라
 * 슬라이드는 같은 곡 안에서만 놓을 수 있다.
 */
export const collideBySameDragType: CollisionDetection = (args) => {
  const active = args.active.data.current as PaneDragData | undefined;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => {
      const data = container.data.current as PaneDragData | undefined;
      if (!active || !data || data.type !== active.type) return false;
      return data.type === "song" || data.songIndex === active.songIndex;
    }),
  });
};

/** 끌린 썸네일의 세로 가운데가 놓을 자리의 위·아래 절반 중 어디에 있는지로 틈을 정한다 */
export function dropTargetOf({
  active,
  over,
}: DragMoveEvent | DragEndEvent): PaneDropTarget | null {
  const data = over?.data.current as PaneDragData | undefined;
  const rect = active.rect.current.translated;
  if (!over || !data || !rect) return null;
  const centerY = rect.top + rect.height / 2;
  if (data.type === "slide") {
    return {
      type: "slide",
      songIndex: data.songIndex,
      index: resolveDropIndex(data.slideIndex, centerY, over.rect),
    };
  }
  return {
    type: "song",
    index: resolveDropIndex(data.songIndex, centerY, over.rect),
  };
}

/** 끌어 놓은 썸네일의 위·아래 절반으로 틈 번호를 정한다 */
export function resolveDropIndex(
  overIndex: number,
  pointerY: number,
  rect: { top: number; height: number },
): number {
  return pointerY < rect.top + rect.height / 2 ? overIndex : overIndex + 1;
}

/**
 * 곡 사이 틈 번호에 놓았을 때 곡이 옮겨 갈 자리. 끈 곡이 빠지면 그 뒤 틈은
 * 한 칸씩 당겨지므로 원래 자리보다 뒤에 놓으면 하나를 뺀다.
 */
export function reorderedSongIndex(from: number, insertBefore: number): number {
  return insertBefore > from ? insertBefore - 1 : insertBefore;
}
