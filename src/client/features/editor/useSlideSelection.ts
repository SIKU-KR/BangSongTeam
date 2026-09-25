import { useState } from "react";
import type { PresentationItem } from "#shared";
import {
  addSlideToSong,
  duplicateSlides,
  getActivePresentation,
  insertSlides,
  moveSlides,
  removeSlides,
  type ProjectionPosition,
} from "../presentation";
import {
  clickSelection,
  extendSelection,
  stepMoveTarget,
  type ClickModifiers,
  type SlideMoveDirection,
} from "./slideSelection";

/** 썸네일 사이 삽입 커서. `index`는 곡 안 틈 번호(0 = 첫 장 앞)다 */
export interface SlideInsertion {
  songIndex: number;
  index: number;
}

interface PickedSlides {
  itemId: string;
  ids: string[];
  anchorId: string;
}

interface SlideClipboard {
  itemId: string;
  lines: string[][];
}

export interface SlideSelection {
  /** 선택된 슬라이드 id (현재 곡 안, 화면 순서). 삽입 커서가 있으면 비어 있다 */
  selectedIds: string[];
  insertion: SlideInsertion | null;
  canDelete: boolean;
  canPaste: boolean;
  select: (position: ProjectionPosition) => void;
  clickSlide: (
    songIndex: number,
    slideIndex: number,
    modifiers: ClickModifiers,
  ) => void;
  selectSong: (songIndex: number) => void;
  selectAll: () => boolean;
  extend: (delta: number) => boolean;
  setInsertion: (insertion: SlideInsertion) => void;
  clearInsertion: () => boolean;
  addSlide: () => string | null;
  deleteSelection: () => boolean;
  duplicateSelection: () => boolean;
  copy: () => boolean;
  cut: () => boolean;
  paste: () => boolean;
  moveSelection: (direction: SlideMoveDirection) => boolean;
  dropSelection: (insertBefore: number) => void;
}

/**
 * PowerPoint 슬라이드 창의 선택·삽입 커서·클립보드 상태.
 *
 * 선택은 늘 현재 곡 한 곡 안에만 있고 slide id로 기억해, 순서를 바꿔도 따라간다.
 * 곡마다 서식이 달라 붙여넣기도 복사한 곡에만 된다. 클립보드는 편집기 메모리에만 있다.
 */
export function useSlideSelection({
  songs,
  position,
  setPosition,
}: {
  songs: PresentationItem[];
  position: ProjectionPosition;
  setPosition: (position: ProjectionPosition) => void;
}): SlideSelection {
  const [picked, setPicked] = useState<PickedSlides | null>(null);
  const [insertion, setInsertionState] = useState<SlideInsertion | null>(null);
  const [clipboard, setClipboard] = useState<SlideClipboard | null>(null);

  const { songIndex } = position;
  const item = songs[songIndex];
  const slides = item?.deck?.slides ?? [];
  const ids = slides.map((slide) => slide.id);
  const currentId = ids[position.slideIndex];

  const pickedHere =
    picked && item && picked.itemId === item.id
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

  const canDelete =
    selectedIndexes.length > 0 && selectedIndexes.length < slides.length;
  const canPaste = !!clipboard && !!item && clipboard.itemId === item.id;

  const slideIdsOf = (target: number): string[] =>
    getActivePresentation().items[target]?.deck?.slides.map((s) => s.id) ?? [];

  const pick = (
    target: number,
    nextIds: string[],
    anchor: string,
    focus: string,
  ): void => {
    const itemId = getActivePresentation().items[target]?.id;
    setInsertionState(null);
    setPicked(itemId ? { itemId, ids: nextIds, anchorId: anchor } : null);
    setPosition({
      songIndex: target,
      slideIndex: Math.max(0, slideIdsOf(target).indexOf(focus)),
    });
  };

  const select = (next: ProjectionPosition): void => {
    setInsertionState(null);
    setPicked(null);
    setPosition(next);
  };

  const clickSlide = (
    target: number,
    slideIndex: number,
    modifiers: ClickModifiers,
  ): void => {
    const targetId = songs[target]?.deck?.slides[slideIndex]?.id;
    if (
      !targetId ||
      target !== songIndex ||
      insertion ||
      (!modifiers.shift && !modifiers.mod)
    ) {
      select({ songIndex: target, slideIndex });
      return;
    }
    const next = clickSelection(
      ids,
      { selected: activeIds, anchor: anchorId, focus: currentId ?? targetId },
      targetId,
      modifiers,
    );
    pick(songIndex, next.selected, next.anchor, next.focus);
  };

  const selectSong = (target: number): void => {
    const targetIds = songs[target]?.deck?.slides.map((s) => s.id) ?? [];
    if (targetIds.length === 0) return;
    pick(target, targetIds, targetIds[0], targetIds[0]);
  };

  const selectAll = (): boolean => {
    if (!currentId) return false;
    pick(songIndex, ids, ids[0], currentId);
    return true;
  };

  const extend = (delta: number): boolean => {
    if (!currentId) return false;
    const next = extendSelection(
      ids,
      { selected: activeIds, anchor: anchorId, focus: currentId },
      delta,
    );
    pick(songIndex, next.selected, next.anchor, next.focus);
    return true;
  };

  const setInsertion = (next: SlideInsertion): void => {
    setPicked(null);
    setPosition({
      songIndex: next.songIndex,
      slideIndex: Math.max(0, next.index - 1),
    });
    setInsertionState(next);
  };

  const clearInsertion = (): boolean => {
    if (!insertion) return false;
    setInsertionState(null);
    return true;
  };

  const insertAt = (): number =>
    insertion
      ? insertion.index
      : selectedIndexes.length > 0
        ? Math.max(...selectedIndexes) + 1
        : position.slideIndex + 1;

  const addSlide = (): string | null => {
    if (!item?.deck) return null;
    const at = insertAt();
    addSlideToSong(songIndex, [], at - 1);
    const newId = slideIdsOf(songIndex)[at];
    if (!newId) return null;
    pick(songIndex, [newId], newId, newId);
    return newId;
  };

  const deleteSelection = (): boolean => {
    if (!canDelete) return false;
    if (!removeSlides(songIndex, selectedIndexes)) return false;
    const remaining = slideIdsOf(songIndex);
    select({
      songIndex,
      slideIndex: Math.min(Math.min(...selectedIndexes), remaining.length - 1),
    });
    return true;
  };

  const pickInserted = (at: number, count: number, focusLast: boolean) => {
    const inserted = slideIdsOf(songIndex).slice(at, at + count);
    if (inserted.length === 0) return;
    const focus = focusLast ? inserted[inserted.length - 1] : inserted[0];
    pick(songIndex, inserted, inserted[0], focus);
  };

  const duplicateSelection = (): boolean => {
    if (selectedIndexes.length === 0) return false;
    duplicateSlides(songIndex, selectedIndexes);
    pickInserted(
      Math.max(...selectedIndexes) + 1,
      selectedIndexes.length,
      false,
    );
    return true;
  };

  const copy = (): boolean => {
    if (!item || selectedIndexes.length === 0) return false;
    setClipboard({
      itemId: item.id,
      lines: selectedIndexes.map((index) => [...slides[index].lines]),
    });
    return true;
  };

  const cut = (): boolean => {
    if (!canDelete) return false;
    copy();
    return deleteSelection();
  };

  const paste = (): boolean => {
    if (!canPaste || !clipboard) return false;
    const at = insertAt();
    insertSlides(songIndex, at, clipboard.lines);
    pickInserted(at, clipboard.lines.length, true);
    return true;
  };

  const moveTo = (insertBefore: number): void => {
    if (selectedIndexes.length === 0 || !currentId) return;
    moveSlides(songIndex, selectedIndexes, insertBefore);
    pick(songIndex, selectedIds, anchorId, currentId);
  };

  const moveSelection = (direction: SlideMoveDirection): boolean => {
    if (selectedIndexes.length === 0) return false;
    moveTo(stepMoveTarget(selectedIndexes, slides.length, direction));
    return true;
  };

  return {
    selectedIds,
    insertion,
    canDelete,
    canPaste,
    select,
    clickSlide,
    selectSong,
    selectAll,
    extend,
    setInsertion,
    clearInsertion,
    addSlide,
    deleteSelection,
    duplicateSelection,
    copy,
    cut,
    paste,
    moveSelection,
    dropSelection: moveTo,
  };
}
