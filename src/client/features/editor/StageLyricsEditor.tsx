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

function supportsFieldSizing(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");
}

/**
 * 편집 캔버스의 텍스트 박스 안에서 가사를 바로 고치는 입력칸. 송출과 같은 박스
 * 안에 그려 글꼴·크기·정렬·줄바꿈이 송출 화면과 똑같이 보인다.
 *
 * 높이는 `field-sizing: content`가 내용에 맞춘다. 이 속성이 없는 브라우저(Safari 26.2 미만,
 * Firefox ESR 140)는 행이 한 줄로 잡혀 나머지 줄이 가려지므로, 줄 수로 행을 잡고 렌더마다
 * 내용 높이를 재서 맞춘다. 칸 안에서 줄이 감겨 늘어난 만큼도, 글자 크기 단축키로 바뀐 높이도
 * 이때 따라온다.
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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || supportsFieldSizing()) return;
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    if (contentHeight > 0) el.style.height = `${contentHeight}px`;
  });

  return (
    <textarea
      ref={ref}
      data-testid="stage-lyrics-editor"
      data-editor-history
      aria-label={EDITOR_COPY.slide.editLyrics}
      rows={Math.max(1, slide.lines.length)}
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
