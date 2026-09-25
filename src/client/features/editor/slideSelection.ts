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
} from "../drive/selectionModel";

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

/** 끌어 놓은 썸네일의 위·아래 절반으로 틈 번호를 정한다 */
export function resolveDropIndex(
  overIndex: number,
  pointerY: number,
  rect: { top: number; height: number },
): number {
  return pointerY < rect.top + rect.height / 2 ? overIndex : overIndex + 1;
}
