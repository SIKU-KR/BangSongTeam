import React, { useState } from "react";
import type { Slide, DeckStyle, TextBoxPosition } from "#shared";
import { DEFAULT_DECK_STYLE } from "#shared";
import { SlideStage } from "../../components/stage/SlideStage";
import { TextBoxMoveable } from "./TextBoxMoveable";
import type { SnapGuides } from "./textBoxDrag";

export interface EditorStageCanvasProps {
  slide?: Slide | null;
  style?: DeckStyle;
  backgroundUrl?: string;
  backgroundImageUrl?: string;
  posterUrl?: string;
  slideNumber: number;
  totalSlideCount: number;
  songNumber: number;
  totalSongs: number;
  onPrevSlide: () => void;
  onNextSlide: () => void;
  zoomLevel?: number;
  onZoomChange?: (zoom: number) => void;
  onOpenLyricModal?: () => void;
  onUpdateStyle?: (update: Partial<DeckStyle>) => void;
  /** 가사 줄 대신 텍스트 박스 안에 그릴 직접 편집기. 있으면 박스 이동·폭 조절을 끈다 */
  textEditor?: React.ReactNode;
  onRequestTextEdit?: () => void;
  /** 상태 표시줄 왼쪽에 덧붙일 항목 (줄 수, 넘침 경고) */
  statusItems?: React.ReactNode;
  className?: string;
}

/** 슬라이드 편집 캔버스 작업 공간 컴포넌트. */
export function EditorStageCanvas({
  slide,
  style,
  backgroundUrl,
  backgroundImageUrl,
  posterUrl,
  slideNumber,
  totalSlideCount,
  songNumber,
  totalSongs,
  onPrevSlide,
  onNextSlide,
  zoomLevel = 100,
  onZoomChange,
  onOpenLyricModal,
  onUpdateStyle,
  textEditor,
  onRequestTextEdit,
  statusItems,
  className = "",
}: EditorStageCanvasProps): React.JSX.Element {
  const [textBoxEl, setTextBoxEl] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{
    position: TextBoxPosition;
    guides: SnapGuides;
  } | null>(null);

  const isEditingText = textEditor !== undefined;
  const baseStyle = style ?? DEFAULT_DECK_STYLE;
  const effectiveStyle = draft
    ? { ...baseStyle, position: draft.position }
    : baseStyle;
  const canEditTextBox = !!onUpdateStyle && !!slide && !isEditingText;
  const refreshKey = JSON.stringify([effectiveStyle, slide?.lines, zoomLevel]);
  const textContent = isEditingText ? (
    textEditor
  ) : slide && slide.lines.length === 0 && onRequestTextEdit ? (
    <div
      data-testid="empty-slide-placeholder"
      className="rounded-lg border-2 border-dashed border-current py-[0.3em] opacity-60 text-[0.5em]"
    >
      더블클릭하여 가사 입력
    </div>
  ) : undefined;

  if (!slide || totalSlideCount === 0) {
    return (
      <div
        data-testid="editor-stage-canvas"
        className={`relative flex-1 bg-zinc-100 dark:bg-zinc-900/60 overflow-hidden flex flex-col items-center justify-center p-6 select-none ${className}`}
      >
        <div className="w-full max-w-xl p-8 rounded-2xl bg-white dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800 text-center flex flex-col items-center gap-4 shadow-xl dark:shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
          </div>

          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
              등록된 찬양 곡 또는 슬라이드가 없습니다
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-md">
              새 찬양 가사를 빠른 입력으로 추가하여 프레젠테이션 제작을
              시작하세요.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {onOpenLyricModal && (
              <button
                type="button"
                onClick={onOpenLyricModal}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm dark:shadow-lg dark:shadow-emerald-950/50 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>가사 붙여넣기로 새 곡 추가</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const zoomScale = zoomLevel / 100;

  return (
    <div
      data-testid="editor-stage-canvas"
      className={`relative flex-1 bg-zinc-100 dark:bg-zinc-900/60 overflow-hidden flex flex-col items-center justify-between px-6 pt-6 pb-2 select-none ${className}`}
    >
      <div className="flex-1 w-full flex items-center justify-center overflow-hidden py-2">
        <div
          data-editor-canvas
          tabIndex={-1}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            onRequestTextEdit?.();
          }}
          className="relative w-full max-w-4xl aspect-video rounded-xl overflow-hidden shadow-xl ring-1 ring-zinc-300 dark:shadow-2xl dark:shadow-black dark:ring-zinc-800 bg-black group outline-none transition-transform duration-150"
          style={{
            transform: `scale(${zoomScale})`,
            transformOrigin: "center center",
          }}
        >
          <SlideStage
            slide={slide}
            style={effectiveStyle}
            backgroundUrl={backgroundUrl}
            backgroundImageUrl={backgroundImageUrl}
            posterUrl={posterUrl}
            textBoxRef={setTextBoxEl}
            isTextInteracting={draft !== null || isEditingText}
            textContent={textContent}
          />

          {draft?.guides.vertical && (
            <div
              data-testid="snap-guide-vertical"
              className="absolute inset-y-0 left-1/2 w-px bg-emerald-400/80 pointer-events-none z-30"
            />
          )}
          {draft?.guides.horizontal && (
            <div
              data-testid="snap-guide-horizontal"
              className="absolute inset-x-0 top-1/2 h-px bg-emerald-400/80 pointer-events-none z-30"
            />
          )}

          {canEditTextBox && (
            <TextBoxMoveable
              target={textBoxEl}
              refreshKey={refreshKey}
              onPreview={(position, guides) =>
                setDraft(position ? { position, guides } : null)
              }
              onCommit={(position) => onUpdateStyle?.({ position })}
              onDoubleClick={onRequestTextEdit}
            />
          )}

          <button
            type="button"
            data-testid="canvas-prev-btn"
            disabled={slideNumber <= 1}
            onClick={onPrevSlide}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-40 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-sm border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer shadow-lg"
            title="이전 슬라이드 (◀)"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <button
            type="button"
            data-testid="canvas-next-btn"
            disabled={slideNumber >= totalSlideCount}
            onClick={onNextSlide}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-40 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-sm border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer shadow-lg"
            title="다음 슬라이드 (▶)"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>

      <div
        data-testid="editor-status-bar"
        className="w-full max-w-4xl mt-2 flex items-center justify-between gap-3 shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-zinc-700 dark:text-zinc-300">
            슬라이드 {slideNumber}/{totalSlideCount}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">
            곡 {songNumber}/{totalSongs}
          </span>
          {statusItems}
        </div>

        {onZoomChange && (
          <div className="hidden sm:flex items-center gap-1 bg-white dark:bg-zinc-950/90 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(50, zoomLevel - 15))}
              className="hover:text-zinc-900 dark:hover:text-white px-1 font-bold cursor-pointer"
              title="캔버스 축소"
            >
              -
            </button>
            <span className="w-12 text-center font-mono text-zinc-800 dark:text-zinc-200">
              {zoomLevel}%
            </span>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(150, zoomLevel + 15))}
              className="hover:text-zinc-900 dark:hover:text-white px-1 font-bold cursor-pointer"
              title="캔버스 확대"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="ml-1 pl-1.5 border-l border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
              title="100% 원본 맞춤"
            >
              맞춤
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
