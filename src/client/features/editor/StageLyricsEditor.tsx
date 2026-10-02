import React, { useLayoutEffect, useRef } from "react";
import type { Slide } from "#shared";
import { exceedsSlideLimits } from "#shared";
import { EDITOR_COPY } from "#copy/editor";

/** 편집을 시작할 때 커서를 둘 곳. 나눈 뒷장은 맨 앞에서 이어 쓴다 */
export type CaretPlacement = "start" | "end";

interface StageLyricsEditorProps {
  slide: Slide;
  caretColor: string;
  initialCaret?: CaretPlacement;
  onChangeLines: (lines: string[]) => void;
  onLimitHit: () => void;
  onCaretChange: (offset: number) => void;
  onSplit: (offset: number) => void;
  onExit: () => void;
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
      aria-label={EDITOR_COPY.slide.editLyrics}
      rows={1}
      value={slide.lines.join("\n")}
      placeholder={EDITOR_COPY.slide.lyricsPlaceholder}
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
      className="m-0 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none select-text placeholder:text-current placeholder:opacity-40"
      style={
        {
          font: "inherit",
          color: "inherit",
          textAlign: "inherit",
          lineHeight: "inherit",
          textShadow: "inherit",
          wordBreak: "keep-all",
          caretColor,
          minWidth: "4ch",
          fieldSizing: "content",
        } as React.CSSProperties
      }
    />
  );
}
