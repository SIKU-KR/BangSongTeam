import { useState } from "react";
import {
  MAX_SLIDE_LINES,
  mergeSlideLines,
  middleSplitOffset,
  splitLinesAtCursor,
  type Slide,
} from "#shared";
import {
  breakHistoryCoalescing,
  getActivePresentation,
  getSlideAt,
  mergeSlideWithNext,
  splitSlideAtCursor,
  updateSlideLines,
  type ProjectionPosition,
} from "../presentation";
import type { CaretPlacement } from "./StageLyricsEditor";

interface UseSlideTextEditingOptions {
  songIndex: number;
  slideIndex: number;
  currentSlide: Slide | null;
  nextSlideInSong: Slide | null;
  select: (position: ProjectionPosition) => void;
}

interface SlideTextEditing {
  isEditingText: boolean;
  initialCaret: CaretPlacement | undefined;
  /** 줄 수·길이 제한에 막힌 입력이 지금 슬라이드에서 있었는지 */
  isLimitHintShown: boolean;
  splitOffset: number;
  canSplit: boolean;
  canMerge: boolean;
  start: (slideId?: string, caretAt?: CaretPlacement) => void;
  exit: (slideId: string) => void;
  split: (offset: number) => void;
  merge: () => void;
  changeLines: (lines: string[]) => void;
  hitLimit: () => void;
  updateCaret: (offset: number) => void;
}

/**
 * 편집 캔버스에서 가사를 바로 고치는 상태와 동작.
 *
 * 편집을 시작하고 끝낼 때 실행 취소 묶음을 끊어, 한 번의 편집이 앞뒤 스타일 변경과
 * 한 번에 되돌려지지 않게 한다. 편집 상태·커서·제한 안내는 슬라이드 id에 묶여 있어
 * 다른 슬라이드로 옮기면 저절로 꺼진다. 나누기는 편집 중이었을 때만 나뉜 뒷장의
 * 맨 앞에서 편집을 이어 간다.
 */
export function useSlideTextEditing({
  songIndex,
  slideIndex,
  currentSlide,
  nextSlideInSong,
  select,
}: UseSlideTextEditingOptions): SlideTextEditing {
  const [textEdit, setTextEdit] = useState<{
    slideId: string;
    caret: CaretPlacement;
  } | null>(null);
  const [caret, setCaret] = useState<{
    slideId: string;
    offset: number;
  } | null>(null);
  const [limitHintSlideId, setLimitHintSlideId] = useState<string | null>(null);

  const isEditingText = !!currentSlide && textEdit?.slideId === currentSlide.id;
  const caretOffset =
    currentSlide && caret?.slideId === currentSlide.id ? caret.offset : null;

  const start = (
    slideId: string | undefined = currentSlide?.id,
    caretAt: CaretPlacement = "end",
  ): void => {
    if (!slideId) return;
    breakHistoryCoalescing();
    setTextEdit({ slideId, caret: caretAt });
  };

  const exit = (slideId: string): void => {
    breakHistoryCoalescing();
    setTextEdit((prev) => (prev?.slideId === slideId ? null : prev));
  };

  const splitOffset =
    isEditingText && caretOffset !== null
      ? caretOffset
      : currentSlide
        ? middleSplitOffset(currentSlide.lines)
        : 0;
  const canSplit =
    !!currentSlide &&
    splitLinesAtCursor(currentSlide.lines, splitOffset) !== null;
  const canMerge =
    !!currentSlide &&
    !!nextSlideInSong &&
    mergeSlideLines(currentSlide.lines, nextSlideInSong.lines) !== null;

  const split = (offset: number): void => {
    const wasEditing = isEditingText;
    if (!splitSlideAtCursor(songIndex, slideIndex, offset)) return;
    const next = { songIndex, slideIndex: slideIndex + 1 };
    select(next);
    if (wasEditing) {
      start(getSlideAt(next, getActivePresentation().items)?.id, "start");
    }
  };

  const merge = (): void => {
    mergeSlideWithNext(songIndex, slideIndex);
  };

  const changeLines = (lines: string[]): void => {
    if (!currentSlide) return;
    if (lines.length < MAX_SLIDE_LINES) {
      setLimitHintSlideId(null);
    }
    updateSlideLines(songIndex, slideIndex, lines, {
      coalesceKey: `lines:${currentSlide.id}`,
    });
  };

  const hitLimit = (): void => {
    if (currentSlide) setLimitHintSlideId(currentSlide.id);
  };

  const updateCaret = (offset: number): void => {
    if (currentSlide) setCaret({ slideId: currentSlide.id, offset });
  };

  return {
    isEditingText,
    initialCaret: textEdit?.caret,
    isLimitHintShown: !!currentSlide && limitHintSlideId === currentSlide.id,
    splitOffset,
    canSplit,
    canMerge,
    start,
    exit,
    split,
    merge,
    changeLines,
    hitLimit,
    updateCaret,
  };
}
