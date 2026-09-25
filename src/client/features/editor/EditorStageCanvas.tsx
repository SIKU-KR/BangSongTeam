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
      className="rounded-lg border-2 border-dashed border-current py-[0.3em] text-[0.5em] opacity-60"
    >
      더블클릭하여 가사 입력
    </div>
  ) : undefined;

  if (!slide || totalSlideCount === 0) {
    return (
      <div
        data-testid="editor-stage-canvas"
        className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-zinc-100 p-6 select-none dark:bg-zinc-900/60 ${className}`}
      >
        <div className="flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-xl dark:border-zinc-800 dark:bg-zinc-950/80 dark:shadow-2xl">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-100 text-emerald-600 dark:border-zinc-700/60 dark:bg-zinc-900 dark:text-emerald-400">
            <svg className="size-8 fill-current" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
          </div>

          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
              등록된 찬양 곡 또는 슬라이드가 없습니다
            </h3>
            <p className="mt-1 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
              새 찬양 가사를 빠른 입력으로 추가하여 프레젠테이션 제작을
              시작하세요.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {onOpenLyricModal && (
              <button
                type="button"
                onClick={onOpenLyricModal}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-500 dark:shadow-lg dark:shadow-emerald-950/50"
              >
                <svg
                  className="size-4"
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
      className={`relative flex flex-1 flex-col items-center justify-between overflow-hidden bg-zinc-100 px-6 pt-6 pb-2 select-none dark:bg-zinc-900/60 ${className}`}
    >
      <div className="flex w-full flex-1 items-center justify-center overflow-hidden py-2">
        <div
          data-editor-canvas
          tabIndex={-1}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            onRequestTextEdit?.();
          }}
          className="group relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl bg-black shadow-xl ring-1 ring-zinc-300 transition-transform duration-150 outline-none dark:shadow-2xl dark:shadow-black dark:ring-zinc-800"
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
              className="pointer-events-none absolute inset-y-0 left-1/2 z-30 w-px bg-emerald-400/80"
            />
          )}
          {draft?.guides.horizontal && (
            <div
              data-testid="snap-guide-horizontal"
              className="pointer-events-none absolute inset-x-0 top-1/2 z-30 h-px bg-emerald-400/80"
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
            className="absolute top-1/2 left-3 z-40 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-black/80 disabled:opacity-0"
            title="이전 슬라이드 (◀)"
          >
            <svg
              className="size-5"
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
            className="absolute top-1/2 right-3 z-40 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-black/80 disabled:opacity-0"
            title="다음 슬라이드 (▶)"
          >
            <svg
              className="size-5"
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
        className="mt-2 flex w-full max-w-4xl shrink-0 items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-400"
      >
        <div className="flex min-w-0 items-center gap-2">
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
          <div className="hidden items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-500 sm:flex dark:border-zinc-800 dark:bg-zinc-950/90 dark:text-zinc-400">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(50, zoomLevel - 15))}
              className="cursor-pointer px-1 font-bold hover:text-zinc-900 dark:hover:text-white"
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
              className="cursor-pointer px-1 font-bold hover:text-zinc-900 dark:hover:text-white"
              title="캔버스 확대"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="ml-1 cursor-pointer border-l border-zinc-200 pl-1.5 text-[11px] text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-200"
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
