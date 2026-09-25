import React, { useLayoutEffect, useRef } from "react";
import type { Slide } from "#shared";
import { MAX_SLIDE_LINE_LENGTH, MAX_SLIDE_LINES } from "#shared";

export interface StageLyricsEditorProps {
  slide: Slide;
  caretColor: string;
  initialCaret?: "start" | "end";
  onChangeLines: (lines: string[]) => void;
  onLimitHit: () => void;
  onCaretChange: (offset: number) => void;
  onSplit: (offset: number) => void;
  onExit: () => void;
}

/** 한 슬라이드의 줄 수·줄 길이 제한(`SlideSchema`)을 넘는 입력인지 확인한다. */
export function exceedsSlideLimits(
  nextLines: string[],
  currentLines: string[],
): boolean {
  if (
    nextLines.length > MAX_SLIDE_LINES &&
    nextLines.length > currentLines.length
  ) {
    return true;
  }
  return nextLines.some((line) => line.length > MAX_SLIDE_LINE_LENGTH);
}

/**
 * 편집 캔버스의 텍스트 박스 안에서 가사를 바로 고치는 입력칸. 송출과 같은 박스
 * 안에 그려 글꼴·크기·정렬·줄바꿈이 송출 화면과 똑같이 보인다.
 */
export function StageLyricsEditor({
  slide,
  caretColor,
  initialCaret = "end",
  onChangeLines,
  onLimitHit,
  onCaretChange,
  onSplit,
  onExit,
}: StageLyricsEditorProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const offset = initialCaret === "start" ? 0 : el.value.length;
    el.setSelectionRange(offset, offset);
    onCaretChange(offset);
  }, []);

  return (
    <textarea
      ref={ref}
      data-testid="stage-lyrics-editor"
      aria-label="슬라이드 가사 편집"
      rows={1}
      value={slide.lines.join("\n")}
      placeholder="가사를 입력하세요"
      onChange={(e) => {
        const lines = e.target.value.split("\n");
        if (exceedsSlideLimits(lines, slide.lines)) {
          onLimitHit();
          return;
        }
        onChangeLines(lines);
      }}
      onSelect={(e) => onCaretChange(e.currentTarget.selectionStart)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          onExit();
          return;
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSplit(e.currentTarget.selectionStart);
        }
      }}
      onBlur={onExit}
      spellCheck={false}
      className="block w-full min-w-[4ch] m-0 p-0 border-0 bg-transparent outline-none resize-none overflow-hidden select-text placeholder:text-current placeholder:opacity-40"
      style={
        {
          font: "inherit",
          color: "inherit",
          textAlign: "inherit",
          lineHeight: "inherit",
          textShadow: "inherit",
          wordBreak: "keep-all",
          caretColor,
          fieldSizing: "content",
        } as React.CSSProperties
      }
    />
  );
}
