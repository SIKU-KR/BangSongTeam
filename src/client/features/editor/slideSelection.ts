/**
 * 슬라이드 썸네일 창의 선택 규칙 (순수 함수). PowerPoint 슬라이드 창과 같다.
 *
 * 선택은 늘 한 곡 안에만 있으므로 `ids`는 그 곡의 슬라이드 id를 화면 순서대로 담는다.
 */
import {
  mergeKeys,
  rangeKeys,
  stepFocus,
  toggleKey,
} from "../../lib/selection/selectionModel";

export interface SlideSelectionState {
  selected: string[];
  /** Shift 범위 선택의 기준점 */
  anchor: string;
  /** 캔버스에 보이는 현재 슬라이드 */
  focus: string;
}

export interface ClickModifiers {
  shift: boolean;
  mod: boolean;
}

/**
 * 썸네일 클릭 결과. Ctrl/⌘는 넣거나 빼고, Shift는 기준점부터 범위를 고르며
 * 둘을 함께 누르면 범위를 기존 선택에 더한다. 마지막 한 장은 빼지 않는다.
 */
export function clickSelection(
  ids: readonly string[],
  current: SlideSelectionState,
  target: string,
  { shift, mod }: ClickModifiers,
): SlideSelectionState {
  if (shift) {
    const range = rangeKeys(ids, current.anchor, target);
    return {
      selected: mod ? mergeKeys(current.selected, range) : range,
      anchor: current.anchor,
      focus: target,
    };
  }
  if (mod) {
    const toggled = toggleKey(new Set(current.selected), target);
    if (toggled.length === 0) {
      return { selected: [target], anchor: target, focus: target };
    }
    const ordered = ids.filter((id) => toggled.includes(id));
    return {
      selected: ordered,
      anchor: target,
      focus: ordered.includes(target) ? target : ordered[ordered.length - 1],
    };
  }
  return { selected: [target], anchor: target, focus: target };
}

/** Shift+↑↓: 기준점은 두고 현재 슬라이드를 한 칸 옮겨 그 사이를 고른다 */
export function extendSelection(
  ids: readonly string[],
  current: SlideSelectionState,
  delta: number,
): SlideSelectionState {
  const focus = stepFocus(ids, current.focus, delta) ?? current.focus;
  return {
    selected: rangeKeys(ids, current.anchor, focus),
    anchor: current.anchor,
    focus,
  };
}

export type SlideMoveDirection = "up" | "down" | "start" | "end";

/**
 * Ctrl/⌘(+Shift)+↑↓로 선택을 옮길 틈 번호(`moveSlides`의 `insertBefore`).
 * 흩어진 선택은 한 덩어리로 모인다.
 */
export function stepMoveTarget(
  indexes: readonly number[],
  length: number,
  direction: SlideMoveDirection,
): number {
  switch (direction) {
    case "up":
      return Math.max(0, Math.min(...indexes) - 1);
    case "down":
      return Math.min(length, Math.max(...indexes) + 2);
    case "start":
      return 0;
    case "end":
      return length;
  }
}

/** 썸네일 사이 삽입 커서. `index`는 곡 안 틈 번호(0 = 첫 장 앞)다 */
export interface SlideInsertion {
  songIndex: number;
  index: number;
}

/** Ctrl/⌘·Shift로 고른 슬라이드. 곡 id와 slide id로 기억해 순서를 바꿔도 따라간다 */
export interface PickedSlides {
  itemId: string;
  ids: string[];
  anchorId: string;
}

interface PaneSelection {
  /** 삽입 커서와 상관없이 지금 고른 슬라이드 id (화면 순서) */
  activeIds: string[];
  anchorId: string;
  /** 화면에 선택으로 보이는 슬라이드 id. 삽입 커서가 있으면 비어 있다 */
  selectedIds: string[];
  selectedIndexes: number[];
}

/**
 * 현재 곡의 선택을 정한다. 고른 묶음이 다른 곡 것이거나 현재 슬라이드를 품지 않으면
 * 현재 슬라이드 한 장만 고른 것으로 본다. 기준점이 사라졌으면 현재 슬라이드가
 * 기준점이 되고, 현재 슬라이드도 없으면 빈 문자열이다.
 */
export function resolvePaneSelection({
  ids,
  itemId,
  currentId,
  picked,
  insertion,
}: {
  ids: readonly string[];
  itemId: string | undefined;
  currentId: string | undefined;
  picked: PickedSlides | null;
  insertion: SlideInsertion | null;
}): PaneSelection {
  const pickedHere =
    picked && itemId !== undefined && picked.itemId === itemId
      ? ids.filter((id) => picked.ids.includes(id))
      : [];
  const usePicked = currentId !== undefined && pickedHere.includes(currentId);
  const activeIds = usePicked
    ? pickedHere
    : currentId === undefined
      ? []
      : [currentId];
  const anchorId =
    usePicked && picked && ids.includes(picked.anchorId)
      ? picked.anchorId
      : (currentId ?? "");
  const selectedIds = insertion ? [] : activeIds;
  const selectedIndexes = selectedIds.map((id) => ids.indexOf(id));
  return { activeIds, anchorId, selectedIds, selectedIndexes };
}

/**
 * 새 슬라이드·붙여넣기가 들어갈 틈 번호. 삽입 커서가 있으면 그 자리, 아니면 선택한
 * 마지막 장 뒤, 선택이 없으면 현재 슬라이드 뒤다.
 */
export function resolveInsertIndex(
  insertion: SlideInsertion | null,
  selectedIndexes: readonly number[],
  slideIndex: number,
): number {
  return insertion
    ? insertion.index
    : selectedIndexes.length > 0
      ? Math.max(...selectedIndexes) + 1
      : slideIndex + 1;
}
